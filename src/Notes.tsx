import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { Bold, ChevronLeft, Eye, FileText, Hash, Italic, Link2, List, ListChecks, ListFilter, MoreHorizontal, Pencil, Pin, Plus, Quote, Search, Trash2, Type, X } from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './library.ts'
import { createNoteStore, NoteChangedError } from './noteAutosave.ts'
import { countNoteWords, formatNote, type NoteFormat } from './noteMarkdown.ts'
import { privateNotes, type SavedNote } from './notes.ts'
import './notes.css'

const formatting = [
  { format: 'heading', label: 'Heading', Icon: Type, divider: true },
  { format: 'bold', label: 'Bold', Icon: Bold },
  { format: 'italic', label: 'Italic', Icon: Italic, divider: true },
  { format: 'bullet', label: 'Bullet list', Icon: List },
  { format: 'checklist', label: 'Checklist', Icon: ListChecks },
  { format: 'quote', label: 'Quote', Icon: Quote, divider: true },
  { format: 'heading3', label: 'Heading 3', Icon: Hash },
  { format: 'link', label: 'Insert link', Icon: Link2 },
] as const

const markdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    if (!href) return children
    if (/^https?:\/\//i.test(href)) return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    if (href.startsWith('//')) return <a {...props} href={'https:' + href} target="_blank" rel="noopener noreferrer">{children}</a>
    return <a {...props} href={href}>{children}</a>
  },
}

const noteTitle = (note: SavedNote) => note.title.trim() || 'Untitled note'
const noteSnippet = (note: SavedNote) => note.body.replace(/[#*`>\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 95) || 'Empty note'

export default function Notes({ userId, active, locked, flushRef }: {
  userId: string; active: boolean; locked: boolean; flushRef: RefObject<(() => Promise<void>) | null>
}) {
  const [store] = useState(() => createNoteStore(privateNotes(userId)))
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned'>('all')
  const [showActions, setShowActions] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [problem, setProblem] = useState('')
  const paper = useRef<HTMLTextAreaElement>(null)
  const editorPane = useRef<HTMLElement>(null)
  const selection = useRef<{ start: number; end: number } | null>(null)
  const entry = entries.find(item => item.note.id === selectedId)
  const note = entry?.note
  const hasUnsaved = entries.some(item => item.dirty)
  const disabled = locked || !!entry?.busy

  const visible = useMemo(() => {
    const query = search.toLowerCase()
    return entries.map(item => item.note).filter(item =>
      (filter === 'all' || item.pinned) && (item.title + ' ' + item.body).toLowerCase().includes(query),
    ).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
  }, [entries, filter, search])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void store.refresh(controller.signal).then(() => {
        if (controller.signal.aborted) return
        setLoadFailed(false)
        setLoading(false)
      }).catch(() => {
        if (controller.signal.aborted) return
        setLoadFailed(true)
        setLoading(false)
      })
    }
    const syncOnReturn = () => { if (!document.hidden) refresh() }
    const channel = supabase?.channel('pokertools-notes:' + userId, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    refresh()
    window.addEventListener('focus', syncOnReturn)
    window.addEventListener('online', syncOnReturn)
    document.addEventListener('visibilitychange', syncOnReturn)
    flushRef.current = store.flush
    return () => {
      controller.abort()
      store.cancelTimers()
      flushRef.current = null
      window.removeEventListener('focus', syncOnReturn)
      window.removeEventListener('online', syncOnReturn)
      document.removeEventListener('visibilitychange', syncOnReturn)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [store, userId, flushRef])

  useEffect(() => {
    if (!hasUnsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsaved])

  useLayoutEffect(() => {
    if (active) setPreview(true)
  }, [active])

  useLayoutEffect(() => {
    setShowActions(false)
    editorPane.current?.scrollTo(0, 0)
  }, [selectedId])

  useLayoutEffect(() => {
    const caret = selection.current
    selection.current = null
    if (!caret || !paper.current || preview || !active) return
    paper.current.focus()
    paper.current.setSelectionRange(caret.start, caret.end)
  }, [note, preview, active])

  function select(id: string | null, showPreview = true) {
    setSelectedId(id)
    setPreview(showPreview)
    setProblem('')
  }

  async function create() {
    if (creating || locked) return
    setCreating(true)
    setProblem('')
    try {
      const created = await store.create()
      setFilter('all')
      setSearch('')
      select(created.id, false)
    } catch {
      setProblem('Couldn’t create a note. Try again.')
    } finally {
      setCreating(false)
    }
  }

  async function remove() {
    if (!note || disabled || !window.confirm('Delete this note? This cannot be undone.')) return
    setShowActions(false)
    try {
      await store.remove(note.id)
      setSelectedId(current => current === note.id ? null : current)
    } catch {
      setProblem('Couldn’t delete this note. It may have changed elsewhere.')
    }
  }

  async function copy() {
    if (!note || disabled) return
    try {
      const created = await store.copy(note.id)
      if (!created) return
      setFilter('all')
      setSearch('')
      select(created.id, false)
    } catch {
      setProblem('Couldn’t save a copy. Your draft is still here.')
    }
  }

  function insertMarkdown(command: NoteFormat) {
    if (!note || disabled) return
    const start = paper.current?.selectionStart ?? note.body.length
    const change = formatNote(note.body, start, paper.current?.selectionEnd ?? start, command)
    selection.current = change
    setPreview(false)
    store.edit(note.id, { body: change.text })
  }

  const saveStatus = !entry?.dirty ? 'Autosaved' : entry.problem ? 'Not saved' : 'Saving...'

  return <div className={'notes-layout' + (note ? ' note-open-mobile' : '')}>
    <aside className="notes-list-pane" aria-label="Saved notes">
      <div className="notes-list-heading">
        <h1>Notes<span className="title-count" aria-label={entries.length + ' notes'}>{entries.length}</span></h1>
        <button type="button" className="icon-button accent" aria-label="Create note" title="Create note" disabled={creating || locked} onClick={() => void create()}><Plus size={20} /></button>
      </div>
      <div className="notes-search">
        <Search size={17} aria-hidden="true" />
        <input aria-label="Search your notes" placeholder="Search your notes..." value={search} onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={17} /></button>}
      </div>
      <div className="note-filter-row" aria-label="Filter notes" role="group">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><ListFilter size={14} /> All notes</button>
        <button type="button" aria-pressed={filter === 'pinned'} onClick={() => setFilter('pinned')}><Pin size={13} /> Pinned</button>
      </div>
      <div className="notes-scroll">
        {loadFailed && <p className="error notes-list-message" role="alert">Couldn’t refresh your notes.</p>}
        {loading ? <p role="status" className="notes-list-message">Loading notes...</p>
          : visible.length ? visible.map(item => <button type="button" key={item.id} onClick={() => select(item.id)}
            className="note-list-card" aria-current={item.id === selectedId ? 'true' : undefined}>
            <span className="note-list-top"><strong>{noteTitle(item)}</strong>{item.pinned && <Pin size={13} className="pin-small" aria-label="Pinned" />}</span>
            <span className="note-list-preview">{noteSnippet(item)}</span>
            <time className="note-list-date" dateTime={item.updated_at}><FileText size={12} />{formatDistanceToNow(parseISO(item.updated_at), { addSuffix: true })}</time>
          </button>) : <div className="notes-empty-list">
            <List size={22} /><strong>No notes found</strong>
            <p>{search ? 'Try another search.' : filter === 'pinned' ? 'Pin a note to see it here.' : 'Create your first note.'}</p>
            {!search && <button type="button" className="button" disabled={creating || locked} onClick={() => void create()}>New note</button>}
          </div>}
        {problem && !note && <p className="error notes-list-message" role="alert">{problem}</p>}
      </div>
    </aside>
    <section className="notes-editor-pane" aria-label="Note editor" ref={editorPane}>
      {entry && note ? <>
        <div className="editor-toolbar-top">
          <button type="button" className="editor-back" onClick={() => select(null)}><ChevronLeft size={17} /> All notes</button>
          <div className="editor-top-right">
            <span className="save-indicator" data-status={saveStatus} role="status"><span />{saveStatus}</span>
            {saveStatus === 'Not saved' && <button type="button" className="retry-save" disabled={disabled} onClick={() => store.retry(note.id)}>Retry</button>}
            <button type="button" className={'icon-button' + (note.pinned ? ' pin-active' : '')} disabled={disabled}
              onClick={() => store.edit(note.id, { pinned: !note.pinned })} aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
              title={note.pinned ? 'Unpin note' : 'Pin note'}><Pin size={18} /></button>
            <div className="note-actions" onKeyDown={event => { if (event.key === 'Escape') setShowActions(false) }}>
              <button type="button" className="icon-button" disabled={disabled} onClick={() => setShowActions(open => !open)}
                aria-label="Note actions" aria-expanded={showActions}><MoreHorizontal size={20} /></button>
              {showActions && <div className="notes-floating-menu"><button type="button" className="delete-action" onClick={() => void remove()}><Trash2 size={15} /> Delete note</button></div>}
            </div>
          </div>
        </div>
        {(problem || entry.problem instanceof NoteChangedError) && <div className="editor-alert" role="alert">
          <p className="error">{problem || 'This note changed or was deleted elsewhere. Your draft is still here.'}</p>
          {entry.problem instanceof NoteChangedError && entry.dirty && <button type="button" className="button small" disabled={disabled} onClick={() => void copy()}>Save a copy</button>}
        </div>}
        <div className="editor-body">
          <div className="editor-meta"><FileText size={14} /> NOTE <span>·</span> Edited {format(parseISO(note.updated_at), 'MMM d, yyyy')}</div>
          <input className="note-title-input" placeholder="Untitled note" aria-label="Note title" maxLength={120} value={note.title} readOnly={disabled}
            onChange={event => store.edit(note.id, { title: event.target.value })} />
          <div className="editor-format-toolbar" role="group" aria-label="Markdown formatting">
            {formatting.map(tool => <span className="notes-tool-group" key={tool.format}>
              <button type="button" title={tool.label} aria-label={tool.label} disabled={disabled || (preview && tool.format === 'link')}
                onMouseDown={event => event.preventDefault()} onClick={() => insertMarkdown(tool.format)}><tool.Icon size={17} /></button>
              {'divider' in tool && <span className="toolbar-divider" />}
            </span>)}
            <span className="toolbar-spacer" />
            <button type="button" className="editor-mode" aria-pressed={!preview} aria-label="Edit" title="Edit Markdown" onClick={() => setPreview(false)}><Pencil size={16} /><span>Edit</span></button>
            <button type="button" className="editor-mode" aria-pressed={preview} aria-label="Preview" title="Preview formatted note" onClick={() => setPreview(true)}><Eye size={16} /><span>Preview</span></button>
          </div>
          <textarea ref={paper} hidden={preview} className="note-content-input" placeholder="Write a note..." aria-label="Note content"
            value={note.body} readOnly={disabled} onChange={event => store.edit(note.id, { body: event.target.value })} />
          {preview && <div className="markdown-preview" aria-label="Markdown preview" role="region">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} disallowedElements={['img']}>
              {note.body || '*Nothing here yet. Switch to Edit and start writing.*'}
            </Markdown>
          </div>}
          <div className="editor-bottom-meta"><span>Markdown supported</span><span>{countNoteWords(note.body)} words</span></div>
        </div>
      </> : <div className="editor-placeholder">
        <span className="placeholder-art"><FileText size={38} /></span>
        <h2>Select a note</h2><p>Choose a note or create one.</p>
        <button type="button" className="button primary" disabled={creating || locked} onClick={() => void create()}><Plus size={17} /> Create a note</button>
      </div>}
    </section>
  </div>
}
