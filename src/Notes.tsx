import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from './library.ts'
import { NoteChangedError, privateNotes, type NoteSummary, type SavedNote } from './notes.ts'
import './notes.css'

type Editor = { id: string; saved: SavedNote | null; title: string; body: string }
const blankNote = (): Editor => ({ id: crypto.randomUUID(), saved: null, title: '', body: '' })
const openEditor = (note: SavedNote): Editor => ({ id: note.id, saved: note, title: note.title, body: note.body })

function NoteWorkspace({ userId }: { userId: string }) {
  const [library] = useState(() => privateNotes(userId))
  const [notes, setNotes] = useState<NoteSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [editor, setEditor] = useState(blankNote)
  const [pending, setPending] = useState('')
  const [problem, setProblem] = useState<{ text: string; conflict?: boolean; canCopy?: boolean }>()
  const inFlight = useRef(false)
  const paper = useRef<HTMLTextAreaElement>(null)
  const dirty = editor.title !== (editor.saved?.title ?? '') || editor.body !== (editor.saved?.body ?? '')

  useEffect(() => {
    const controller = new AbortController()
    void library.list(controller.signal).then(rows => {
      if (!controller.signal.aborted) setNotes(rows)
    }, () => {
      if (!controller.signal.aborted) setLoadError(true)
    })
    return () => controller.abort()
  }, [library, retry])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function run(label: string, failure: string, action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(label)
    setProblem(undefined)
    try {
      await action()
    } catch (error) {
      setProblem(error instanceof NoteChangedError
        ? { text: error.message, conflict: true, canCopy: label === 'Saving…' }
        : { text: failure })
    } finally {
      inFlight.current = false
      setPending('')
    }
  }

  function canLeave() {
    return !inFlight.current && (!dirty || window.confirm('Discard unsaved changes to this note?'))
  }

  function newNote() {
    if (!canLeave()) return
    setEditor(blankNote())
    setProblem(undefined)
    paper.current?.focus()
  }

  function openNote(id: string) {
    if ((!problem?.conflict && id === editor.saved?.id) || !canLeave()) return
    void run('Opening…', 'Couldn’t open this note.', async () => {
      const note = await library.read(id)
      if (!note) throw new Error('Note unavailable.')
      setEditor(openEditor(note))
    })
  }

  function save(copy = false) {
    if (!dirty || inFlight.current) return
    const baseTitle = editor.title.trim() || editor.body.split('\n').find(line => line.trim())?.trim() || 'Untitled note'
    const suffix = copy ? ' (copy)' : ''
    const title = Array.from(baseTitle).slice(0, 120 - suffix.length).join('').trimEnd() + suffix
    const target = copy ? { ...editor, id: crypto.randomUUID(), saved: null, title } : editor
    if (copy) setEditor(target)
    void run('Saving…', 'Couldn’t save this note. Your edits are still here.', async () => {
      const note = await library.save(target.id, { title, body: target.body }, target.saved?.updated_at ?? null)
      const { id, updated_at } = note
      setNotes(rows => [{ id, title: note.title, updated_at }, ...(rows ?? []).filter(row => row.id !== id)])
      setEditor(openEditor(note))
    })
  }

  function remove() {
    const note = editor.saved
    if (!note || inFlight.current || !window.confirm('Delete this note?')) return
    void run('Deleting…', 'Couldn’t delete this note.', async () => {
      await library.remove(note)
      setNotes(rows => rows?.filter(row => row.id !== note.id) ?? [])
      setEditor(blankNote())
    })
  }

  function shortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      save()
    }
  }

  return <div className="notes-workspace" onKeyDown={shortcut}>
    <div className="tool-heading">
      <h1>Notes</h1>
      {notes && <button type="button" className="button" disabled={!!pending} onClick={newNote}><Plus size={16} />New note</button>}
    </div>
    {loadError && <section className="panel review-panel">
      <p className="error" role="alert">Couldn’t load your notes.</p>
      <button type="button" className="button notes-retry" onClick={() => { setLoadError(false); setRetry(value => value + 1) }}>Retry</button>
    </section>}
    {!loadError && !notes && <p role="status">Loading notes…</p>}
    {notes && <div className="notes-layout">
      <aside className="panel notes-sidebar" aria-label="Saved notes">
        <div className="notes-saved-list">
          <h2>Saved notes</h2>
          {notes.length ? <ul aria-label="Saved notes">{notes.map(note => <li key={note.id}>
            <button type="button" aria-current={editor.saved?.id === note.id ? 'true' : undefined}
              disabled={!!pending} onClick={() => openNote(note.id)}>{note.title}</button>
          </li>)}</ul> : <p>No saved notes yet.</p>}
        </div>
        <label className="notes-picker">
          <span className="sr-only">Saved notes</span>
          <select aria-label="Saved notes" value={editor.saved?.id ?? ''} disabled={!!pending || !notes.length}
            onChange={event => openNote(event.target.value)}>
            <option value="" disabled>{notes.length ? 'Open a saved note' : 'No saved notes yet'}</option>
            {notes.map(note => <option value={note.id} key={note.id}>{note.title}</option>)}
          </select>
        </label>
      </aside>
      <form className="panel notepad" aria-label="Note editor" onSubmit={event => { event.preventDefault(); save() }}>
        <label className="notepad-title">
          <span className="sr-only">Note title</span>
          <input name="title" placeholder="Untitled note" maxLength={120} value={editor.title} readOnly={!!pending}
            onChange={event => setEditor({ ...editor, title: event.target.value })} />
        </label>
        <label>
          <span className="sr-only">Note text</span>
          <textarea name="body" placeholder="Write a note…" ref={paper} value={editor.body} readOnly={!!pending} spellCheck={false}
            onChange={event => setEditor({ ...editor, body: event.target.value })} />
        </label>
        <div className="notepad-footer">
          <p className="notepad-status" role="status">{pending || (dirty ? 'Unsaved changes' : editor.saved ? 'Saved to Supabase' : '')}</p>
          <div className="notepad-actions">
            {editor.saved && <button type="button" className="icon-button" aria-label="Delete note" disabled={!!pending} onClick={remove}><Trash2 size={16} /></button>}
            <button type="submit" className="button primary" disabled={!dirty || !!pending}>Save</button>
          </div>
        </div>
        {problem && <div className="notepad-problem">
          <p className="error" role="alert">{problem.text}</p>
          {problem.conflict && <div className="notepad-actions">
            {problem.canCopy && <button type="button" className="button" onClick={() => save(true)}>Save a copy</button>}
            <button type="button" className="button" onClick={() => openNote(editor.id)}>Reopen saved note</button>
          </div>}
        </div>}
      </form>
    </div>}
  </div>
}

export default function Notes({ userId }: { userId?: string }) {
  if (userId && supabase) return <NoteWorkspace key={userId} userId={userId} />
  return <div className="notes-workspace">
    <div className="tool-heading"><h1>Notes</h1></div>
    <section className="panel review-panel">
      {supabase ? <>
        <p>Sign in to write and open your notes.</p>
        <a className="button primary notes-retry" href="#library">Sign in</a>
      </> : <p className="error">Configure Supabase to use Notes.</p>}
    </section>
  </div>
}
