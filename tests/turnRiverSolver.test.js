import assert from 'node:assert/strict'
import { runInThisContext } from 'node:vm'
import { test } from 'node:test'
import { prepareGame, compareEvLoss, candidateIsWorse, decodeCheckpoint } from '../solver/index.mjs'
import { runBatch, runFlopValidation } from '../solver/batch.mjs'
import { readEngineSource } from '../solver/v18/assets.mjs'

const { core, compile } = runInThisContext(`(() => {
  ${readEngineSource()}
  return { core: createSolverCore(), compile: game => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES) }
})()`)

const card = core.cardId
const hand = (a, b) => core.comboId(card(a), card(b))
const bluff = hand('Ks', 'Qs')
const nuts = hand('Ah', 'Ad')
const weights = entries => {
  const range = new Float64Array(1326)
  for (const [a, b, w] of entries) range[hand(a, b)] = w
  return range
}
const river = {
  board: ['As', '8h', '3d', '2c', '7s'], pot: 100, stack: 100, maxRaises: 0, sizes0: [50], sizes1: [],
  weights0: weights([['Ah', 'Ad', .75], ['Ks', 'Qs', 1]]), weights1: weights([['Jh', 'Jd', 1]]),
}
const checkdown = { sizes0: [], sizes1: [], turnSizes0: [], turnSizes1: [], flopSizes0: [], flopSizes1: [] }

function near(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected} (±${epsilon})`)
}

function nearValues(actual, expected, epsilon) {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < actual.length; i++) near(actual[i], expected[i], epsilon)
}

function contains(bounds, value, epsilon = 1e-9) {
  assert.ok(bounds.lower - epsilon <= value && value <= bounds.upper + epsilon,
    `expected ${JSON.stringify(bounds)} to contain ${value}`)
}

function lock(node, restrictions) {
  return { nodeId: node.id, history: node.history, player: node.p,
    actions: node.actions.map(edge => edge.label), ...restrictions }
}

function rootLock(config, restrictions) {
  const game = core.makeGame(config, { preview: true })
  return lock(game.nodes[game.root], restrictions)
}

function solve(config, iterations, backend = 'javascript') {
  const game = core.makeGame(config, { deferState: backend === 'wasm' })
  if (backend === 'wasm') {
    game.compiled = compile(game)
    assert.equal(game.compiled.fullTraversal, true)
  }
  const solver = new core.CFRSolver(game)
  for (let i = 0; i < iterations; i++) solver.step()
  return { game, solver, metrics: solver.summary() }
}

function checkParity(reference, native, epsilon = 1e-9) {
  for (const key of ['profileEV', 'constrainedBestResponseEV', 'unrestrictedBestResponseEV']) {
    nearValues(reference[key].centered, native[key].centered, epsilon)
    nearValues(reference[key].foldZero, native[key].foldZero, epsilon)
  }
  near(reference.constrainedExploitability, native.constrainedExploitability, epsilon)
  near(reference.unrestrictedExploitability, native.unrestrictedExploitability, epsilon)
  near(native.profileEV.centered[0] + native.profileEV.centered[1], 0, epsilon)
}

test('seven-card evaluation and exclusive card removal agree with exact combinations', () => {
  const rank = text => core.evaluate7(text.split(' ').map(card))
  assert.ok(rank('As Ks Qs Js Ts 3d 2c') > rank('Ac Ad Ah As Ks 3d 2c'))
  assert.ok(rank('Ac Ad Ah Ks Kd Kh 2c') > rank('Ac Ad Ah Qs Qd Qh 2c'))
  assert.ok(rank('Ac 2d 3h 4s 5c Ks Qd') < rank('2c 3d 4h 5s 6c Ks Qd'))
  assert.ok(rank('As Ad 7h 5s 4c Kd Jh') > rank('As Ad 7h 5s 4c Qd Jh'))
  assert.throws(() => rank('Ac Ac 3h 4s 5c 6d 7s'), /seven distinct/)
  assert.throws(() => rank('Ac Xc 3h 4s 5c 6d 7s'), /seven distinct/)
  const board = river.board.map(card), ids = core.boardCombos(board)
  assert.equal(ids.length, 47 * 46 / 2)
  assert.ok(ids.every(id => core.ALL_COMBOS[id].every(c => !board.includes(c))))
  assert.throws(() => core.makeGame({ ...river, weights1: river.weights0.map((_, i) => i === nuts ? 1 : 0),
    weights0: weights([['Ah', 'Ad', 1]]) }), /No mutually compatible/)
})

test('exact weighted private ranges normalize only disjoint deals, including tiny compatible mass', () => {
  const cfg = { ...river, ...checkdown, weights1: weights([['Ah', 'Kd', .25], ['Jh', 'Jd', 1]]) }
  const game = core.makeGame(cfg)
  const [p0, p1] = game.players
  const joint = p0.ids.flatMap((id, i) => p1.ids.map((other, j) =>
    core.compatible(core.ALL_COMBOS[id], core.ALL_COMBOS[other]) ? p0.priors[i] * p1.priors[j] : 0))
  near(game.jointZ, joint.reduce((sum, w) => sum + w, 0))
  near(game.jointZ, (1 + .75 + .25) / (1.75 * 1.25))
  const tiny = { ...cfg, weights0: weights([['Ah', 'Ad', 1]]), weights1: weights([['Ah', 'Kd', 1], ['Jh', 'Jd', 1e-15]]) }
  for (const backend of ['javascript', 'wasm']) {
    const { metrics } = solve(tiny, 0, backend)
    near(metrics.value0, 100)
    near(metrics.value1, 0)
    near(metrics.jointZ, 1e-15, 1e-28)
  }
})

test('analytical river equilibrium, constrained EV bounds, signed EV change and exact baseline identity', () => {
  const prepared = prepareGame(river)
  const baseline = prepared.createSession().solveUntil({ targetEVWidth: .01, maxIterations: 4000 })
  contains(baseline.equilibriumBounds.foldZero[0], 400 / 7)
  near(baseline.equilibriumBounds.width, 2 * baseline.constrainedExploitability)
  near(baseline.value0 + baseline.value1, 100)
  near(baseline.equilibriumBounds.foldZero[0].lower, 100 - baseline.br1)
  near(baseline.equilibriumBounds.foldZero[0].upper, baseline.br0)
  const session = prepared.createSession()
  const identical = session.solveUntil({ maxIterations: 1, baseline })
  nearValues([identical.evLoss.minimum, identical.evLoss.maximum], [0, 0])
  session.setNodeLocks([session.makeLock(0, { comboPercentages: { [bluff]: [0, 100] } })])
  const result = session.solveUntil({ targetEVWidth: .01, maxIterations: 4000, baseline })
  contains(result.equilibriumBounds.foldZero[0], 250 / 7)
  contains({ lower: result.evLoss.minimum, upper: result.evLoss.maximum }, 150 / 7)
  near(result.evLoss.percentOfPot.maximum, result.evLoss.maximum)
  assert.ok(result.unrestrictedExploitability > 10)
  assert.equal(result.evaluationBackend, 'wasm-lock-aware')
  assert.equal(result.terminationReason, 'ev-uncertainty')
  const good = prepared.createSession()
  good.setNodeLocks([good.makeLock(0, { percentages: [100, 0] })])
  const goodResult = good.solveUntil({ targetExploitability: .01 })
  assert.equal(goodResult.terminationReason, 'target-exploitability')
  assert.ok(candidateIsWorse(result, goodResult))
  assert.equal(candidateIsWorse(goodResult, result), false)
  assert.equal(session.solveUntil({ incumbent: goodResult }).terminationReason, 'candidate-eliminated')

  const ip = prepared.createSession()
  const response = ip.findDecision(['River', 'Bet 50%'])
  ip.setNodeLocks([ip.makeLock(response.nodeId, { percentages: [0, 100] })])
  const signed = ip.solveUntil({ targetEVWidth: .01, baseline })
  assert.equal(signed.evLoss.heroOnlyRestriction, false)
  assert.ok(signed.evLoss.maximum < 0)
  const mismatched = prepareGame({ ...river, stack: 101 }).createSession().metrics()
  assert.throws(() => compareEvLoss(baseline, mismatched), /matching rules/)
})

test('locked rows remain fixed and empty of regrets and average sums across JavaScript and WASM variants', () => {
  const cases = [
    { comboPercentages: { [bluff]: [25, 75] } },
    { comboPercentages: { [bluff]: [25, 75], [nuts]: [0, 100] } },
    { percentages: [100, 0] },
  ]
  for (const gtoAlgorithm of ['dcfr', 'cfrplus', 'dcfr-predictive']) {
    for (const restrictions of cases) {
      const cfg = { ...river, gtoAlgorithm, nodeLocks: [rootLock(river, restrictions)] }
      const js = solve(cfg, 80)
      const wasm = solve(cfg, 80, 'wasm')
      assert.equal(wasm.game.compiled.handlesLocks, true)
      assert.equal(wasm.game.compiled.fusesPolicy, gtoAlgorithm === 'dcfr')
      assert.equal(wasm.metrics.evaluationBackend, 'wasm-lock-aware')
      checkParity(js.metrics, wasm.metrics)
      for (const { game, solver } of [js, wasm]) {
        const node = game.nodes[game.root], h = game.players[0].index[bluff]
        assert.equal(node.allLocked, cases[0] !== restrictions)
        assert.deepEqual([...node.regret.subarray(h * 2, h * 2 + 2)], [0, 0])
        assert.deepEqual([...node.averageSum.subarray(h * 2, h * 2 + 2)], [0, 0])
        const detail = solver.nodeReport(node.id)
        const stored = detail.hands.find(v => v[0] === bluff)
        assert.deepEqual(stored[3], (restrictions.percentages ?? restrictions.comboPercentages[bluff]).map(p => p / 100))
        assert.deepEqual(detail, solver.report().nodes[node.id])
      }
    }
  }
})

test('native constrained best responses evaluate the same projected grid policy', () => {
  const cfg = { ...river, frequencyIncrements: { river: [25, 50] },
    nodeLocks: [rootLock(river, { comboPercentages: { [bluff]: [25, 75] } })] }
  const js = solve(cfg, 110)
  const wasm = solve(cfg, 110, 'wasm')
  assert.equal(wasm.metrics.evaluationBackend, 'wasm-lock-aware')
  assert.equal(wasm.metrics.equilibriumBounds.scope, 'continuous-lock-game')
  checkParity(js.metrics, wasm.metrics)
  const current = wasm.solver.nodeReport(0).hands.find(v => v[0] === bluff)
  assert.deepEqual(current[3], [.25, .75])
  assert.throws(() => compareEvLoss(js.metrics, wasm.metrics), /continuous GTO/)
})

function categoryRange(categories) {
  return Float64Array.from(core.ALL_COMBOS, ([a, b]) => {
    const index = categories.indexOf(core.comboCategory(a, b))
    return index < 0 ? 0 : (index + 1) / categories.length
  })
}
const symFlop = {
  ...river, board: ['As', '8s', '3s'], flopSamplingMethod: 'suit-orbits', flopSamplingSeed: 23,
  turnSizes0: [], turnSizes1: [], sizes1: [], maxNodes: 12_000, flopSizes0: [50], flopSizes1: [],
  weights0: categoryRange(['AA', 'KK', 'KQs', 'T9o']),
  weights1: categoryRange(['QQ', 'JJ', 'QJs', '98s']),
}

test('public suit group preserves weighted ranges, symmetric locks and only compatible asymmetric locks', () => {
  const unusedSuitHands = ['h', 'd', 'c'].map(suit => hand('K' + suit, 'Q' + suit))
  const symmetric = Object.fromEntries(unusedSuitHands.map(id => [id, [60, 40]]))
  const configs = [
    { board: ['As', '8h', '3d'], group: 1, restriction: { percentages: [65, 35] } },
    { board: ['As', '8s', '3h'], group: 2, restriction: { percentages: [65, 35] } },
    { board: ['As', '8s', '3s'], group: 6, restriction: { comboPercentages: symmetric } },
    { board: ['As', 'Ah', '3d'], group: 2, restriction: { percentages: [35, 65] } },
    { board: ['As', '8s', '3s'], group: 2, restriction: { comboPercentages: { [unusedSuitHands[1]]: [60, 40] } } },
  ]
  for (const { board, group, restriction } of configs) {
    const base = { ...symFlop, board }
    const config = { ...base, nodeLocks: [rootLock(base, restriction)] }
    const exact = solve({ ...config, useSuitIsomorphism: false }, 30)
    const compressed = solve(config, 30, 'wasm')
    assert.equal(compressed.game.suitIsomorphism.groupSize, group)
    if (group > 1) assert.ok(compressed.game.suitIsomorphism.aliasedDecisions > 0)
    assert.equal(compressed.metrics.rulesFingerprint, exact.metrics.rulesFingerprint)
    assert.equal(compressed.metrics.evaluationBackend, 'wasm-lock-aware')
    checkParity(exact.metrics, compressed.metrics, 1e-7)
  }
  const asymmetric = { ...symFlop, weights0: new Float64Array(symFlop.weights0) }
  asymmetric.weights0[unusedSuitHands[0]] *= .5
  asymmetric.weights0[unusedSuitHands[1]] *= .75
  assert.equal(core.makeGame(asymmetric, { preview: true }).suitIsomorphism.groupSize, 1)
})

test('later-street locks preserve or split their chance orbit and reconstruct aliased combo strategies', () => {
  const preview = core.makeGame(symFlop, { preview: true })
  const firstChance = preview.nodes.find(node => node.chance && node.street === 'deal-turn')
  const orbit = firstChance.isoGroups.find(group => group.members.length === 3)
  assert.ok(orbit)
  const riverNodes = orbit.members.map(({ outcome }) =>
    preview.nodes.find(n => !n.terminal && !n.chance && n.turn === outcome.card && n.river != null &&
      n.p === 0 && n.actions.length === 2 && n.history[1] === 'Check' && n.history[2] === 'Check'))
  assert.ok(riverNodes.every(Boolean))
  // Choose the complete orbit of a single physical river decision by its alias chain.
  const canonical = id => {
    while (preview.nodes[id].isoAlias) id = preview.nodes[id].isoAlias.source
    return id
  }
  const id = canonical(riverNodes[0].id)
  const members = preview.nodes.filter(n => !n.terminal && !n.chance && n.actions.length === 2 && canonical(n.id) === id)
  assert.ok(members.length >= 3)
  const nodeLocks = members.map(node => lock(node, { percentages: [80, 20] }))
  const config = { ...symFlop, nodeLocks }
  const compressed = solve(config, 18, 'wasm')
  const full = solve({ ...config, useSuitIsomorphism: false }, 18)
  const asym = core.makeGame({ ...symFlop, nodeLocks: nodeLocks.slice(0, 1) }, { preview: true })
  assert.equal(compressed.game.suitIsomorphism.groupSize, 6)
  assert.ok(asym.suitIsomorphism.groupSize < 6)
  checkParity(full.metrics, compressed.metrics, 1e-7)
  const alias = members.at(-1)
  assert.notEqual(alias.id, id)
  const report = compressed.solver.nodeReport(alias.id)
  assert.deepEqual(report.hands.map(row => row[0]), compressed.game.players[alias.p].ids)
  for (const row of report.hands) {
    if (core.ALL_COMBOS[row[0]].includes(alias.turn) || core.ALL_COMBOS[row[0]].includes(alias.river)) continue
    assert.deepEqual(row[3], [.8, .2])
  }
  const other = full.solver.nodeReport(alias.id)
  nearValues(report.actions, other.actions, 1e-8)
  near(report.rangeEV, other.rangeEV, 1e-8)
})

test('exact flop and turn chance weights equal brute-force legal runout sums', () => {
  const cfg = { ...river, ...checkdown, board: river.board.slice(0, 3), flopFidelity: 'exact',
    weights0: weights([['Ah', 'Ad', 1]]), weights1: weights([['Jh', 'Jd', 1]]) }
  const board = cfg.board.map(card), own = core.ALL_COMBOS[nuts], opp = core.ALL_COMBOS[hand('Jh', 'Jd')]
  const legal = Array.from({ length: 52 }, (_, i) => i).filter(i => ![...board, ...own, ...opp].includes(i))
  let payoff = 0, count = 0
  for (const turn of legal) for (const river of legal) if (turn !== river) {
    payoff += 50 * Math.sign(core.evaluate7([...board, turn, river, ...own]) - core.evaluate7([...board, turn, river, ...opp]))
    count++
  }
  assert.equal(count, 45 * 44)
  const gto = solve(cfg, 0, 'wasm')
  near(gto.metrics.value0, 50 + payoff / count)
  assert.equal(gto.metrics.chanceMode, 'exact')
  assert.equal(gto.game.nodes.find(n => n.street === 'deal-turn').runouts.length, 49)
  const turn = legal[0]
  const eq = legal.filter(c => c !== turn).reduce((sum, river) => sum + 50 * Math.sign(
    core.evaluate7([...board, turn, river, ...own]) - core.evaluate7([...board, turn, river, ...opp])), 0)
  const solvedTurn = solve({ ...cfg, board: [...cfg.board, turn] }, 0)
  near(solvedTurn.metrics.value0, 50 + eq / 44)
  const forced = gto.game.nodes.filter(n => n.forced)
  assert.ok(forced.length > 2000)
  assert.ok(new Set(forced.map(n => n.current)).size <= 2)
  assert.equal(gto.game.riverPayoffLayouts.get(legal[0] * 53 + legal[1]),
    gto.game.riverPayoffLayouts.get(legal[1] * 53 + legal[0]))
})

test('locked all-in and call collapse to exact blocker-adjusted showdown payoffs', () => {
  const cfg = { ...river, board: river.board.slice(0, 4), stack: 40, allIn: true, sizes0: [],
    weights0: weights([['Ah', 'Ad', 1]]) }
  const preview = core.makeGame(cfg, { preview: true })
  const root = preview.nodes[0], reply = preview.nodes[root.actions[1].child]
  assert.equal(root.actions[1].label, 'All-in 40')
  assert.equal(reply.actions[1].type, 'call')
  const locked = { ...cfg, nodeLocks: [
    lock(root, { percentages: [0, 100] }),
    lock(reply, { percentages: [0, 100] }),
  ] }
  const board = cfg.board.map(card), a = core.ALL_COMBOS[nuts], b = core.ALL_COMBOS[hand('Jh', 'Jd')]
  const available = Array.from({ length: 52 }, (_, i) => i).filter(i => ![...board, ...a, ...b].includes(i))
  assert.equal(available.length, 44)
  const advantage = available.reduce((sum, river) => sum + Math.sign(
    core.evaluate7([...board, river, ...a]) - core.evaluate7([...board, river, ...b])), 0)
  const js = solve(locked, 4), wasm = solve(locked, 4, 'wasm')
  checkParity(js.metrics, wasm.metrics)
  near(wasm.metrics.value0, 50 + 90 * advantage / 44)
  near(wasm.metrics.equilibriumBounds.width, 0)
})

test('seeded flop sampling compares only matching chance games and supports independent validation', () => {
  const small = { ...river, ...checkdown, board: river.board.slice(0, 3), flopSamplingMethod: 'uniform' }
  const exact = prepareGame({ ...small, flopFidelity: 'exact' }).createSession().metrics()
  const runs = Array.from({ length: 24 }, (_, seed) => prepareGame({ ...small, flopFidelity: 'fast',
    flopSamplingSeed: seed }).createSession().metrics())
  assert.equal(new Set(runs.map(r => r.rulesFingerprint)).size, runs.length)
  assert.ok(runs.every(r => r.chanceMode === 'sampled-weighted' && r.constrainedExploitability < 1e-10))
  assert.ok(runs.some(r => Math.abs(r.value0 - exact.value0) > .1))
  near(runs.reduce((sum, r) => sum + r.value0, 0) / runs.length, exact.value0, 4)
  assert.throws(() => compareEvLoss(runs[0], runs[1]), /actual chance trees/)
  const repeated = prepareGame(small).createSession().metrics()
  assert.equal(runs[0].rulesFingerprint, repeated.rulesFingerprint)
  near(runs[0].value0, repeated.value0)
  for (const [flopFidelity, [turns, rivers]] of Object.entries(core.flopFidelities)) {
    const game = core.makeGame({ ...small, flopFidelity }, { preview: true })
    assert.equal(game.nodes.find(n => n.street === 'deal-turn').runouts.length, turns)
    const river = game.nodes.find(n => n.street === 'deal-river')
    assert.equal(river.runouts.length, rivers)
    near(river.runouts[0].weight, 48 / rivers / 44)
  }
})

test('legacy seed validation uses the dealt cards of the current sampled game', () => {
  const groups = new Set()
  for (let seed = 0; seed < 20; seed++) {
    const cfg = { ...symFlop, flopSamplingMethod: 'legacy', flopSamplingSeed: seed,
      flopTurnSamples: 1, flopRiverSamples: 1 }
    const game = core.makeGame(cfg, { preview: true })
    const selected = game.nodes.filter(node => node.chance).flatMap(node => node.runouts.map(edge => edge.card))
    const unused = 4 - new Set([...game.board, ...selected].map(c => c & 3)).size
    assert.equal(game.suitIsomorphism.groupSize, [1, 1, 2, 6][unused])
    groups.add(game.suitIsomorphism.groupSize)
  }
  assert.ok(groups.size > 1)
})

test('prepared sessions isolate state and reuse WASM allocation for matching lock layouts', () => {
  const prepared = core.prepareGame(symFlop)
  const a = prepared.createGame(undefined, { deferState: true })
  const b = prepared.createGame()
  a.compiled = compile(a)
  const solver = new core.CFRSolver(a)
  assert.equal(a.players, b.players)
  assert.equal(a.riverPayoffLayouts, b.riverPayoffLayouts)
  assert.notEqual(a.stateStorage.buffer, b.stateStorage.buffer)
  assert.notEqual(a.stateStorage.buffer, undefined)
  assert.equal(a.stateStorage.buffer, a.compiled.memory.buffer)
  for (let i = 0; i < 5; i++) solver.step()
  const memory = a.compiled.memory
  for (const percentages of [[25, 75], [75, 25], [30, 70]]) {
    solver.setNodeLocks([lock(a.nodes[a.root], { percentages })], () => assert.fail('unexpected recompilation'))
    assert.equal(solver.game, a)
    assert.equal(a.compiled.memory, memory)
    assert.equal(solver.iteration, 0)
    assert.deepEqual([...a.nodes[0].current.subarray(0, 2)], percentages.map(p => p / 100))
    assert.deepEqual([...b.nodes[0].current.subarray(0, 2)], [.5, .5])
    solver.step()
  }
  solver.setNodeLocks([lock(a.nodes[0], { comboPercentages: { [hand('Kd', 'Qd')]: [30, 70] } })])
  assert.notEqual(solver.game, a)
  assert.equal(solver.game.riverPayoffLayouts, a.riverPayoffLayouts)
  assert.equal(solver.game.suitIsomorphism.groupSize, 2)
})

test('warm starts reset averages and schedules, transfer across symmetry layouts and match a cold equilibrium', () => {
  const prepared = prepareGame(river)
  const source = prepared.createSession()
  source.solveUntil({ targetEVWidth: .01, maxIterations: 4000 })
  const storedSource = source.saveCheckpoint()
  const reference = prepared.createSession()
  const constraints = [reference.makeLock(0, { comboPercentages: { [bluff]: [50, 50] } })]
  reference.setNodeLocks(constraints)
  const cold = reference.solveUntil({ targetEVWidth: .008, maxIterations: 4000 })
  for (const mode of ['strategy', 'regret', 'combined']) {
    const candidate = prepared.createSession({ nodeLocks: constraints })
    candidate.warmStartFrom(source, { mode })
    assert.equal(candidate.iteration, 0)
    assert.equal(candidate.saveCheckpoint().history.length, 0)
    assert.deepEqual(candidate.nodeReport(0).hands.find(h => h[0] === bluff)[3], [.5, .5])
    const warmed = candidate.solveUntil({ targetEVWidth: .008, maxIterations: 4000 })
    assert.equal(warmed.terminationReason, 'ev-uncertainty')
    near(warmed.value0, cold.value0, .016)
    contains(warmed.equilibriumBounds.foldZero[0], cold.value0, .008)
  }
  assert.deepEqual(source.saveCheckpoint().storage, storedSource.storage)
  const other = prepareGame({ ...river, stack: 102 }).createSession()
  assert.throws(() => other.warmStartFrom(source), /structurally compatible/)
  const symmetric = prepareGame(symFlop)
  const grouped = symmetric.createSession()
  grouped.solveUntil({ maxIterations: 15 })
  const dest = symmetric.createSession()
  dest.setNodeLocks([dest.makeLock(0, { comboPercentages: { [hand('Kd', 'Qd')]: [65, 35] } })])
  assert.ok(dest.statistics.layoutChanges > 0)
  dest.warmStartFrom(grouped, { mode: 'combined' })
  assert.equal(dest.iteration, 0)
  near(dest.metrics().value0 + dest.metrics().value1, 100, 1e-8)
})

test('checkpoints round-trip across backends, enforce locks and reject unrelated state', () => {
  const cfg = { ...river, nodeLocks: [rootLock(river, { comboPercentages: { [bluff]: [25, 75] } })] }
  const session = prepareGame(cfg).createSession()
  session.solveUntil({ maxIterations: 40 })
  const { config, checkpoint } = decodeCheckpoint(session.encodeCheckpoint())
  const strict = prepareGame(config, { backend: 'javascript' }).createSession({ checkpoint })
  assert.equal(strict.iteration, 40)
  checkParity(session.metrics(), strict.metrics())
  assert.throws(() => prepareGame(river).createSession({ checkpoint }), /Checkpoint does not match/)
  assert.throws(() => prepareGame({ ...cfg, stack: 120 }).createSession({ checkpoint }), /Checkpoint does not match/)
  assert.throws(() => strict.restoreCheckpoint({ ...checkpoint, storage: new Uint8Array(12) }), /Float64/)
  const cfg2 = { ...cfg, gtoAlgorithm: 'cfrplus' }
  const a = solve(cfg2, 6)
  const altered = a.solver.saveCheckpoint()
  const node = a.game.nodes[0], idx = a.game.players[0].index[bluff] * 2
  altered.storage[node.current.byteOffset / 8 + idx] = .99
  altered.storage[node.regret.byteOffset / 8 + idx] = 42
  const resume = core.CFRSolver.resume(core.makeGame(cfg2), altered)
  assert.deepEqual([...resume.game.nodes[0].current.subarray(idx, idx + 2)], [.25, .75])
  assert.equal(resume.game.nodes[0].regret[idx], 0)
})

test('the legacy fingerprint migrates a verified strategy layout and rejects a changed layout', () => {
  const cfg = { ...river, board: ['As', '8s', '3h', '2h'], turnSizes0: [], turnSizes1: [],
    weights0: categoryRange(['AA', 'KK', 'KQs']), weights1: categoryRange(['QQ', 'QJs', '98s']) }
  const old = solve({ ...cfg, compactState: false }, 20)
  assert.ok(old.game.suitIsomorphism.enabled)
  const checkpoint = { ...old.solver.saveCheckpoint(), fingerprint: core.gameSignature(old.game, { legacy: true }) }
  const native = core.makeGame(cfg, { deferState: true })
  native.compiled = compile(native)
  assert.ok(native.stateStorage.length < checkpoint.storage.length)
  const resumed = core.CFRSolver.resume(native, checkpoint)
  checkParity(resumed.summary(), old.metrics, 1e-8)
  assert.throws(() => core.CFRSolver.resume(core.makeGame({ ...cfg, useSuitIsomorphism: false }), checkpoint),
    /Checkpoint/)
})

test('QRE retains native/reference parity on the regularized residual and chip bounds', () => {
  const cfg = { ...river, equilibrium: 'qre', qreTemperaturePercent: .5 }
  const js = solve(cfg, 100)
  const wasm = solve(cfg, 100, 'wasm')
  checkParity(js.metrics, wasm.metrics, 1e-8)
  assert.equal(wasm.metrics.equilibriumBounds.scope, 'chip-minimax')
  near(wasm.metrics.qreResidual, js.metrics.qreResidual, 1e-8)
})

test('pruning masks affect training only, and selected action CFVs still include every legal action', () => {
  const cfg = { ...river, useActionFrequencyPruning: true, actionPruneWarmupIterations: 1,
    actionPruneRecheckIterations: 2, actionPruneThresholdPercent: 5 }
  const { game, solver } = solve(cfg, 0, 'wasm')
  const root = game.nodes[0], idx = game.players[0].index[nuts]
  root.pruned[1] = 1
  core.currentPolicy(game, 0)
  const cfvs = solver.counterfactualActionValues(0)
  near(cfvs.hands[idx].values[0], 50)
  near(cfvs.hands[idx].values[1], 75)
  const summary = solver.summary()
  assert.ok(summary.br0 > summary.value0)
  assert.equal(solver.nodeReport(0).hands[idx][3][1], 0)
  solver.step()
  solver.step()
  solver.step()
  assert.ok(game.actionPruning.fullProbeIterations > 0)
  solver.resetSolverState()
  assert.equal(root.pruned[1], 0)
  assert.equal(game.actionPruning.fullProbeIterations, 0)
})

test('batch workers return deterministic compact metrics in input order and observe budgets', async () => {
  const jobs = ['first', 'second'].map(id => ({ id, config: river, solve: { maxIterations: 25 } }))
  const results = await runBatch(jobs, { workers: 2, workerHeapMb: 96 })
  assert.deepEqual(results.map(row => row.id), ['first', 'second'])
  assert.ok(results.every(row => !row.error), JSON.stringify(results.map(row => row.error)))
  assert.equal(results[0].result.fingerprint, results[1].result.fingerprint)
  assert.deepEqual(results[0].result.equilibriumBounds, results[1].result.equilibriumBounds)
  assert.equal(results[0].result.terminationReason, 'iteration-limit')
  assert.deepEqual(results[0].result.nodes, [])
  const session = prepareGame(river).createSession()
  assert.equal(session.solveUntil({ maxRuntimeMs: 0 }).terminationReason, 'runtime-limit')
  assert.equal(session.solveUntil({ maxMemoryBytes: 1 }).terminationReason, 'memory-limit')
  assert.ok(session.solveUntil({ maxIterations: 0 }).equilibriumBounds.width > 0)
})


test('flop validation pairs candidate and baseline per seed and resolves structural histories', async () => {
  const results = await runFlopValidation({
    config: { ...symFlop, flopSamplingMethod: 'uniform' },
    seeds: [10, 11],
    fidelities: [{ name: 'fast', turns: 2, riversPerTurn: 2 }],
    candidates: [
      { id: 'root', nodeLocks: [{ history: ['Flop'], percentages: [60, 40] }] },
      { id: 'missing', nodeLocks: [{ history: ['Flop', 'Check', 'Check', 'Turn As'], percentages: [100] }] },
    ],
    solve: { maxIterations: 3 },
  }, { workers: 2 })
  assert.deepEqual(results.map(r => r.id), ['fast:10', 'fast:11'])
  assert.ok(results.every(row => !row.error), JSON.stringify(results.map(row => row.error)))
  for (const result of results) {
    assert.equal(result.baseline.rulesFingerprint, result.candidates[0].result.rulesFingerprint)
    assert.ok(result.candidates[0].result.evLoss.maximum >= 0)
    assert.match(result.candidates[1].error, /missing from this chance tree/)
  }
  assert.notEqual(results[0].baseline.rulesFingerprint, results[1].baseline.rulesFingerprint)
})
