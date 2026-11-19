import { cardText } from './cards.ts'

const symbols: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }
const suitNames: Record<string, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }
const rankNames: Record<string, string> = { T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' }

export function PlayingCard({ card, back = false }: { card?: number; back?: boolean }) {
  if (card === undefined) return <span className={'playing-card ' + (back ? 'card-back' : 'card-empty')} aria-label={back ? 'Unknown card' : 'Empty board slot'}>{back && '♠'}</span>
  const [rank, suit] = cardText(card)
  return <span className={'playing-card card-face suit-' + suit} role="img" aria-label={(rankNames[rank] ?? rank) + ' of ' + suitNames[suit]}>
    <b className="card-rank" aria-hidden="true">{rank}</b>
    <span className="card-watermark" aria-hidden="true">{symbols[suit]}{'\uFE0E'}</span>
  </span>
}
