import assert from 'node:assert/strict'
import test from 'node:test'
import { core, compile } from '../scripts/solver/harness.mjs'

const MiB = 1048576
function range(weights) {
  const result = new Float64Array(1326)
  for (const [hand, weight] of Object.entries(weights))
    for (const id of core.CATEGORY_IDS[hand]) result[id] = weight
  return result
}
const basic = {
  board: ['As', '8s', '3s'], pot: 550, stack: 9750, maxRaises: 0, allIn: true,
  flopSizes0: [], flopSizes1: [33], turnSizes0: [], turnSizes1: [], sizes0: [], sizes1: [75],
  flopTurnSamples: 49, flopRiverSamples: 48, useSuitIsomorphism: true,
  weights0: range({ T9s: 1, 88: 0.8, KQs: 0.3, '76s': 0.5 }),
  weights1: range({ AQs: 1, JJ: 0.7, AJo: 0.5, '65s': 0.3 }),
  storageLayout: 'compact', memoryLimitBytes: 2048 * MiB, preparationLimitBytes: 2048 * MiB,
}
const large = { ...basic, flopSizes1: [25, 60], turnSizes0: [33], turnSizes1: [50, 100],
  sizes0: [50], sizes1: [50, 100], maxRaises: 2, flopRaiseSizes0: [60], flopRaiseSizes1: [60],
  turnRaiseSizes0: [60], turnRaiseSizes1: [60], raiseSizes0: [75], raiseSizes1: [75] }
const estimate = config => core.makeGame(config, { capacityOnly: true })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`)

test('preflight separates the configurable record budget, logical IDs and worker memory', () => {
  const plan = estimate(large)
  assert.ok(plan.logicalNodes > 2_000_000)
  assert.ok(plan.materializedRecords > 500_000 && plan.materializedRecords < 1_000_000)
  assert.ok(plan.logicalNodes > plan.physicalSlots && plan.canonicalDecisions < plan.materializedRecords)
  assert.ok(plan.wasmBytes > plan.strategyBytes)
  assert.ok(plan.peakBytes > plan.strategyBytes + plan.wasmBytes)
  for (const maxNodes of [250_000, 500_000]) {
    assert.throws(() => core.makeGame({ ...large, maxNodes }), error => {
      assert.equal(error.capacity.blockedBy, 'Materialized tree records')
      assert.equal(error.capacity.required, plan.materializedRecords)
      return error.capacity.limit === maxNodes
    })
  }
  assert.throws(() => core.makeGame({ ...large, preparationLimitBytes: 512 * MiB }),
    error => error.capacity.blockedBy === 'Peak worker preparation memory')
  assert.throws(() => core.makeGame({ ...large, memoryLimitBytes: 100 * MiB }),
    error => error.capacity.blockedBy === 'Strategy storage')
  assert.throws(() => core.makeGame({ ...large, treeHeapLimitBytes: 64 * MiB }),
    error => error.capacity.blockedBy === 'JavaScript tree metadata')
  const wide = new Float64Array(1326).fill(1)
  assert.throws(() => core.makeGame({ ...large, maxRaises: 1, turnSizes0: [], memoryLimitBytes: 8192 * MiB, weights0: wide, weights1: wide }),
    error => error.capacity.blockedBy === 'WebAssembly linear memory' && error.capacity.limit < 2 * 1024 * MiB)
})

test('canonical structure preserves the full preorder, strategies and checkpoint identity', () => {
  const game = core.makeGame(basic)
  const preview = core.makeGame(basic, { preview: true, lazyTree: true })
  const explicit = core.makeGame({ ...basic, treeLayout: 'explicit' })
  assert.equal(game.capacity.logicalNodes, game.nodes.length)
  assert.equal(game.capacity.materializedRecords, game.treeStorage.budgetRecords)
  assert.equal(game.capacity.physicalSlots, game.treeStorage.physicalSlots)
  assert.equal(game.capacity.canonicalDecisions, game.decisionNodes.length)
  assert.equal(game.capacity.strategyBytes, game.stateStorage.byteLength)
  assert.ok(game.treeStorage.budgetRecords < explicit.treeStorage.budgetRecords / 2)
  assert.ok(preview.staticNodes.length < 100)
  assert.equal(preview.nodes.length, explicit.nodes.length)
  const alias = game.nodes.find(n => n.isoAlias && game.nodes[n.isoAlias.source].isoAlias)
  assert.ok(alias && !game.decisionNodes.some(node => node.id === alias.id))
  assert.deepEqual(alias.history, explicit.nodes[alias.id].history)
  assert.deepEqual(alias.history, preview.nodes[alias.id].history)
  assert.deepEqual(preview.parentOf(alias.id), game.parentOf(alias.id))
  assert.deepEqual(alias.actions, explicit.nodes[alias.id].actions)
  assert.equal(core.gameSignature(game), core.gameSignature(explicit))

  game.compiled = compile(game, basic.memoryLimitBytes, 'auto')
  assert.ok(game.compiled?.fullTraversal)
  assert.ok(game.capacity.wasmBytes >= game.compiled.memory.buffer.byteLength)
  const solver = new core.CFRSolver(game)
  const reference = new core.CFRSolver(explicit)
  for (let i = 0; i < 3; i++) { solver.step(); reference.step() }
  const actual = solver.summary(), expected = reference.summary()
  near(actual.value0, expected.value0)
  near(actual.oopEvBounds.lower, expected.oopEvBounds.lower)
  near(actual.oopEvBounds.upper, expected.oopEvBounds.upper)
  const detail = solver.nodeReport(alias.id), refDetail = reference.nodeReport(alias.id)
  near(detail.rangeEV, refDetail.rangeEV)
  assert.deepEqual(detail.hands.map(h => h[0]).sort((a, b) => a - b), refDetail.hands.map(h => h[0]))
  for (const hand of detail.hands) near(hand[3].reduce((s, p) => s + p, 0), 1)
  const restored = core.CFRSolver.resume(core.makeGame(basic), reference.saveCheckpoint())
  near(restored.summary().value0, expected.value0)
})

test('asymmetric exact-combo locks materialize affected orbits and matching locks preserve them', () => {
  const settings = { ...basic, board: ['As', 'Ah', '7d', '2c'], turnSizes1: [50],
    weights0: range({ KK: 1, T9s: 0.5 }), weights1: range({ QQ: 1, JTs: 0.3 }) }
  const preview = core.makeGame({ ...settings, useSuitIsomorphism: false }, { preview: true, lazyTree: true })
  const chance = preview.nodes[preview.nodes[preview.nodes[0].actions[0].child].actions[0].child]
  function lock(dealtCard, combination) {
    const node = preview.nodes[chance.runouts.find(x => x.card === core.cardId(dealtCard)).child]
    const id = core.comboId(core.cardId(combination.slice(0, 2)), core.cardId(combination.slice(2)))
    return { nodeId: node.id, history: node.history, actions: node.actions.map(a => a.label), player: node.p,
      comboPercentages: { [id]: [20, 80] } }
  }
  const nodeLocks = [lock('Ks', 'Ts9s'), lock('Kh', 'Th9h')]
  const restricted = core.makeGame({ ...settings, nodeLocks })
  assert.equal(restricted.suitIsomorphism.groupSize, 2)
  assert.ok(nodeLocks.some(lock => restricted.nodes[lock.nodeId].isoAlias && restricted.nodes[lock.nodeId].locked))
  const unilateral = core.makeGame({ ...settings, nodeLocks: nodeLocks.slice(0, 1) }, { preview: true })
  assert.equal(unilateral.suitIsomorphism.groupSize, 1)
  assert.ok(unilateral.treeStorage.budgetRecords > restricted.treeStorage.budgetRecords)

  restricted.compiled = compile(restricted, basic.memoryLimitBytes, 'scalar')
  assert.ok(restricted.compiled?.constrainedBest)
  const fast = new core.CFRSolver(restricted)
  const old = new core.CFRSolver(core.makeGame({ ...settings, nodeLocks, treeLayout: 'explicit' }))
  for (let i = 0; i < 8; i++) { fast.step(); old.step() }
  near(fast.summary().exploitability, old.summary().exploitability)
  near(fast.summary().unrestrictedExploitability, old.summary().unrestrictedExploitability)
})

test('weighted ranges can break public symmetry without changing the logical tree', () => {
  const weights0 = Float64Array.from(basic.weights0)
  for (const [suit, weight] of [['h',0.6], ['d',0.9]]) {
    weights0[core.comboId(core.cardId('K'+suit), core.cardId('Q'+suit))] = weight
  }
  const symmetric = estimate(basic), asymmetric = estimate({ ...basic, weights0 })
  assert.equal(symmetric.logicalNodes, asymmetric.logicalNodes)
  assert.equal(asymmetric.aliasedDecisions, 0)
  assert.ok(asymmetric.materializedRecords > 3 * symmetric.materializedRecords)
})

test('two histories with the same pot and stacks keep independent decision state', () => {
  const game = core.makeGame({ ...basic, allIn: false, flopSizes0: [50], flopSizes1: [50], sizes0: [50],
    flopTurnSamples: 1, flopRiverSamples: 1, useSuitIsomorphism: false })
  const root = game.nodes[0]
  const action = (node,type) => game.nodes[node.actions.find(a => a.type === type).child]
  const deal = node => game.nodes[node.runouts[0].child]
  const river = afterCall => deal(action(action(deal(afterCall), 'check'), 'check'))
  const first = river(action(action(root, 'bet'), 'call'))
  const second = river(action(action(action(root, 'check'), 'bet'), 'call'))
  assert.equal(first.river, second.river)
  assert.equal(first.pot, second.pot)
  assert.deepEqual(first.c, second.c)
  assert.notDeepEqual(first.history, second.history)
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.current.byteOffset, second.current.byteOffset)
})
