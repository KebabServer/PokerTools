import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateEquity, equityInputs } from '../src/equity.ts'
import { parseRange, rangeMatrixSelection, toggleRangeClass } from '../src/ranges.ts'

test('river guarantees a winner with exact percentages', () => {
  const result = calculateEquity({ players: ['AsAd', 'KhKd'], board: 'Ac 9c 7h 4s 2d', dead: '' })
  assert.deepEqual(result, {
    mode: 'exact', count: 1,
    players: [{ equity: 1, win: 1, tie: 0 }, { equity: 0, win: 0, tie: 0 }],
  })
})

test('a board royal flush gives every player the correct fractional equity', () => {
  const result = calculateEquity({ players: ['2d3d', '4c5c', '6h7h'], board: 'As Ks Qs Js Ts', dead: '' })
  assert.deepEqual(result.players, Array.from({ length: 3 }, () => ({ equity: 1 / 3, win: 0, tie: 1 })))
  const headsUp = calculateEquity({ players: ['2d3d', '4c5c'], board: 'As Ks Qs Js Ts', dead: '' })
  assert.deepEqual(headsUp.players, [{ equity: 0.5, win: 0, tie: 1 }, { equity: 0.5, win: 0, tie: 1 }])
})

test('ranges expand without duplicates and apply blockers', () => {
  assert.equal(parseRange('77+, AJs+, KQo, A5s-A2s, AcJc').combos.length, 88)
  assert.equal(parseRange('random').combos.length, 1326)
  const { options } = equityInputs({ players: ['As Ac', 'AJs+'], board: 'Ah 9h 4c', dead: 'Jd' })
  assert.throws(() => equityInputs({ players: ['AsKd', 'AsJc'], board: '', dead: '' }), /duplicate card/i)
  assert.throws(() => calculateEquity({ players: ['AA', 'AA', 'AA'], board: '', dead: '' }), /no legal matchup/i)
  assert.equal(options[1].combos.length, 2)
})

test('matrix toggles expand a partial class and preserve exact combos in other classes', () => {
  const range = parseRange('77+, AsKd, 5c4c')
  const selection = rangeMatrixSelection(range)
  assert.equal(selection.get('AA'), true)
  assert.equal(selection.get('AKo'), 'mixed')
  assert.equal(selection.get('54s'), 'mixed')
  assert.equal(selection.has('AKs'), false)

  const expanded = parseRange(toggleRangeClass(range, 'AKo', false))
  assert.equal(rangeMatrixSelection(expanded).get('AKo'), true)
  assert.deepEqual(expanded.specific, ['5c4c'])
  const removed = parseRange(toggleRangeClass(expanded, 'AKo', true))
  assert.equal(rangeMatrixSelection(removed).has('AKo'), false)
  assert.deepEqual(removed.specific, ['5c4c'])
})

test('matrix recognizes a full class entered as individual combos and removes all of them', () => {
  const range = parseRange('AsKs, AhKh, AdKd, AcKc, AsKd')
  assert.equal(rangeMatrixSelection(range).get('AKs'), true)
  assert.equal(toggleRangeClass(range, 'AKs', true), 'AsKd')
})

test('each legal combo contributes its own outcome, with dead cards applied', () => {
  const result = calculateEquity({ players: ['AdKd', 'QQ, 2c3c'], board: '2s 3d 9s 4h 8h', dead: 'Qc' })
  assert.equal(result.count, 4)
  assert.equal(result.players[0].equity, 0)
  const mixed = calculateEquity({ players: ['AdKd', 'QQ, 5c3c'], board: '2s Jh 9s 4h 8h', dead: 'Qc' })
  assert.equal(mixed.count, 4)
  assert.equal(mixed.players[0].equity, 0.25)
})

test('a turn calculation enumerates every remaining river and large jobs sample', () => {
  const input = { players: ['AsAd', 'KhKd'], board: 'Ac 9c 7h 4s', dead: '2d' }
  const exact = calculateEquity(input)
  assert.equal(exact.mode, 'exact')
  assert.equal(exact.count, 43)
  const approximate = calculateEquity({ ...input, board: '', samples: 500 })
  assert.equal(approximate.mode, 'estimated')
  assert.equal(approximate.count, 500)
  assert.ok(Math.abs(approximate.players.reduce((sum, player) => sum + player.equity, 0) - 1) < 1e-9)
})
