import type { CSSProperties } from 'react'

export function chipLayers(amount: number, bigBlind: number) {
  return Math.min(7, 1 + Math.ceil(Math.log2(Math.max(1, amount / bigBlind))))
}

export function ChipStack({ count, color }: { count: number; color: 'red' | 'ivory' | 'black' }) {
  return <span className={`chip-stack chip-stack-${color}`} aria-hidden="true" style={{ '--chip-layers': count - 1 } as CSSProperties}>
    {Array.from({ length: count }, (_, index) =>
      <span key={index} className="chip-disc" style={{ '--chip-index': index } as CSSProperties} />,
    )}
  </span>
}

export function PotChips({ amount, bigBlind }: { amount: number; bigBlind: number }) {
  if (amount <= 0) return null
  const count = chipLayers(amount, bigBlind)
  return <span className="pot-chips" aria-hidden="true">
    {count > 2 && <ChipStack count={count - 2} color="black" />}
    <ChipStack count={count} color="red" />
    {count > 4 && <ChipStack count={count - 4} color="ivory" />}
  </span>
}
