import type { NoteText, privateNotes, SavedNote } from './notes.ts'

export class NoteChangedError extends Error {}
type Repository = ReturnType<typeof privateNotes>

type Entry = {
  note: SavedNote
  acknowledged: SavedNote
  dirty: boolean
  problem?: Error
  timer?: ReturnType<typeof setTimeout>
  writing?: Promise<void>
  busy?: boolean
}

const delay = 650
const conflict = () => new NoteChangedError('This note changed or was deleted elsewhere. Save a copy to keep your draft.')
const clean = (note: SavedNote): Entry => ({ note, acknowledged: note, dirty: false })
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
          entries.set(id, clean(received))
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

  function edit(id: string, patch: Partial<NoteText>) {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const updated = { ...entry.note, ...patch }
    if (sameContent(entry.note, updated)) return
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

  function create() {
    return mutate(async () => {
      const note = await repository.save(crypto.randomUUID(), { title: '', body: '', pinned: false }, null)
      entries.set(note.id, clean(note))
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
    refresh, edit, create, remove, copy, flush,
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
