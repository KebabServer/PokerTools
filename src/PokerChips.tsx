import type { CSSProperties } from 'react'
import type { ChipPile } from './chipBreakdown.ts'
import { chips } from './replay.ts'

export function describeChips(piles: ChipPile[]) {
  return piles.map(({ count, value }) => count + ' × ' + chips(value)).join(', ')
}

export function ChipPiles({ piles, className = '', label }: { piles: ChipPile[]; className?: string; label?: string }) {
  if (!piles.length) return null
  return <span className={'chip-piles ' + className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={!label || undefined} title={label}>
    {piles.map(({ value, color, count }) => {
      const layers = Math.min(count, 4)
      return <span key={value} className={`chip-stack chip-stack-${color}`} data-value={value} data-count={count}
        aria-hidden="true" style={{ '--chip-layers': layers - 1 } as CSSProperties}>
        {Array.from({ length: layers }, (_, index) =>
          <span key={index} className="chip-disc" style={{ '--chip-index': index } as CSSProperties} />,
        )}
        {color === 'fraction' && <span className="chip-fraction">{chips(value).slice(1)}</span>}
        {count > layers && <span className="chip-count">×{count}</span>}
      </span>
    })}
  </span>
}
