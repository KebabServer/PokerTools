export const ranks = '23456789TJQKA'
export const suits = 'cdhs'
export const deck = Array.from({ length: 52 }, (_, card) => card)

export function cardText(card: number) {
  return ranks[Math.floor(card / 4)] + suits[card % 4]
}

export function readCards(input: string): number[] {
  const compact = input.toUpperCase().replace(/10/g, 'T').replace(/[\s,]+/g, '')
  if (!/^(?:[2-9TJQKA][CDHS])*$/.test(compact)) throw new Error('Use card codes such as As, Td or 7c.')
  return (compact.match(/../g) ?? []).map(code => ranks.indexOf(code[0]) * 4 + suits.indexOf(code[1].toLowerCase()))
}

export function assertDistinct(cards: number[]) {
  if (new Set(cards).size === cards.length) return
  const duplicate = cards.find((card, index) => cards.indexOf(card) !== index)!
  throw new Error('Duplicate card: ' + cardText(duplicate) + '.')
}

function straightHigh(mask: number) {
  for (let high = 12; high >= 4; high--) {
    if ((mask & (31 << (high - 4))) === (31 << (high - 4))) return high
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1
}

function topRanks(mask: number, count: number) {
  const top: number[] = []
  for (let rank = 12; rank >= 0 && top.length < count; rank--) {
    if (mask & (1 << rank)) top.push(rank)
  }
  return top
}

function score(category: number, ...kickers: number[]) {
  let value = category
  for (let index = 0; index < 5; index++) value = value * 13 + (kickers[index] ?? 0)
  return value
}

// Evaluate the best five-card hand from a complete Hold'em board and two hole cards.
export function evaluate(cards: number[]) {
  const counts = Array<number>(13).fill(0)
  const masks = [0, 0, 0, 0]
  const suited = [0, 0, 0, 0]
  let all = 0
  for (const card of cards) {
    const rank = card >> 2
    const suit = card & 3
    counts[rank]++
    suited[suit]++
    masks[suit] |= 1 << rank
    all |= 1 << rank
  }
  const flush = suited.findIndex(count => count >= 5)
  if (flush >= 0) {
    const high = straightHigh(masks[flush])
    if (high >= 0) return score(8, high)
  }
  const groups = [[], [], [], [], []] as number[][]
  for (let rank = 12; rank >= 0; rank--) groups[counts[rank]].push(rank)
  const [, singles, pairs, trips, quads] = groups
  if (quads.length) return score(7, quads[0], ...topRanks(all & ~(1 << quads[0]), 1))
  if (trips.length && (trips.length > 1 || pairs.length)) return score(6, trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1))
  if (flush >= 0) return score(5, ...topRanks(masks[flush], 5))
  const high = straightHigh(all)
  if (high >= 0) return score(4, high)
  if (trips.length) return score(3, trips[0], ...topRanks(all & ~(1 << trips[0]), 2))
  if (pairs.length >= 2) return score(2, pairs[0], pairs[1], ...topRanks(all & ~((1 << pairs[0]) | (1 << pairs[1])), 1))
  if (pairs.length) return score(1, pairs[0], ...singles.slice(0, 3))
  return score(0, ...singles.slice(0, 5))
}
