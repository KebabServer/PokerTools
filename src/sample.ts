import type { Hand } from './replay.ts'

export const sampleHand: Hand = {
  version: 1, smallBlind: 1, bigBlind: 2, ante: 0, button: 6,
  players: [
    { seat: 1, name: 'Mina', stack: 200, cards: 'Kh Qh' },
    { seat: 2, name: 'Nico', stack: 80, cards: '9s 9d' },
    { seat: 3, name: 'Jules', stack: 160, cards: '' },
    { seat: 4, name: 'Sasha', stack: 180, cards: '' },
    { seat: 5, name: 'Remy', stack: 120, cards: '' },
    { seat: 6, name: 'Alex', stack: 175, cards: 'Ah Ad' },
  ],
  board: ['As 9h 4c', '8h', '2d'],
  actions: [
    { street: 0, seat: 3, type: 'fold' },
    { street: 0, seat: 4, type: 'fold' },
    { street: 0, seat: 5, type: 'fold' },
    { street: 0, seat: 6, type: 'raise', amount: 12 },
    { street: 0, seat: 1, type: 'call' },
    { street: 0, seat: 2, type: 'call' },
    { street: 1, seat: 1, type: 'check' },
    { street: 1, seat: 2, type: 'all-in' },
    { street: 1, seat: 6, type: 'raise', amount: 148 },
    { street: 1, seat: 1, type: 'all-in' },
    { street: 1, seat: 6, type: 'all-in' },
  ],
}

export const emptyHand: Hand = {
  version: 1, smallBlind: 1, bigBlind: 2, ante: 0, button: 1,
  players: [
    { seat: 1, name: 'Player 1', stack: 100, cards: '' },
    { seat: 2, name: 'Player 2', stack: 100, cards: '' },
  ],
  board: ['', '', ''],
  actions: [],
}
