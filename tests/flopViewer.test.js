import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCards } from '../src/cards.ts'
import { parseFlopImport } from '../src/flopViewerImport.ts'
import { flopHandClasses, summarizeFlopNode } from '../src/flopStrategy.ts'

const node = {
  name: 'C-bet',
  actions: [{ label: 'Check' }, { label: 'B33' }],
  combos: [
    { hand: 'KsAs', weight: .5, frequencies: [70, 30], evs: [2.4, null] },
    { hand: 'AdKd', weight: 1, frequencies: [0, 50] },
    { hand: 'AhKh', weight: 1, frequencies: [0, 100] },
  ],
}

test('JSON strategy import canonicalizes the flop and removes blocked exact combos', () => {
  const [spot] = parseFlopImport(JSON.stringify({ configuration: ' BTN vs BB ', board: '2c AH 7h', nodes: [node] }))
  assert.equal(spot.configuration, 'BTN vs BB')
  assert.equal(spot.board, 'Ah7h2c')
  assert.deepEqual(spot.nodes[0].combos.map(combo => combo.hand), ['AsKs', 'AdKd'])
  assert.deepEqual(spot.nodes[0].combos[0].evs, [2.4, null])
  const { hands, whole, made } = summarizeFlopNode(readCards(spot.board), spot.nodes[0])
  assert.equal(hands.get('AKs').legal, 3)
  assert.equal(whole.weight, 1.5)
  assert.deepEqual(whole.shares.map(share => Math.round(share * 100)), [35, 65, 50])
  assert.equal(made.get('Top pair').weight, 1.5)
})

test('legacy import uses the reference combo order, percentage columns, and EV columns', () => {
  const weights = Array(1326).fill(0)
  const [high, low] = readCards('AsKs')
  weights[high * (high - 1) / 2 + low] = .6
  const header = ['Configuration', 'Board', 'NodeName1', 'PreflopRange1', 'RangeColors1', 'Freqs1'].join('\t')
  const row = ['Legacy', 'Ah7h2c', 'C-bet', weights.join(' '), 'green,#aa3746', 'AsKs,36.5,63.5,2.4,'].join('\t')
  const [spot] = parseFlopImport('\uFEFF' + header + '\r\n' + row)
  assert.deepEqual(spot.nodes[0].actions, [{ label: 'Action 1', color: 'green' }, { label: 'Action 2', color: '#aa3746' }])
  assert.deepEqual(spot.nodes[0].combos, [{ hand: 'AsKs', weight: .6, frequencies: [36.5, 63.5], evs: [2.4, null] }])
})

test('imports reject duplicate flops, reversed duplicate combos, and malformed action frequencies', () => {
  const spot = { configuration: 'Test', board: 'Ah7h2c', nodes: [node] }
  assert.throws(() => parseFlopImport(JSON.stringify([spot, { ...spot, board: '7h2cAh' }])), /repeats a flop/)
  assert.throws(() => parseFlopImport(JSON.stringify({
    ...spot, nodes: [{ ...node, combos: [...node.combos, { ...node.combos[0], hand: 'AsKs' }] }],
  })), /repeats AsKs/)
  assert.throws(() => parseFlopImport(JSON.stringify({
    ...spot, nodes: [{ ...node, combos: [{ ...node.combos[0], frequencies: [70, 70] }] }],
  })), /frequency from 0–100/)
})

test('made hands and draws respect suits, paired boards, and straight windows', () => {
  function classify(board, hole) { return flopHandClasses(readCards(board), readCards(hole)) }
  assert.equal(classify('AhKh2h', 'Qh8h').made, 'Flush')
  assert.equal(classify('AhAd2c', 'AsKs').made, 'Trips')
  assert.equal(classify('7h7d2c', 'AsKs').made, 'Board pair')
  assert.deepEqual(classify('Ah7h2c', 'KhQh'), { made: 'King high', draw: 'Nut flush draw' })
  assert.equal(classify('8h7d2c', '9sTc').draw, 'Open-ended straight draw')
  assert.equal(classify('6h4d2c', '8s5c').draw, 'Double gutshot')
  assert.equal(classify('Ah4d2c', '3s8c').draw, 'Gutshot')
  assert.equal(classify('Ah4d2c', '5s3c').made, 'Straight')
})
