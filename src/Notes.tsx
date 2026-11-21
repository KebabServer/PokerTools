import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Bold, Eye, FileText, Hash, Italic, Link2, List, ListChecks, Pencil, Plus, Quote, Trash2, Type } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './library.ts'
import { countNoteWords, formatNote, type NoteFormat } from './noteMarkdown.ts'
import { NoteChangedError, privateNotes, type NoteSummary, type SavedNote } from './notes.ts'
import './notes.css'

type Editor = { id: string; saved: SavedNote | null; title: string; body: string }
const blankNote = (): Editor => ({ id: crypto.randomUUID(), saved: null, title: '', body: '' })
const openEditor = (note: SavedNote): Editor => ({ id: note.id, saved: note, title: note.title, body: note.body })
const editedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const formatting = [
  { format: 'paragraph', label: 'Paragraph', Icon: Type },
  { format: 'bold', label: 'Bold', Icon: Bold },
  { format: 'italic', label: 'Italic', Icon: Italic },
  { format: 'bullet', label: 'Bulleted list', Icon: List },
  { format: 'checklist', label: 'Checklist', Icon: ListChecks },
  { format: 'quote', label: 'Quote', Icon: Quote },
  { format: 'heading', label: 'Heading', Icon: Hash },
  { format: 'link', label: 'Link', Icon: Link2 },
] as const

function NoteWorkspace({ userId }: { userId: string }) {
  const [library] = useState(() => privateNotes(userId))
  const [notes, setNotes] = useState<NoteSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [editor, setEditor] = useState(blankNote)
  const [preview, setPreview] = useState(false)
  const [pending, setPending] = useState('')
  const [problem, setProblem] = useState<{ text: string; conflict?: boolean; canCopy?: boolean }>()
  const inFlight = useRef(false)
  const paper = useRef<HTMLTextAreaElement>(null)
  const selectionToRestore = useRef<{ start: number; end: number } | null>(null)
  const dirty = editor.title !== (editor.saved?.title ?? '') || editor.body !== (editor.saved?.body ?? '')
  const wordCount = useMemo(() => countNoteWords(editor.body), [editor.body])

  useLayoutEffect(() => {
    const selection = selectionToRestore.current
    selectionToRestore.current = null
    if (!selection || !paper.current || preview) return
    paper.current.focus()
    paper.current.setSelectionRange(selection.start, selection.end)
  }, [editor, preview])

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
    selectionToRestore.current = { start: 0, end: 0 }
    setEditor(blankNote())
    setPreview(false)
    setProblem(undefined)
  }

  function openNote(id: string) {
    if ((!problem?.conflict && id === editor.saved?.id) || !canLeave()) return
    void run('Opening…', 'Couldn’t open this note.', async () => {
      const note = await library.read(id)
      if (!note) throw new Error('Note unavailable.')
      setEditor(openEditor(note))
      setPreview(false)
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
      setPreview(false)
    })
  }

  function shortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      save()
    }
  }

  function applyFormat(format: NoteFormat) {
    const textarea = paper.current
    if (!textarea || preview || inFlight.current) return
    const change = formatNote(editor.body, textarea.selectionStart, textarea.selectionEnd, format)
    selectionToRestore.current = change
    setEditor({ ...editor, body: change.text })
  }

  return <div className="notes-workspace" onKeyDown={shortcut}>
    <div className="tool-heading">
      <h1 className={notes ? 'sr-only' : undefined}>Notes</h1>
      {notes && <div className="notes-switcher">
        <label>
          <span className="sr-only">Saved notes</span>
          <select aria-label="Saved notes" value={editor.saved?.id ?? ''} disabled={!!pending || !notes.length}
            onChange={event => openNote(event.target.value)}>
            <option value="" disabled>{notes.length ? 'Open a saved note' : 'No saved notes yet'}</option>
            {notes.map(note => <option value={note.id} key={note.id}>{note.title}</option>)}
          </select>
        </label>
        <button type="button" className="button" disabled={!!pending} onClick={newNote}>
          <Plus size={16} />New note
        </button>
      </div>}
    </div>
    {loadError && <section className="panel review-panel">
      <p className="error" role="alert">Couldn’t load your notes.</p>
      <button type="button" className="button notes-retry" onClick={() => { setLoadError(false); setRetry(value => value + 1) }}>Retry</button>
    </section>}
    {!loadError && !notes && <p role="status">Loading notes…</p>}
    {notes && <form className="notepad" aria-label="Note editor" onSubmit={event => { event.preventDefault(); save() }}>
        <div className="notepad-meta">
          <FileText size={14} aria-hidden="true" />
          {editor.saved ? <span>Edited <time dateTime={editor.saved.updated_at}>{editedDate.format(new Date(editor.saved.updated_at))}</time></span> : <span>Draft</span>}
        </div>
        <label className="notepad-title">
          <span className="sr-only">Note title</span>
          <input name="title" placeholder="Untitled note" maxLength={120} value={editor.title} readOnly={!!pending}
            onChange={event => setEditor({ ...editor, title: event.target.value })} />
        </label>
        <div className="notepad-toolbar">
          <div className="notepad-format" role="group" aria-label="Markdown formatting">
            {formatting.map(({ format, label, Icon }) => <button type="button" className="notepad-tool"
              key={format} title={label} aria-label={label} disabled={preview || !!pending}
              onMouseDown={event => event.preventDefault()} onClick={() => applyFormat(format)}>
              <Icon size={17} aria-hidden="true" />
            </button>)}
          </div>
          <div className="notepad-mode" role="group" aria-label="Note view">
            <button type="button" className="notepad-tool" aria-pressed={!preview} onClick={() => setPreview(false)}><Pencil size={15} aria-hidden="true" />Edit</button>
            <button type="button" className="notepad-tool" aria-pressed={preview} onClick={() => setPreview(true)}><Eye size={16} aria-hidden="true" />Preview</button>
          </div>
        </div>
        <label hidden={preview}>
          <span className="sr-only">Note text</span>
          <textarea name="body" placeholder="Write a note…" ref={paper} value={editor.body} readOnly={!!pending} spellCheck={false}
            onChange={event => setEditor({ ...editor, body: event.target.value })} />
        </label>
        {preview && <section className="notepad-preview" aria-label="Markdown preview">
          {editor.body.trim() ? <Markdown remarkPlugins={[remarkGfm]} disallowedElements={['img']}
            components={{ a: ({ node: _node, children, ...props }) => props.href
              ? <a {...props} target="_blank" rel="noreferrer">{children}</a>
              : <span>{children}</span> }}>
            {editor.body}
          </Markdown> : <p className="notepad-empty">Nothing to preview yet.</p>}
        </section>}
        <div className="notepad-info">
          <span>Markdown supported</span><span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
        </div>
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
      </form>}
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
