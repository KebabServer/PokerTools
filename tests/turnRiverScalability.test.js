import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInThisContext } from 'node:vm'
import { prepareGame, cardId, comboId, decodeCheckpoint } from '../solver/index.mjs'
import { runBatch } from '../solver/batch.mjs'

const coreSource = readFileSync(new URL('../public/turn-river-lab/core.js', import.meta.url), 'utf8')
const core = runInThisContext(coreSource + '\ncreateSolverCore()')
const hand = (a, b) => comboId(cardId(a), cardId(b))
const nuts = hand('Ah', 'Ad')
const bluff = hand('Ks', 'Qs')
const makeRange = entries => {
  const weights = new Float64Array(1326)
  for (const [a, b, w] of entries) weights[hand(a, b)] = w
  return weights
}
const river = {
  board: ['As', '8h', '3d', '2c', '7s'], pot: 100, stack: 100, maxRaises: 0,
  sizes0: [50], sizes1: [], maxNodes: 100000,
  weights0: makeRange([['Ah', 'Ad', .75], ['Ks', 'Qs', 1]]),
  weights1: makeRange([['Jh', 'Jd', 1]]),
}
const compact = { strategyStorage: 'compact' }
const exact = { flopTurnSamples: 49, flopRiverSamples: 48 }
const sampled = { flopTurnSamples: 3, flopRiverSamples: 3, flopSamplingSeed: 67, flopSamplingMethod: 'uniform' }
const checkdown = { flopSizes0: [], flopSizes1: [], turnSizes0: [], turnSizes1: [], sizes0: [], sizes1: [] }

function near(x, y, tolerance = 1e-9) {
  assert.ok(Math.abs(x - y) <= tolerance, `expected ${x} within ${tolerance} of ${y}`)
}

function parity(first, second, tolerance = 1e-9) {
  for (const key of ['profileEV', 'constrainedBestResponseEV', 'unrestrictedBestResponseEV']) {
    for (let p = 0; p < 2; p++) near(first[key].centered[p], second[key].centered[p], tolerance)
  }
  near(first.equilibriumBounds.width, second.equilibriumBounds.width, tolerance)
}

function lock(session, restrictions, id = session.describe().root) {
  session.setNodeLocks([session.makeLock(id, restrictions)])
}

test('compact legal rows omit blockers, forced actions, structural incompatibility and locks', () => {
  const cfg = {
    ...river, board: river.board.slice(0, 3), ...sampled, flopTurnSamples: 49,
    weights1: makeRange([['Ah', 'Jh', .25], ['Ah', 'Th', 1]]),
  }
  const game = core.makeGame({ ...cfg, ...compact })
  const dense = core.makeGame(cfg)
  const root = game.nodes[0], index = game.players[0].index
  assert.equal(root.rowShape.map[index[nuts]], -1)
  assert.equal(root.rowShape.map[index[bluff]], 0)
  assert.ok(game.nodes.some(node => node.actions?.length === 1 && !node.current))
  assert.ok(game.nodes.some(node => node.rowShape && node.valid?.[node.p].some((allowed, i) =>
    !allowed && node.rowShape.map[i] === -1)))
  assert.ok(game.stateBytes < dense.stateBytes)
  assert.deepEqual(root.history, dense.nodes[0].history)

  const session = prepareGame({ ...cfg, ...compact }).createSession()
  const reply = session.findDecision(['Flop', 'Bet 50%'])
  lock(session, { percentages: [100, 0] })
  const lockedGame = core.makeGame({ ...cfg, ...compact,
    nodeLocks: [session.makeLock(0, { percentages: [100, 0] })] })
  assert.equal(lockedGame.nodes[0].regret.length, 0)
  assert.equal(lockedGame.nodes[0].lockedRows.length, 2)
  assert.ok(lockedGame.nodes[reply.nodeId].regret.length > 0)
  assert.equal(session.nodeReport(reply.nodeId).reachMass, 0)
  const result = session.solveUntil({ maxIterations: 6 })
  parity(result, session.metrics({ independent: true }))
  assert.ok(result.unrestrictedBestResponseEV.centered[0] >= result.constrainedBestResponseEV.centered[0])
})

test('exact compact Float64 and derived current match dense reference across storage layouts', () => {
  const cfg = { ...river, ...checkdown, board: river.board.slice(0, 3), ...exact, sizes0: [33] }
  const dense = prepareGame(cfg, { backend: 'javascript' }).createSession()
  const standard = prepareGame({ ...cfg, ...compact }).createSession()
  const derived = prepareGame({ ...cfg, ...compact, currentPolicyStorage: 'derived' }, { backend: 'wasm-simd' }).createSession()
  const expected = dense.solveUntil({ maxIterations: 5 })
  const stored = standard.solveUntil({ maxIterations: 5 })
  parity(expected, stored)
  parity(expected, derived.solveUntil({ maxIterations: 5 }))
  parity(stored, derived.metrics({ independent: true }))
  assert.ok(derived.describe().packedNodes < dense.describe().structuralNodes)
  near(derived.describe().strategy.bytes, 2 * standard.describe().strategy.bytes / 3, 8)
  derived.warmStartFrom(dense, { mode: 'regret' })
  assert.equal(derived.iteration, 0)
  assert.throws(() => derived.warmStartFrom(standard, { mode: 'combined' }), /regret-only/)
  standard.warmStartFrom(derived, { mode: 'strategy' })
  parity(standard.metrics(), standard.metrics({ independent: true }))
})

test('compact suit rows require exact range, chance and later-lock invariance', () => {
  const categoryRange = labels => Float64Array.from(core.ALL_COMBOS, cards =>
    labels.includes(core.comboCategory(...cards)) ? .7 : 0)
  const cfg = { ...river, ...compact, board: ['As', '8s', '3s'], flopSamplingMethod: 'suit-orbits',
    flopTurnSamples: 6, flopRiverSamples: 4, flopSamplingSeed: 12,
    weights0: categoryRange(['AA', '88', 'KQs', 'JTs']),
    weights1: categoryRange(['KK', '99', 'QJs', '98s']) }
  const reference = prepareGame({ ...cfg, useSuitIsomorphism: false }, { backend: 'javascript' }).createSession()
  const run = prepareGame(cfg).createSession()
  assert.ok(run.describe().symmetry.groupSize > 1)
  assert.ok(run.describe().strategy.rows < reference.describe().strategy.rows)
  parity(reference.solveUntil({ maxIterations: 15 }), run.solveUntil({ maxIterations: 15 }))

  const preview = core.makeGame(cfg, { preview: true })
  const later = preview.nodes.find(node => node.turn != null && node.actions?.length > 1)
  const combo = preview.players[later.p].ids.find(id => core.ALL_COMBOS[id].every(c => c !== later.turn) &&
    core.comboCategory(...core.ALL_COMBOS[id]).endsWith('s'))
  const entry = run.makeLock(later.id, { comboPercentages: { [combo]: [0, 100] } })
  run.setNodeLocks([entry])
  reference.setNodeLocks([entry])
  assert.ok(run.describe().symmetry.groupSize < preview.suitIsomorphism.groupSize)
  parity(reference.solveUntil({ maxIterations: 12 }), run.solveUntil({ maxIterations: 12 }))
  assert.deepEqual(run.nodeReport(later.id).hands.find(row => row[0] === combo)[3], [0, 1])

  const asymmetric = cfg.weights0.slice()
  asymmetric[hand('Kc', 'Qc')] = .6
  const unequal = prepareGame({ ...cfg, weights0: asymmetric }).createSession()
  assert.ok(unequal.describe().symmetry.groupSize < preview.suitIsomorphism.groupSize)
})

for (const strategyPrecision of ['f32-regret', 'f32-average', 'f32', 'scaled']) {
  test(`${strategyPrecision} reaches a tight Float64-verified analytical bound and restores byte-packed state`, () => {
    const settings = { ...river, ...compact, strategyPrecision }
    const session = prepareGame(settings, { backend: 'wasm-simd' }).createSession()
    const result = session.solveUntil({ targetEVWidth: .01, maxIterations: 2500, finalEvaluation: 'javascript' })
    assert.equal(result.terminationReason, 'ev-uncertainty')
    assert.equal(result.evaluationBackend, 'javascript')
    assert.ok(result.equilibriumBounds.foldZero[0].lower <= 400 / 7 + 1e-9)
    assert.ok(result.equilibriumBounds.foldZero[0].upper >= 400 / 7 - 1e-9)
    parity(result, session.metrics())
    const { config, checkpoint } = decodeCheckpoint(session.encodeCheckpoint())
    assert.equal(checkpoint.format, 'TurnRiverLab-checkpoint-v2')
    assert.ok(checkpoint.storage instanceof Uint8Array)
    assert.equal(checkpoint.storage.byteLength, session.describe().strategy.bytes)
    const reference = prepareGame(config, { backend: 'javascript' }).createSession({ checkpoint })
    parity(session.solveUntil({ maxIterations: 77 }), reference.solveUntil({ maxIterations: 77 }), 2e-7)
    assert.throws(() => prepareGame({ ...config, strategyPrecision: 'f64' }).createSession({ checkpoint }), /compact game/)
    const invalid = new Uint8Array(session.encodeCheckpoint())
    invalid[invalid.length - 1] ^= 1
    assert.throws(() => decodeCheckpoint(invalid), /checksum/)
  })
}

test('full and partial compact locks refresh in-place only for compatible row maps', () => {
  const session = prepareGame({ ...river, ...compact }).createSession()
  lock(session, { comboPercentages: { [bluff]: [25, 75] } })
  const started = session.statistics
  session.solveUntil({ maxIterations: 6 })
  lock(session, { comboPercentages: { [bluff]: [70, 30] } })
  assert.equal(session.statistics.layoutChanges, started.layoutChanges)
  assert.equal(session.statistics.wasmInitializationMs, started.wasmInitializationMs)
  assert.equal(session.iteration, 0)
  assert.deepEqual(session.counterfactualActionValues(0, 'profile', { comboIds: [bluff] }).hands[0].probabilities, [.7, .3])
  lock(session, { comboPercentages: { [nuts]: [80, 20] } })
  assert.equal(session.statistics.layoutChanges, started.layoutChanges + 1)
  lock(session, { percentages: [0, 100] })
  parity(session.solveUntil({ maxIterations: 20 }), session.metrics({ independent: true }))
})

for (const chance of [exact, sampled]) {
  test(`all-in runouts and optional pair operator match explicit ${chance === exact ? 'exact' : 'sampled'} reference`, () => {
    const cfg = { ...river, ...compact, ...checkdown, board: river.board.slice(0, 3), ...chance, allIn: true,
      weights0: makeRange([['Ah', 'Ad', .8], ['Ks', 'Qs', .15], ['Jc', '9c', .1]]),
      weights1: makeRange([['Jh', 'Jd', 1], ['Ah', 'Kh', .2], ['Ts', 'Th', .9]]) }
    const solve = (allInRunouts, backend) => {
      const s = prepareGame({ ...cfg, allInRunouts }, { backend }).createSession()
      const reply = s.findDecision(['Flop', 'All-in 100'])
      s.setNodeLocks([s.makeLock(0, { percentages: [0, 100] }),
        s.makeLock(reply.nodeId, { percentages: [0, 100] })])
      return { s, result: s.solveUntil({ maxIterations: 1 }) }
    }
    const explicit = solve('explicit', 'javascript')
    const implicit = solve('implicit', 'wasm')
    const pair = solve('pair-equity', 'wasm-simd')
    parity(explicit.result, implicit.result)
    parity(explicit.result, pair.result)
    parity(pair.result, pair.s.metrics({ independent: true }))
    assert.ok(implicit.s.describe().structuralNodes < explicit.s.describe().structuralNodes)
    assert.equal(pair.s.describe().allIn.pairEquityPrograms > 0, chance === exact)
    near(pair.result.equilibriumBounds.width, 0)
  })
}

test('native addon, scalar WASM, SIMD WASM and JS agree on locked weighted turns', {
  skip: !existsSync(new URL('../solver/native/build/turn-river.node', import.meta.url)),
}, () => {
  const cfg = { ...river, ...compact, board: river.board.slice(0, 4), allIn: true, strategyPrecision: 'f32-average',
    weights1: makeRange([['Jh', 'Jd', 1], ['Ah', 'Kh', 1e-13], ['Ts', 'Th', .9]]) }
  const results = ['javascript', 'wasm', 'wasm-simd', 'native'].map(backend => {
    const s = prepareGame(cfg, { backend }).createSession()
    lock(s, { comboPercentages: { [bluff]: [5, 25, 70] } })
    const result = s.solveUntil({ maxIterations: 30 })
    if (backend === 'native') assert.match(result.backend, /^native-compact/)
    if (backend === 'wasm-simd') assert.match(result.backend, /^wasm-source-simd/)
    return result
  })
  for (const result of results.slice(1)) parity(results[0], result, 1e-7)
})

test('selected sensitivities report compatible mass, zero-frequency actions and grouped conditional EVs', () => {
  const s = prepareGame({ ...river, ...compact }).createSession()
  lock(s, { percentages: [100, 0] })
  const actions = s.counterfactualActionValues(0, 'profile', { comboIds: [nuts], groups: { selected: [nuts, bluff] } })
  assert.equal(actions.evaluation, 'fixed-continuation')
  assert.equal(actions.localSensitivity, true)
  assert.equal(actions.hands.length, 1)
  const [row] = actions.hands
  assert.deepEqual(row.lockedActionProbabilities, [1, 0])
  assert.deepEqual(row.probabilities, [1, 0])
  assert.equal(row.compatibleOpponentMass, 1)
  assert.equal(row.ownReach, 1)
  assert.deepEqual(row.values, [50, 75])
  assert.deepEqual(row.conditionalActionEVs, row.values)
  near(actions.groups.selected.reachMass, 1)
  near(actions.groups.selected.deltasFromFirstAction[0], 0)
  assert.equal(s.counterfactualActionValues(0, 'constrainedBest').localSensitivity, false)
})

test('adaptive checks certify EV-loss bounds and respect cooperative cancellation and budgets', () => {
  const prepared = prepareGame({ ...river, ...compact })
  const baseline = prepared.createSession().solveUntil({ targetEVWidth: .005, maxIterations: 4000 })
  const candidate = prepared.createSession()
  lock(candidate, { comboPercentages: { [bluff]: [0, 100] } })
  const result = candidate.solveUntil({ baseline, targetEVLossWidth: .01, adaptiveChecks: true,
    checkEvery: 5, maxCheckEvery: 40, maxIterations: 4000, finalEvaluation: 'javascript' })
  assert.equal(result.terminationReason, 'ev-loss-uncertainty')
  assert.ok(result.evLoss.width <= .01)
  assert.ok(result.evLoss.minimum <= 150 / 7 && result.evLoss.maximum >= 150 / 7)
  assert.equal(result.checkIterations.at(-1), result.iterations)
  assert.equal(result.evaluationBackend, 'javascript')
  assert.equal(candidate.solveUntil({ maxIterations: 0 }).terminationReason, 'iteration-limit')
  assert.equal(candidate.solveUntil({ maxRuntimeMs: 0 }).terminationReason, 'runtime-limit')
  assert.equal(candidate.solveUntil({ maxMemoryBytes: 1 }).terminationReason, 'memory-limit')
  const flag = new Int32Array(new SharedArrayBuffer(4))
  Atomics.store(flag, 0, 1)
  assert.equal(candidate.solveUntil({ cancelFlag: flag }).terminationReason, 'canceled')
})

test('persistent workers reuse preparation, honor weighted reservations and recover candidate rounds', async () => {
  const config = { ...river, ...compact }
  const run = id => ({ id, config, solve: { maxIterations: 15 } })
  const jobs = [run('first'), run('second')]
  const rows = await runBatch(jobs, { workers: 1 })
  assert.deepEqual(rows.map(row => row.id), ['first', 'second'])
  assert.equal(rows[1].reusedPreparation, true)
  parity(rows[0].result, rows[1].result)
  const maxMemoryBytes = process.memoryUsage.rss() + 192 * 1024 ** 2
  const estimate = Math.ceil(maxMemoryBytes * .7)
  const bounded = await runBatch(jobs.map(job => ({ ...job, estimatedMemoryBytes: estimate })),
    { workers: 2, maxMemoryBytes })
  assert.ok(bounded.every(row => row.reservedBytes === estimate && !row.error), JSON.stringify(bounded.map(row => row.error)))
  parity(bounded[0].result, rows[0].result)
  const canceled = await runBatch(jobs, { signal: AbortSignal.abort(), workers: 2 })
  assert.ok(canceled.every(row => row.terminationReason === 'canceled'))

  const directory = mkdtempSync(join(tmpdir(), 'trl-v18-tests-'))
  try {
    const job = { id: 'campaign', config, checkpointDirectory: directory, candidateRounds: [8, 10],
      solve: { maxIterations: 80 }, candidates: [
        { id: 'check', nodeLocks: [{ history: ['River'], percentages: [100, 0] }] },
        { id: 'bluff', nodeLocks: [{ history: ['River'], comboPercentages: { [bluff]: [0, 100] } }],
          eliminateAgainstIncumbent: true },
      ] }
    const [first] = await runBatch([job], { workers: 1 })
    assert.equal(first.candidates[0].rounds[1].from, 8)
    assert.equal(first.candidates[1].result.terminationReason, 'candidate-eliminated')
    const [next] = await runBatch([job], { workers: 1 })
    assert.equal(next.candidates[0].rounds[0].from, 18)
    assert.equal(next.candidates[0].rounds[1].from, 26)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
