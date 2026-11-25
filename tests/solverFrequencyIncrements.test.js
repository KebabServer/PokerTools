import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInThisContext } from 'node:vm'

const source = name => readFileSync(new URL('../public/turn-river-lab/' + name, import.meta.url), 'utf8')
const { core, compile } = runInThisContext(`(() => {
  ${source('core.js')}
  ${source('compiled-traversal.js')}
  ${source('wasm-kernel-data.js')}
  return { core: createSolverCore(), compile: game => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES) }
})()`)

const combo = (a, b) => core.comboId(core.cardId(a), core.cardId(b))
function range(hands) {
  const weights = new Float64Array(1326)
  for (const [a, b, weight] of hands) weights[combo(a, b)] = weight
  return weights
}

const river = {
  board: ['As', '8h', '3d', '2c', '7s'],
  pot: 100, stack: 100, sizes0: [50], sizes1: [],
  maxNodes: 5_000, maxRaises: 0, allIn: false,
  weights0: range([['Ah', 'Ad', .75], ['Ks', 'Qs', 1]]),
  weights1: range([['Jh', 'Jd', 1]]),
}

function checkMix(mix, units) {
  assert.ok(Math.abs(mix.reduce((sum, p) => sum + p, 0) - 1) < 1e-12)
  for (const p of mix) {
    assert.ok(p >= 0 && p <= 1)
    if (units) assert.ok(Math.abs(p * units - Math.round(p * units)) < 1e-10, mix.join(', '))
  }
}

test('frequency increments apply to the configured player and street in training and reports', () => {
  const increments = { flop: [25, 0], turn: [0, 50], river: [20, 12.5] }
  const game = core.makeGame({
    ...river, board: river.board.slice(0, 3), flopTurnSamples: 1, flopRiverSamples: 1,
    flopSizes0: [33, 50], flopSizes1: [33, 50], sizes1: [50],
    turnSizes0: [50], turnSizes1: [50], frequencyIncrements: increments,
  })
  const solver = new core.CFRSolver(game)
  const initial = core.averagePolicy(game)
  const ipFlop = game.nodes[game.nodes[game.root].actions[0].child]
  assert.equal(ipFlop.frequencyUnits, undefined)
  assert.equal(initial[ipFlop.id][0], 1 / 3)
  const playerStreets = new Set()
  for (let i = 0; i < 7; i++) {
    for (const node of game.nodes) {
      if (node.terminal || node.chance || node.isoAlias) continue
      const step = increments[node.street][node.p]
      playerStreets.add(node.street + node.p)
      assert.equal(node.frequencyUnits, step ? 100 / step : undefined)
      const actions = node.actions.length
      for (let off = 0; off < node.current.length; off += actions) {
        checkMix(node.current.subarray(off, off + actions), node.frequencyUnits)
      }
    }
    solver.step()
  }
  assert.equal(playerStreets.size, 6)
  const report = solver.report()
  for (const node of game.nodes) {
    if (node.terminal || node.chance) continue
    for (const hand of report.nodes[node.id].hands) checkMix(hand[3], node.frequencyUnits)
  }
})

test('reference and compiled solves use grid-constrained hand mixes and evaluate that profile', () => {
  const config = { ...river, frequencyIncrements: { river: [25, 0] } }
  for (const useCompiled of [false, true]) {
    const game = core.makeGame(config)
    if (useCompiled) {
      game.compiled = compile(game)
      assert.equal(game.compiled.fullTraversal, true)
      assert.equal(game.compiled.fusesPolicy, false)
      assert.equal(game.compiled.exactBest, null)
    }
    const solver = new core.CFRSolver(game)
    const root = game.nodes[game.root]
    for (let i = 0; i < 1_000; i++) {
      solver.step()
      checkMix(root.current.subarray(0, 2), 4)
    }
    // A 50% pot bet needs one bluff per three value hands. The ranges here
    // make that ratio possible when OOP bluffs with KsQs exactly 25% of the time.
    const report = solver.report()
    const detail = solver.nodeReport(root.id)
    const bluff = detail.hands.find(hand => hand[0] === combo('Ks', 'Qs'))
    assert.deepEqual(bluff[3], [.75, .25])
    assert.deepEqual(report.nodes[root.id], detail)
    const ip = report.nodes[root.actions[1].child].hands[0]
    assert.ok(Math.abs(ip[3][1] - 2 / 3) < .01)
    assert.equal(Math.round(ip[3][1] * 4) === ip[3][1] * 4, false)
    assert.ok(report.exploitability < .1)
    assert.ok(Math.abs(solver.summary().exploitability - report.exploitability) < 1e-10)
    assert.ok(Math.abs(solver.checkConvergence().exploitability - report.exploitability) < 1e-10)
  }
})

test('frequency increments validate input, respect compatible locks, and survive checkpoints', () => {
  const config = { ...river, frequencyIncrements: { river: [25, 0] } }
  assert.throws(() => core.makeGame({ ...river, frequencyIncrements: { river: [30, 0] } }), /River OOP frequency increment/)
  assert.throws(() => core.makeGame({ ...river, frequencyIncrements: { river: [0, -1] } }), /River IP frequency increment/)
  assert.throws(() => core.makeGame({ ...config, equilibrium: 'qre' }), /Nash \/ GTO/)
  const plain = core.makeGame(river)
  const irrelevant = core.makeGame({ ...river, frequencyIncrements: { flop: [25, 0], river: [0, 0] } })
  assert.equal(core.gameSignature(plain), core.gameSignature(irrelevant))

  const root = plain.nodes[plain.root]
  const lock = { nodeId: root.id, history: root.history, player: 0, actions: root.actions.map(a => a.label) }
  assert.throws(() => core.makeGame({ ...config, nodeLocks: [{ ...lock, percentages: [40, 60] }] }), /must match the 25% frequency increment/)
  const game = core.makeGame({ ...config, nodeLocks: [{ ...lock, comboPercentages: { [combo('Ks','Qs')]: [25, 75] } }] })
  const solver = new core.CFRSolver(game)
  for (let i = 0; i < 10; i++) solver.step()
  const checkpoint = solver.saveCheckpoint()
  const resumedGame = core.makeGame({ ...config, nodeLocks: game.nodeLocks })
  const resumed = core.CFRSolver.resume(resumedGame, checkpoint)
  resumed.step()
  const mix = resumed.nodeReport(root.id).hands.find(hand => hand[0] === combo('Ks','Qs'))[3]
  assert.deepEqual(mix, [.25, .75])
  assert.throws(() => core.CFRSolver.resume(core.makeGame({
    ...config, nodeLocks: game.nodeLocks, frequencyIncrements: {river: [12.5, 0]},
  }), checkpoint), /Checkpoint does not match/)
})
