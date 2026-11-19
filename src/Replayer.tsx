import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, FileText, FolderOpen, LockKeyhole, Pause, Pencil, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { HandEditor } from './HandEditor.tsx'
import { handLibrary, supabase, type SavedHand } from './library.ts'
import { PlayingCard } from './PlayingCard.tsx'
import { chips, replay, streets, type Frame } from './replay.ts'
import { emptyHand, sampleHand } from './sample.ts'

const sampleTitle = 'Set over set'
const sampleStart = replay(sampleHand).frames.findIndex(frame => frame.street === 1)

function Table({ frame, button }: { frame: Frame | undefined; button: number }) {
  if (!frame) return <div className="table-fallback">Complete table setup to preview this hand.</div>
  const { seats, board, pot, street, active } = frame
  return <div className="table-stage" aria-label="Replay table">
    <div className="table-rail"><div className="table-felt" /></div>
    <div className="table-center">
      <div className="pot-total"><span>{frame.awards ? 'TOTAL POT' : 'POT'}</span><strong>{chips(pot)}</strong></div>
      <div className="board-cards">{Array.from({ length: 5 }, (_, index) => <PlayingCard key={index} card={board[index]} />)}</div>
      <span className="felt-street">{streets[street]}</span>
    </div>
    {seats.map((seat, index) => {
      const angle = Math.PI / 2 - (index * 2 * Math.PI) / seats.length
      const left = 50 + Math.cos(angle) * 41
      const top = 50 + Math.sin(angle) * 36
      return <div key={seat.seat} className={'table-seat' + (seat.folded ? ' folded' : '') + (active === seat.seat ? ' acting' : '')} style={{ '--left': left + '%', '--top': top + '%' } as CSSProperties}>
        <div className="hole-cards"><PlayingCard card={seat.hole[0]} back /><PlayingCard card={seat.hole[1]} back /></div>
        <div className="seat-info"><strong title={seat.name}>{seat.name}</strong><span title={seat.folded ? 'Folded' : seat.remaining ? 'Stack' : 'All-in'}>{chips(seat.remaining)}</span>
          {seat.seat === button && <span className="dealer-chip" aria-label="Dealer button" title="Dealer button">D</span>}
        </div>
      </div>
    })}
  </div>
}

function ReplayHistory({ frames, index, seek }: { frames: Frame[]; index: number; seek: (index: number) => void }) {
  const selected = useRef<HTMLButtonElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const button = selected.current
    const container = scroll.current
    if (!button || !container) return
    const item = button.getBoundingClientRect()
    const outer = container.getBoundingClientRect()
    if (item.bottom > outer.bottom) container.scrollTop += item.bottom - outer.bottom + 10
    if (item.top < outer.top) container.scrollTop -= outer.top - item.top + 10
  }, [index, frames])
  return <aside className="panel history-panel">
    <div className="section-head history-head"><h2><ClipboardList size={18} /> Action history</h2><span className="event-count">{frames.length}</span></div>
    <div className="history-scroll" ref={scroll}>
      {!frames.length && <p className="history-empty">Actions will appear here as you record the hand.</p>}
      <ol className="history-list">
        {frames.map((frame, step) => <li key={step}>
          {(!step || frame.street !== frames[step - 1].street) && <div className="history-street">{streets[frame.street]}</div>}
          <button className={'history-step' + (step === index ? ' selected' : '')} ref={step === index ? selected : null} aria-current={step === index ? 'step' : undefined} onClick={() => seek(step)}>
            <span className="step-dot" /><span>{frame.label}</span><span className="step-pot">{chips(frame.pot)}</span>
          </button>
        </li>)}
      </ol>
    </div>
  </aside>
}

export function Replayer({ userId, email, signOut, libraryRequest }: {
  userId?: string; email?: string; signOut: () => Promise<void>; libraryRequest: number
}) {
  const [hand, setHand] = useState(sampleHand)
  const [title, setTitle] = useState(sampleTitle)
  const [notes, setNotes] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [source, setSource] = useState<'sample' | 'draft' | 'saved'>('sample')
  const [step, setStep] = useState(sampleStart)
  const [playing, setPlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<SavedHand[]>([])
  const [loading, setLoading] = useState(Boolean(userId))
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const librarySection = useRef<HTMLElement>(null)
  const library = useMemo(() => userId ? handLibrary(userId) : null, [userId])
  const result = useMemo(() => replay(hand), [hand])
  const { frames } = result
  const last = Math.max(0, frames.length - 1)
  const index = Math.min(step, last)
  const frame = frames[index]
  const cleanNotes = saved.find(row => row.id === openId)?.notes
  const notesDirty = cleanNotes !== undefined && cleanNotes !== notes

  useEffect(() => {
    if (libraryRequest) librarySection.current?.scrollIntoView({ block: 'start' })
  }, [libraryRequest])

  useEffect(() => {
    if (!library) return
    let current = true
    setLoading(true)
    library.list().then(rows => { if (current) setSaved(rows) })
      .catch(error => { if (current) setProblem(error.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [library])

  useEffect(() => {
    if (!playing || index === last) return
    const timer = window.setTimeout(() => {
      setStep(index + 1)
      if (index + 1 === last) setPlaying(false)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [playing, index, last])

  function seek(next: number) {
    setPlaying(false)
    setStep(Math.min(last, Math.max(0, next)))
  }

  function load(row?: SavedHand, blank = false) {
    setOpenId(row?.id ?? null)
    setTitle(row?.title ?? (blank ? 'Untitled hand' : sampleTitle))
    setNotes(row?.notes ?? '')
    setHand(row?.hand_data ?? (blank ? emptyHand : sampleHand))
    setSource(row ? 'saved' : blank ? 'draft' : 'sample')
    setStep(row || blank ? 0 : sampleStart)
    setPlaying(false)
    setEditing(blank)
    setNotice('')
    setProblem('')
    setConfirmDelete(null)
  }

  function editHand() {
    setEditing(true)
    requestAnimationFrame(() => document.getElementById('hand-editor')?.scrollIntoView({ block: 'start' }))
  }

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setProblem('')
    setNotice('')
    try { await task() } catch (error) { setProblem((error as Error).message) }
    finally { setBusy(false) }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    await run(async () => {
      const { error } = await supabase!.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) })
      if (error) throw error
    })
  }

  function save(notesOnly = false) {
    if (!library || loading || busy) return
    if (notesOnly && !openId) return
    if (!notesOnly && (!result.complete || !title.trim())) {
      setProblem(!title.trim() ? 'Give your hand a title.' : 'Complete the hand before saving.')
      editHand()
      return
    }
    void run(async () => {
      const contents = { title: title.trim(), hand_data: hand }
      const values = notesOnly ? { notes } : openId ? contents : { ...contents, notes }
      const row = await library.save(values, openId)
      setSaved(rows => [row, ...rows.filter(item => item.id !== row.id)])
      setOpenId(row.id)
      setSource('saved')
      if (!notesOnly) setTitle(row.title)
      setNotice(notesOnly ? 'Notes saved.' : 'Hand saved.')
    })
  }

  function remove(row: SavedHand) {
    if (!library || busy) return
    void run(async () => {
      await library.remove(row.id)
      setSaved(rows => rows.filter(item => item.id !== row.id))
      if (openId === row.id) load()
      setConfirmDelete(null)
      setNotice('Hand deleted.')
    })
  }

  return <>
    <div className="tool-heading">
      <div><div className="eyebrow"><span /> NO-LIMIT TEXAS HOLD’EM</div><h1>Hand Replayer</h1><p>Review your hands, one decision at a time.</p></div>
      <div className="heading-actions"><button className="button" onClick={() => load()} disabled={busy}><BookOpen size={17} /> Sample hand</button><button className="button primary" onClick={() => { load(undefined, true); editHand() }} disabled={busy}><Plus size={19} /> New hand</button></div>
    </div>

    <div className="replay-layout">
      <section className="panel replay-panel">
        <div className="section-head replay-head">
          <div><div className="hand-title"><h2>{title.trim() || 'Untitled hand'}</h2>{source === 'sample' && <span className="pill">Sample</span>}</div><p>{hand.smallBlind} / {hand.bigBlind} blinds <span className="separator">·</span> {hand.players.length} players</p></div>
          <button className="button small edit-button" onClick={editHand} disabled={busy}><Pencil size={15} /> Edit hand</button>
        </div>
        <Table frame={frame} button={hand.button} />
        {frame && frame.pots.length > 1 && <div className="pot-breakdown">{frame.pots.map((pot, i) => <span key={i}>{i ? 'Side pot ' + i : 'Main pot'} <strong>{chips(pot.amount)}</strong></span>)}</div>}
        {!!frame?.awards?.length && <div className="pot-breakdown">{frame.awards.map(award => <span key={award.seat}>{hand.players.find(player => player.seat === award.seat)?.name} wins <strong>{chips(award.amount)}</strong></span>)}</div>}
        <div className="replay-controls">
          <div className="transport">
            <button className="icon-button" aria-label="Restart replay" title="Restart replay" onClick={() => seek(0)} disabled={!index}><RotateCcw size={17} /></button>
            <button className="icon-button" aria-label="Previous action" title="Previous action" onClick={() => seek(index - 1)} disabled={!index}><ChevronLeft size={22} /></button>
            <button className="icon-button primary play-button" aria-label={playing ? 'Pause replay' : 'Play replay'} title={playing ? 'Pause replay' : 'Play replay'} disabled={!last} onClick={() => { if (playing) setPlaying(false); else { if (index === last) setStep(0); setPlaying(true) } }}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
            <button className="icon-button" aria-label="Next action" title="Next action" onClick={() => seek(index + 1)} disabled={index >= last}><ChevronRight size={22} /></button>
          </div>
          <div className="progress-control"><input type="range" aria-label="Replay position" min={0} max={last} value={index} onChange={event => seek(Number(event.target.value))} disabled={!last} /><span>{frames.length ? index + 1 : 0} / {frames.length}</span></div>
        </div>
        <div className="streets" aria-label="Jump to street">{streets.map((street, id) => {
          const destination = frames.findIndex(frame => frame.street === id)
          return <button key={street} className={frame?.street === id ? 'current' : ''} aria-pressed={frame?.street === id} disabled={destination < 0} onClick={() => seek(destination)}>{street}</button>
        })}</div>
      </section>
      <ReplayHistory frames={frames} index={index} seek={seek} />
    </div>

    {editing && <HandEditor hand={hand} title={title} result={result} setTitle={setTitle} setHand={updated => { setHand(updated); setPlaying(false); setStep(Number.MAX_SAFE_INTEGER) }} close={() => setEditing(false)} />}

    <div className="review-layout">
      <section className="panel review-panel" id="library" ref={librarySection}>
        <div className="section-head"><h2><FolderOpen size={18} /> Saved hands</h2>{userId && <button className="button text-button" disabled={busy} onClick={() => void run(signOut)}>Sign out</button>}</div>
        {!userId ? <>
          <p><LockKeyhole size={15} /> Sign in to access your private hand library.</p>
          {supabase
            ? <form onSubmit={signIn} className="signin-form"><label>Email<input type="email" name="email" autoComplete="username" required /></label><label>Password<input type="password" name="password" autoComplete="current-password" required /></label><button className="button" disabled={busy}>Sign in</button></form>
            : <div className="subtle-status"><CircleHelp size={15} /> Supabase setup is required to sign in.</div>}
        </> : <>
          <p className="account-email">{email}</p>
          {loading && <p>Loading hands…</p>}
          {!loading && !saved.length && <p>Your saved hands will appear here.</p>}
          <ul className="saved-list">{saved.map(row => <li key={row.id}>
            <button className={'button saved-entry' + (openId === row.id ? ' current' : '')} disabled={busy} onClick={() => { load(row); window.scrollTo({ top: 0 }) }}><FileText size={16} />{row.title}</button>
            {confirmDelete === row.id ? <div className="delete-actions"><button className="button small danger" disabled={busy} onClick={() => remove(row)}>Delete</button><button className="button small" disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</button></div> : <button className="icon-button" aria-label={'Delete ' + row.title} disabled={busy} onClick={() => setConfirmDelete(row.id)}><Trash2 size={16} /></button>}
          </li>)}</ul>
          <button className="button primary" disabled={busy || loading} onClick={() => save()}><Save size={16} /> Save hand</button>
        </>}
        {problem && <p className="error" role="alert">{problem}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
      </section>
      <section className="panel review-panel">
        <div className="section-head"><h2><Pencil size={17} /> Hand notes</h2></div>
        <label className="notes-label"><span className="sr-only">Private hand notes</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What stood out about this hand?" /></label>
        {userId && openId ? <button className="button small" disabled={busy || !notesDirty} onClick={() => save(true)}><Save size={15} /> Save notes</button> : <p><LockKeyhole size={14} /> Notes are stored privately with a saved hand.</p>}
      </section>
    </div>
  </>
}
