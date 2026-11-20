import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openingReplayStep, potTotal, replay } from '../src/replay.ts'
import { emptyHand, sampleHand } from '../src/sample.ts'

test('postflop sizing uses the pot before a bet and the pot after the call for a raise', () => {
  const start = {
    ...emptyHand,
    board: ['As 9h 4c', '8h', ''],
    actions: [{ street: 0, seat: 1, type: 'raise', amount: 18 }, { street: 0, seat: 2, type: 'call' }],
  }
  const bet = replay({ ...start, actions: [...start.actions, { street: 1, seat: 2, type: 'bet', amount: 72 }] })
  assert.equal(bet.frames[1].seats[0].wager, undefined)
  assert.deepEqual(bet.frames.at(-1).seats[1].wager, { kind: 'bet', percent: 200 })
  for (const amount of [14.4, 14.41, 36, 36.01]) {
    const sized = replay({ ...start, actions: [...start.actions, { street: 1, seat: 2, type: 'bet', amount }] })
    assert.equal(sized.frames.at(-1).seats[1].wager.percent, Math.round(amount * 100) / 36)
  }
  const raised = replay({ ...start, actions: [
    ...start.actions,
    { street: 1, seat: 2, type: 'bet', amount: 12 },
    { street: 1, seat: 1, type: 'raise', amount: 42 },
    { street: 1, seat: 2, type: 'call' },
  ] })
  assert.deepEqual(raised.frames.at(-3).seats[0].wager, { kind: 'raise', percent: 50 })
  assert.deepEqual(raised.frames.at(-2).seats[1].wager, { kind: 'call' })
  assert.ok(raised.frames.at(-1).seats.every(seat => !seat.wager))
  const allInCall = replay(sampleHand).frames.find(frame => frame.label === 'Alex goes all-in for 163')
  assert.deepEqual(allInCall.seats.find(seat => seat.name === 'Alex').wager, { kind: 'call' })
})

test('the displayed pot stays at 40 while a 30-chip flop bet and call sit at the seats', () => {
  const { frames } = replay({
    ...emptyHand,
    board: ['As 9h 4c', '8h', ''],
    actions: [
      { street: 0, seat: 1, type: 'raise', amount: 20 },
      { street: 0, seat: 2, type: 'call' },
      { street: 1, seat: 2, type: 'bet', amount: 30 },
      { street: 1, seat: 1, type: 'call' },
    ],
  })
  assert.deepEqual(frames.slice(-4).map(frame => [potTotal(frame.collectedPots), frame.pot]), [
    [4000, 4000], [4000, 7000], [4000, 10000], [10000, 10000],
  ])
  assert.equal(frames.at(-3).seats[1].committed, 3000)
})

test('a loaded hand starts with the first voluntary preflop player next to act', () => {
  const { frames } = replay(sampleHand)
  const start = openingReplayStep(frames)
  assert.equal(frames[start].active, 6)
  assert.equal(frames[start].pot, 300)
  assert.deepEqual(frames[start].seats.filter(seat => seat.folded).map(seat => seat.seat), [3, 4, 5])
  assert.equal(frames[start + 1].label, 'Alex raises to 12')

  const walk = replay({ ...emptyHand, ante: 1, actions: [{ street: 0, seat: 1, type: 'fold' }] })
  assert.equal(openingReplayStep(walk.frames), 0)
  const limp = replay({ ...emptyHand, ante: 1, actions: [{ street: 0, seat: 1, type: 'call' }] })
  assert.equal(openingReplayStep(limp.frames), 0)
})

test('sample refunds unmatched chips and reconstructs both pots through backward seeks', () => {
  const result = replay(sampleHand)
  assert.equal(result.complete, true)
  const before = result.frames.findIndex(frame => frame.label.includes('receives'))
  const stack = (index, name) => result.frames[index].seats.find(seat => seat.name === name).remaining
  assert.deepEqual(result.frames[before].pots, [
    { amount: 24000, eligible: [1, 2, 6] },
    { amount: 19000, eligible: [1, 6] },
  ])
  assert.equal(result.frames[before].pot, 43000)
  assert.equal(potTotal(result.frames[before].collectedPots), 3600)
  assert.deepEqual(result.frames[before + 1].collectedPots.map(pot => pot.amount), [24000, 19000])
  assert.equal(stack(before, 'Mina'), 2500)
  assert.deepEqual(result.frames.at(-1).awards, [{ seat: 6, amount: 43000 }])
  assert.equal(stack(result.frames.length - 1, 'Alex'), 43000)
  assert.equal(result.frames[before - 1].pot, 45500)
  assert.equal(stack(before - 1, 'Mina'), 0)
  assert.equal(result.frames[0].pot, 300)
})

test('hands can end by folds with unknown hole cards and a returned blind', () => {
  const result = replay({ ...emptyHand, actions: [{ street: 0, seat: 1, type: 'fold' }] })
  assert.equal(result.complete, true)
  assert.deepEqual(result.frames.at(-1).awards, [{ seat: 2, amount: 200 }])
  assert.equal(result.frames.at(-1).board.length, 0)
})

test('duplicate cards, wrong turn, invalid check and oversized raise are flagged', () => {
  assert.match(replay({ ...sampleHand, board: ['Ah 9h 4c', '8h', '2d'] }).error, /duplicate/i)
  assert.match(replay({ ...emptyHand, actions: [{ street: 0, seat: 2, type: 'fold' }] }).error, /player 1 acts next/i)
  assert.match(replay({ ...emptyHand, actions: [{ street: 0, seat: 1, type: 'check' }] }).error, /cannot check/i)
  assert.match(replay({ ...emptyHand, actions: [{ street: 0, seat: 1, type: 'raise', amount: 101 }] }).error, /exceeds/i)
})

test('the short stack can win the main pot while a deeper player wins the side pot', () => {
  const result = replay({ ...sampleHand, board: ['Js 9h 4c', '8h', '2d'] })
  assert.equal(result.complete, true)
  assert.deepEqual(result.frames.at(-1).awards, [
    { seat: 2, amount: 24000 },
    { seat: 6, amount: 19000 },
  ])
})
