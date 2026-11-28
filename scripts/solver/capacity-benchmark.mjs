import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { core, compile } from './harness.mjs'

const [, , fixture = 'single', mode = 'plan', scope = 'wide'] = process.argv
const baseline = process.env.SOLVER_BASELINE_DIRECTORY
const MiB = 1048576
const mib = bytes => Number((bytes / MiB).toFixed(2))
const elapsed = start => Number((performance.now() - start).toFixed(1))

// 100bb BTN open to 2.5bb, BB calls, SB folds. Approximate action
// frequencies by hand class and keep weights uniform across its suits.
const btn = {
  1: '22 33 44 55 66 77 88 99 TT JJ QQ KK AA A2s A3s A4s A5s A6s A7s A8s A9s ATs AJs AQs AKs K5s K6s K7s K8s K9s KTs KJs KQs Q8s Q9s QTs QJs J8s J9s JTs T8s T9s 97s 98s 86s 87s 76s 65s 54s A9o ATo AJo AQo AKo KTo KJo KQo QTo QJo JTo',
  0.6: 'K2s K3s K4s Q5s Q6s Q7s J7s T7s 96s 85s 75s 64s 53s 43s A5o A6o A7o A8o K9o Q9o J9o T9o',
  0.25: 'Q3s Q4s J6s 95s 74s 63s A2o A3o A4o K8o Q8o J8o T8o 98o',
}
const bb = {
  1: '22 33 44 55 66 77 A6s A7s A8s A9s K5s K6s K7s K8s K9s Q5s Q6s Q7s Q8s Q9s J6s J7s J8s J9s T6s T7s T8s T9s 95s 96s 97s 98s 85s 86s 87s 74s 75s 76s 64s 65s 53s 54s 43s A8o A9o K9o KTo Q9o QTo J9o JTo T8o T9o 98o',
  0.6: '88 99 TT ATs AJs K2s K3s K4s KTs KJs Q3s Q4s QTs QJs J4s J5s JTs T5s 94s 84s 73s 63s 52s 42s 32s A2o A3o A4o A5o A6o A7o ATo AJo K7o K8o KJo Q8o QJo J8o 87o 76o 65o 54o',
  0.25: 'JJ A2s A3s A4s A5s AQs KQs Q2s J3s T4s 93s 83s 72s 62s AQo K5o K6o KQo Q7o J7o T7o 97o 86o 75o',
}
function weights(classes) {
  const result = new Float64Array(1326)
  for (const [weight, hands] of Object.entries(classes)) {
    for (const hand of hands.split(' ')) for (const id of core.CATEGORY_IDS[hand]) result[id] = Number(weight)
  }
  return result
}
const wide = [weights(bb), weights(btn)]
const narrow = [weights({ 1: 'T9s 88', 0.5: 'KQs 76s' }), weights({ 1: 'AQs JJ', 0.5: 'AJo 65s' })]
const ranges = scope === 'wide' ? wide : narrow
const cases = {
  single: { flopSizes1: [33], sizes1: [75] },
  'two-size': { flopSizes1: [33, 75], sizes1: [75] },
  'multi-street': { flopSizes1: [33, 75], turnSizes1: [50], sizes1: [50, 100] },
  'flop-raise': { flopSizes1: [33, 75], turnSizes1: [40, 85], sizes1: [50, 100], maxRaises: 1, flopRaiseSizes0: [75] },
  raises: { flopSizes1: [33, 75], turnSizes1: [50, 100], sizes1: [50, 100],
    maxRaises: 1, flopRaiseSizes0: [75], turnRaiseSizes0: [75], raiseSizes0: [100] },
  'raise-heavy': { flopSizes1: [25, 60], turnSizes0: [33], turnSizes1: [50, 100], sizes0: [50], sizes1: [50, 100],
    maxRaises: 1, flopRaiseSizes0: [75], turnRaiseSizes0: [75], raiseSizes0: [100] },
  'near-million': { flopSizes1: [25, 60], turnSizes0: [33], turnSizes1: [50, 100], sizes0: [50, 125], sizes1: [50, 100],
    maxRaises: 1, flopRaiseSizes0: [75], turnRaiseSizes0: [75], raiseSizes0: [100] },
  'deep-raises': { flopSizes1: [25, 60], turnSizes0: [33], turnSizes1: [50, 100], sizes0: [50], sizes1: [50, 100],
    maxRaises: 2, flopRaiseSizes0: [60], flopRaiseSizes1: [60], turnRaiseSizes0: [60], turnRaiseSizes1: [60],
    raiseSizes0: [75], raiseSizes1: [75] },
}
if (!cases[fixture] || !['plan','prepare','solve','locked'].includes(mode) || !['wide','narrow'].includes(scope))
  throw Error('Usage: capacity-benchmark.mjs <fixture> <plan|prepare|solve|locked> <wide|narrow>')
const budget = Number(process.env.SOLVER_CAPACITY_MIB ?? 4096) * MiB
const config = {
  board: (process.env.SOLVER_CAPACITY_BOARD ?? 'As 8s 3s').split(' '),
  pot: 550, stack: 9750, weights0: ranges[0], weights1: ranges[1],
  flopTurnSamples: 49, flopRiverSamples: 48,
  flopSizes0: [], flopSizes1: [], turnSizes0: [], turnSizes1: [], sizes0: [], sizes1: [],
  flopRaiseSizes0: [], flopRaiseSizes1: [], turnRaiseSizes0: [], turnRaiseSizes1: [], raiseSizes0: [], raiseSizes1: [],
  maxRaises: 0, allIn: true, useSuitIsomorphism: true, gtoAlgorithm: 'dcfr',
  storageLayout: 'compact', storagePrecision: 'float64',
  memoryLimitBytes: budget, preparationLimitBytes: budget,
  maxNodes: Number(process.env.SOLVER_CAPACITY_RECORDS ?? (baseline ? 100_000 : 1_000_000)),
  ...cases[fixture],
}
const engine = baseline ? runInThisContext(`(() => {
  ${['core.js','compiled-traversal.js','wasm-kernel-data.js','source-kernel-data.js']
    .map(file => readFileSync(baseline + '/' + file, 'utf8')).join('\n')}
  return {core: createSolverCore(), compile: (game, limit) => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, limit, 'auto')};
})()`) : { core, compile: (game, limit) => compile(game, limit, 'auto') }

const context = { fixture, mode, scope, baseline: !!baseline, board: config.board, maxRecords: config.maxNodes }
const start = performance.now()
try {
  if (mode === 'locked') {
    // The first IP flop decision after BB checks, with a mixed c-bet.
    const probe = engine.core.makeGame({ ...config, flopTurnSamples: 1, flopRiverSamples: 1 }, { preview: true })
    const decision = probe.nodes[probe.nodes[probe.root].actions[0].child]
    config.nodeLocks = [{ nodeId: decision.id, player: decision.p, history: decision.history,
      actions: decision.actions.map(action => action.label), percentages: decision.actions.length === 3 ? [50, 50, 0] : [50, 25, 25, 0] }]
  }
  globalThis.gc?.()
  const initialRss = process.memoryUsage().rss
  if (mode === 'plan' && !baseline) {
    console.log(JSON.stringify({ ...context, ...core.makeGame(config, { capacityOnly: true }), planMs: elapsed(start) }))
  } else {
    const game = engine.core.makeGame(config, { preview: mode === 'plan' })
    const treeMs = elapsed(start), wasmStart = performance.now(), treeMemory = process.memoryUsage()
    const treePeakMiB = mib(process.resourceUsage().maxRSS * 1024 - initialRss)
    if (mode !== 'plan') {
      game.compiled = engine.compile(game, budget)
      if (!game.compiled?.fullTraversal) throw Error('Full WASM traversal did not fit the requested budget.')
    }
    const wasmMs = elapsed(wasmStart)
    const metrics = {
      logical: game.nodes.length, records: game.treeStorage.budgetRecords, physicalSlots: game.treeStorage.physicalSlots,
      nativeRows: game.compiled?.treeRecords, ranges: game.players.map(player => player.ids.length),
      engineMiB: mib(game.memory), strategyMiB: mib(game.stateStorage?.byteLength ?? game.numericStorage.stateBytes),
      wasmMiB: mib(game.compiled?.memory.buffer.byteLength ?? 0),
      planPeakMiB: game.capacity ? mib(game.capacity.peakBytes) : undefined,
      treeMs, wasmMs, treeHeapMiB: mib(treeMemory.heapUsed), treePeakMiB,
      preparePeakMiB: mib(process.resourceUsage().maxRSS * 1024 - initialRss),
      wasmHeapMiB: mib(process.memoryUsage().heapUsed),
    }
    if (mode === 'solve' || mode === 'locked') {
      const solver = new engine.core.CFRSolver(game)
      const steps = Number(process.env.SOLVER_CAPACITY_STEPS ?? 12)
      const target = Number(process.env.SOLVER_CAPACITY_TARGET ?? 5) * game.pot / 100
      const training = performance.now()
      let check, checkMs = 0
      for (let i = 0; i < steps; i++) {
        solver.step()
        if (i % 2 === 1 || i + 1 === steps) {
          const started = performance.now()
          check = solver.checkConvergence()
          checkMs += performance.now() - started
          if (check.exploitability <= target) break
        }
      }
      const solveMs = elapsed(training), summary = solver.summary()
      Object.assign(metrics, { steps: solver.iteration, target, reached: check.exploitability <= target,
        solveMs, checkMs, msPerIteration: (solveMs - checkMs) / solver.iteration,
        ev: summary.value0, bounds: summary.oopEvBounds, gap: summary.exploitability,
        unrestrictedGap: summary.unrestrictedExploitability,
        solvePeakMiB: mib(process.resourceUsage().maxRSS * 1024 - initialRss) })
    }
    console.log(JSON.stringify({ ...context, ...metrics }))
  }
} catch (error) {
  console.log(JSON.stringify({ ...context, error: error.message, ...error.capacity, elapsedMs: elapsed(start) }))
  process.exitCode = 1
}
