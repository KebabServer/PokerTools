import type { NoteText, privateNotes, SavedNote } from './notes.ts'
import { insertNoteLink } from './noteMarkdown.ts'

export class NoteChangedError extends Error {}
type Repository = ReturnType<typeof privateNotes>
export type NoteLinkSource = { id: string; body: string; range: { start: number; end: number } | null }
type Range = { start: number; end: number }
type BodySnapshot = { body: string; range?: Range }
type BodyEdit = { before: BodySnapshot; after: BodySnapshot; inputType?: string; time: number }
type BodyEditOptions = { before?: Range; after?: Range; inputType?: string }

type Entry = {
  note: SavedNote
  acknowledged: SavedNote
  dirty: boolean
  problem?: Error
  timer?: ReturnType<typeof setTimeout>
  writing?: Promise<void>
  busy?: boolean
  undo: BodyEdit[]
  redo: BodyEdit[]
}

const delay = 650
const conflict = () => new NoteChangedError('This note changed or was deleted elsewhere. Save a copy to keep your draft.')
const clean = (note: SavedNote): Entry => ({ note, acknowledged: note, dirty: false, undo: [], redo: [] })
const content = ({ title, body, pinned }: NoteText): NoteText => ({ title, body, pinned })
const sameContent = (a: NoteText, b: NoteText) => a.title === b.title && a.body === b.body && a.pinned === b.pinned

export function createNoteStore(repository: Repository) {
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  const operations = new Set<Promise<unknown>>()
  let snapshot: readonly Entry[] = []
  let refreshSequence = 0
  let revision = 0

  function publish() {
    snapshot = [...entries.values()]
    listeners.forEach(listener => listener())
  }

  function cancelTimer(entry: Entry) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }

  async function refresh(signal?: AbortSignal) {
    const request = ++refreshSequence
    const started = revision
    const notes = await repository.list(signal)
    if (signal?.aborted || request !== refreshSequence) return
    if (started !== revision) return refresh(signal)
    const remote = new Map(notes.map(note => [note.id, note]))
    const pending = new Set<Promise<unknown>>(operations)
    for (const [id, entry] of entries) {
      const received = remote.get(id)
      remote.delete(id)
      if (entry.writing) pending.add(entry.writing)
      if (entry.writing || entry.busy) continue
      if (!entry.dirty || (received && sameContent(entry.note, received))) {
        if (received) {
          cancelTimer(entry)
          const next = clean(received)
          if (received.body === entry.note.body) {
            next.undo = entry.undo
            next.redo = entry.redo
          }
          entries.set(id, next)
        } else entries.delete(id)
      } else if (received?.updated_at !== entry.acknowledged.updated_at) {
        cancelTimer(entry)
        entry.problem = conflict()
      }
    }
    for (const note of remote.values()) entries.set(note.id, clean(note))
    publish()
    if (pending.size) {
      await Promise.allSettled(pending)
      if (!signal?.aborted && request === refreshSequence) return refresh(signal)
    }
  }

  function save(entry: Entry): Promise<void> {
    if (entry.writing) return entry.writing
    if (!entry.dirty || entry.busy) return Promise.resolve()
    const sent = entry.note
    entry.problem = undefined
    revision++
    entry.writing = repository.save(sent.id, content(sent), entry.acknowledged.updated_at).then(note => {
      entry.acknowledged = note
      if (entry.note === sent) {
        entry.note = note
        entry.dirty = false
      }
    }).catch(error => {
      entry.problem = error instanceof Error ? error : new Error('Couldn’t save this note.')
      cancelTimer(entry)
    }).finally(() => {
      entry.writing = undefined
      revision++
      publish()
      if (entry.dirty && !entry.timer && !entry.busy && !entry.problem) void save(entry)
    })
    publish()
    return entry.writing
  }

  function applyEdit(entry: Entry, updated: SavedNote) {
    entry.note = { ...updated, updated_at: new Date().toISOString() }
    entry.dirty = true
    if (!(entry.problem instanceof NoteChangedError)) {
      entry.problem = undefined
      cancelTimer(entry)
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        void save(entry)
      }, delay)
    }
    publish()
  }

  function edit(id: string, patch: Partial<NoteText>, options?: BodyEditOptions) {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const updated = { ...entry.note, ...patch }
    if (sameContent(entry.note, updated)) return
    if (entry.note.body !== updated.body) {
      const before = { body: entry.note.body, range: options?.before }
      const after = { body: updated.body, range: options?.after }
      const previous = entry.undo.at(-1)
      const inputType = options?.inputType
      const time = Date.now()
      const cursor = before.range
      if (inputType && previous?.inputType === inputType && time - previous.time < 750 && cursor
        && cursor.start === cursor.end && previous.after.range?.start === cursor.start && previous.after.range.end === cursor.end) {
        previous.after = after
        previous.time = time
      } else {
        entry.undo.push({ before, after, inputType, time })
        if (entry.undo.length > 100) entry.undo.shift()
      }
      entry.redo = []
    }
    applyEdit(entry, updated)
  }

  function navigateHistory(id: string, action: 'undo' | 'redo') {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const change = entry[action].pop()
    if (!change) return
    change.inputType = undefined
    entry[action === 'undo' ? 'redo' : 'undo'].push(change)
    const target = action === 'undo' ? change.before : change.after
    applyEdit(entry, { ...entry.note, body: target.body })
    return target.range ?? { start: target.body.length, end: target.body.length }
  }

  function mutate<T>(work: () => Promise<T>) {
    revision++
    const operation = work().finally(() => {
      operations.delete(operation)
      revision++
      publish()
    })
    operations.add(operation)
    return operation
  }

  function link(source: NoteLinkSource, targetId: string) {
    const entry = entries.get(source.id)
    const target = entries.get(targetId)
    if (!entry || !target || entry.busy || target.busy || source.id === targetId) {
      throw new Error('That note is unavailable.')
    }
    const range = entry.note.body === source.body ? source.range : null
    const change = insertNoteLink(entry.note.body, range, targetId, target.note.title)
    const before = range ?? { start: entry.note.body.length, end: entry.note.body.length }
    edit(source.id, { body: change.text }, { before, after: change })
    return change
  }

  function create(title = '', source?: NoteLinkSource) {
    return mutate(async () => {
      const note = await repository.save(crypto.randomUUID(), { title, body: '', pinned: false }, null)
      entries.set(note.id, clean(note))
      if (source) link(source, note.id)
      return note
    })
  }

  function remove(id: string) {
    return mutate(async () => {
      const entry = entries.get(id)
      if (!entry || entry.busy) return
      entry.busy = true
      cancelTimer(entry)
      publish()
      try {
        await entry.writing
        await repository.remove(entry.acknowledged)
        entries.delete(id)
      } catch (error) {
        if (entry.dirty) entry.problem = error instanceof Error ? error : new Error('Couldn’t delete the note.')
        throw error
      } finally {
        entry.busy = false
      }
    })
  }

  function copy(id: string) {
    return mutate(async () => {
      const entry = entries.get(id)
      if (!entry || entry.busy || entry.writing) return
      entry.busy = true
      cancelTimer(entry)
      publish()
      try {
        const original = await repository.read(id)
        const base = entry.note.title.trim() || 'Untitled note'
        const title = Array.from(base).slice(0, 113).join('').trimEnd() + ' (copy)'
        const note = await repository.save(crypto.randomUUID(), { ...content(entry.note), title }, null)
        if (original) entries.set(id, clean(original))
        else entries.delete(id)
        entries.set(note.id, clean(note))
        return note
      } finally {
        entry.busy = false
      }
    })
  }

  async function flush() {
    for (;;) {
      await Promise.allSettled([...operations])
      const dirty = [...entries.values()].filter(entry => entry.dirty)
      if (!dirty.length) return
      for (const entry of dirty) cancelTimer(entry)
      await Promise.all(dirty.map(save))
      const failed = dirty.find(entry => entry.dirty && entry.problem)
      if (failed) throw failed.problem
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh, edit, navigateHistory, create, link, remove, copy, flush,
    retry(id: string) {
      const entry = entries.get(id)
      if (!entry) return
      cancelTimer(entry)
      void save(entry)
    },
    cancelTimers() {
      for (const entry of entries.values()) cancelTimer(entry)
    },
  }
}
