import { deck, evaluate, handCategory, readCards } from './cards.ts'
import { gridHands, startingHandName } from './ranges.ts'

export type FlopAction = { label: string; color?: string }
export type FlopCombo = { hand: string; weight: number; frequencies: number[]; evs?: (number | null)[] }
export type FlopNode = { name: string; actions: FlopAction[]; combos: FlopCombo[] }
export type FlopSpot = { configuration: string; board: string; nodes: FlopNode[] }

export const flopHands = gridHands.flat()
export const unlistedAction = { label: 'Unlisted', color: '#464646' }

const palette = ['#82532c', '#7151a2', '#4f697f', '#963f6e', '#477384']

export function flopActionColor({ label, color }: FlopAction, index: number) {
  if (color && (typeof CSS === 'undefined' || CSS.supports('color', color))) return color
  if (/^(check|call)$/i.test(label)) return '#24714f'
  if (/^fold$/i.test(label)) return '#315c8a'
  if (/^(raise|r\d)/i.test(label)) return '#a83a91'
  if (/^b\d/i.test(label)) {
    const size = Number.parseFloat(label.slice(1))
    return size <= 40 ? '#a65a22' : size <= 100 ? '#aa3746' : '#7544a3'
  }
  return palette[index % palette.length]
}

const madeHandLabels = [
  'Straight flush', 'Quads', 'Full house', 'Flush', 'Straight', 'Set', 'Trips', 'Two pair',
  'Overpair', 'Top pair', 'Middle pair', 'Bottom pair', 'Underpair', 'Board pair', 'Ace high', 'King high', 'No made hand',
]
const drawLabels = [
  'Combo draw', 'Nut flush draw', 'Pair and flush draw', 'Flush draw', 'Open-ended straight draw',
  'Double gutshot', 'Gutshot', 'Nut backdoor flush draw (2 cards)', 'Backdoor flush draw (2 cards)',
  'Nut backdoor flush draw (1 card)', 'Backdoor flush draw (1 card)', 'No draw',
]
const straightWindows = [[12, 0, 1, 2, 3], ...Array.from({ length: 9 }, (_, start) =>
  Array.from({ length: 5 }, (_, offset) => start + offset),
)]

export function flopHandClasses(board: number[], hole: number[]) {
  const cards = [...board, ...hole]
  const category = handCategory(evaluate(cards))
  const boardRanks = [...new Set(board.map(card => card >> 2))].sort((a, b) => b - a)
  const [first, second] = hole.map(card => card >> 2)
  const pocket = first === second
  const match = boardRanks.findIndex(rank => first === rank || second === rank)
  const fixedCategory = ['', '', 'Two pair', '', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'][category]
  let made = fixedCategory
  if (category === 3) made = pocket ? 'Set' : 'Trips'
  if (category === 1) {
    made = pocket ? (first > boardRanks[0] ? 'Overpair' : 'Underpair')
      : ['Top pair', 'Middle pair', 'Bottom pair'][match] ?? 'Board pair'
  }
  if (category === 0) {
    const high = Math.max(first, second)
    made = high === 12 ? 'Ace high' : high === 11 ? 'King high' : 'No made hand'
  }

  const ranks = new Set(cards.map(card => card >> 2))
  const suitCounts = [0, 0, 0, 0]
  for (const card of cards) suitCounts[card & 3]++

  const straightOuts = new Set<number>()
  if (category < 4) {
    for (const window of straightWindows) {
      const missing = window.filter(rank => !ranks.has(rank))
      if (missing.length === 1) straightOuts.add(missing[0])
    }
  }
  const flushSuit = suitCounts.indexOf(4)
  if (flushSuit >= 0) {
    if (straightOuts.size) return { made, draw: 'Combo draw' }
    if (hasNutSuit(board, hole, flushSuit)) return { made, draw: 'Nut flush draw' }
    return { made, draw: category === 1 && made !== 'Board pair' ? 'Pair and flush draw' : 'Flush draw' }
  }
  if (straightOuts.size > 1) {
    const hasFourInARow = Array.from({ length: 9 }, (_, start) => start)
      .some(start => [0, 1, 2, 3].every(offset => ranks.has(start + offset)))
    return { made, draw: hasFourInARow ? 'Open-ended straight draw' : 'Double gutshot' }
  }
  if (straightOuts.size) return { made, draw: 'Gutshot' }
  const backdoorSuit = suitCounts.indexOf(3)
  const holeCount = hole.filter(card => (card & 3) === backdoorSuit).length
  if (holeCount) {
    const name = hasNutSuit(board, hole, backdoorSuit) ? 'Nut backdoor flush draw' : 'Backdoor flush draw'
    return { made, draw: name + (holeCount === 2 ? ' (2 cards)' : ' (1 card)') }
  }
  return { made, draw: 'No draw' }
}

function hasNutSuit(board: number[], hole: number[], suit: number) {
  let card = 48 + suit
  while (board.includes(card)) card -= 4
  return hole.includes(card)
}

type Totals = { weight: number; shares: number[] }
type ClassTotals = Totals & { legal: number; combos: FlopCombo[] }

export function summarizeFlopNode(board: number[], node: FlopNode) {
  // The last share holds reach weight for which the export lists no action.
  const totals = (): Totals => ({ weight: 0, shares: Array<number>(node.actions.length + 1).fill(0) })
  const whole = totals()
  const hands = new Map<string, ClassTotals>(flopHands.map(hand => [hand, { ...totals(), legal: 0, combos: [] }]))
  const made = new Map(madeHandLabels.map(label => [label, totals()]))
  const draws = new Map(drawLabels.map(label => [label, totals()]))
  const available = deck.filter(card => !board.includes(card))
  for (const [index, high] of available.entries()) {
    for (let low = 0; low < index; low++) hands.get(startingHandName(high, available[low]))!.legal++
  }
  for (const combo of node.combos) {
    const hole = readCards(combo.hand)
    if (!combo.weight || hole.some(card => board.includes(card))) continue
    const hand = hands.get(startingHandName(hole[0], hole[1]))!
    const classes = flopHandClasses(board, hole)
    const sum = combo.frequencies.reduce((total, frequency) => total + frequency, 0)
    const shares = combo.frequencies.map(frequency => combo.weight * frequency / Math.max(100, sum))
    shares.push(combo.weight * Math.max(0, 1 - sum / 100))
    for (const entry of [whole, hand, made.get(classes.made)!, draws.get(classes.draw)!]) {
      entry.weight += combo.weight
      shares.forEach((share, index) => { entry.shares[index] += share })
    }
    hand.combos.push(combo)
  }
  return { whole, hands, made, draws }
}

export function flopMixBackground(shares: number[], denominator: number, colors: string[]) {
  if (!denominator) return undefined
  const stops: string[] = []
  let start = 0
  shares.forEach((share, index) => {
    if (share <= 1e-8) return
    const end = Math.min(100, start + 100 * share / denominator)
    stops.push(`${colors[index]} ${start}% ${end}%`)
    start = end
  })
  if (!stops.length) return undefined
  stops.push(`var(--flop-unreached) ${start}% 100%`)
  return 'linear-gradient(90deg, ' + stops.join(', ') + ')'
}
