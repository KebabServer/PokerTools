import {
  activeGtoPlayers, dealGtoFlop, gtoLegalMoves, gtoMoveKey, gtoPlayer, playGtoMove, simpleGtoConfig, startGtoGame,
  type GtoGameConfig, type GtoGameState, type GtoMove, type GtoPosition,
} from './gtoGame.ts'
import {
  preflopComboOrder, preflopCombos, preflopPositions, preflopStudyPath, type PreflopAction, type PreflopPreset,
} from './preflop.ts'

export const simpleGtoPresetName = 'GTOw 500nl Simple'
const exportRounding = 0.00501

export type GtoSource = {
  studyPath: string; preset: string; adapterVersion: number; fingerprint: string; comboOrder: typeof preflopComboOrder
}
export type GtoStudy = { libraryKey: string; config: GtoGameConfig; preset: PreflopPreset; source: GtoSource }
export type IncomingGtoRange = {
  weights: Float64Array
  provenance: 'starting' | 'exported' | 'overlapping-export'
}
type IncomingRanges = Record<GtoPosition, IncomingGtoRange | null>
export type GtoComboStrategy = PreflopAction & { actionEvs?: Float64Array }
export type GtoStrategy =
  | { status: 'available'; spot: string; source: GtoSource; actions: readonly GtoComboStrategy[];
      basis: 'starting-range' | 'opening-range' | 'unverified'; overlapping: boolean; hasUnmapped: boolean }
  | { status: 'missing'; reason: string }

export type GtoBranch = {
  move: GtoMove
  childId: string
  sourceAction: GtoComboStrategy | null
  rangeFrequency: number | null
}

export type GtoNode = {
  id: string
  parentId: string | null
  game: GtoGameState
  incomingRanges: IncomingRanges
  strategy: GtoStrategy
  branches: readonly GtoBranch[]
}

export function makeGtoStudy(preset: PreflopPreset, fingerprint: string): GtoStudy {
  return {
    libraryKey: 'gtow-simple-100bb', config: simpleGtoConfig, preset,
    source: { studyPath: preflopStudyPath, preset: preset.name, adapterVersion: 1, fingerprint, comboOrder: preflopComboOrder },
  }
}

export function interpretGtoAction(label: string, unitsPerBb: number): GtoMove | null {
  // Slash labels describe conditional actions or plans spanning multiple decisions.
  // None provides an independent probability for a single action at this node.
  if (label === 'Fold') return { kind: 'fold' }
  if (label === 'Call') return { kind: 'call' }
  if (label === 'Check') return { kind: 'check' }
  if (label === 'All In') return { kind: 'all-in' }
  const match = /^Raise (\d+(?:\.\d+)?)bb$/.exec(label)
  const to = match ? Number(match[1]) * unitsPerBb : 0
  return Number.isSafeInteger(to) && to > 0 ? { kind: 'raise', to } : null
}

function sourceSpot(game: GtoGameState) {
  if (!game.actor || game.street !== 'preflop') return null
  const entries = game.history.filter(entry => entry.move.kind !== 'fold')
  const [open, reraise] = entries
  if (!open && game.actor !== 'BB') return `2Bet/${game.actor}/${game.actor}`
  if (entries.length === 1 && open.move.kind === 'raise') return `3Bet/${open.actor}/${game.actor}`
  if (entries.length === 2 && open.move.kind === 'raise' && reraise.move.kind === 'raise' &&
      game.actor === open.actor && activeGtoPlayers(game).length === 2) return `4Bet/${open.actor}/${reraise.actor}`
  return null
}

function readSpot(spot: string, game: GtoGameState, study: GtoStudy, incoming: IncomingGtoRange | null) {
  const row = study.preset.ranges.get(spot)
  const context = study.preset.contexts.get(spot)
  if (!row?.length || !context?.investedBb || !game.actor) return null
  const actor = context.actor === 'HJ' ? 'MP' : context.actor
  if (actor !== game.actor || !context.investedBb.every((amount, index) =>
    Math.round(amount * game.config.unitsPerBb) === game.players[index].contributed)) return null

  const totals = new Float64Array(preflopCombos.length)
  for (const action of row) action.comboFrequencies.forEach((frequency, i) => { totals[i] += frequency })
  const overlapping = totals.some(total => total > 1 + exportRounding)
  // The exported 4-bet responses sum to the opening weights combo by combo,
  // allowing for source rounding. Multiplying them by the opening weights again would double-count reach.
  const basis = spot.startsWith('4Bet/')
    ? incoming?.provenance === 'exported' && totals.every((total, i) =>
      Math.abs(total - incoming.weights[i]) <= exportRounding && (incoming.weights[i] > 0 || total === 0))
      ? 'opening-range' : 'unverified'
    : incoming?.provenance === 'starting' ? 'starting-range' : 'unverified'
  return { spot, row, basis, overlapping } as const
}

function observedOpens(game: GtoGameState, study: GtoStudy) {
  const actor = game.actor
  if (!actor || game.history.some(entry => entry.move.kind !== 'fold')) return []
  const index = preflopPositions.indexOf(actor)
  return [...study.preset.contexts].flatMap(([spot, context]) => {
    const invested = context.investedBb
    return spot.startsWith(`3Bet/${actor}/`) && invested && invested.every((amount, i) =>
      i === index || Math.round(amount * game.config.unitsPerBb) === game.players[i].contributed)
      ? [Math.round(invested[index] * game.config.unitsPerBb)] : []
  })
}

function buildNode(id: string, parentId: string | null, game: GtoGameState, incomingRanges: IncomingRanges, study: GtoStudy): GtoNode {
  const spot = sourceSpot(game)
  const incoming = game.actor ? incomingRanges[game.actor] : null
  const result = spot ? readSpot(spot, game, study, incoming) : null
  const decoded = (result?.row ?? []).map(action => ({ action, move: interpretGtoAction(action.label, game.config.unitsPerBb) }))
  const raises = decoded.flatMap(({ move }) => move?.kind === 'raise' ? [move.to] : [])
  const legal = gtoLegalMoves(game, [...raises, ...observedOpens(game, study)])
  const mass = incoming?.weights.reduce((total, weight) => total + weight, 0) ?? 0
  const branches = legal.map(move => {
    const key = gtoMoveKey(move)
    const matched = decoded.filter(entry => entry.move && gtoMoveKey(entry.move) === key)
    const sourceAction = matched.length === 1 ? matched[0].action : null
    const rangeFrequency = sourceAction && mass > 0 && result?.basis !== 'unverified' && !result?.overlapping
      ? sourceAction.comboFrequencies.reduce((sum, weight) => sum + weight, 0) / mass : null
    return { move, sourceAction, rangeFrequency, childId: id + '/' + game.actor + '-' + key }
  })
  const strategy: GtoStrategy = result ? {
    status: 'available', spot: result.spot, source: study.source, actions: result.row,
    basis: result.basis, overlapping: result.overlapping,
    hasUnmapped: decoded.some(entry => !branches.some(branch => branch.sourceAction === entry.action)),
  } : { status: 'missing', reason: spot && study.preset.ranges.get(spot)?.length
      ? 'No source strategy for this betting history. The exported row uses a different betting context.'
      : 'No source strategy for this betting history.' }
  return { id, parentId, game, incomingRanges, strategy, branches }
}

export function createGtoRoot(study: GtoStudy): GtoNode {
  const starting: IncomingGtoRange = { weights: new Float64Array(preflopCombos.length).fill(1), provenance: 'starting' }
  const incoming = Object.fromEntries(preflopPositions.map(position => [position, starting])) as IncomingRanges
  return buildNode('preflop', null, startGtoGame(study.config), incoming, study)
}

export function followGtoBranch(node: GtoNode, childId: string, study: GtoStudy): GtoNode {
  const branch = node.branches.find(item => item.childId === childId)
  const actor = node.game.actor
  if (!branch || !actor) throw new Error('This branch is unavailable.')
  const game = playGtoMove(node.game, branch.move)
  const strategy = node.strategy
  const range: IncomingGtoRange | null = branch.sourceAction && strategy.status === 'available' && strategy.basis !== 'unverified'
    ? { weights: branch.sourceAction.comboFrequencies, provenance: strategy.overlapping ? 'overlapping-export' : 'exported' }
    : null
  return buildNode(childId, node.id, game, { ...node.incomingRanges, [actor]: range }, study)
}

export const gtoBoardKey = (cards: readonly number[]) => [...cards].sort((a, b) => a - b).join('-')

export function attachGtoFlop(node: GtoNode, cards: readonly number[]): GtoNode {
  const game = dealGtoFlop(node.game, cards)
  const blocked = new Set(cards)
  const incomingRanges = { ...node.incomingRanges }
  for (const player of activeGtoPlayers(game)) {
    const range = node.incomingRanges[player.position]
    if (!range) continue
    incomingRanges[player.position] = { ...range, weights: range.weights.map((weight, i) =>
      preflopCombos[i].some(card => blocked.has(card)) ? 0 : weight) }
  }
  return { id: node.id + '/flop-' + gtoBoardKey(cards), parentId: node.id, game, incomingRanges, branches: [],
    strategy: { status: 'missing', reason: 'Flop strategy has yet to be loaded.' } }
}

export type GtoNavigation = { nodes: readonly GtoNode[]; cursor: number }
export const currentGtoNode = (navigation: GtoNavigation) => navigation.nodes[navigation.cursor]

export function jumpGtoNode(navigation: GtoNavigation, cursor: number): GtoNavigation {
  return { ...navigation, cursor: Math.max(0, Math.min(cursor, navigation.nodes.length - 1)) }
}

export function advanceGtoNode(navigation: GtoNavigation, next: GtoNode): GtoNavigation {
  if (next.parentId !== currentGtoNode(navigation).id) throw new Error('This branch belongs to another node.')
  const cursor = navigation.cursor + 1
  if (navigation.nodes[cursor]?.id === next.id) return jumpGtoNode(navigation, cursor)
  return { nodes: [...navigation.nodes.slice(0, cursor), next], cursor }
}
