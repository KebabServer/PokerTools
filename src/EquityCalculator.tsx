import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { EquityResult } from './equity.ts'
import type { WorkerResponse } from './equity.worker.ts'
import { calculationLibrary, type SavedCalculation } from './library.ts'
import { gridHands, normalizeExactField, parseRange, rangeMatrixSelection, toggleRangeClass } from './ranges.ts'

function rangeDetails(text: string) {
  try { return parseRange(normalizeExactField(text)) } catch { return null }
}

const percent = (decimal: number) => (decimal * 100).toFixed(2) + '%'
const countText = new Intl.NumberFormat('en-US')

export function EquityCalculator({ userId, initialCalculation, deletedCalculationId }: {
  userId?: string; initialCalculation: SavedCalculation | null; deletedCalculationId: string | null
}) {
  const [players, setPlayers] = useState(initialCalculation?.input.players ?? ['AsKd', 'QQ'])
  const [matrixPlayer, setMatrixPlayer] = useState<number | null>(null)
  const [board, setBoard] = useState(initialCalculation?.input.board ?? '')
  const [dead, setDead] = useState(initialCalculation?.input.dead ?? '')
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<EquityResult | null>(initialCalculation?.result ?? null)
  const [problem, setProblem] = useState('')
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(initialCalculation)
  const [title, setTitle] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const ranges = players.map(rangeDetails)
  const matrixRange = matrixPlayer === null ? null : ranges[matrixPlayer]
  const matrixSelection = rangeMatrixSelection(matrixRange)
  const invalidMatrixRange = matrixPlayer !== null && matrixRange === null && !!players[matrixPlayer].trim()
  const running = progress !== null
  const savedTitle = saved?.result === result && saved?.id !== deletedCalculationId ? saved?.title : undefined

  function stop() {
    worker.current?.terminate()
    worker.current = null
    setProgress(null)
  }

  function clear() {
    stop()
    setResult(null)
    setProblem('')
    setStatus('')
    setSaveOpen(false)
    setSaveError('')
  }

  async function saveCalculation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userId || !result || !title.trim() || saveBusy) return
    setSaveBusy(true)
    setSaveError('')
    try {
      const row = await calculationLibrary(userId).save({ title: title.trim(), input: { players, board, dead }, result })
      setSaved({ ...row, result })
      setSaveOpen(false)
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      setSaveBusy(false)
    }
  }

  function setRange(index: number, value: string) {
    clear()
    setPlayers(values => values.map((previous, position) => index === position ? value : previous))
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clear()
    try {
      const job = new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' })
      worker.current = job
      setProgress(0)
      job.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (worker.current !== job) return
        if (data.type === 'progress') { setProgress(data.progress); return }
        if (data.type === 'error') setProblem(data.message)
        else setResult(data.result)
        stop()
      }
      job.onerror = () => {
        if (worker.current !== job) return
        setProblem('The calculation worker could not load. Reload the page and try again.')
        stop()
      }
      job.postMessage({ players, board, dead })
    } catch {
      setProblem('The browser could not start the calculation worker.')
    }
  }

  return <div className="equity-workspace">
    <div className="tool-heading">
      <h1>Equity Calculator</h1>
      <button type="button" className="button small add-player" disabled={running || players.length >= 10} onClick={() => {
        clear()
        setPlayers([...players, 'random'])
      }}><Plus size={16} /> Add player</button>
    </div>
    <form className="panel equity-inputs" onSubmit={calculate}>
      <div className={'range-list' + (players.length > 2 ? ' multiple-players' : '')}>
        {players.map((range, index) => <div className="range-row" key={index}>
          <label className="range-heading" htmlFor={'range-player-' + index}><span>Player {index + 1}</span><span aria-hidden="true">{ranges[index] && countText.format(ranges[index].combos.length) + (ranges[index].combos.length === 1 ? ' combo' : ' combos')}</span></label>
          <div className="range-entry">
            <input aria-label={'Player ' + (index + 1)} id={'range-player-' + index} value={range} placeholder="AsKd or 77+" onChange={event => setRange(index, event.target.value)} autoComplete="off" spellCheck={false} disabled={running} />
            <button type="button" className="button equity-matrix-toggle" aria-label={'Player ' + (index + 1) + ' range matrix'}
              aria-expanded={matrixPlayer === index} aria-controls="equity-range-matrix"
              onClick={() => setMatrixPlayer(current => current === index ? null : index)}>Matrix</button>
            {players.length > 2 && <button type="button" className="icon-button" aria-label={'Remove player ' + (index + 1)} disabled={running} onClick={() => {
              clear()
              setPlayers(players.filter((_, i) => i !== index))
              setMatrixPlayer(current => current === null || current === index ? null : current - Number(index < current))
            }}><Trash2 size={16} /></button>}
          </div>
        </div>)}
        <section className="equity-range-matrix" id="equity-range-matrix" aria-labelledby="equity-matrix-title" hidden={matrixPlayer === null}>
          {matrixPlayer !== null && <>
            <div className="section-head grid-heading">
              <h2 id="equity-matrix-title">Player {matrixPlayer + 1} range matrix</h2>
              <button type="button" className="button text-button" disabled={running || !players[matrixPlayer]} onClick={() => setRange(matrixPlayer, '')}>Clear range</button>
            </div>
            {invalidMatrixRange && <p className="field-hint">Fix the range text or clear it to select hands.</p>}
            <p className="field-hint grid-scroll-hint">Swipe the matrix to see all ranks.</p>
            <div className="range-grid-scroll" key={matrixPlayer}><div className="range-grid" role="group" aria-label={'Starting hands for player ' + (matrixPlayer + 1)}>
              {gridHands.map((row, i) => row.map((hand, j) => {
                const pressed = matrixSelection.get(hand) ?? false
                return <button type="button" key={hand}
                  className={i === j ? 'pair' : i < j ? 'suited' : 'offsuit'}
                  disabled={running || invalidMatrixRange} aria-pressed={pressed}
                  onClick={() => setRange(matrixPlayer, toggleRangeClass(matrixRange, hand, pressed === true))}>{hand}</button>
              }))}
            </div></div>
            <div className="grid-legend"><span className="pair">Pair</span><span className="suited">Suited</span><span className="offsuit">Offsuit</span><span className="partial">Partial</span></div>
          </>}
        </section>
      </div>
      <div className="equity-board">
        <div className="board-heading"><label htmlFor="board-cards">Board cards</label><span id="board-hint">Blank for preflop</span></div>
        <input id="board-cards" aria-describedby="board-hint" placeholder="e.g. Ah 9d 4c" value={board} onChange={event => { clear(); setBoard(event.target.value) }} autoComplete="off" spellCheck={false} disabled={running} />
      </div>
      <div className="equity-actions">
        <details className="dead-card-options">
          <summary><ChevronDown size={16} /><span>Dead cards{dead.trim() && ' · ' + dead.trim()}</span></summary>
          <input aria-label="Dead cards" placeholder="e.g. 2h 7d" value={dead} onChange={event => { clear(); setDead(event.target.value) }} autoComplete="off" spellCheck={false} disabled={running} />
        </details>
        {running
          ? <button type="button" className="button" onClick={event => { event.preventDefault(); stop(); setStatus('Calculation canceled.') }}>Cancel</button>
          : <button type="submit" className="button primary">Calculate equity</button>}
      </div>
      {running && <div className="calculation-progress"><p role="status">Calculating equity…</p><progress aria-label="Calculation progress" max={1} value={progress || undefined} /></div>}
      {status && <p className="field-hint" role="status">{status}</p>}
      {problem && <p className="error" role="alert">{problem}</p>}
    </form>

    <div aria-live="polite">
      {result && <section className="panel equity-results">
        <div className="section-head"><h2>Results</h2><span className="result-count">{result.mode === 'exact' ? 'Exact' : 'Estimated'} · {countText.format(result.count)} {result.mode === 'exact' ? (result.count === 1 ? 'outcome' : 'outcomes') : (result.count === 1 ? 'sample' : 'samples')}</span></div>
        <table className="results-table">
          <thead><tr><th scope="col">Player</th><th scope="col">Equity</th><th scope="col">Win</th><th scope="col">Tie</th></tr></thead>
          <tbody>{result.players.map((player, index) => <tr key={index}><th scope="row">Player {index + 1}</th><td><strong>{percent(player.equity)}</strong><span className="equity-bar" aria-hidden="true"><span style={{ width: percent(player.equity) }} /></span></td><td>{percent(player.win)}</td><td>{percent(player.tie)}</td></tr>)}</tbody>
        </table>
      </section>}
    </div>

    {result && <div className="calculation-save">
      {!userId ? <a className="button" href="#library">Sign in to save calculation</a>
        : savedTitle ? <p role="status">Saved as <strong>{savedTitle}</strong>. <a href="#library">Open Library</a></p>
        : saveOpen ? <form className="save-calculation-form" onSubmit={saveCalculation}>
          <label>Calculation name<input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required /></label>
          <button className="button primary" disabled={saveBusy || !title.trim()}>Save calculation</button>
        </form>
        : <button className="button" disabled={saveBusy} onClick={() => {
          setTitle(players.map(player => player.trim()).join(' vs ').slice(0, 120))
          setSaveOpen(true)
        }}>Save calculation</button>}
      {saveError && <p className="error" role="alert">{saveError}</p>}
    </div>}
  </div>
}
