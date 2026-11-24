// Replayer amounts are integer hundredths of a chip.
const denominations = [
  { value: 100_000, color: 'orange' },
  { value: 50_000, color: 'purple' },
  { value: 10_000, color: 'black' },
  { value: 2_500, color: 'green' },
  { value: 500, color: 'red' },
  { value: 100, color: 'white' },
] as const

type ChipColor = (typeof denominations)[number]['color'] | 'fraction'
export type ChipPile = { value: number; color: ChipColor; count: number }

export function chipBreakdown(amount: number): ChipPile[] {
  const piles: ChipPile[] = []
  let remainder = amount
  for (const denomination of denominations) {
    const count = Math.floor(remainder / denomination.value)
    if (count <= 0) continue
    piles.push({ ...denomination, count })
    remainder -= count * denomination.value
  }
  if (remainder > 0) piles.push({ value: remainder, color: 'fraction', count: 1 })
  return piles
}
