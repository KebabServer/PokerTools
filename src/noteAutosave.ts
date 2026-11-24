import type { NoteText, privateNotes, SavedNote } from './notes.ts'
import { insertNoteLink } from './noteMarkdown.ts'
import { emptyNotePages, firstPageId, pagesForNote, sameNoteText, type NotePageText } from './notePages.ts'

export class NoteChangedError extends Error {}
type Repository = ReturnType<typeof privateNotes>
export type NoteLinkSource = { id: string; pageId: string; body: string; range: { start: number; end: number } | null }
type Range = { start: number; end: number }
type BodySnapshot = { body: string; range?: Range }
type BodyEdit = { before: BodySnapshot; after: BodySnapshot; inputType?: string; time: number }
type BodyEditOptions = { before?: Range; after?: Range; inputType?: string }
type BodyHistory = { undo: BodyEdit[]; redo: BodyEdit[] }

type Entry = {
  note: SavedNote
  acknowledged: SavedNote
  dirty: boolean
  problem?: Error
  timer?: ReturnType<typeof setTimeout>
  writing?: Promise<void>
  busy?: boolean
  history: Map<string, BodyHistory>
}

const delay = 650
const conflict = () => new NoteChangedError('This note changed or was deleted elsewhere. Save a copy to keep your draft.')
const clean = (note: SavedNote): Entry => ({ note, acknowledged: note, dirty: false, history: new Map() })
const content = ({ title, body, pinned, pages }: NoteText): NoteText => ({ title, body, pinned, pages })

function updatePage(note: SavedNote, pageId: string, patch: Partial<NotePageText>): SavedNote {
  if (pageId === firstPageId) {
    return { ...note, body: patch.body ?? note.body, pages: { ...note.pages, firstTitle: patch.title ?? note.pages.firstTitle } }
  }
  const extra = note.pages.extra.map(page => page.id === pageId ? { ...page, ...patch } : page)
  return { ...note, pages: { ...note.pages, extra } }
}

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
      if (!entry.dirty || (received && sameNoteText(entry.note, received))) {
        if (received) {
          cancelTimer(entry)
          const next = clean(received)
          const previousPages = new Map(pagesForNote(entry.note).map(page => [page.id, page.body]))
          for (const page of pagesForNote(received)) {
            const history = entry.history.get(page.id)
            if (history && previousPages.get(page.id) === page.body) next.history.set(page.id, history)
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

  function edit(id: string, patch: Partial<Pick<NoteText, 'title' | 'pinned'>>) {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const updated = { ...entry.note, ...patch }
    if (!sameNoteText(entry.note, updated)) applyEdit(entry, updated)
  }

  function addPage(id: string) {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const page = { id: crypto.randomUUID(), title: '', body: '' }
    const pages = { ...entry.note.pages, extra: [...entry.note.pages.extra, page] }
    applyEdit(entry, { ...entry.note, pages })
    return page.id
  }

  function editPage(id: string, pageId: string, patch: Partial<NotePageText>, options?: BodyEditOptions) {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const page = pagesForNote(entry.note).find(page => page.id === pageId)
    if (!page) return
    const updated = { ...page, ...patch }
    if (page.title === updated.title && page.body === updated.body) return
    if (page.body !== updated.body) {
      const history = entry.history.get(pageId) ?? { undo: [], redo: [] }
      const before = { body: page.body, range: options?.before }
      const after = { body: updated.body, range: options?.after }
      const previous = history.undo.at(-1)
      const inputType = options?.inputType
      const time = Date.now()
      const cursor = before.range
      if (inputType && previous?.inputType === inputType && time - previous.time < 750 && cursor
        && cursor.start === cursor.end && previous.after.range?.start === cursor.start && previous.after.range.end === cursor.end) {
        previous.after = after
        previous.time = time
      } else {
        history.undo.push({ before, after, inputType, time })
        if (history.undo.length > 100) history.undo.shift()
      }
      history.redo = []
      entry.history.set(pageId, history)
    }
    applyEdit(entry, updatePage(entry.note, pageId, patch))
  }

  function navigateHistory(id: string, pageId: string, action: 'undo' | 'redo') {
    const entry = entries.get(id)
    if (!entry || entry.busy) return
    const history = entry.history.get(pageId)
    if (!history) return
    const change = history[action].pop()
    if (!change) return
    change.inputType = undefined
    history[action === 'undo' ? 'redo' : 'undo'].push(change)
    const target = action === 'undo' ? change.before : change.after
    applyEdit(entry, updatePage(entry.note, pageId, { body: target.body }))
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
    const page = entry && pagesForNote(entry.note).find(page => page.id === source.pageId)
    if (!entry || !target || !page || entry.busy || target.busy || source.id === targetId) {
      throw new Error('That note is unavailable.')
    }
    const range = page.body === source.body ? source.range : null
    const change = insertNoteLink(page.body, range, targetId, target.note.title)
    const before = range ?? { start: page.body.length, end: page.body.length }
    editPage(source.id, source.pageId, { body: change.text }, { before, after: change })
    return change
  }

  function create(title = '', source?: NoteLinkSource) {
    return mutate(async () => {
      const note = await repository.save(crypto.randomUUID(), { title, body: '', pinned: false, pages: emptyNotePages }, null)
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
    refresh, edit, addPage, editPage, navigateHistory, create, link, remove, copy, flush,
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
