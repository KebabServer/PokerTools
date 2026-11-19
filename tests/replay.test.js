import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replay } from '../src/replay.ts'
import { emptyHand, sampleHand } from '../src/sample.ts'

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
