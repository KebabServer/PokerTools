import { assertDistinct, deck, evaluate, readCards } from './cards.ts'
import { cardMask, normalizeExactField, parseRange, type Combo } from './ranges.ts'

export type EquityInput = { players: string[]; board: string; dead: string; samples?: number }
export type EquityResult = {
  mode: 'exact' | 'estimated'
  count: number
  players: { equity: number; win: number; tie: number }[]
}

export function equityInputs(input: EquityInput) {
  if (input.players.length < 2 || input.players.length > 10) throw new Error('Enter 2–10 players.')
  const board = readCards(input.board)
  const dead = readCards(input.dead)
  if (![0, 3, 4, 5].includes(board.length)) throw new Error('Enter 0, 3, 4 or 5 board cards.')
  const ranges = input.players.map((range, index) => {
    try { return parseRange(normalizeExactField(range)) }
    catch (error) { throw new Error('Player ' + (index + 1) + ': ' + (error as Error).message) }
  })
  const fixed = [...board, ...dead]
  assertDistinct([...fixed, ...ranges.flatMap(range => range.exact)])
  if (52 - dead.length - input.players.length * 2 < 5) throw new Error('No legal matchup remains. There are too few cards for the board and players.')
  const available = deck.filter(card => !fixed.includes(card))
  const fixedMask = cardMask(fixed)
  let options = ranges.map((range, index) => ({ index, combos: range.combos.filter(combo => !(combo.mask & fixedMask)) }))
  // Forced hands can remove blockers from other ranges as early as parsing.
  while (true) {
    const previous = options
    const forced = options.filter(option => option.combos.length === 1)
    options = options.map(option => {
      const blocked = forced.filter(other => other !== option).reduce((mask, other) => mask | other.combos[0].mask, 0n)
      return { ...option, combos: option.combos.filter(combo => !(combo.mask & blocked)) }
    })
    const empty = options.find(option => !option.combos.length)
    if (empty) throw new Error('No legal matchup remains. Player ' + (empty.index + 1) + ' has no combinations after blockers.')
    if (previous.every((option, index) => option.combos.length === options[index].combos.length)) break
  }
  options.sort((a, b) => a.combos.length - b.combos.length)
  return { board, available, options }
}

function choose(total: number, take: number) {
  let value = 1
  for (let i = 1; i <= take; i++) value = value * (total - i + 1) / i
  return Math.round(value)
}

export function calculateEquity(input: EquityInput, report: (progress: number) => void = () => {}) : EquityResult {
  const { board, available, options } = equityInputs(input)
  const missing = 5 - board.length
  const playerCount = options.length
  const outcomesPerMatch = choose(available.length - playerCount * 2, missing)
  const exactLimit = Math.floor(350_000 / playerCount / outcomesPerMatch)
  const matchLimit = Math.max(1024, exactLimit)
  const matches: { hands: Combo[]; mask: bigint }[] = []
  const hands: Combo[] = []
  let truncated = false

  function findMatches(position: number, mask: bigint) {
    if (position === playerCount) {
      if (matches.length === matchLimit) {
        truncated = true
        return
      }
      matches.push({ hands: [...hands], mask })
      return
    }
    for (const combo of options[position].combos) {
      if (combo.mask & mask) continue
      const used = mask | combo.mask
      if (options.slice(position + 1).some(option => !option.combos.some(other => !(other.mask & used)))) continue
      hands[position] = combo
      findMatches(position + 1, used)
      if (truncated) return
    }
  }
  findMatches(0, 0n)
  if (!matches.length) throw new Error('No legal matchup remains. These ranges cannot all hold different cards.')

  const results = options.map(() => ({ equity: 0, win: 0, tie: 0 }))
  const scores = Array<number>(playerCount)
  let count = 0
  function record(match: Combo[], runout: number[]) {
    let best = -1
    let winners = 0
    for (let i = 0; i < playerCount; i++) {
      const rank = evaluate([...match[i].cards, ...runout])
      scores[i] = rank
      if (rank > best) { best = rank; winners = 1 }
      else if (rank === best) winners++
    }
    for (let i = 0; i < playerCount; i++) {
      if (scores[i] !== best) continue
      const result = results[options[i].index]
      result.equity += 1 / winners
      if (winners === 1) result.win++
      else result.tie++
    }
    count++
  }

  const exact = !truncated && matches.length <= exactLimit
  if (exact) {
    const runout = [...board]
    function completeBoard(match: Combo[], cards: number[], start: number) {
      if (runout.length === 5) {
        record(match, runout)
        return
      }
      for (let i = start; i <= cards.length - (5 - runout.length); i++) {
        runout.push(cards[i])
        completeBoard(match, cards, i + 1)
        runout.pop()
      }
    }
    for (const match of matches) completeBoard(match.hands, available.filter(card => !(cardMask([card]) & match.mask)), 0)
  } else {
    const requested = Math.max(1, Math.min(250_000, Math.trunc(input.samples ?? 75000)))
    const randomIndex = (length: number) => Math.floor(Math.random() * length)
    // Uniform independent draws, conditioned on no collisions, weight every legal joint combo equally.
    function drawMatch() {
      let mask = 0n
      for (let i = 0; i < playerCount; i++) {
        const { combos } = options[i]
        const combo = combos[randomIndex(combos.length)]
        if (combo.mask & mask) return undefined
        hands[i] = combo
        mask |= combo.mask
      }
      return { hands, mask }
    }
    const runout = [...board]
    const maxAttempts = truncated ? Math.max(1_000_000, requested * 20) : requested
    for (let attempt = 0; count < requested && attempt < maxAttempts; attempt++) {
      const match = truncated ? drawMatch() : matches[randomIndex(matches.length)]
      if (!match) continue
      runout.length = board.length
      let used = match.mask
      while (runout.length < 5) {
        const card = available[randomIndex(available.length)]
        const bit = cardMask([card])
        if (used & bit) continue
        used |= bit
        runout.push(card)
      }
      record(match.hands, runout)
      if (count % 2500 === 0) report(count / requested)
    }
    if (!count) throw new Error('These overlapping ranges yielded no samples. Narrow the ranges or specify more exact hands.')
  }
  return {
    mode: exact ? 'exact' : 'estimated', count,
    players: results.map(({ equity, win, tie }) => ({ equity: equity / count, win: win / count, tie: tie / count })),
  }
}
