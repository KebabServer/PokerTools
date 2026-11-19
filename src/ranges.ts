import { cardText, deck, ranks, readCards } from './cards.ts'

export type Combo = { cards: [number, number]; mask: bigint }
export const gridRanks = [...ranks].reverse()
export const gridHands = gridRanks.map((row, i) => gridRanks.map((col, j) => i === j ? row + col : i < j ? row + col + 's' : col + row + 'o'))
const cardBits = deck.map(card => 1n << BigInt(card))
export const cardMask = (cards: number[]) => cards.reduce((mask, card) => mask | cardBits[card], 0n)
const combosByClass = new Map<string, Combo[]>()
const allCombos: Combo[] = []

for (const low of deck) {
  for (let high = low + 1; high < 52; high++) {
    const combo: Combo = { cards: [low, high], mask: cardBits[low] | cardBits[high] }
    allCombos.push(combo)
    const [highRank, highSuit] = cardText(high)
    const [lowRank, lowSuit] = cardText(low)
    const name = highRank + lowRank + (highRank === lowRank ? '' : highSuit === lowSuit ? 's' : 'o')
    const set = combosByClass.get(name) ?? []
    set.push(combo)
    combosByClass.set(name, set)
  }
}

type Class = { high: number; low: number; kind: string }
const className = ({ high, low, kind }: Class) => ranks[high] + ranks[low] + kind

function readClass(text: string): Class {
  const match = /^([2-9TJQKA])([2-9TJQKA])([SO]?)$/.exec(text)
  if (!match) throw new Error('Invalid range token: ' + text + '.')
  const high = ranks.indexOf(match[1]), low = ranks.indexOf(match[2]), kind = match[3].toLowerCase()
  if (high < low || (high === low && kind)) throw new Error('Invalid starting hand: ' + text + '. Use the higher rank first.')
  return { high, low, kind }
}

function expandClass(token: string) {
  if (token.endsWith('+')) {
    const from = readClass(token.slice(0, -1))
    if (from.high === from.low) return Array.from({ length: 13 - from.high }, (_, index) => ({ ...from, high: from.high + index, low: from.low + index }))
    return Array.from({ length: from.high - from.low }, (_, index) => ({ ...from, low: from.low + index }))
  }
  if (!token.includes('-')) return [readClass(token)]
  const ends = token.split('-')
  if (ends.length !== 2) throw new Error('Invalid range: ' + token + '.')
  const from = readClass(ends[0]), to = readClass(ends[1])
  const highDiff = to.high - from.high, lowDiff = to.low - from.low
  if (from.kind !== to.kind || (highDiff !== 0 && highDiff !== lowDiff)) {
    throw new Error('Range endpoints must keep the same high card or move both ranks by the same amount: ' + token + '.')
  }
  return Array.from({ length: Math.abs(lowDiff) + 1 }, (_, index) => ({
    high: from.high + index * Math.sign(highDiff),
    low: from.low + index * Math.sign(lowDiff),
    kind: from.kind,
  }))
}

export function parseRange(text: string) {
  const tokens = text.trim().toUpperCase().replace(/10/g, 'T').replace(/[–—]/g, '-').replace(/\s*-\s*/g, '-').split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) throw new Error('Enter an exact hand or a range.')
  const byMask = new Map<bigint, Combo>()
  const classes = new Set<string>()
  const exact: number[] = []
  const specific: string[] = []
  function add(combo: Combo) { byMask.set(combo.mask, combo) }

  for (const token of tokens) {
    if (token === 'RANDOM') {
      allCombos.forEach(add)
      gridHands.flat().forEach(name => classes.add(name))
      continue
    }
    if (/^(?:[2-9TJQKA][CDHS]){2}$/.test(token)) {
      const [a, b] = readCards(token)
      if (a === b) throw new Error('Duplicate card: ' + cardText(a) + '.')
      add({ cards: [a, b], mask: cardMask([a, b]) })
      exact.push(a, b)
      specific.push(cardText(a) + cardText(b))
      continue
    }
    for (const hand of expandClass(token)) {
      const name = className(hand)
      const names = hand.high === hand.low || hand.kind ? [name] : [name + 's', name + 'o']
      for (const kind of names) {
        classes.add(kind)
        combosByClass.get(kind)!.forEach(add)
      }
    }
  }
  return { combos: [...byMask.values()], classes, specific, exact: tokens.length === 1 ? exact : [] }
}

export function normalizeExactField(text: string) {
  const compact = text.trim().toUpperCase().replace(/10/g, 'T').replace(/\s+/g, '')
  return !text.includes(',') && /^(?:[2-9TJQKA][CDHS]){2}$/.test(compact) ? compact : text
}
