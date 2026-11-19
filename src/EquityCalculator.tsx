import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BarChart3, Calculator as CalculatorIcon, Grid3X3, Plus, Trash2, X } from 'lucide-react'
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

  return <>
    <div className="tool-heading">
      <div><div className="eyebrow"><span /> NO-LIMIT TEXAS HOLD’EM</div><h1>Equity Calculator</h1><p>Compare exact hands and ranges on any street.</p></div>
    </div>
    <div className="equity-layout">
      <form className="panel equity-inputs" onSubmit={calculate}>
        <div className="section-head"><h2><CalculatorIcon size={18} /> Matchup</h2><button type="button" className="button small" disabled={running || players.length >= 10} onClick={() => {
          clear()
          setFocused(players.length)
          setPlayers([...players, 'random'])
        }}><Plus size={16} /> Add player</button></div>
        <div className="range-list">
          {players.map((range, index) => <div className="range-row" key={index}>
            <label><span className="range-heading"><span>Player {index + 1}</span><span aria-hidden="true">{ranges[index] && countText.format(ranges[index].combos.length) + (ranges[index].combos.length === 1 ? ' combo' : ' combos')}</span></span>
              <input aria-label={'Player ' + (index + 1)} id={'range-player-' + index} value={range} placeholder="AsKd or 77+, AJs+, KQo" onFocus={() => setFocused(index)} onChange={event => setRange(index, event.target.value)} autoComplete="off" spellCheck={false} disabled={running} />
            </label>
            {players.length > 2 && <button type="button" className="icon-button" aria-label={'Remove player ' + (index + 1)} disabled={running} onClick={() => {
              clear()
              setPlayers(players.filter((_, i) => i !== index))
              setFocused(index < focused ? focused - 1 : Math.min(focused, players.length - 2))
            }}><Trash2 size={16} /></button>}
          </div>)}
        </div>
        <div className="equity-board">
          <label>Board cards <input placeholder="Ah 9d 4c" value={board} onChange={event => { clear(); setBoard(event.target.value) }} autoComplete="off" spellCheck={false} disabled={running} /></label>
          <p className="field-hint">0 for preflop, 3 for flop, 4 for turn, 5 for river.</p>
          <label>Dead cards <input placeholder="Optional · e.g. 2h 7d" value={dead} onChange={event => { clear(); setDead(event.target.value) }} autoComplete="off" spellCheck={false} disabled={running} /></label>
        </div>
        <div className="calculation-actions">
          <button className="button primary" disabled={running}><CalculatorIcon size={16} /> Calculate equity</button>
          {running && <button type="button" className="button" onClick={() => { stop(); setStatus('Calculation canceled.') }}><X size={16} /> Cancel</button>}
        </div>
        {running && <div className="calculation-progress"><p role="status">Calculating equity…</p><progress aria-label="Calculation progress" max={1} value={progress || undefined} /></div>}
        {status && <p className="field-hint" role="status">{status}</p>}
        {problem && <p className="error" role="alert">{problem}</p>}
      </form>

      <section className="panel equity-grid-panel">
        <div className="section-head grid-heading"><div><h2><Grid3X3 size={17} /> Range grid</h2><p>Tap any starting hand to include it.</p></div><label><span className="sr-only">Edit range for</span><select value={focused} onChange={event => setFocused(Number(event.target.value))} disabled={running}>{players.map((_, index) => <option key={index} value={index}>Player {index + 1}</option>)}</select></label></div>
        <p className="field-hint grid-scroll-hint">Swipe the grid to see all ranks.</p>
        <div className="range-grid-scroll"><div className="range-grid" role="group" aria-label={'Starting hands for player ' + (focused + 1)}>
          {gridHands.map((row, i) => row.map((hand, j) => <button type="button" key={hand}
            className={i === j ? 'pair' : i < j ? 'suited' : 'offsuit'} disabled={running} aria-pressed={selected?.classes.has(hand) ?? false} onClick={() => toggleHand(hand)}>{hand}</button>))}
        </div></div>
        <div className="grid-footer"><div className="grid-legend"><span className="pair">Pair</span><span className="suited">Suited</span><span className="offsuit">Offsuit</span></div><button className="button text-button" disabled={running || !players[focused]} onClick={() => setRange(focused, '')}>Clear range</button></div>
      </section>
    </div>

    <section className="panel equity-results" aria-live="polite">
      <div className="section-head"><h2><BarChart3 size={18} /> Results</h2>{result && <span className="pill">{result.mode === 'exact' ? 'Exact' : 'Estimated'} · {countText.format(result.count)} {result.mode === 'exact' ? (result.count === 1 ? 'outcome' : 'outcomes') : (result.count === 1 ? 'sample' : 'samples')}</span>}</div>
      {result ? <table className="results-table">
        <thead><tr><th scope="col">Player</th><th scope="col">Equity</th><th scope="col">Win</th><th scope="col">Tie</th></tr></thead>
        <tbody>{result.players.map((player, index) => <tr key={index}><th scope="row">Player {index + 1}</th><td><strong>{percent(player.equity)}</strong><span className="equity-bar" aria-hidden="true"><span style={{ width: percent(player.equity) }} /></span></td><td>{percent(player.win)}</td><td>{percent(player.tie)}</td></tr>)}</tbody>
      </table> : <p>Run a calculation to see each player’s equity, wins and ties.</p>}
    </section>
  </>
}
