import { assertDistinct, evaluate, readCards } from './cards.ts'

export const streets = ['Preflop', 'Flop', 'Turn', 'River'] as const
export const actionTypes = ['fold', 'check', 'call', 'bet', 'raise', 'all-in'] as const
export type ActionType = typeof actionTypes[number]
export type Player = { seat: number; name: string; stack: number; cards: string }
export type Action = { street: number; seat: number; type: ActionType; amount?: number }
export type Hand = {
  version: 1
  players: Player[]
  button: number
  smallBlind: number
  bigBlind: number
  ante: number
  board: [string, string, string]
  actions: Action[]
}

type Seat = Player & { remaining: number; committed: number; invested: number; folded: boolean; hole: number[]; actedAt: number | null }
type Pot = { amount: number; eligible: number[] }
export type Frame = {
  street: number
  board: number[]
  seats: Seat[]
  pot: number
  pots: Pot[]
  label: string
  active?: number
  awards?: { seat: number; amount: number }[]
}
export type Replay = {
  frames: Frame[]
  error?: string
  complete: boolean
  next?: { street: number; seat: number }
  missingBoard?: number
}

export const chips = (cents: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(cents / 100)

export function openingReplayStep(frames: Frame[]) {
  // Forced blinds and antes are already included in the first frame.
  const firstVpip = frames.findIndex((frame, index) =>
    index > 0 && frame.street === 0 && frame.pot > frames[index - 1].pot,
  )
  return Math.max(0, firstVpip - 1)
}

function money(value: number) {
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 1e12 || Math.abs(value * 100 - cents) > 0.0001) {
    throw new Error('Chip amounts must be nonnegative, with at most two decimal places.')
  }
  return cents
}

function clockwise(seats: Seat[], after: number) {
  return [...seats.filter(player => player.seat > after), ...seats.filter(player => player.seat <= after)]
}

function potLayers(seats: Seat[]): Pot[] {
  let last = 0
  return [...new Set(seats.map(seat => seat.invested))].filter(Boolean).sort((a, b) => a - b).map(level => {
    const contributors = seats.filter(seat => seat.invested >= level)
    const layer = { amount: (level - last) * contributors.length, eligible: contributors.filter(seat => !seat.folded).map(seat => seat.seat) }
    last = level
    return layer
  }).reduce<Pot[]>((pots, layer) => {
    const previous = pots.at(-1)
    if (!layer.eligible.length && previous) previous.amount += layer.amount
    else if (previous && String(previous.eligible) === String(layer.eligible)) previous.amount += layer.amount
    else pots.push(layer)
    return pots
  }, [])
}

export function replay(hand: Hand): Replay {
  const frames: Frame[] = []
  try {
    if (hand.version !== 1) throw new Error('This hand format is unsupported.')
    if (hand.players.length < 2 || hand.players.length > 10) throw new Error('Seat 2–10 players.')
    const seats: Seat[] = [...hand.players].sort((a, b) => a.seat - b.seat).map(player => {
      if (!Number.isInteger(player.seat) || player.seat < 1 || player.seat > 10) throw new Error('Use seat numbers 1–10.')
      if (!player.name.trim()) throw new Error('Enter a name for seat ' + player.seat + '.')
      const remaining = money(player.stack)
      if (!remaining) throw new Error(player.name + ' needs a starting stack above zero.')
      const hole = readCards(player.cards)
      if (hole.length > 2) throw new Error(player.name + ' can have at most two known cards.')
      return { ...player, remaining, committed: 0, invested: 0, folded: false, hole, actedAt: null }
    })
    if (new Set(seats.map(seat => seat.seat)).size !== seats.length) throw new Error('Seat numbers must be unique.')
    if (!seats.some(seat => seat.seat === hand.button)) throw new Error('Select a seated dealer.')
    const sb = money(hand.smallBlind), bb = money(hand.bigBlind), ante = money(hand.ante)
    if (!sb || sb > bb) throw new Error('Enter positive blinds with the big blind at least as large as the small blind.')
    const boardParts = hand.board.map(readCards)
    if (boardParts.some((part, index) => part.length && part.length !== (index === 0 ? 3 : 1))) {
      throw new Error('Enter three flop cards and one card each for the turn and river.')
    }
    if (boardParts.some((part, index) => part.length && index && !boardParts[index - 1].length)) {
      throw new Error('Enter board cards in street order.')
    }
    assertDistinct([...seats.flatMap(seat => seat.hole), ...boardParts.flat()])

    let street = 0
    let board: number[] = []
    let target = bb
    let minRaise = bb
    const blindOrder = clockwise(seats, hand.button)
    const small = seats.length === 2 ? blindOrder[1] : blindOrder[0]
    const big = seats.length === 2 ? blindOrder[0] : blindOrder[1]
    let cursor = big.seat
    const live = () => seats.filter(seat => !seat.folded)
    const acting = () => live().filter(seat => seat.remaining > 0)

    function nextSeat() {
      if (live().length <= 1) return undefined
      const able = acting()
      if (able.length === 1) {
        const opponentBet = Math.max(0, ...live().filter(seat => seat !== able[0]).map(seat => seat.committed))
        return able[0].committed < opponentBet ? able[0] : undefined
      }
      return clockwise(seats, cursor).find(seat => able.includes(seat) && (seat.actedAt === null || seat.committed < target))
    }

    function snapshot(label: string, awards?: Frame['awards']) {
      const pots = potLayers(seats)
      frames.push({
        street, board: [...board], seats: seats.map(seat => ({ ...seat })),
        pot: pots.reduce((sum, pot) => sum + pot.amount, 0), pots,
        label, active: awards ? undefined : nextSeat()?.seat, awards,
      })
    }

    function contribute(seat: Seat, amount: number, isAnte = false) {
      seat.invested += amount
      if (!isAnte) seat.committed += amount
      seat.remaining -= amount
    }

    if (ante) for (const seat of seats) contribute(seat, Math.min(seat.remaining, ante), true)
    contribute(small, Math.min(sb, small.remaining))
    contribute(big, Math.min(bb, big.remaining))
    snapshot('Blinds posted' + (ante ? ' with antes' : ''))

    function returnUncalled() {
      const [first, second] = [...seats].sort((a, b) => b.committed - a.committed)
      const excess = first.committed - second.committed
      if (!excess) return
      first.committed -= excess
      first.invested -= excess
      first.remaining += excess
      snapshot(first.name + ' receives ' + chips(excess) + ' uncalled')
    }

    function apply(action: Action, seat: Seat) {
      if (action.street !== street) throw new Error(streets[street] + ' action is still required from ' + seat.name + '.')
      if (action.seat !== seat.seat) throw new Error(seat.name + ' acts next on the ' + streets[street].toLowerCase() + '.')
      if (!actionTypes.includes(action.type)) throw new Error('Choose a supported action.')
      const otherCanBet = acting().length > 1
      const callTarget = otherCanBet ? target : Math.max(0, ...live().filter(player => player !== seat).map(player => player.committed))
      const owed = Math.max(0, callTarget - seat.committed)
      let paid = 0
      if (action.type === 'fold') seat.folded = true
      if (action.type === 'check' && owed) throw new Error(seat.name + ' is facing a bet and cannot check.')
      if (action.type === 'call') {
        if (!owed) throw new Error('There is no bet to call.')
        paid = Math.min(owed, seat.remaining)
      }
      if (action.type === 'bet' || action.type === 'raise' || action.type === 'all-in') {
        if (action.type === 'bet' && target) throw new Error('Use a raise-to total when there is already a bet.')
        if (action.type === 'raise' && !target) throw new Error('Open with a bet.')
        paid = action.type === 'all-in' ? seat.remaining : money(action.amount ?? 0) - seat.committed
        if (paid > seat.remaining) throw new Error('That amount exceeds ' + seat.name + '’s stack.')
        const total = seat.committed + paid
        if (total > callTarget) {
          if (!otherCanBet) throw new Error('No other player has chips to call a raise.')
          if (seat.actedAt !== null && target - seat.actedAt < minRaise) throw new Error('The short all-in did not reopen raising for ' + seat.name + '.')
          const increment = total - target
          const full = increment >= minRaise
          if (!full && paid < seat.remaining) throw new Error('Minimum ' + (target ? 'raise-to total is ' : 'bet is ') + chips(target + minRaise) + '.')
          if (full) minRaise = increment
          target = total
        } else if (action.type !== 'all-in') {
          throw new Error('The ' + action.type + ' must increase the current bet.')
        }
      }
      contribute(seat, paid)
      seat.actedAt = target
      cursor = seat.seat
      const descriptions: Record<ActionType, string> = {
        fold: 'folds', check: 'checks', call: 'calls ' + chips(paid), bet: 'bets ' + chips(paid),
        raise: 'raises to ' + chips(seat.committed), 'all-in': 'goes all-in for ' + chips(seat.committed),
      }
      snapshot(seat.name + ' ' + descriptions[action.type] + (action.type === 'call' && !seat.remaining ? ' (all-in)' : ''))
    }

    let index = 0
    while (true) {
      const next = nextSeat()
      const action = hand.actions[index]
      if (next) {
        if (!action) return { frames, complete: false, next: { street, seat: next.seat } }
        try {
          apply(action, next)
        } catch (error) {
          return { frames, complete: false, error: 'Action ' + (index + 1) + ' · ' + (error as Error).message }
        }
        index++
        continue
      }
      returnUncalled()
      if (live().length === 1 || street === 3) {
        if (action) throw new Error('Action ' + (index + 1) + ' occurs after the hand ends.')
        const winners = live()
        const pots = potLayers(seats)
        const scores = new Map(winners.filter(seat => seat.hole.length === 2 && board.length === 5).map(seat => [seat.seat, evaluate([...board, ...seat.hole])]))
        const payouts = new Map<number, number>()
        for (const pot of pots) {
          const eligible = pot.eligible.length ? pot.eligible : winners.map(seat => seat.seat)
          if (eligible.length > 1 && eligible.some(seat => !scores.has(seat))) continue
          const best = Math.max(...eligible.map(seat => scores.get(seat) ?? 0))
          const shared = clockwise(seats, hand.button).filter(seat => eligible.includes(seat.seat) && (scores.get(seat.seat) ?? 0) === best)
          shared.forEach((seat, position) => {
            const payment = Math.floor(pot.amount / shared.length) + Number(position < pot.amount % shared.length)
            payouts.set(seat.seat, (payouts.get(seat.seat) ?? 0) + payment)
          })
        }
        const awards = [...payouts].map(([seat, amount]) => ({ seat, amount }))
        const resolved = awards.reduce((sum, award) => sum + award.amount, 0) === pots.reduce((sum, pot) => sum + pot.amount, 0)
        const label = winners.length === 1 ? winners[0].name + ' wins by folds' : resolved ? 'Showdown · pots awarded' : 'Showdown · unknown cards'
        // Keep pot amounts as the final hand summary while crediting determined winnings.
        for (const seat of seats) seat.remaining += payouts.get(seat.seat) ?? 0
        snapshot(label, awards)
        return { frames, complete: true }
      }
      if (!boardParts[street].length) {
        if (action) throw new Error('Enter the ' + streets[street + 1].toLowerCase() + ' cards before recording its actions.')
        return { frames, complete: false, missingBoard: street + 1 }
      }
      board = [...board, ...boardParts[street]]
      street++
      target = 0
      minRaise = bb
      cursor = hand.button
      seats.forEach(seat => { seat.committed = 0; seat.actedAt = null })
      snapshot(streets[street] + ' dealt')
    }
  } catch (error) {
    return { frames, complete: false, error: (error as Error).message }
  }
}
