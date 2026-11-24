import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { Bold, ChevronLeft, ChevronRight, Eye, FileText, Hash, Italic, Link2, List, ListChecks, ListFilter, MoreHorizontal, Pencil, Pin, Plus, Quote, Redo2, Search, Table2, Trash2, Type, Undo2, X } from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from './library.ts'
import { createNoteStore, NoteChangedError, type NoteLinkSource } from './noteAutosave.ts'
import { continueTableBullet, countNoteWords, formatNote, insertNoteTable, noteHref, noteIdFromHref, type NoteFormat, type NoteTableSize } from './noteMarkdown.ts'
import { noteTableLists } from './noteTableLists.ts'
import { pagesForNote } from './notePages.ts'
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
    if (noteIdFromHref(href)) return <a {...props} href={href} className="note-link">{children}</a>
    if (/^https?:\/\//i.test(href)) return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    if (href.startsWith('//')) return <a {...props} href={'https:' + href} target="_blank" rel="noopener noreferrer">{children}</a>
    return <a {...props} href={href}>{children}</a>
  },
  table: ({ node, ...props }) => {
    const heading = node?.children.find(child => child.type === 'element' && child.tagName === 'thead')
    const row = heading?.type === 'element' ? heading.children.find(child => child.type === 'element' && child.tagName === 'tr') : undefined
    const columns = row?.type === 'element' ? row.children.filter(child => child.type === 'element' && child.tagName === 'th').length : 0
    return <div className="note-table-scroll" role="region" aria-label="Table" tabIndex={0}>
      <table {...props} role="table" style={{ '--note-table-columns': Math.max(1, columns) } as CSSProperties} />
    </div>
  },
  thead: ({ node: _node, ...props }) => <thead {...props} role="rowgroup" />,
  tbody: ({ node: _node, ...props }) => <tbody {...props} role="rowgroup" />,
  tr: ({ node: _node, ...props }) => <tr {...props} role="row" />,
  th: ({ node: _node, ...props }) => <th {...props} role="columnheader" />,
  td: ({ node: _node, ...props }) => <td {...props} role="cell" />,
}

const noteTitle = (note: SavedNote) => note.title.trim() || 'Untitled note'
const noteSnippet = (note: SavedNote) => (pagesForNote(note).find(page => page.body.trim())?.body ?? '').replace(/\]\(#notes\/[0-9a-f-]+\)/gi, ']')
  .replace(/[#*`>\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 95) || 'Empty note'

function navigationFromHash() {
  const id = noteIdFromHref(window.location.hash)
  const trail: unknown = window.history.state?.noteTrail
  return { id, trail: id && Array.isArray(trail) ? trail.filter((item): item is string => typeof item === 'string') : [] }
}

type EditorScroll = { paneTop: number; textTop: number; textLeft: number }
type EditorSelection = { start: number; end: number }

export default function Notes({ userId, active, locked, flushRef }: {
  userId: string; active: boolean; locked: boolean; flushRef: RefObject<(() => Promise<void>) | null>
}) {
  const [store] = useState(() => createNoteStore(privateNotes(userId)))
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [navigation, setNavigation] = useState(navigationFromHash)
  const { id: selectedId, trail } = navigation
  const [lastPages, setLastPages] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned'>('all')
  const [showActions, setShowActions] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [linkSource, setLinkSource] = useState<NoteLinkSource | null>(null)
  const [linkTarget, setLinkTarget] = useState('')
  const [linking, setLinking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [problem, setProblem] = useState('')
  const paper = useRef<HTMLTextAreaElement>(null)
  const pageName = useRef<HTMLInputElement>(null)
  const nameNewPage = useRef<string | null>(null)
  const tableButton = useRef<HTMLButtonElement>(null)
  const actionsButton = useRef<HTMLButtonElement>(null)
  const editorPane = useRef<HTMLElement>(null)
  const editorRestore = useRef<{ caret?: EditorSelection; scroll?: EditorScroll } | null>(null)
  const pickerScroll = useRef<EditorScroll | undefined>(undefined)
  const cursor = useRef<{ start: number; end: number } | undefined>(undefined)
  const entry = entries.find(item => item.note.id === selectedId)
  const note = entry?.note
  const pages = note ? pagesForNote(note) : []
  const pageIndex = note ? Math.max(0, pages.findIndex(item => item.id === lastPages[note.id])) : 0
  const page = pages[pageIndex]
  const history = page && entry?.history.get(page.id)
  const parentId = trail.at(-1)
  const parent = entries.find(item => item.note.id === parentId)?.note
  const parentTitle = parent ? noteTitle(parent) : 'Previous note'
  const hasUnsaved = entries.some(item => item.dirty)
  const disabled = locked || !!entry?.busy

  const visible = useMemo(() => {
    const query = search.toLowerCase()
    return entries.map(item => item.note).filter(item =>
      (filter === 'all' || item.pinned) && (!query || [item.title, ...pagesForNote(item).flatMap(page => [page.title, page.body])]
        .join(' ').toLowerCase().includes(query)),
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
    if (preview || !active) {
      setShowActions(false)
      setShowTable(false)
      setLinkSource(null)
      pickerScroll.current = undefined
    }
  }, [preview, active])

  useLayoutEffect(() => {
    function syncNavigation() {
      const next = navigationFromHash()
      if (!next.id && window.location.hash !== '#notes') return
      // The app's Notes tab reopens the last selected note.
      if (!next.id && !Array.isArray(window.history.state?.noteTrail) && navigation.id) {
        window.history.replaceState({ noteTrail: navigation.trail }, '', noteHref(navigation.id))
        return
      }
      setNavigation(next)
      setPreview(true)
      setProblem('')
    }
    window.addEventListener('hashchange', syncNavigation)
    return () => window.removeEventListener('hashchange', syncNavigation)
  }, [navigation])

  useLayoutEffect(() => {
    cursor.current = undefined
    editorRestore.current = null
    pickerScroll.current = undefined
    setShowActions(false)
    setShowTable(false)
    setLinkSource(null)
    editorPane.current?.scrollTo(0, 0)
    if (page?.id && page.id === nameNewPage.current) {
      nameNewPage.current = null
      pageName.current?.focus({ preventScroll: true })
    }
  }, [selectedId, page?.id])

  useLayoutEffect(() => {
    const restore = editorRestore.current
    editorRestore.current = null
    const area = paper.current
    if (!restore || !area || !active) return
    if (restore.caret && !preview) {
      area.focus({ preventScroll: true })
      area.setSelectionRange(restore.caret.start, restore.caret.end)
      cursor.current = restore.caret
    }
    // Updating a textarea's value moves its scroll position to the end.
    if (restore.scroll) {
      area.scrollTop = restore.scroll.textTop
      area.scrollLeft = restore.scroll.textLeft
      if (editorPane.current) editorPane.current.scrollTop = restore.scroll.paneTop
    }
  }, [note, preview, active])

  function editorScroll(): EditorScroll {
    return {
      paneTop: editorPane.current?.scrollTop ?? 0,
      textTop: paper.current?.scrollTop ?? 0,
      textLeft: paper.current?.scrollLeft ?? 0,
    }
  }

  function select(id: string | null, showPreview = true, noteTrail: string[] = [], push = false) {
    const href = id ? noteHref(id) : '#notes'
    if (push) window.history.pushState({ noteTrail }, '', href)
    else window.history.replaceState({ noteTrail }, '', href)
    setNavigation({ id, trail: noteTrail })
    setPreview(showPreview)
    setProblem('')
  }

  function selectPage(id: string) {
    if (note) setLastPages(previous => ({ ...previous, [note.id]: id }))
  }

  function addPage() {
    if (!note || disabled) return
    const id = store.addPage(note.id)
    if (!id) return
    nameNewPage.current = id
    selectPage(id)
    setPreview(false)
  }

  function openLinked(id: string, showPreview = true) {
    if (!selectedId || id === selectedId) return
    const previous = trail.indexOf(id)
    select(id, showPreview, previous < 0 ? [...trail, selectedId] : trail.slice(0, previous), true)
  }

  function goBack() {
    select(parentId ?? null, true, trail.slice(0, -1))
  }

  function followLink(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return
    const id = noteIdFromHref(event.target.closest('a')?.getAttribute('href') ?? '')
    if (!id) return
    event.preventDefault()
    openLinked(id)
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
      if (noteIdFromHref(window.location.hash) === note.id) goBack()
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

  function insertMarkdown(command: NoteFormat | NoteTableSize, scroll = editorScroll()) {
    if (!note || !page || disabled) return
    const area = paper.current
    const start = area?.selectionStart ?? page.body.length
    const end = area?.selectionEnd ?? start
    const change = typeof command === 'string' ? formatNote(page.body, start, end, command) : insertNoteTable(page.body, start, end, command)
    editorRestore.current = { caret: change, scroll }
    store.editPage(note.id, page.id, { body: change.text }, { before: { start, end }, after: change })
  }

  function navigateHistory(action: 'undo' | 'redo') {
    if (!note || !page || disabled) return
    const scroll = editorScroll()
    const caret = store.navigateHistory(note.id, page.id, action)
    if (caret) editorRestore.current = { caret, scroll }
  }

  function editBody(event: ChangeEvent<HTMLTextAreaElement>) {
    if (!note || !page || disabled) return
    const { inputType, isComposing } = event.nativeEvent as InputEvent
    if (inputType === 'historyUndo' || inputType === 'historyRedo') {
      navigateHistory(inputType === 'historyUndo' ? 'undo' : 'redo')
      return
    }
    const area = event.currentTarget
    const after = { start: area.selectionStart, end: area.selectionEnd }
    const typing = !isComposing && /^(insertText|deleteContentBackward|deleteContentForward)$/.test(inputType)
    store.editPage(note.id, page.id, { body: area.value }, { before: cursor.current, after, inputType: typing ? inputType : undefined })
    cursor.current = after
  }

  function historyShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && note && page && !disabled) {
      const { selectionStart: start, selectionEnd: end } = event.currentTarget
      const change = continueTableBullet(page.body, start, end)
      if (change) {
        event.preventDefault()
        editorRestore.current = { caret: change, scroll: editorScroll() }
        store.editPage(note.id, page.id, { body: change.text }, { before: { start, end }, after: change })
      }
      return
    }
    if (event.altKey || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && !(event.ctrlKey && !event.metaKey && key === 'y')) return
    event.preventDefault()
    navigateHistory(event.shiftKey || key === 'y' ? 'redo' : 'undo')
  }

  function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const size = new FormData(event.currentTarget)
    insertMarkdown({ columns: Number(size.get('columns')), rows: Number(size.get('rows')) }, pickerScroll.current)
    pickerScroll.current = undefined
    setShowTable(false)
  }

  function closeTable() {
    pickerScroll.current = undefined
    setShowTable(false)
    tableButton.current?.focus()
  }

  function startNoteLink() {
    if (!note || !page || disabled || linking) return
    pickerScroll.current = editorScroll()
    const area = paper.current
    const range = area ? { start: area.selectionStart, end: area.selectionEnd } : null
    setLinkSource({ id: note.id, pageId: page.id, body: page.body, range })
    setLinkTarget('')
    setShowActions(false)
    setShowTable(false)
    setProblem('')
  }

  function closeNoteLink() {
    pickerScroll.current = undefined
    setLinkSource(null)
    setProblem('')
    actionsButton.current?.focus()
  }

  async function addNoteLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!linkSource || disabled || linking) return
    setProblem('')
    if (linkTarget) {
      try {
        const scroll = pickerScroll.current ?? editorScroll()
        const change = store.link(linkSource, linkTarget)
        editorRestore.current = { caret: change, scroll }
        pickerScroll.current = undefined
        setLinkSource(null)
      } catch {
        setProblem('That note is unavailable.')
      }
      return
    }
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim()
    setLinking(true)
    try {
      const created = await store.create(title, linkSource)
      if (noteIdFromHref(window.location.hash) === linkSource.id && pageName.current?.dataset.pageId === linkSource.pageId) {
        setFilter('all')
        setSearch('')
        openLinked(created.id, false)
      }
    } catch {
      if (noteIdFromHref(window.location.hash) === linkSource.id && pageName.current?.dataset.pageId === linkSource.pageId) {
        setProblem('Couldn’t create a linked note. Try again.')
      }
    } finally {
      setLinking(false)
    }
  }

  const range = linkSource?.range
  const suggestedTitle = range ? linkSource.body.slice(range.start, range.end).trim().replace(/\s+/g, ' ').slice(0, 120) : ''
  const linkOptions = linkSource ? entries.map(item => item.note).filter(item => item.id !== selectedId)
    .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b))) : []
  const saveStatus = !entry?.dirty ? 'Autosaved' : entry.problem ? 'Not saved' : 'Saving...'

  return <div className={'notes-layout' + (selectedId ? ' note-open-mobile' : '')}>
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
      {entry && note && page ? <>
        <div className="editor-toolbar-top">
          <button type="button" className={'editor-back' + (parentId ? ' linked-note-back' : '')}
            aria-label={parentId ? 'Back to ' + parentTitle : undefined} onClick={goBack}>
            <ChevronLeft size={17} /><span>{parentId ? parentTitle : 'All notes'}</span>
          </button>
          <div className="editor-top-right">
            <span className="save-indicator" data-status={saveStatus} role="status"><span />{saveStatus}</span>
            {saveStatus === 'Not saved' && <button type="button" className="retry-save" disabled={disabled} onClick={() => store.retry(note.id)}>Retry</button>}
            <button type="button" className={'icon-button' + (note.pinned ? ' pin-active' : '')} disabled={disabled}
              onClick={() => store.edit(note.id, { pinned: !note.pinned })} aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
              title={note.pinned ? 'Unpin note' : 'Pin note'}><Pin size={18} /></button>
            <div className="note-actions" onKeyDown={event => { if (event.key === 'Escape') setShowActions(false) }}>
              <button ref={actionsButton} type="button" className="icon-button" disabled={disabled} onClick={() => setShowActions(open => !open)}
                aria-label="Note actions" aria-expanded={showActions}><MoreHorizontal size={20} /></button>
              {showActions && <div className="notes-floating-menu">
                {!preview && <>
                  <button type="button" disabled={!history?.undo.length || disabled} onClick={() => { navigateHistory('undo'); setShowActions(false) }}><Undo2 size={15} /> Undo</button>
                  <button type="button" disabled={!history?.redo.length || disabled} onClick={() => { navigateHistory('redo'); setShowActions(false) }}><Redo2 size={15} /> Redo</button>
                  <button type="button" disabled={linking} onClick={startNoteLink}><Link2 size={15} /> Link note</button>
                </>}
                <button type="button" className="delete-action" onClick={() => void remove()}><Trash2 size={15} /> Delete note</button>
              </div>}
            </div>
          </div>
        </div>
        <div className="note-view-bar">
          {preview && <div className="note-pages" role="group" aria-label="Note pages">
            <button type="button" className="icon-button" aria-label="Previous page" title="Previous page" disabled={pageIndex === 0}
              onClick={() => selectPage(pages[pageIndex - 1].id)}><ChevronLeft size={18} /></button>
            <span className="note-page-count" role="status" aria-label={'Page ' + (pageIndex + 1) + ' of ' + pages.length}>{pageIndex + 1} / {pages.length}</span>
            <button type="button" className="icon-button" aria-label="Next page" title="Next page" disabled={pageIndex === pages.length - 1}
              onClick={() => selectPage(pages[pageIndex + 1].id)}><ChevronRight size={18} /></button>
            <button type="button" className="icon-button" aria-label="Add page" title="Add page" disabled={disabled} onClick={addPage}><Plus size={19} /></button>
          </div>}
          <div className="note-modes" role="group" aria-label="Note view">
            <button type="button" className="editor-mode" aria-pressed={!preview} aria-label="Edit" title="Edit Markdown" onClick={() => setPreview(false)}><Pencil size={16} />Edit</button>
            <button type="button" className="editor-mode" aria-pressed={preview} aria-label="Preview" title="Preview formatted note" onClick={() => setPreview(true)}><Eye size={16} />Preview</button>
          </div>
        </div>
        {(problem || entry.problem instanceof NoteChangedError) && <div className="editor-alert" role="alert">
          <p className="error">{problem || 'This note changed or was deleted elsewhere. Your draft is still here.'}</p>
          {entry.problem instanceof NoteChangedError && entry.dirty && <button type="button" className="button small" disabled={disabled} onClick={() => void copy()}>Save a copy</button>}
        </div>}
        <div className="editor-body">
          <div className="editor-meta"><FileText size={14} /> NOTE <span>·</span> Edited {format(parseISO(note.updated_at), 'MMM d, yyyy')}</div>
          <input className="note-title-input" placeholder="Untitled note" aria-label="Note title" maxLength={120} value={note.title} readOnly={disabled || preview}
            onChange={event => store.edit(note.id, { title: event.target.value })} />
          {preview ? (page.title.trim() && <h2 className="note-page-title">{page.title}</h2>)
            : <input ref={pageName} data-page-id={page.id} className="note-page-name" aria-label="Page name" maxLength={120}
              value={page.title} placeholder={'Page ' + (pageIndex + 1) + ' name'} readOnly={disabled}
              onChange={event => store.editPage(note.id, page.id, { title: event.target.value })} />}
          {!preview && <div className="editor-format-toolbar" role="group" aria-label="Markdown formatting">
            {formatting.map(tool => <span className="notes-tool-group" key={tool.format}>
              <button type="button" title={tool.label} aria-label={tool.label} disabled={disabled}
                onMouseDown={event => event.preventDefault()} onClick={() => insertMarkdown(tool.format)}><tool.Icon size={17} /></button>
              {'divider' in tool && <span className="toolbar-divider" />}
            </span>)}
            <button ref={tableButton} type="button" title="Insert table" aria-label="Insert table" aria-expanded={showTable}
              aria-controls={showTable ? 'note-table-size' : undefined} disabled={disabled}
              onMouseDown={event => event.preventDefault()} onClick={() => {
                pickerScroll.current = showTable ? undefined : editorScroll()
                setLinkSource(null)
                setShowTable(!showTable)
              }}><Table2 size={17} /></button>
          </div>}
          {!preview && linkSource && <form className="note-link-form" aria-label="Link note" onSubmit={event => void addNoteLink(event)}
            onKeyDown={event => { if (event.key === 'Escape' && !linking) closeNoteLink() }}>
            <label>Link to<select value={linkTarget} autoFocus onChange={event => { setLinkTarget(event.target.value); setProblem('') }} disabled={linking || disabled}>
              <option value="">New sub-note</option>
              {linkOptions.map(item => <option key={item.id} value={item.id}>{noteTitle(item)}</option>)}
            </select></label>
            {!linkTarget && <label>Sub-note title<input name="title" defaultValue={suggestedTitle} maxLength={120} placeholder="Untitled note" disabled={linking || disabled} /></label>}
            <div className="note-insert-actions">
              <button type="button" className="button small" disabled={linking} onClick={closeNoteLink}>Cancel</button>
              <button type="submit" className="button small primary" disabled={linking || disabled}>
                {linking ? 'Creating…' : linkTarget ? 'Insert link' : 'Create and link'}
              </button>
            </div>
          </form>}
          {!preview && showTable && <form className="note-table-form" id="note-table-size" aria-label="Table size" onSubmit={addTable}
            onKeyDown={event => { if (event.key === 'Escape') closeTable() }}>
            <label>Columns<input name="columns" type="number" required min={1} max={20} defaultValue={3} autoFocus /></label>
            <label>Body rows<input name="rows" type="number" required min={1} max={100} defaultValue={2} /></label>
            <div className="note-insert-actions">
              <button type="button" className="button small" onClick={closeTable}>Cancel</button>
              <button type="submit" className="button small primary" disabled={disabled}>Insert</button>
            </div>
          </form>}
          <textarea key={note.id + '/' + page.id} ref={paper} hidden={preview} className="note-content-input" placeholder="Write a note..." aria-label="Note content"
            value={page.body} readOnly={disabled} onChange={editBody} onKeyDown={historyShortcut}
            onSelect={event => { cursor.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }} />
          {preview && <div className="markdown-preview" aria-label="Markdown preview" role="region" onClick={followLink}>
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[noteTableLists]} components={markdownComponents} disallowedElements={['img']}>
              {page.body || '*Nothing here yet. Switch to Edit and start writing.*'}
            </Markdown>
          </div>}
          <div className="editor-bottom-meta"><span>Markdown supported</span><span>{countNoteWords(page.body)} words</span></div>
        </div>
      </> : selectedId ? <div className="editor-placeholder">
        <h2>{loading ? 'Loading note…' : 'Note unavailable'}</h2>
        {!loading && <p>{loadFailed ? 'Couldn’t load your notes.' : 'This link points to a note you can’t open.'}</p>}
        <button type="button" className="button" onClick={goBack}><ChevronLeft size={17} /> {parentId ? 'Back to ' + parentTitle : 'All notes'}</button>
      </div> : <div className="editor-placeholder">
        <span className="placeholder-art"><FileText size={38} /></span>
        <h2>Select a note</h2><p>Choose a note or create one.</p>
        <button type="button" className="button primary" disabled={creating || locked} onClick={() => void create()}><Plus size={17} /> Create a note</button>
      </div>}
    </section>
  </div>
}
