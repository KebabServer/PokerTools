import { readFileSync, existsSync } from 'node:fs'
import { cpus, availableParallelism, release, totalmem } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { runInThisContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { realisticCases, rangeRevision } from './turn-river-realistic-cases.mjs'
import { readEngineSource, researchEngineDirectory } from '../solver/v18/assets.mjs'

const { values: options } = parseArgs({ options: {
  source: { type: 'string', default: researchEngineDirectory },
  revision: { type: 'string', default: 'working-tree' },
  suite: { type: 'string', default: 'standard' },
  repetitions: { type: 'string', default: '3' },
  case: { type: 'string' },
  backend: { type: 'string', default: 'wasm' },
  'memory-mib': { type: 'string', default: '512' },
  'max-iterations': { type: 'string' }, target: { type: 'string' }, 'target-pot-percent': { type: 'string' },
  storage: { type: 'string' }, precision: { type: 'string' }, 'all-in-runouts': { type: 'string' },
  'current-policy': { type: 'string' },
  algorithm: { type: 'string' },
  'max-nodes': { type: 'string' }, independent: { type: 'boolean' }, 'fixed-iterations': { type: 'boolean' },
  'prepare-only': { type: 'boolean' },
  'lock-mix': { type: 'string', default: '25' }, 'native-addon': { type: 'string' },
} })
const source = resolve(options.source)
const repetitions = Number(options.repetitions)
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw Error('Repetitions must be a positive integer.')
if (!['standard', 'algorithms', 'capacity', 'repeated', 'realistic'].includes(options.suite)) throw Error('Unknown benchmark suite.')
if (!['wasm', 'wasm-simd', 'native', 'javascript'].includes(options.backend)) throw Error('Unknown solver backend.')

const native = options.backend === 'native'
  ? createRequire(import.meta.url)(resolve(options['native-addon'] ?? 'solver/native/build/turn-river.node')) : null
const engineSource = readEngineSource(source)
const { core, compile } = runInThisContext(`(() => {
  ${engineSource}
  return { core: createSolverCore(), compile: (game, limit, options) => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, limit, options) }
})()`, { filename: join(source, 'benchmark-bundle.js') })

function weightedRange(categories, phase) {
  return Array.from(core.ALL_COMBOS, ([a, b], id) => {
    const index = categories?.indexOf(core.comboCategory(a, b))
    if (index === -1) return 0
    return (1 + ((index ?? id) + phase) % 7) / 7
  })
}
const narrow = [
  ['AA', 'KK', '88', '77', 'AKs', 'KQs', 'QJs', '98s'],
  ['QQ', 'JJ', 'TT', '99', 'AJs', 'KJs', 'JTs', '87s'],
]
const medium = narrow.map((list, p) => list.concat('AQo', p === 0 ? 'KJo' : 'KTo', 'QTo', 'T9o', '98o'))
const flop = { flopTurnSamples: 8, flopRiverSamples: 6, flopSamplingSeed: 29 }
const exact = { flopTurnSamples: 49, flopRiverSamples: 48 }
const oneStreet = { flopSizes0: [], flopSizes1: [], turnSizes0: [], turnSizes1: [] }
const cases = [
  { id: 'river-narrow', board: ['As', '8h', '3d', '2c', '7s'], range: narrow, stack: 80 },
  { id: 'river-wide', board: ['As', 'Ah', '3d', '2c', '7s'], stack: 400, max: 180 },
  { id: 'turn-symmetric-lock', board: ['As', '8s', '3h', '2h'], range: medium, stack: 140, lock: 'whole' },
  { id: 'turn-asymmetric-lock', board: ['As', '8s', '3h', '2h'], range: medium, stack: 140, lock: 'combo' },
  { id: 'flop-sampled', board: ['As', '8h', '3d'], range: medium, stack: 140, ...flop, max: 140 },
  { id: 'flop-sampled-locked', board: ['As', '8s', '3s'], range: narrow, stack: 240, ...flop, lock: 'combo', max: 140 },
  { id: 'flop-exact-narrow', board: ['As', '8s', '3h'], range: narrow, stack: 80, ...exact, ...oneStreet,
    sizes1: [], max: 80, target: 1.5 },
]
const capacity = [
  { id: 'exact-wide-river-bets', board: ['As', '8h', '3d'], stack: 100, ...exact, ...oneStreet, sizes1: [], max: 2 },
  { id: 'exact-wide-two-street-bets', board: ['As', '8s', '3s'], stack: 100, ...exact,
    ...oneStreet, turnSizes0: [50], sizes1: [], max: 2 },
  { id: 'exact-wide-three-street-bets', board: ['As', '8s', '3s'], stack: 100, ...exact,
    flopSizes0: [50], flopSizes1: [], turnSizes0: [50], turnSizes1: [], sizes1: [], max: 2 },
  { id: 'exact-wide-two-street-symmetric', board: ['As', '8s', '3s'], stack: 100, ...exact,
    ...oneStreet, turnSizes0: [50], sizes1: [], max: 2, symmetricWide: true },
  { id: 'exact-wide-three-street-two-sided', board: ['As', '8s', '3s'], stack: 100, ...exact,
    max: 2, maxNodes: 180_000 },
  { id: 'exact-medium-three-street-one-sided', board: ['As', '8s', '3s'], stack: 100, ...exact,
    sizes1: [], max: 2, range: medium },
  { id: 'exact-medium-three-street-two-sided', board: ['As', '8s', '3s'], stack: 100, ...exact,
    max: 2, maxNodes: 180_000, range: medium },
  { id: 'exact-medium-three-street-within-old-node-cap', board: ['As', '8s', '3s'], stack: 100, ...exact,
    max: 2, maxNodes: 100_000, range: medium },
  { id: 'flop-all-in-equity', board: ['As', '8h', '3d'], stack: 85, range: narrow, ...exact,
    ...oneStreet, sizes0: [], sizes1: [], allIn: true, max: 10 },
  { id: 'turn-all-in-equity', board: ['As', '8h', '3d', '6s'], stack: 85, range: medium,
    ...oneStreet, sizes0: [], sizes1: [], allIn: true, max: 50 },
]
const algorithms = ['cfrplus', 'dcfr', 'dcfr-scheduled', 'dcfr-scheduled-cubic', 'dcfr-adaptive',
  'dcfr-predictive', 'lcfr', 'dcfr-cubic', 'dcfr-2-0.5-2', 'optimistic']
const checkEvery = 10
const memoryLimitBytes = Number(options['memory-mib']) * 1024 ** 2
if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 2 * 1024 ** 2) throw Error('Invalid memory budget.')

function configuredBackend(cfg) {
  if (options.storage || native || options.backend === 'wasm-simd') cfg.strategyStorage = options.storage ?? 'compact'
  if (options.precision) cfg.strategyPrecision = options.precision
  if (options['all-in-runouts']) cfg.allInRunouts = options['all-in-runouts']
  if (options['current-policy']) cfg.currentPolicyStorage = options['current-policy']
  if (options['max-nodes']) cfg.maxNodes = Number(options['max-nodes'])
  return cfg
}

function configuration(c, algorithm) {
  if (c.config) return configuredBackend({ ...c.config, memoryLimitBytes, gtoAlgorithm: algorithm })
  const cfg = {
    board: c.board, pot: 100, stack: c.stack, sizes0: c.sizes0 ?? [50], sizes1: c.sizes1 ?? [66],
    maxRaises: 0, allIn: c.allIn ?? false, maxNodes: c.maxNodes ?? 100_000, memoryLimitBytes, gtoAlgorithm: algorithm,
    weights0: weightedRange(c.range?.[0], 0), weights1: weightedRange(c.range?.[1], 3),
  }
  for (const key of ['flopTurnSamples', 'flopRiverSamples', 'flopSamplingSeed',
    'flopSizes0', 'flopSizes1', 'turnSizes0', 'turnSizes1']) {
    if (key in c) cfg[key] = c[key]
  }
  if (c.symmetricWide) {
    cfg.weights0 = cfg.weights0.map((_, i) => categoryWeight(i, 0))
    cfg.weights1 = cfg.weights1.map((_, i) => categoryWeight(i, 3))
  }
  if (c.lock && c.board.length === 4) {
    cfg.weights0 = cfg.weights0.map((_, i) => weightedByCategory(i, c.range[0]))
    cfg.weights1 = cfg.weights1.map((_, i) => weightedByCategory(i, c.range[1]))
  }
  return configuredBackend(cfg)
}

function categoryWeight(id, phase) {
  const label = core.comboCategory(...core.ALL_COMBOS[id])
  const sum = [...label].reduce((n, c) => n + c.charCodeAt(0), phase)
  return (1 + sum % 7) / 7
}

function weightedByCategory(id, categories) {
  const index = categories.indexOf(core.comboCategory(...core.ALL_COMBOS[id]))
  return index < 0 ? 0 : (1 + index % 7) / 7
}

function rootLock(game, type, bet = 25, id = game.root) {
  const node = game.nodes[id]
  const entry = { nodeId: node.id, player: node.p, history: node.history, actions: node.actions.map(a => a.label) }
  const percentages = [100 - bet, bet, ...Array(node.actions.length - 2).fill(0)]
  if (type === 'whole' || type === 'cbet') return { ...entry, percentages }
  const combo = game.players[node.p].ids.find(i => core.ALL_COMBOS[i].some(card => (card & 3) === 2))
  return { ...entry, comboPercentages: { [combo]: percentages } }
}

function initialize(game) {
  if (options.backend === 'javascript') return
  game.compiled = compile(game, memoryLimitBytes, { native, simd: options.backend === 'wasm-simd' })
  if (['native', 'wasm-simd'].includes(options.backend) && !game.compiled?.sourceOnly)
    throw Error('Source-backed backend unavailable for this configuration or memory budget.')
}

function fresh(cfg) {
  const began = performance.now()
  const prepared = core.prepareGame?.(cfg)
  const prepareMs = performance.now() - began
  const created = performance.now()
  const game = prepared ? prepared.createGame(undefined, { deferState: options.backend !== 'javascript' }) : core.makeGame(cfg)
  const stateMs = performance.now() - created
  const compileStarted = performance.now()
  initialize(game)
  const wasmMs = performance.now() - compileStarted
  const solver = new core.CFRSolver(game)
  return { solver, prepareMs: prepared ? prepareMs : null, prepareAndStateMs: prepareMs + stateMs, wasmMs }
}

function run(c, algorithm, repeat, config = null, reused = null) {
  const cfg = config ?? configuration(c, algorithm)
  if (!config && c.lock) {
    const preview = core.makeGame(cfg, { preview: true })
    const nodeId = c.lock === 'cbet' ? preview.nodes[preview.root].actions[0].child : preview.root
    cfg.nodeLocks = [rootLock(preview, c.lock, Number(options['lock-mix']), nodeId)]
  }
  const began = performance.now()
  if (options['prepare-only']) {
    const prepared = core.prepareGame(cfg)
    const prepareMs = performance.now() - began
    const game = prepared.createGame(undefined, { deferState: true })
    return { id: c.id, repeat, algorithm, phase: 'prepare-only', storage: cfg.strategyStorage ?? 'dense',
      precision: cfg.strategyPrecision ?? 'f64', currentPolicy: cfg.currentPolicyStorage ?? 'stored',
      prepareMs, wallMs: performance.now() - began, structuralNodes: game.nodes.length,
      canonicalInformationSets: game.strategyRows, stateBytes: game.stateBytes ?? game.stateLength * 8,
      stateScalars: game.stateLength, memoryBytes: game.memory, immutableBytes: game.immutableBytes,
      rulesFingerprint: game.rulesFingerprint, peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      maxNodes: cfg.maxNodes, memoryLimitBytes }
  }
  let setup
  if (reused) {
    let wasmMs = 0
    reused.solver.setNodeLocks(cfg.nodeLocks, game => {
      const started = performance.now()
      initialize(game)
      wasmMs += performance.now() - started
    })
    const prepareAndStateMs = performance.now() - began - wasmMs
    const warming = performance.now()
    if (reused.mode !== 'cold-reused') reused.solver.warmStartFrom(reused.donor, { mode: reused.mode })
    setup = { solver: reused.solver, prepareAndStateMs, wasmMs, prepareMs: 0,
      warmStartMs: reused.mode === 'cold-reused' ? 0 : performance.now() - warming }
  } else setup = fresh(cfg)
  const { solver, prepareMs, prepareAndStateMs, wasmMs, warmStartMs = 0 } = setup
  const game = solver.game
  const target = options['target-pot-percent'] !== undefined ? cfg.pot * Number(options['target-pot-percent']) / 200 : Number(options.target ?? c.target ?? .25)
  const max = Number(options['max-iterations'] ?? c.max ?? 240)
  if (!Number.isFinite(target) || target < 0 || !Number.isSafeInteger(max) || max < 1)
    throw Error('Invalid target or iteration limit.')
  let stepMs = 0, checkMs = 0, checks = 0, gap, targetMs = null
  let peakObservedRssBytes = process.memoryUsage.rss()
  while (solver.iteration < max) {
    const start = performance.now()
    for (let i = Math.min(checkEvery, max - solver.iteration); i > 0; i--) solver.step()
    stepMs += performance.now() - start
    const checking = performance.now()
    gap = solver.checkConvergence()
    checkMs += performance.now() - checking
    checks++
    peakObservedRssBytes = Math.max(peakObservedRssBytes, process.memoryUsage.rss())
    if (gap.exploitability <= target) {
      targetMs ??= performance.now() - began
      if (!options['fixed-iterations']) break
    }
  }
  const summary = solver.summary()
  const wallMs = performance.now() - began
  const solvePeakRssBytes = process.resourceUsage().maxRSS * 1024
  const solveMemory = process.memoryUsage()
  const validationStart = performance.now()
  let validation = null
  if (options.independent) {
    // The v17 summary has no independent option. Disabling the bridge only
    // for evaluation lets both revisions use their Float64 JS policy reader.
    const compiled = game.compiled
    try {
      game.compiled = null
      validation = solver.summary()
    } finally {
      game.compiled = compiled
    }
  }
  const validationMs = options.independent ? performance.now() - validationStart : null
  return {
    id: c.id, repeat, algorithm, mode: reused?.mode ?? 'cold-fresh', backend: game.compiled?.mode ?? 'javascript',
    evaluationBackend: summary.evaluationBackend,
    locked: c.lock ?? null, targetExploitability: target, targetIntervalWidth: target * 2,
    reached: targetMs !== null && (validation?.constrainedExploitability ?? gap.exploitability) <= target,
    iterations: solver.iteration, targetMs,
    prepareAndStateMs, prepareMs, wasmMs, warmStartMs, stepMs, checkMs, checks,
    wallMs, ips: 1000 * solver.iteration / stepMs,
    exploitability: gap.exploitability, evIntervalWidth: gap.nashConv, profileEV: [summary.value0, summary.value1],
    equilibriumBounds: summary.equilibriumBounds?.foldZero ?? null, zeroSumError: summary.zeroSumError,
    unrestrictedBestResponseEV: summary.unrestrictedBestResponseEV?.foldZero,
    independent: validation ? { backend: validation.evaluationBackend, ms: validationMs,
      profileEV: [validation.value0, validation.value1], evIntervalWidth: validation.equilibriumBounds.width,
      equilibriumBounds: validation.equilibriumBounds.foldZero,
      unrestrictedBestResponseEV: validation.unrestrictedBestResponseEV?.foldZero } : null,
    combos: game.players.map(p => p.ids.length), stateScalars: game.stateLength ?? game.stateStorage.length,
    canonicalInformationSets: game.strategyRows ?? game.nodes.reduce((rows, node) => rows +
      (!node.terminal && !node.chance && !node.isoAlias && node.actions.length > 1 ?
        game.players[node.p].ids.filter((_, i) => (!node.valid || node.valid[node.p][i]) &&
          (!node.suitRows || node.suitRows[i] === i) && !node.lockedMask?.[i]).length : 0), 0),
    rangeFingerprint: createHash('sha256').update(JSON.stringify([Array.from(cfg.weights0), Array.from(cfg.weights1)])).digest('hex'),
    stateBytes: game.stateBytes ?? game.stateLength * 8, immutableBytes: game.immutableBytes,
    arenaBytes: game.compiled?.arenaBytes ?? game.compiled?.memory?.buffer?.byteLength,
    packedBytes: game.compiled?.packedBytes, packedNodes: game.packedNodes,
    scratchBytes: game.compiled?.scratchBytes, rowMetadataBytes: game.rowMetadataBytes,
    allInProgramCount: game.allInProgramCount, pairEquityCount: game.pairEquityCount, pairEquityBytes: game.pairEquityBytes,
    precision: cfg.strategyPrecision ?? 'f64', storage: cfg.strategyStorage ?? 'dense',
    currentPolicy: cfg.currentPolicyStorage ?? 'stored',
    allInRunouts: game.allInRunouts ?? 'explicit',
    betSizes: [cfg.flopSizes0, cfg.flopSizes1, cfg.turnSizes0, cfg.turnSizes1, cfg.sizes0, cfg.sizes1],
    maxRaises: cfg.maxRaises, allIn: cfg.allIn, sampledTurns: game.turnSamples, riversPerTurn: game.riverSamples,
    board: cfg.board, seed: cfg.flopSamplingSeed ?? null, pot: cfg.pot, stack: cfg.stack,
    memoryLimitBytes, maxNodes: cfg.maxNodes,
    stepMsPerIteration: stepMs / solver.iteration, bestResponseMsPerCheck: checkMs / checks,
    structuralNodes: game.nodes.length, canonicalDecisions: game.nodes.filter(n => !n.terminal && !n.chance && !n.isoAlias).length,
    canonicalNodes: game.suitIsomorphism.canonicalNodes ?? null,
    aliases: game.suitIsomorphism.aliasedDecisions, memoryBytes: game.memory,
    solvePeakRssBytes, solveMemory,
    peakObservedRssBytes: Math.max(peakObservedRssBytes, process.memoryUsage.rss()),
    peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
    fingerprint: core.gameSignature(game), rulesFingerprint: game.rulesFingerprint ?? null,
  }
}

function repeatedCases(repeat) {
  const casesToRepeat = [
    { ...cases[0], id: 'repeat-river', target: .08, max: 450 },
    { ...cases[2], id: 'repeat-turn', target: .2, max: 200 },
  ].filter(c => !options.case || c.id === options.case)
  const rows = []
  for (const c of casesToRepeat) {
    const cfg = configuration(c, 'dcfr')
    const sourceStart = performance.now()
    const prepared = core.prepareGame?.(cfg)
    let donor, reusable
    if (prepared) {
      const init = () => {
        const game = prepared.createGame(undefined, { deferState: options.backend !== 'javascript' })
        initialize(game)
        return new core.CFRSolver(game)
      }
      donor = init()
      reusable = init()
      for (let i = 0; i < 100; i++) donor.step()
      cfg.donorMs = performance.now() - sourceStart
    }
    const game = donor?.game ?? core.makeGame(cfg, { preview: true })
    const firstCheck = game.nodes[game.root].actions[0].child
    const modes = prepared ? (cfg.currentPolicyStorage === 'derived'
      ? ['cold-fresh', 'cold-reused', 'regret'] : ['cold-fresh', 'cold-reused', 'strategy', 'regret', 'combined']) : ['cold-fresh']
    for (const bet of [5, 25, 65]) {
      const next = { ...cfg, nodeLocks: [rootLock(game, 'whole', bet, firstCheck)] }
      // Rotate the modes across repetitions so each path sees different runtime warmup.
      const rotation = (repeat - 1) % modes.length
      for (const mode of modes.slice(rotation).concat(modes.slice(0, rotation))) {
        const row = run(c, 'dcfr', repeat, next, mode === 'cold-fresh' ? null : { solver: reusable, donor, mode })
        rows.push({ ...row, variation: bet, donorPreparationAndTrainingMs: cfg.donorMs ?? null })
      }
    }
  }
  return rows
}

const selected = (options.suite === 'capacity' ? capacity :
  options.suite === 'realistic' ? realisticCases(core) :
  options.suite === 'algorithms' ? cases.filter((_, i) => [0, 1, 2, 4, 5].includes(i)) : cases)
  .filter(c => !options.case || c.id === options.case)
const rows = []
if (options.suite === 'repeated') {
  for (let repeat = 1; repeat <= repetitions; repeat++) rows.push(...repeatedCases(repeat))
} else {
  for (const c of selected) {
      for (const algorithm of options.algorithm ? [options.algorithm] : options.suite === 'algorithms' ? algorithms : ['dcfr']) {
      for (let repeat = 1; repeat <= repetitions; repeat++) {
        global.gc?.()
        try { rows.push(run(c, algorithm, repeat)) }
        catch (error) {
          rows.push({ id: c.id, algorithm, repeat, error: error.message,
            storage: options.storage ?? 'dense', precision: options.precision ?? 'f64',
            memoryLimitBytes, maxNodes: Number(options['max-nodes'] ?? c.config?.maxNodes ?? c.maxNodes ?? 100_000),
            peakProcessRssBytes: process.resourceUsage().maxRSS * 1024 })
        }
      }
    }
  }
}
if (!rows.length) throw Error('No benchmark cases match.')
console.log(JSON.stringify({
  revision: options.revision, rangeRevision: options.suite === 'realistic' ? rangeRevision : null, suite: options.suite, repetitions, checkEvery, memoryLimitBytes,
  sourceFingerprint: createHash('sha256').update(engineSource).digest('hex'),
  node: process.version, osRelease: release(), hostMemoryBytes: totalmem(),
  cgroupMemoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : null,
  cgroupCpuLimit: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null,
  platform: process.platform, architecture: process.arch,
  cpu: cpus()[0].model, availableParallelism: availableParallelism(),
  peakRssScope: 'process high-water mark, cumulative across rows', rows,
}, null, 2))
