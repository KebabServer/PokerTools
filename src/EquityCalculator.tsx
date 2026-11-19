import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { EquityResult } from './equity.ts'
import type { WorkerResponse } from './equity.worker.ts'
import { gridHands, normalizeExactField, parseRange } from './ranges.ts'

function rangeDetails(text: string) {
  try { return parseRange(normalizeExactField(text)) } catch { return null }
}

const percent = (decimal: number) => (decimal * 100).toFixed(2) + '%'
const countText = new Intl.NumberFormat('en-US')

export function EquityCalculator() {
  const [players, setPlayers] = useState(['AsKd', 'QQ'])
  const [focused, setFocused] = useState(1)
  const [board, setBoard] = useState('')
  const [dead, setDead] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<EquityResult | null>(null)
  const [problem, setProblem] = useState('')
  const [status, setStatus] = useState('')
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const ranges = players.map(rangeDetails)
  const selected = ranges[focused]
  const running = progress !== null

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
  }

  function setRange(index: number, value: string) {
    clear()
    setPlayers(values => values.map((previous, position) => index === position ? value : previous))
  }

  function toggleHand(hand: string) {
    const classes = new Set(selected?.classes)
    if (classes.has(hand)) classes.delete(hand)
    else classes.add(hand)
    setRange(focused, [...gridHands.flat().filter(name => classes.has(name)), ...(selected?.specific ?? [])].join(', '))
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
        setFocused(players.length)
        setPlayers([...players, 'random'])
      }}><Plus size={16} /> Add player</button>
    </div>
    <form className="panel equity-inputs" onSubmit={calculate}>
      <div className={'range-list' + (players.length > 2 ? ' multiple-players' : '')}>
        {players.map((range, index) => <div className="range-row" key={index}>
          <label><span className="range-heading"><span>Player {index + 1}</span><span aria-hidden="true">{ranges[index] && countText.format(ranges[index].combos.length) + (ranges[index].combos.length === 1 ? ' combo' : ' combos')}</span></span>
            <input aria-label={'Player ' + (index + 1)} id={'range-player-' + index} value={range} placeholder="AsKd or 77+" onFocus={() => setFocused(index)} onChange={event => setRange(index, event.target.value)} autoComplete="off" spellCheck={false} disabled={running} />
          </label>
          {players.length > 2 && <button type="button" className="icon-button" aria-label={'Remove player ' + (index + 1)} disabled={running} onClick={() => {
            clear()
            setPlayers(players.filter((_, i) => i !== index))
            setFocused(index < focused ? focused - 1 : Math.min(focused, players.length - 2))
          }}><Trash2 size={16} /></button>}
        </div>)}
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

    <details className="panel equity-grid-panel">
      <summary><ChevronDown size={16} /> Range grid</summary>
      <div className="section-head grid-heading"><p>Choose hands for</p><label><span className="sr-only">Edit range for</span><select value={focused} onChange={event => setFocused(Number(event.target.value))} disabled={running}>{players.map((_, index) => <option key={index} value={index}>Player {index + 1}</option>)}</select></label></div>
      <p className="field-hint grid-scroll-hint">Swipe the grid to see all ranks.</p>
      <div className="range-grid-scroll"><div className="range-grid" role="group" aria-label={'Starting hands for player ' + (focused + 1)}>
        {gridHands.map((row, i) => row.map((hand, j) => <button type="button" key={hand}
          className={i === j ? 'pair' : i < j ? 'suited' : 'offsuit'} disabled={running} aria-pressed={selected?.classes.has(hand) ?? false} onClick={() => toggleHand(hand)}>{hand}</button>))}
      </div></div>
      <div className="grid-footer"><div className="grid-legend"><span className="pair">Pair</span><span className="suited">Suited</span><span className="offsuit">Offsuit</span></div><button className="button text-button" disabled={running || !players[focused]} onClick={() => setRange(focused, '')}>Clear range</button></div>
    </details>
  </div>
}
