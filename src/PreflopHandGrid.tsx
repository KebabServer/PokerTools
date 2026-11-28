import { useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { mixBackground, mixForHand, preflopHands, type PreflopAction } from './preflop.ts'
import './preflop.css'

const matrixSize = 13

export function PreflopHandGrid({ actions, hand, onHandChange }: {
  actions: readonly PreflopAction[]
  hand: number
  onHandChange: (hand: number) => void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const hint = useId()

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rowStart = index - index % matrixSize
    const rowEnd = rowStart + matrixSize - 1
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(rowStart, index - 1); break
      case 'ArrowRight': next = Math.min(rowEnd, index + 1); break
      case 'ArrowUp': next = index < matrixSize ? index : index - matrixSize; break
      case 'ArrowDown': next = index + matrixSize < preflopHands.length ? index + matrixSize : index; break
      case 'Home': next = event.ctrlKey ? 0 : rowStart; break
      case 'End': next = event.ctrlKey ? preflopHands.length - 1 : rowEnd; break
      default: return
    }
    event.preventDefault()
    onHandChange(next)
    grid.current?.querySelectorAll('button')[next]?.focus()
  }

  return <>
    <span className="sr-only" id={hint}>Use the arrow keys to select a starting hand.</span>
    <div className="preflop-hand-grid" role="group" ref={grid} aria-label="Starting hands" aria-describedby={hint}>
      {preflopHands.map((name, index) => <button className="preflop-cell" type="button" key={name}
        tabIndex={index === hand ? 0 : -1} aria-pressed={index === hand}
        style={{ backgroundImage: mixBackground(mixForHand(actions, index)) }}
        onClick={() => onHandChange(index)} onKeyDown={event => move(event, index)}>
        {name}
      </button>)}
    </div>
  </>
}
