import { deck } from './cards.ts'
import { preflopPositions } from './preflop.ts'

export type GtoPosition = typeof preflopPositions[number]
export const gtoStreets = ['preflop', 'flop', 'turn', 'river'] as const
export type GtoStreet = typeof gtoStreets[number]

export type GtoGameConfig = {
  key: string
  variant: 'nlhe'
  format: '6-max cash'
  unitsPerBb: number
  stack: number
  smallBlind: number
  bigBlind: number
  rake: { percent: number; cap: number } | null
}

export const simpleGtoConfig: GtoGameConfig = {
  key: 'gtow-simple-100bb',
  variant: 'nlhe',
  format: '6-max cash',
  unitsPerBb: 100,
  stack: 10_000,
  smallBlind: 50,
  bigBlind: 100,
  rake: null,
}

export type GtoMove = { kind: 'fold' | 'check' | 'call' | 'all-in' } | { kind: 'raise'; to: number }
export type GtoPlayer = {
  position: GtoPosition
  stack: number
  contributed: number
  folded: boolean
  actedAt: number | null
}

export type GtoHistoryEntry = {
  street: GtoStreet
  actor: GtoPosition
  move: GtoMove
  paid: number
  total: number
  raises: boolean
}

export type GtoGameState = {
  config: GtoGameConfig
  street: GtoStreet
  phase: 'betting' | 'awaiting-flop' | 'postflop' | 'uncontested'
  actor: GtoPosition | null
  players: readonly GtoPlayer[]
  pot: number
  wager: number
  minRaise: number
  history: readonly GtoHistoryEntry[]
  board: readonly number[]
}

const postflopOrder = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'] as const
const bbNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const chips = (n: number) => Number.isSafeInteger(n) && n > 0
const potFor = (players: readonly GtoPlayer[]) => players.reduce((total, p) => total + p.contributed, 0)
export const gtoPlayer = (game: GtoGameState, position: GtoPosition) => game.players[preflopPositions.indexOf(position)]
export const activeGtoPlayers = (game: GtoGameState) => game.players.filter(player => !player.folded)
export const gtoMoveKey = (move: GtoMove) => move.kind === 'raise' ? 'raise-' + move.to : move.kind
export const formatGtoBb = (amount: number, config: GtoGameConfig) =>
  bbNumber.format(amount / config.unitsPerBb) + ' bb'

export function startGtoGame(config = simpleGtoConfig, stacks: Partial<Record<GtoPosition, number>> = {}): GtoGameState {
  if (!chips(config.stack) || !chips(config.unitsPerBb) || !chips(config.smallBlind) || !chips(config.bigBlind) ||
      config.smallBlind >= config.bigBlind || config.bigBlind !== config.unitsPerBb) throw new Error('Invalid game configuration.')
  const players = preflopPositions.map(position => {
    const starting = stacks[position] ?? config.stack
    const blind = position === 'SB' ? config.smallBlind : position === 'BB' ? config.bigBlind : 0
    if (!chips(starting) || starting <= blind) throw new Error('Starting stack must cover the blind.')
    return { position, stack: starting - blind, contributed: blind, folded: false, actedAt: null }
  })
  return { config, street: 'preflop', phase: 'betting', actor: 'UTG', players, pot: potFor(players),
    wager: config.bigBlind, minRaise: config.bigBlind, history: [], board: [] }
}

export function gtoLegalMoves(game: GtoGameState, raiseTotals: readonly number[] = []): GtoMove[] {
  if (game.phase !== 'betting' || !game.actor) return []
  const player = gtoPlayer(game, game.actor)
  const owes = game.wager > player.contributed
  const moves: GtoMove[] = owes ? [{ kind: 'fold' }, { kind: 'call' }] : [{ kind: 'check' }]
  const total = player.contributed + player.stack
  const opponentCanBet = activeGtoPlayers(game).some(other => other !== player && other.stack > 0)
  const raisingOpen = player.actedAt === null || game.wager - player.actedAt >= game.minRaise
  if (!opponentCanBet || !raisingOpen || total <= game.wager) return moves
  for (const to of [...new Set(raiseTotals)].sort((a, b) => a - b)) {
    if (chips(to) && to >= game.wager + game.minRaise && to < total) moves.push({ kind: 'raise', to })
  }
  moves.push({ kind: 'all-in' })
  return moves
}

export function playGtoMove(game: GtoGameState, move: GtoMove): GtoGameState {
  if (!game.actor || !gtoLegalMoves(game, move.kind === 'raise' ? [move.to] : [])
    .some(legal => gtoMoveKey(legal) === gtoMoveKey(move))) throw new Error('This action is unavailable.')
  const actor = game.actor
  const player = gtoPlayer(game, actor)
  const total = move.kind === 'raise' ? move.to
    : move.kind === 'all-in' ? player.contributed + player.stack
    : move.kind === 'call' ? Math.min(game.wager, player.contributed + player.stack)
    : player.contributed
  const paid = total - player.contributed
  const raises = total > game.wager
  const wager = Math.max(game.wager, total)
  const minRaise = Math.max(game.minRaise, total - game.wager)
  let players = game.players.map(seat => seat === player
    ? { ...seat, stack: seat.stack - paid, contributed: total, folded: move.kind === 'fold', actedAt: wager }
    : seat)
  const history = [...game.history, { street: game.street, actor, move, paid, total, raises }]
  const active = players.filter(seat => !seat.folded)
  const canBet = active.filter(seat => seat.stack > 0)
  const needsAction = (seat: GtoPlayer) => !seat.folded && seat.stack > 0 &&
    (seat.contributed < wager || (seat.actedAt === null && canBet.length > 1))
  const index = preflopPositions.indexOf(actor)
  const next = active.length > 1
    ? [...players.slice(index + 1), ...players.slice(0, index + 1)].find(needsAction)
    : undefined
  if (next) return { ...game, actor: next.position, players, pot: potFor(players), wager, minRaise, history }

  // A wager no other player matched returns to the bettor before the pot carries forward.
  const [largest, second] = [...players].sort((a, b) => b.contributed - a.contributed)
  const unmatched = largest.contributed - second.contributed
  if (unmatched > 0) players = players.map(seat => seat === largest
    ? { ...seat, stack: seat.stack + unmatched, contributed: second.contributed } : seat)
  const uncontested = active.length === 1
  return { ...game, actor: null, players, pot: potFor(players), wager: second.contributed,
    minRaise, history, street: uncontested ? 'preflop' : 'flop',
    phase: uncontested ? 'uncontested' : 'awaiting-flop' }
}

export function dealGtoFlop(game: GtoGameState, cards: readonly number[]): GtoGameState {
  if (game.phase !== 'awaiting-flop') throw new Error('Complete preflop before choosing a flop.')
  if (cards.length !== 3 || new Set(cards).size !== 3 || cards.some(card => !deck.includes(card)))
    throw new Error('Choose three different cards.')
  const canBet = activeGtoPlayers(game).filter(seat => seat.stack > 0)
  const first = canBet.length > 1 ? postflopOrder.find(position => canBet.some(seat => seat.position === position)) : null
  return { ...game, phase: 'postflop', actor: first ?? null, board: [...cards] }
}

export function gtoMatchup(game: GtoGameState) {
  const players = postflopOrder.map(position => gtoPlayer(game, position)).filter(player => !player.folded)
  if (game.street !== 'flop' || players.length < 2) return null
  const raises = game.history.filter(entry => entry.raises).length
  const potType = raises === 0 ? 'Limped pot' : raises === 1 ? 'Single-raised pot' : raises + 1 + '-bet pot'
  return { players, potType, headsUp: players.length === 2,
    effectiveStack: Math.min(...players.map(seat => seat.stack)) }
}
