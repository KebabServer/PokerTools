import { cardText } from './cards.ts'

const symbols: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }
const suitNames: Record<string, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }

export function PlayingCard({ card, back = false }: { card?: number; back?: boolean }) {
  if (card === undefined) return <span className={'playing-card ' + (back ? 'card-back' : 'card-empty')} aria-label={back ? 'Unknown card' : 'Empty board slot'}>{back && '♠'}</span>
  const [rank, suit] = cardText(card)
  return <span className={'playing-card card-face suit-' + suit} aria-label={rank + ' of ' + suitNames[suit]}><b>{rank === 'T' ? '10' : rank}</b><span aria-hidden="true">{symbols[suit]}</span></span>
}
