import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, RotateCcw, X } from 'lucide-react'
import { cardText, deck, suits } from './cards.ts'
import { PlayingCard } from './PlayingCard.tsx'
import { PreflopHandGrid } from './PreflopHandGrid.tsx'
import {
  activeGtoPlayers, formatGtoBb, gtoMatchup, gtoPlayer, gtoStreets,
  type GtoGameState, type GtoMove, type GtoStreet,
} from './gtoGame.ts'
import {
  advanceGtoNode, attachGtoFlop, createGtoRoot, currentGtoNode, followGtoBranch, jumpGtoNode, makeGtoStudy,
  simpleGtoPresetName, type GtoBranch, type GtoNavigation, type GtoNode, type GtoStudy,
} from './gtoPreflop.ts'
import { findGtoFlop, studyFingerprint } from './gtoCatalog.ts'
import { mixForHand, parsePreflopPresets, preflopColors, preflopHands, preflopStudyPath } from './preflop.ts'
import { readStudyFile } from './studyFiles.ts'
import './gto-library.css'

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })
const streetName = (street: GtoStreet) => street[0].toUpperCase() + street.slice(1)
const flopSlots = ['First flop card', 'Second flop card', 'Third flop card']
const pickerRows = [...suits].reverse().map(suit => deck.filter(card => suits[card % suits.length] === suit).reverse())

function actionLabel(move: GtoMove, game: GtoGameState, amount = 0) {
  if (move.kind === 'raise') return 'Raise to ' + formatGtoBb(move.to, game.config)
  if (move.kind === 'all-in') return 'All-in ' + formatGtoBb(amount, game.config)
  if (move.kind === 'call') return 'Call ' + formatGtoBb(amount, game.config)
  return move.kind === 'check' ? 'Check' : 'Fold'
}

function branchLabel(move: GtoMove, game: GtoGameState) {
  const actor = gtoPlayer(game, game.actor!)
  return actionLabel(move, game, move.kind === 'all-in'
    ? actor.contributed + actor.stack : Math.min(actor.stack, game.wager - actor.contributed))
}

function GtoTable({ game }: { game: GtoGameState }) {
  const [winner] = activeGtoPlayers(game)
  const status = game.phase === 'uncontested' ? winner.position + ' wins the pot'
    : game.phase === 'awaiting-flop' ? 'Choose a flop'
    : game.actor ? game.actor + (game.phase === 'betting' ? ' to act' : ' first to act')
    : 'All-in runout'
  return <section className="gto-table" aria-label="Six-player table">
    <div className="gto-felt" aria-hidden="true" />
    {game.players.map(player => <div key={player.position} data-position={player.position}
      className={'gto-seat' + (player.folded ? ' folded' : '') + (game.actor === player.position ? ' acting' : '')}>
      <strong>{player.position}{player.position === 'BTN' && <span className="gto-dealer" aria-label="Dealer button">D</span>}</strong>
      <span aria-label={player.position + ' remaining stack'}>{formatGtoBb(player.stack, game.config)}</span>
      {player.folded && <small>Folded</small>}
      {!player.folded && player.contributed > 0 && <small>In {formatGtoBb(player.contributed, game.config)}</small>}
    </div>)}
    <div className="gto-table-center">
      <div className="gto-pot"><span>Pot</span> <strong>{formatGtoBb(game.pot, game.config)}</strong></div>
      {game.street !== 'preflop' && <div className="gto-board" aria-label="Flop board">
        {flopSlots.map((slot, index) => <PlayingCard key={slot} card={game.board[index]} />)}
      </div>}
      <span className="gto-actor" aria-live="polite">{status}</span>
    </div>
  </section>
}

function BettingHistory({ navigation, jump }: { navigation: GtoNavigation; jump: (index: number) => void }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = list.current
    const selected = container?.querySelector<HTMLButtonElement>('[aria-current="step"]')
    if (container && selected) {
      if (selected.offsetLeft < container.scrollLeft) container.scrollLeft = selected.offsetLeft
      const right = selected.offsetLeft + selected.offsetWidth
      if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth
    }
  }, [navigation.cursor, navigation.nodes])
  return <div className="gto-history" role="group" aria-label="Betting history" ref={list}>
    {navigation.nodes.map((node, index) => {
      const entry = node.game.history.at(-1)
      const text = node.game.board.length ? 'Flop ' + node.game.board.map(cardText).join(' ')
        : entry ? entry.actor + ' · ' + actionLabel(entry.move, node.game, entry.move.kind === 'all-in' ? entry.total : entry.paid) : 'Start'
      return <button type="button" key={node.id} aria-current={index === navigation.cursor ? 'step' : undefined}
        className={index > navigation.cursor ? 'future' : undefined} onClick={() => jump(index)}>{text}</button>
    })}
  </div>
}

const moveColors: Record<GtoMove['kind'], string> = {
  fold: preflopColors.fold, check: preflopColors.call, call: preflopColors.call,
  raise: preflopColors.raise, 'all-in': preflopColors.allIn,
}

function PreflopActions({ node, onAction }: { node: GtoNode; onAction: (branch: GtoBranch) => void }) {
  if (!node.game.actor) return <p className="gto-applied-note">This hand ended preflop.</p>
  const listed = node.branches.filter(branch => branch.sourceAction)
  const other = node.branches.filter(branch => !branch.sourceAction)
  function actionGroup(items: GtoBranch[], label: string) {
    if (!items.length) return null
    return <div className="gto-action-group">
      <h3>{label}</h3>
      <div className="gto-action-grid">
        {items.map(branch => <button key={branch.childId} type="button" className="gto-action"
          data-action={branch.move.kind} onClick={() => onAction(branch)}
          style={{ borderInlineStartColor: branch.sourceAction?.color ?? moveColors[branch.move.kind] }}>
          <strong>{branchLabel(branch.move, node.game)}</strong>
          {branch.rangeFrequency !== null && <span>{percent.format(branch.rangeFrequency)} of range</span>}
          {!branch.sourceAction && <span>Frequency unavailable</span>}
        </button>)}
      </div>
    </div>
  }
  return <div className="gto-actions" aria-label="Available actions">
    {actionGroup(listed, 'Source actions')}
    {actionGroup(other, listed.length ? 'Other legal actions' : 'Explore legal actions')}
  </div>
}

function GtoStrategyPanel({ node, hand, selectHand }: { node: GtoNode; hand: number; selectHand: (hand: number) => void }) {
  const strategy = node.strategy
  const actions = strategy.status === 'available' ? strategy.actions : []
  const mix = mixForHand(actions, hand)
  return <section className="panel preflop-chart gto-strategy" aria-label="Preflop strategy">
    <div className="gto-strategy-title">
      <h2>{node.game.actor ? node.game.actor + ' strategy' : 'Preflop strategy'}</h2>
      {strategy.status === 'available' && <span>{strategy.spot.split('/')[0] === '2Bet' ? 'RFI' : strategy.spot.split('/')[0].replace('Bet', '-bet')}</span>}
    </div>
    {strategy.status === 'missing' && <p className="gto-source-note">{strategy.reason}</p>}
    <PreflopHandGrid actions={actions} hand={hand} onHandChange={selectHand} />
    <div className="gto-mix" aria-live="polite" aria-label="Selected-hand frequencies">
      <strong>{preflopHands[hand]}</strong>
      {mix.length ? <ul className="preflop-actions">
        {mix.map(({ label, color, frequency }) => <li key={label}>
          <span className="preflop-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
          {label} <strong>{percent.format(frequency)}</strong>
        </li>)}
      </ul> : <span>Frequency unavailable</span>}
    </div>
    {strategy.status === 'available' && <div className="gto-strategy-notes">
      {strategy.basis === 'opening-range' && <p>Range percentages use the opening range. The matrix shows the original export.</p>}
      {strategy.basis === 'unverified' && <p>The source row is shown as exported. Incoming range frequencies are unavailable.</p>}
      {strategy.overlapping && <p>Some exported combo totals exceed 100%. Range-wide frequencies are unavailable.</p>}
      {strategy.hasUnmapped && <p>Some exported labels require a different decision context.</p>}
    </div>}
  </section>
}

function FlopPicker({ board, onFlop }: { board: readonly number[]; onFlop: (cards: number[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [draft, setDraft] = useState<number[]>([])
  const full = draft.length === flopSlots.length
  const canApply = full && draft.some(card => !board.includes(card))

  useEffect(() => {
    const dismiss = () => dialog.current?.close()
    window.addEventListener('hashchange', dismiss)
    return () => window.removeEventListener('hashchange', dismiss)
  }, [])

  function toggleCard(card: number) {
    setDraft(cards => {
      if (cards.includes(card)) return cards.filter(selected => selected !== card)
      return cards.length < flopSlots.length ? [...cards, card] : cards
    })
  }

  return <>
    <button type="button" className="button gto-flop-trigger" aria-haspopup="dialog" onClick={() => {
      setDraft([...board])
      dialog.current?.showModal()
    }}>{board.length ? 'Change flop' : 'Choose flop'}</button>
    <dialog className="gto-flop-dialog" ref={dialog} aria-labelledby={title}>
      <form onSubmit={event => {
        event.preventDefault()
        if (!canApply) return
        dialog.current?.close()
        onFlop(draft)
      }}>
        <header className="gto-picker-head">
          <h2 id={title}>Set the flop</h2>
          <button type="button" className="icon-button" aria-label="Close flop picker" onClick={() => dialog.current?.close()}><X size={17} aria-hidden="true" /></button>
        </header>
        <div className="gto-picker-preview" role="group" aria-label="Selected flop cards">
          {flopSlots.map((slot, index) => <span className="gto-picker-slot" key={slot}>
            <PlayingCard card={draft[index]} />
            {index === draft.length && <Plus size={15} aria-hidden="true" />}
          </span>)}
        </div>
        <div className="gto-picker-deck" role="group" aria-label="Deck">
          {pickerRows.map(row => <div key={row[0]} className="gto-picker-suit">
            {row.map(card => {
              const picked = draft.indexOf(card)
              return <button key={card} type="button" className="gto-picker-card" aria-pressed={picked !== -1}
                disabled={full && picked === -1} onClick={() => toggleCard(card)}>
                <PlayingCard card={card} />
                {picked !== -1 && <span className="gto-picker-order" aria-hidden="true">{picked + 1}</span>}
              </button>
            })}
          </div>)}
        </div>
        <footer className="gto-picker-footer">
          <p role="status">{full ? 'Tap a selected card to remove it.' : draft.length + ' of 3 selected'}</p>
          <div className="gto-picker-buttons">
            <button type="button" className="button" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="button primary" disabled={!canApply}>Set flop</button>
          </div>
        </footer>
      </form>
    </dialog>
  </>
}

function PostflopPanel({ node, street, study, onFlop }: { node: GtoNode; street: GtoStreet; study: GtoStudy; onFlop: (cards: number[]) => void }) {
  const matchup = gtoMatchup(node.game)!
  const { headsUp, effectiveStack, players, potType } = matchup
  const hasBoard = node.game.board.length === 3
  const canLookUp = headsUp && effectiveStack > 0 && hasBoard
  const [lookup, setLookup] = useState<{ id: string; status: 'found' | 'missing' | 'unavailable' }>()
  const [attempt, retry] = useState(0)
  const status = lookup?.id === node.id ? lookup?.status : undefined

  useEffect(() => {
    if (!canLookUp) return
    const controller = new AbortController()
    void findGtoFlop(study, node, controller.signal).then(solution => {
      if (!controller.signal.aborted) setLookup({ id: node.id, status: solution ? 'found' : 'missing' })
    }).catch(() => {
      if (!controller.signal.aborted) setLookup({ id: node.id, status: 'unavailable' })
    })
    return () => controller.abort()
  }, [attempt, canLookUp, node, study])

  return <section className="panel gto-postflop" aria-label={streetName(street) + ' strategy'}>
    <h2>{streetName(street)}</h2>
    <p className="gto-matchup">{players.map(player => player.position).join(headsUp ? ' vs ' : ' · ')} · {potType}</p>
    <dl className="gto-postflop-stats">
      <div><dt>Pot before rake</dt><dd>{formatGtoBb(node.game.pot, node.game.config)}</dd></div>
      <div><dt>Effective stack</dt><dd>{formatGtoBb(effectiveStack, node.game.config)}</dd></div>
    </dl>
    <ul className="gto-range-status" aria-label="Incoming ranges">
      {players.map(player => {
        const range = node.incomingRanges[player.position]
        const mass = range?.weights.reduce((sum, value) => sum + value, 0)
        return <li key={player.position}><strong>{player.position}</strong>
          {mass === undefined ? 'Range unavailable' : formatComboMass(mass) +
            (range?.provenance === 'overlapping-export' ? ' · export overlaps' : '')}
        </li>
      })}
    </ul>
    {street === 'flop' && <FlopPicker board={node.game.board} onFlop={onFlop} />}
    <div className="gto-catalog-status" role="status">
      {street !== 'flop' ? <p>{streetName(street)} strategy unavailable.</p>
        : !headsUp ? <p>Multiway flop strategies are unavailable.</p>
        : effectiveStack === 0 ? <p>The players are all-in. No postflop decision remains.</p>
        : !hasBoard ? <p>Choose a flop to check the strategy catalog.</p>
        : status === 'found' ? <p>Stored flop solution available in the catalog.</p>
        : status === 'missing' ? <p>No stored flop solution for this matchup and board.</p>
        : status === 'unavailable' ? <><p>The private strategy catalog is unavailable.</p>
          <button type="button" className="button small" onClick={() => { setLookup(undefined); retry(value => value + 1) }}>Retry</button></>
        : <p>Checking the strategy catalog…</p>}
    </div>
  </section>
}

const comboFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const formatComboMass = (mass: number) => comboFormat.format(mass) + ' weighted combos'

function GtoBrowser({ study }: { study: GtoStudy }) {
  const [navigation, setNavigation] = useState<GtoNavigation>(() => ({ nodes: [createGtoRoot(study)], cursor: 0 }))
  const [hand, setHand] = useState(0)
  const [previewStreet, setPreviewStreet] = useState<'turn' | 'river' | null>(null)
  const node = currentGtoNode(navigation)
  const street = previewStreet ?? node.game.street
  const reachedStreets = navigation.nodes.map(item => item.game.street)
  const lastPreflop = reachedStreets.lastIndexOf('preflop')
  const lastFlop = reachedStreets.lastIndexOf('flop')
  const boardNode = lastFlop >= 0 && navigation.nodes[lastFlop].game.board.length === 3

  function jump(index: number) {
    setNavigation(value => jumpGtoNode(value, index))
    setPreviewStreet(null)
  }
  function follow(branch: GtoBranch) {
    setNavigation(value => advanceGtoNode(value, followGtoBranch(currentGtoNode(value), branch.childId, study)))
  }
  function chooseFlop(cards: number[]) {
    setNavigation(value => {
      const active = currentGtoNode(value)
      const predeal = active.game.phase === 'postflop' ? jumpGtoNode(value, value.cursor - 1) : value
      return advanceGtoNode(predeal, attachGtoFlop(currentGtoNode(predeal), cards))
    })
    setPreviewStreet(null)
  }
  function selectStreet(next: GtoStreet) {
    if (next === 'preflop' || next === 'flop') {
      jump(next === 'preflop' ? lastPreflop : lastFlop)
    } else if (boardNode) {
      setNavigation(value => jumpGtoNode(value, lastFlop))
      setPreviewStreet(next)
    }
  }

  return <>
    <div className="gto-street-bar">
      <div className="gto-streets" role="group" aria-label="GTO Library streets">
        {gtoStreets.map(item => <button key={item} type="button" aria-pressed={item === street}
          disabled={item === 'flop' ? lastFlop < 0 : (item === 'turn' || item === 'river') && !boardNode}
          onClick={() => selectStreet(item)}>{streetName(item)}</button>)}
      </div>
      <div className="gto-navigation" role="group" aria-label="Tree navigation">
        <button type="button" className="icon-button" aria-label="Back" disabled={!navigation.cursor} onClick={() => jump(navigation.cursor - 1)}><ArrowLeft size={17} /></button>
        <button type="button" className="icon-button" aria-label="Forward" disabled={navigation.cursor >= navigation.nodes.length - 1} onClick={() => jump(navigation.cursor + 1)}><ArrowRight size={17} /></button>
        <button type="button" className="icon-button" aria-label="Reset" disabled={navigation.nodes.length === 1} onClick={() => {
          setNavigation(value => ({ nodes: [value.nodes[0]], cursor: 0 }))
          setPreviewStreet(null)
        }}><RotateCcw size={16} /></button>
      </div>
    </div>
    <BettingHistory navigation={navigation} jump={jump} />
    <div className="gto-layout">
      <div className="panel gto-play">
        <GtoTable game={node.game} />
        {street === 'preflop' && <PreflopActions node={node} onAction={follow} />}
      </div>
      {street === 'preflop' ? <GtoStrategyPanel node={node} hand={hand} selectHand={setHand} />
        : <PostflopPanel node={node} street={street} study={study} onFlop={chooseFlop} />}
    </div>
  </>
}

export default function GtoLibrary() {
  const [study, setStudy] = useState<GtoStudy | null>()
  const [attempt, retry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const text = await readStudyFile(preflopStudyPath, controller.signal)
        const preset = parsePreflopPresets(text).find(item => item.name === simpleGtoPresetName)
        if (!preset) throw new Error('The GTO Wizard Simple preset is missing.')
        const fingerprint = await studyFingerprint(text)
        if (!controller.signal.aborted) setStudy(makeGtoStudy(preset, fingerprint))
      } catch {
        if (!controller.signal.aborted) setStudy(null)
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt])

  return <div className="gto-library">
    <header className="gto-heading">
      <h1>GTO Library</h1>
      <p>GTO Wizard Simple · 6-max NLHE · 100 bb</p>
    </header>
    {study ? <GtoBrowser study={study} />
      : study === null ? <div className="preflop-load-error">
        <p className="error" role="alert">Couldn’t load the Simple preflop preset.</p>
        <button type="button" className="button" onClick={() => { setStudy(undefined); retry(count => count + 1) }}>Retry</button>
      </div> : <p role="status">Loading preflop ranges…</p>}
  </div>
}
