import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { cardText, readCards } from './cards.ts'
import { PlayingCard } from './PlayingCard.tsx'
import { supabase } from './library.ts'
import { parseFlopImport } from './flopViewerImport.ts'
import { getFlopSpot, listFlopBoards, listFlopConfigurations, saveFlopSpots, type FlopConfiguration } from './flopViewerLibrary.ts'
import {
  flopActionColor, flopComboShares, flopHands, flopMixBackground, summarizeFlopNode, unlistedAction,
  type FlopNode, type FlopSpot,
} from './flopStrategy.ts'
import './flop-viewer.css'

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })
const amount = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const configKey = (config: FlopConfiguration) => JSON.stringify([config.configuration, config.is_example])

type Loader<T> = (signal: AbortSignal) => Promise<T>

function useFlopData<T>(load: Loader<T> | null, revision: number) {
  const [result, setResult] = useState<{ load: Loader<T>; revision: number; data?: T; error?: true }>()
  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    void load(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ load, revision, data })
    }, () => {
      if (!controller.signal.aborted) setResult({ load, revision, error: true })
    })
    return () => controller.abort()
  }, [load, revision])
  return result?.load === load && result.revision === revision ? result : undefined
}

function actionSummary(shares: number[], weight: number, labels: string[]) {
  return shares.map((share, index) => share > 1e-8 ? labels[index] + ' ' + percent.format(share / weight) : '')
    .filter(Boolean).join(', ')
}

function FlopBreakdown({ title, rows, labels, colors }: {
  title: string
  rows: Map<string, { weight: number; shares: number[] }>
  labels: string[]
  colors: string[]
}) {
  return <section className="panel flop-viewer-breakdown" aria-label={title}>
    <h2>{title}</h2>
    <ul>
      {[...rows].filter(([, total]) => total.weight > 0).map(([label, { weight, shares }]) => <li key={label}>
        <div className="flop-viewer-breakdown-head"><span>{label}</span><span>{amount.format(weight)}</span></div>
        <div className="flop-viewer-bar" role="img" aria-label={actionSummary(shares, weight, labels)}
          title={actionSummary(shares, weight, labels)} style={{ backgroundImage: flopMixBackground(shares, weight, colors) }} />
      </li>)}
    </ul>
  </section>
}

function FlopMatrix({ board, node }: { board: string; node: FlopNode }) {
  const boardCards = useMemo(() => readCards(board), [board])
  const { whole, hands, made, draws } = useMemo(() => summarizeFlopNode(boardCards, node), [boardCards, node])
  const labels = [...node.actions.map(action => action.label), unlistedAction.label]
  const colors = [...node.actions.map(flopActionColor), unlistedAction.color]
  const [selected, setSelected] = useState<number | null>(null)
  const grid = useRef<HTMLDivElement>(null)

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 13)
    const col = index % 13
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = row * 13 + Math.max(0, col - 1); break
      case 'ArrowRight': next = row * 13 + Math.min(12, col + 1); break
      case 'ArrowUp': next = Math.max(0, row - 1) * 13 + col; break
      case 'ArrowDown': next = Math.min(12, row + 1) * 13 + col; break
      default: return
    }
    event.preventDefault()
    setSelected(next)
    grid.current?.querySelectorAll('button')[next]?.focus()
  }

  const hand = selected === null ? undefined : hands.get(flopHands[selected])
  return <div className="flop-viewer-layout">
    <div className="flop-viewer-main">
      <section className="panel flop-viewer-matrix" aria-label="Flop strategy grid">
        <div className="flop-viewer-board">
          <div className="flop-viewer-cards" role="group" aria-label="Board">
            {boardCards.map(card => <PlayingCard key={card} card={card} />)}
          </div>
          <span>{amount.format(whole.weight)} weighted combos</span>
        </div>
        <span className="sr-only" id="flop-viewer-keys">Use the arrow keys to select a starting hand.</span>
        <div className="flop-viewer-grid" role="group" aria-label="Starting hands" aria-describedby="flop-viewer-keys" ref={grid}>
          {flopHands.map((name, index) => {
            const range = hands.get(name)!
            return <button type="button" key={name} aria-pressed={selected === index} tabIndex={(selected ?? 0) === index ? 0 : -1}
              title={range.weight ? actionSummary(range.shares, range.weight, labels) : 'No weighted combos'}
              style={{ backgroundImage: flopMixBackground(range.shares, range.legal, colors) }}
              onClick={() => setSelected(index)} onKeyDown={event => move(event, index)}>{name}</button>
          })}
        </div>
        {whole.weight > 0 ? <ul className="flop-viewer-totals" aria-label="Overall action frequencies">
          {whole.shares.map((share, index) => index < node.actions.length || share > 1e-8 ? <li key={index}>
            <span className="flop-viewer-swatch" style={{ backgroundColor: colors[index] }} aria-hidden="true" />
            {labels[index]} <strong>{percent.format(share / whole.weight)}</strong>
            <span className="flop-viewer-muted">{amount.format(share)} combos</span>
          </li> : null)}
        </ul> : <p className="flop-viewer-note">This node has no weighted combos on the selected flop.</p>}
      </section>
      {hand && <section className="panel flop-viewer-combos" aria-label="Exact combos">
        <div className="flop-viewer-combo-heading">
          <h2>{flopHands[selected!]} combos</h2>
          <span>{amount.format(hand.weight)} weighted</span>
        </div>
        {hand.combos.length ? <ul className="flop-viewer-combo-list">
          {hand.combos.map(combo => {
            const shares = flopComboShares(combo.frequencies)
            const summary = actionSummary(shares, 1, labels)
            return <li key={combo.hand}>
              <div className="flop-viewer-combo-cards">
                <div className="flop-viewer-cards" role="group" aria-label={combo.hand}>
                  {readCards(combo.hand).map(card => <PlayingCard key={card} card={card} />)}
                </div>
                <span title="Range weight">{percent.format(combo.weight)} weight</span>
              </div>
              <div className="flop-viewer-combo-mix">
                <div className="flop-viewer-bar" role="img" aria-label={summary} title={summary}
                  style={{ backgroundImage: flopMixBackground(shares, 1, colors) }} />
                <ul className="flop-viewer-combo-actions">
                  {node.actions.map((action, index) => <li key={action.label}>
                    <span className="flop-viewer-swatch" style={{ backgroundColor: colors[index] }} aria-hidden="true" />
                    {action.label} <strong>{percent.format(combo.frequencies[index] / 100)}</strong>
                    {combo.evs?.[index] != null && <span className="flop-viewer-muted">EV {amount.format(combo.evs[index]!)}</span>}
                  </li>)}
                </ul>
              </div>
            </li>
          })}
        </ul> : <p className="flop-viewer-note">No weighted combos for this hand.</p>}
      </section>}
    </div>
    <div className="flop-viewer-side">
      <FlopBreakdown title="Made hands" rows={made} labels={labels} colors={colors} />
      <FlopBreakdown title="Draws" rows={draws} labels={labels} colors={colors} />
    </div>
  </div>
}

function ImportFlopRanges({ userId, onSaved }: { userId: string; onSaved: (spot: FlopSpot) => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: true }>()

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const file = new FormData(form).get('ranges')
    if (!(file instanceof File) || !file.size) return
    setBusy(true)
    setNotice(undefined)
    try {
      const spots = parseFlopImport(await file.text())
      await saveFlopSpots(spots, userId)
      form.reset()
      onSaved(spots[0])
      setNotice({ text: `Saved ${spots.length} ${spots.length === 1 ? 'flop' : 'flops'} to Supabase.` })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Couldn’t save the flop ranges.' })
    } finally {
      setBusy(false)
    }
  }

  return <details className="panel flop-viewer-import">
    <summary>Import ranges</summary>
    <form onSubmit={save}>
      <p>Use a JSON range file or a legacy Flop Viewer TSV. Importing the same configuration and flop replaces that spot.</p>
      <label>Range file<input type="file" name="ranges" accept=".json,.tsv,application/json,text/tab-separated-values" required disabled={busy} /></label>
      <button type="submit" className="button" disabled={busy}>{busy ? 'Importing…' : 'Save to Supabase'}</button>
      {notice && <p className={notice.error ? 'error' : 'success'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    </form>
  </details>
}

function FlopViewerWorkspace({ userId }: { userId?: string }) {
  const [revision, setRevision] = useState(0)
  const [configurationKey, selectConfig] = useState('')
  const [boardCode, selectBoard] = useState('')
  const [nodeIndex, selectNode] = useState(0)
  const catalog = useFlopData(listFlopConfigurations, revision)
  const configuration = catalog?.data?.find(item => configKey(item) === configurationKey) ?? catalog?.data?.[0]
  const loadBoards = useCallback((signal: AbortSignal) => listFlopBoards(configuration!, signal), [configuration])
  const boards = useFlopData(configuration ? loadBoards : null, revision)
  const board = boards?.data?.find(item => item.board === boardCode) ?? boards?.data?.[0]
  const boardId = board?.id
  const loadSpot = useCallback((signal: AbortSignal) => getFlopSpot(boardId!, signal), [boardId])
  const spot = useFlopData(boardId ? loadSpot : null, revision)
  const node = spot?.data?.nodes[nodeIndex] ?? spot?.data?.nodes[0]
  const failed = catalog?.error || boards?.error || spot?.error
  const loading = !failed && (!catalog || (configuration && !boards) || (board && !spot))

  function openImported(spot: FlopSpot) {
    selectConfig(configKey({ configuration: spot.configuration, is_example: false }))
    selectBoard(spot.board)
    selectNode(0)
    setRevision(value => value + 1)
  }

  return <>
    {catalog?.data?.length ? <div className="panel flop-viewer-controls">
      <label>Configuration
        <select aria-label="Configuration" value={configuration ? configKey(configuration) : ''} onChange={event => {
          selectConfig(event.target.value)
          selectBoard('')
          selectNode(0)
        }}>
          {catalog.data.map(item => <option key={configKey(item)} value={configKey(item)}>
            {item.configuration}{item.is_example ? '' : ' · Private'}
          </option>)}
        </select>
      </label>
      <label>Flop
        <select aria-label="Flop" value={board?.board ?? ''} disabled={!boards?.data?.length} onChange={event => {
          selectBoard(event.target.value)
          selectNode(0)
        }}>
          {!boards?.data?.length && <option value="">Select a flop</option>}
          {boards?.data?.map(item => <option key={item.id} value={item.board}>{readCards(item.board).map(cardText).join(' ')}</option>)}
        </select>
      </label>
      <label>Node
        <select aria-label="Node" disabled={!spot?.data} value={node?.name ?? ''}
          onChange={event => selectNode(event.target.selectedIndex)}>
          {!spot?.data && <option value="">Select a node</option>}
          {spot?.data?.nodes.map(item => <option key={item.name}>{item.name}</option>)}
        </select>
      </label>
    </div> : null}
    {failed && <div className="flop-viewer-status">
      <p className="error" role="alert">Couldn’t load the ranges from Supabase.</p>
      <button className="button" type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>
    </div>}
    {loading && <p className="flop-viewer-note" role="status">Loading flop ranges…</p>}
    {!failed && !loading && !node && <p className="flop-viewer-note">No flop ranges are available yet.</p>}
    {spot?.data && node && <FlopMatrix key={boardId} board={spot.data.board} node={node} />}
    {userId ? <ImportFlopRanges userId={userId} onSaved={openImported} />
      : <a className="button flop-viewer-login" href="#library">Sign in to import ranges</a>}
  </>
}

export default function FlopViewer({ userId }: { userId?: string }) {
  return <div className="flop-viewer">
    <div className="tool-heading"><h1>Flop Viewer</h1></div>
    {supabase ? <FlopViewerWorkspace key={userId ?? 'public'} userId={userId} />
      : <p className="error" role="alert">Configure Supabase to load flop ranges.</p>}
  </div>
}
