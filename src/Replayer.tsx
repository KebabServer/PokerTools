import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { HandEditor } from './HandEditor.tsx'
import { handLibrary, type SavedHand } from './library.ts'
import { PlayingCard } from './PlayingCard.tsx'
import { chipLayers, ChipStack, PotChips } from './PokerChips.tsx'
import { chips, openingReplayStep, replay, streets, type Frame } from './replay.ts'
import { emptyHand, sampleHand } from './sample.ts'

const sampleTitle = 'Set over set'

function Table({ frame, button, bigBlind }: { frame: Frame | undefined; button: number; bigBlind: number }) {
  if (!frame) return <div className="table-fallback">Complete table setup to preview this hand.</div>
  const { seats, board, pot, active, awards } = frame
  const blindCents = Math.round(bigBlind * 100)
  // The displayed total includes wagers. The center pile represents chips already swept in.
  const chipsAtSeats = awards
    ? awards.reduce((sum, award) => sum + award.amount, 0)
    : seats.reduce((sum, seat) => sum + seat.committed, 0)

  return <div className={'table-stage' + (seats.length > 6 ? ' many-seats' : '')} aria-label="Replay table">
    <div className="table-rail"><div className="table-felt" /></div>
    <div className="table-center">
      <div className="pot-display">
        <PotChips amount={pot - chipsAtSeats} bigBlind={blindCents} />
        <div className="pot-total"><span>{awards ? 'Total pot' : 'Pot'}</span><strong>{chips(pot)}</strong></div>
      </div>
      <div className="board-cards">{Array.from({ length: 5 }, (_, index) => <PlayingCard key={index} card={board[index]} />)}</div>
    </div>
    {seats.map((seat, index) => {
      // Screen coordinates increase downward, so increasing the angle moves clockwise.
      const angle = Math.PI / 2 + (index * 2 * Math.PI) / seats.length
      const x = Math.cos(angle)
      const y = Math.sin(angle)
      const amount = awards ? (awards.find(award => award.seat === seat.seat)?.amount ?? 0) : seat.committed
      const amountLabel = seat.name + (awards ? ' won ' : ' committed ') + chips(amount)
      // Leave the board lane clear and keep chips on the felt in front of their seats.
      const betTop = y < 0 ? 24 - y * 5 : 61 + y * 8.5
      return <Fragment key={seat.seat}>
        {amount > 0 && <div role="img" aria-label={amountLabel} title={amountLabel} className="seat-chips" style={{ '--bet-x': x, '--top': betTop + '%' } as CSSProperties}>
          <ChipStack count={Math.min(5, chipLayers(amount, blindCents))} color={awards ? 'ivory' : 'red'} />
          <span className="seat-chip-amount">{awards && '+'}{chips(amount)}</span>
        </div>}
        <div className={'table-seat' + (seat.folded ? ' folded' : '') + (active === seat.seat ? ' acting' : '')} style={{ '--left': (50 + x * 41) + '%', '--top': (50 + y * 36) + '%' } as CSSProperties}>
          <div className="hole-cards"><PlayingCard card={seat.hole[0]} back /><PlayingCard card={seat.hole[1]} back /></div>
          <div className="seat-info"><strong title={seat.name}>{seat.name}</strong><span title={seat.folded ? 'Folded' : seat.remaining ? 'Stack' : 'All-in'}>{chips(seat.remaining)}</span>
            {seat.seat === button && <span className="dealer-chip" aria-label="Dealer button" title="Dealer button">D</span>}
          </div>
        </div>
      </Fragment>
    })}
  </div>
}

function ReplayHistory({ frames, index, seek, open, setOpen }: {
  frames: Frame[]; index: number; seek: (index: number) => void; open: boolean; setOpen: (open: boolean) => void
}) {
  const selected = useRef<HTMLButtonElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const button = selected.current
    const container = scroll.current
    if (!button || !container) return
    const item = button.getBoundingClientRect()
    const outer = container.getBoundingClientRect()
    if (item.bottom > outer.bottom) container.scrollTop += item.bottom - outer.bottom + 10
    if (item.top < outer.top) container.scrollTop -= outer.top - item.top + 10
  }, [index, frames, open])
  return <details className="panel history-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="history-head"><ChevronDown size={17} aria-hidden="true" /><h2>Action history</h2></summary>
    <div className="history-scroll" ref={scroll}>
      {!frames.length && <p className="history-empty">Actions will appear here as you record the hand.</p>}
      <ol className="history-list">
        {frames.map((frame, step) => <li key={step}>
          {(!step || frame.street !== frames[step - 1].street) && <div className="history-street">{streets[frame.street]}</div>}
          <button className={'history-step' + (step === index ? ' selected' : '')} ref={step === index ? selected : null} aria-current={step === index ? 'step' : undefined} onClick={() => seek(step)}>
            <span>{frame.label}</span><span className="step-pot">{chips(frame.pot)}</span>
          </button>
        </li>)}
      </ol>
    </div>
  </details>
}

export function Replayer({ userId, initialHand, deletedHandId }: {
  userId?: string; initialHand: SavedHand | null; deletedHandId: string | null
}) {
  const [hand, setHand] = useState(initialHand?.hand_data ?? sampleHand)
  const [title, setTitle] = useState(initialHand?.title ?? sampleTitle)
  const [notes, setNotes] = useState(initialHand?.notes ?? '')
  const [openId, setOpenId] = useState(initialHand?.id ?? null)
  const [savedNotes, setSavedNotes] = useState(initialHand?.notes ?? '')
  const [source, setSource] = useState<'sample' | 'draft' | 'saved'>(initialHand ? 'saved' : 'sample')
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const result = useMemo(() => replay(hand), [hand])
  const { frames } = result
  const last = Math.max(0, frames.length - 1)
  const index = Math.min(step ?? openingReplayStep(frames), last)
  const frame = frames[index]
  const notesDirty = savedNotes !== notes
  const hasPotDetails = frames.some(item => item.pots.length > 1 || item.awards?.length)
  const showsPotDetails = frame && (frame.pots.length > 1 || !!frame.awards?.length)

  useEffect(() => {
    if (openId && openId === deletedHandId) {
      setOpenId(null)
      setSource('draft')
      setNotice('')
    }
  }, [openId, deletedHandId])

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

  function load(blank = false) {
    setOpenId(null)
    setTitle(blank ? 'Untitled hand' : sampleTitle)
    setNotes('')
    setSavedNotes('')
    setHand(blank ? emptyHand : sampleHand)
    setSource(blank ? 'draft' : 'sample')
    setStep(null)
    setPlaying(false)
    setEditing(blank)
    setHistoryOpen(false)
    setNotice('')
    setProblem('')
  }

  function editHand() {
    setEditing(true)
    requestAnimationFrame(() => document.getElementById('hand-editor')?.scrollIntoView({ block: 'start' }))
  }

  async function save(notesOnly = false) {
    if (!userId || busy || (notesOnly && !openId)) return
    if (!notesOnly && (!result.complete || !title.trim())) {
      setProblem(!title.trim() ? 'Give your hand a title.' : 'Complete the hand before saving.')
      editHand()
      return
    }
    setBusy(true)
    setProblem('')
    setNotice('')
    try {
      const contents = { title: title.trim(), hand_data: hand }
      const values = notesOnly ? { notes } : openId ? contents : { ...contents, notes }
      const row = await handLibrary(userId).save(values, openId)
      setOpenId(row.id)
      setSavedNotes(row.notes)
      setSource('saved')
      if (!notesOnly) setTitle(row.title)
      setNotice(notesOnly ? 'Notes saved.' : 'Hand saved.')
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <h1 className="sr-only">Hand Replayer</h1>
    <div className="replay-layout">
      <section className="panel replay-panel">
        <div className="section-head replay-head">
          <div><h2>{title.trim() || 'Untitled hand'}</h2><p>{source === 'sample' && 'Sample hand · '}{hand.smallBlind} / {hand.bigBlind} blinds · {hand.players.length} players</p></div>
          <button className="button small edit-button" onClick={editHand} disabled={busy}>Edit hand</button>
        </div>
        <Table frame={frame} button={hand.button} bigBlind={hand.bigBlind} />
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
        {hasPotDetails && <div className="replay-pot-details" role="region" aria-label="Pot details" aria-hidden={!showsPotDetails} tabIndex={showsPotDetails ? 0 : undefined}>
          {frame && frame.pots.length > 1 && <div className="pot-breakdown">{frame.pots.map((pot, i) => <span key={i}>{i ? 'Side pot ' + i : 'Main pot'} <strong>{chips(pot.amount)}</strong></span>)}</div>}
          {!!frame?.awards?.length && <div className="pot-breakdown">{frame.awards.map(award => <span key={award.seat}>{hand.players.find(player => player.seat === award.seat)?.name} wins <strong>{chips(award.amount)}</strong></span>)}</div>}
        </div>}
      </section>
      <section className="panel review-panel hand-review">
        <h2>Hand notes</h2>
        <label className="notes-label"><span className="sr-only">Private hand notes</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What stood out about this hand?" /></label>
        <div className="save-actions main-hand-actions">
          <button className="button small" onClick={() => { load(true); editHand() }} disabled={busy}><Plus size={16} /> New hand</button>
          {userId
            ? <button className="button small primary" disabled={busy} onClick={() => void save()}>Save hand</button>
            : <a className="button small" href="#library" aria-label="Sign in to save hand">Sign in to save</a>}
        </div>
        <div className="save-actions secondary-hand-actions">
          {userId && openId && <button className="button" disabled={busy || !notesDirty} onClick={() => void save(true)}>Save notes</button>}
          {(source !== 'sample' || hand !== sampleHand || title !== sampleTitle) && <button className="button text-button" onClick={() => { load(); window.scrollTo(0, 0) }} disabled={busy}>Sample hand</button>}
        </div>
        {problem && <p className="error" role="alert">{problem}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
      </section>
    </div>

    {editing && <HandEditor hand={hand} title={title} result={result} setTitle={setTitle} setHand={updated => { setHand(updated); setPlaying(false); setStep(Number.MAX_SAFE_INTEGER) }} close={() => setEditing(false)} />}

    <ReplayHistory frames={frames} index={index} seek={seek} open={historyOpen} setOpen={setHistoryOpen} />
  </>
}
