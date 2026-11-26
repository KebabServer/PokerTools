import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { ranks } from './cards.ts'
import { PlayingCard } from './PlayingCard.tsx'
import { flopChartRank, orderFlopBoards, type FlopAction, type FlopBoard, type FlopBoardOrder, type FlopTextureGroup } from './flopReport.ts'

const rankAxisHeight = 20
const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })

function drawChart(canvas: HTMLCanvasElement, boards: FlopBoard[], actions: FlopAction[], order: FlopBoardOrder) {
  const { width, height } = canvas.getBoundingClientRect()
  if (!width || !height) return

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.max(boards.length, Math.round(width * pixelRatio))
  canvas.height = Math.round(height * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const plotHeight = Math.round((height - rankAxisHeight) * pixelRatio)
  const boardWidth = canvas.width / boards.length
  const groupRanks = boards.map(board => flopChartRank(board, order))
  let firstInRank = 0

  for (const [index, board] of boards.entries()) {
    const left = Math.round(index * boardWidth)
    const right = Math.round((index + 1) * boardWidth)
    // Normalize the small rounding differences in the export so every bar is full height.
    const total = board.frequencies.reduce((sum, frequency) => sum + frequency, 0)
    let cumulative = 0
    let top = 0
    for (const [actionIndex, { color }] of actions.entries()) {
      cumulative += board.frequencies[actionIndex]
      const bottom = Math.round(plotHeight * cumulative / total)
      ctx.fillStyle = color
      ctx.fillRect(left, top, right - left, bottom - top)
      top = bottom
    }

    const rank = groupRanks[index]
    if (rank !== groupRanks[index + 1]) {
      const groupWidth = (index + 1 - firstInRank) * boardWidth
      if (groupWidth >= 10 * pixelRatio) {
        ctx.fillStyle = '#b4b4b4'
        ctx.font = `${11 * pixelRatio}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(ranks[rank], right - groupWidth / 2, plotHeight + 15 * pixelRatio)
      }
      firstInRank = index + 1
    }
    if (index && groupRanks[index - 1] !== rank) {
      ctx.fillStyle = '#17171799'
      ctx.fillRect(left, 0, Math.round(pixelRatio), plotHeight)
    }
  }
}

export function FlopActionLabel({ action }: { action: FlopAction }) {
  return <span className="flop-action">
    <span className="flop-action-color" style={{ backgroundColor: action.color }} aria-hidden="true" />
    {action.label}
  </span>
}

function BoardDetails({ board, actions }: { board: FlopBoard; actions: FlopAction[] }) {
  return <>
    <div className="flop-board">
      <div className="flop-board-cards">
        {board.cards.map(card => <PlayingCard key={card} card={card} />)}
      </div>
      <span aria-live="polite">{board.code}</span>
    </div>
    <dl className="flop-ev">
      <div><dt>IP EV</dt><dd>{board.ipEv?.toFixed(2) ?? '—'}</dd></div>
      <div><dt>OOP EV</dt><dd>{board.oopEv?.toFixed(2) ?? '—'}</dd></div>
    </dl>
    <ul className="flop-board-actions">
      {actions.map((action, index) => <li key={action.label}>
        <FlopActionLabel action={action} />
        <span>{percent.format(board.frequencies[index])}</span>
      </li>)}
    </ul>
  </>
}

export function FlopReportChart({ group, actions, order }: { group: FlopTextureGroup; actions: FlopAction[]; order: FlopBoardOrder }) {
  const boards = useMemo(() => orderFlopBoards(group.boards, order), [group.boards, order])
  const { label } = group
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartButtonRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const detailsId = useId()
  const [selectedBoard, setSelectedBoard] = useState<FlopBoard | null>(null)
  const [preview, setHovered] = useState<{ boards: FlopBoard[]; index: number; x: number; y: number } | null>(null)
  const selectedIndex = selectedBoard ? boards.indexOf(selectedBoard) : -1
  const selected = selectedIndex < 0 ? null : selectedIndex
  const hovered = preview?.boards === boards ? preview : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const redraw = () => drawChart(canvas, boards, actions, order)
    redraw()
    const observer = new ResizeObserver(redraw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [boards, actions, order])

  function boardAt(event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) {
    const { left, width } = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(boards.length - 1, Math.floor((event.clientX - left) / width * boards.length)))
  }

  function select(index: number) {
    setHovered(null)
    setSelectedBoard(boards[Math.max(0, Math.min(boards.length - 1, index))])
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowLeft': select((selected ?? 1) - 1); break
      case 'ArrowRight': select((selected ?? -1) + 1); break
      case 'Home': select(0); break
      case 'End': select(boards.length - 1); break
      case 'Escape': setHovered(null); setSelectedBoard(null); break
      default: return
    }
    event.preventDefault()
  }

  const marker = hovered?.index ?? selected
  return <section className="panel flop-chart" aria-labelledby={headingId}>
    <div className="flop-chart-heading">
      <h2 id={headingId}>{label}</h2>
      <span>{boards.length} flops</span>
    </div>
    <div className="flop-chart-axes">
      <div className="flop-chart-scale" aria-hidden="true"><span>100%</span><span>0%</span></div>
      <button
        type="button" className="flop-plot" ref={chartButtonRef}
        aria-label={`Inspect ${label.toLowerCase()} flops`}
        aria-expanded={selected !== null} aria-controls={detailsId}
        aria-describedby="flop-chart-keys"
        onClick={event => select(event.detail ? boardAt(event) : selected ?? 0)}
        onPointerMove={event => {
          if (event.pointerType === 'mouse') setHovered({ boards, index: boardAt(event), x: event.clientX, y: event.clientY })
        }}
        onPointerLeave={() => setHovered(null)}
        onKeyDown={handleKey}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        {marker !== null && <span className="flop-chart-marker" aria-hidden="true" style={{ left: `${(marker + .5) / boards.length * 100}%` }} />}
      </button>
    </div>

    {hovered && hovered.index !== selected && <div className="flop-tooltip" aria-hidden="true" style={{
      left: Math.max(8, Math.min(hovered.x + 12, window.innerWidth - 224)),
      top: Math.max(8, Math.min(hovered.y + 12, window.innerHeight - 208)),
    }}>
      <BoardDetails board={boards[hovered.index]} actions={actions} />
    </div>}

    <div className="flop-inspector" id={detailsId} hidden={selected === null}>
      {selected !== null && <>
        <div className="flop-inspector-nav">
          <span>{selected + 1} of {boards.length}</span>
          <div>
            <button type="button" className="icon-button" aria-label="Previous flop" disabled={selected === 0} onClick={() => select(selected - 1)}><ArrowLeft size={16} /></button>
            <button type="button" className="icon-button" aria-label="Next flop" disabled={selected === boards.length - 1} onClick={() => select(selected + 1)}><ArrowRight size={16} /></button>
            <button type="button" className="icon-button" aria-label="Close board details" onClick={() => { setSelectedBoard(null); chartButtonRef.current?.focus() }}><X size={16} /></button>
          </div>
        </div>
        <BoardDetails board={boards[selected]} actions={actions} />
      </>}
    </div>
  </section>
}
