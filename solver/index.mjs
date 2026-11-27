import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInThisContext } from 'node:vm'

const assets = new URL('../public/turn-river-lab/', import.meta.url)
const scripts = ['core.js', 'wasm-kernel-data.js', 'native-kernel-data.js', 'compiled-traversal.js', 'checkpoint-format.js']
const source = scripts.map(name => readFileSync(new URL(name, assets), 'utf8')).join('\n')
const { core, compile, checkpointFormat } = runInThisContext(`(() => {
  ${source}
  return {
    core: createSolverCore(),
    compile: (game, options) => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, game.memoryLimitBytes, options),
    checkpointFormat: createCheckpointFormat(),
  }
})()`, { filename: 'turn-river-lab-engine.js' })

export const { algorithmVersion, flopFidelities, compareEvLoss, candidateIsWorse, cardId, cardText, comboId, boardCombos } = core

export function loadGameConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function decodeCheckpoint(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : Uint8Array.from(bytes).buffer
  return checkpointFormat.decode(buffer)
}

export function prepareGame(config, { backend = 'wasm', profile = false, nativeAddon } = {}) {
  if (!['wasm', 'wasm-simd', 'native', 'javascript'].includes(backend)) throw Error('Unknown solver backend.')
  const settings = structuredClone(config)
  const sourceRequired = backend === 'native' || backend === 'wasm-simd'
  if (sourceRequired) {
    settings.strategyStorage ??= 'compact'
    if (settings.strategyStorage !== 'compact') throw Error('This backend requires compact strategy storage.')
  }
  const native = backend === 'native' ? createRequire(import.meta.url)(
    nativeAddon === undefined ? './native/build/turn-river.node' : resolve(nativeAddon)) : null
  const start = performance.now()
  const prepared = core.prepareGame(settings)
  const preparationMs = performance.now() - start
  return Object.freeze({
    rulesFingerprint: prepared.rulesFingerprint,
    immutableBytes: prepared.immutableBytes,
    preparationMs,
    createSession({ nodeLocks = settings.nodeLocks ?? [], checkpoint } = {}) {
      return new SolverSession(prepared, settings, backend, native, profile, nodeLocks, checkpoint)
    },
  })
}

class SolverSession {
  #solver
  #settings
  #backend
  #native
  #profile
  #cachedFingerprint
  #stats

  constructor(prepared, settings, backend, native, profile, nodeLocks, checkpoint) {
    this.#settings = settings
    this.#backend = backend
    this.#native = native
    this.#profile = profile
    const started = performance.now()
    const game = prepared.createGame(nodeLocks, { deferState: backend !== 'javascript' })
    this.#stats = { sessionAllocationMs: performance.now() - started, wasmInitializationMs: 0,
      lockChanges: 0, layoutChanges: 0, warmStartMs: 0 }
    this.#initializeBackend(game)
    this.#solver = checkpoint ? core.CFRSolver.resume(game, checkpoint) : new core.CFRSolver(game)
  }

  #initializeBackend(game) {
    game.profileEnabled = this.#profile
    if (this.#backend === 'javascript') return
    const started = performance.now()
    try {
      game.compiled = compile(game, { native: this.#native, simd: this.#backend === 'wasm-simd' })
    } catch (error) {
      if (this.#backend === 'native') throw error
      game.compiled = null
    }
    if (this.#backend === 'native' && !game.compiled)
      throw Error('Native arena exceeds the memory budget or engine limits.')
    this.#stats.wasmInitializationMs += performance.now() - started
  }

  get iteration() { return this.#solver.iteration }
  get rulesFingerprint() { return this.#solver.game.rulesFingerprint }
  get fingerprint() { return this.#cachedFingerprint ??= core.gameSignature(this.#solver.game) }
  get memoryBytes() { return this.#solver.game.memory }
  get statistics() { return { ...this.#stats } }

  describe() {
    const game = this.#solver.game
    return { board: game.board.map(cardText), pot: game.pot, stack: game.stack, root: game.root,
      combos: game.players.map(player => player.ids.length), structuralNodes: game.nodes.length,
      canonicalNodes: game.suitIsomorphism.canonicalNodes,
      packedNodes: game.packedNodes ?? null,
      canonicalDecisions: game.nodes.length - game.nodes.filter(n => n.terminal || n.chance || n.isoAlias).length,
      strategy: { layout: game.strategyStorage, precision: game.strategyPrecision,
        current: game.deriveCurrent ? 'derived' : 'stored', bytes: game.stateBytes,
        allocatedScalars: game.stateLength, rows: game.strategyRows ?? null },
      memory: { estimatedBytes: game.memory, immutableBytes: game.immutableBytes, rowMetadataBytes: game.rowMetadataBytes ?? 0,
        arenaBytes: game.compiled?.arenaBytes ?? game.compiled?.memory?.buffer?.byteLength ?? 0,
        packedBytes: game.compiled?.packedBytes ?? null, scratchBytes: game.compiled?.scratchBytes ?? 0 },
      allIn: { mode: game.allInRunouts, programs: game.allInProgramCount, pairEquityPrograms: game.pairEquityCount },
      symmetry: { ...game.suitIsomorphism }, sampledChance: game.sampledChance,
      runouts: { turns: game.turnSamples, riversPerTurn: game.riverSamples,
        method: game.samplingMethod, seed: game.flopSamplingSeed },
      backend: game.compiled?.mode ?? 'javascript' }
  }

  decision(id) {
    const node = this.#solver.game.nodes[id]
    if (!node || node.terminal || node.chance) return null
    return { nodeId: id, player: node.p, history: node.history.slice(), turn: node.turn ?? null,
      river: node.river ?? null, actions: node.actions.map(a => ({ ...a })) }
  }

  findDecision(history) {
    if (!Array.isArray(history)) throw Error('History must be an array of action and runout labels.')
    const game = this.#solver.game
    let node = game.nodes[game.root]
    if (history[0] !== node.history[0]) return null
    for (const label of history.slice(1)) {
      const edge = (node.chance ? node.runouts : node.actions)?.find(a => a.label === label)
      if (!edge) return null
      node = game.nodes[edge.child]
    }
    return this.decision(node.id)
  }

  makeLock(id, restriction) {
    const node = this.decision(id)
    if (!node) throw Error('Node lock requires a decision ID.')
    return { ...structuredClone(restriction), nodeId: id, player: node.player, history: node.history,
      actions: node.actions.map(a => a.label), actionTotals: node.actions.map(a => a.total) }
  }

  setNodeLocks(nodeLocks) {
    const previous = this.#solver.game
    this.#solver.setNodeLocks(nodeLocks, game => this.#initializeBackend(game))
    this.#cachedFingerprint = undefined
    this.#stats.lockChanges++
    if (this.#solver.game !== previous) this.#stats.layoutChanges++
    return this
  }

  resetSolverState() {
    this.#solver.resetSolverState()
    return this
  }

  warmStartFrom(other, options) {
    if (!(other instanceof SolverSession)) throw Error('A warm start requires a source session.')
    const start = performance.now()
    this.#solver.warmStartFrom(other.#solver, options)
    this.#stats.warmStartMs += performance.now() - start
    return this
  }

  saveCheckpoint() { return this.#solver.saveCheckpoint() }

  encodeCheckpoint() {
    return checkpointFormat.encode(this.#solver.saveCheckpoint(false), { ...this.#settings, nodeLocks: this.#solver.game.nodeLocks })
  }

  restoreCheckpoint(checkpoint) {
    this.#solver = core.CFRSolver.resume(this.#solver.game, checkpoint)
    return this
  }

  metrics(options) { return this.#solver.summary(options) }

  nodeReport(id) { return this.#solver.nodeReport(id) }

  counterfactualActionValues(id, continuation, options) {
    return this.#solver.counterfactualActionValues(id, continuation, options)
  }

  solveUntil({
    targetExploitability, targetEVWidth, targetEVLossWidth, maxIterations = 2000, checkEvery = 10, minIterations = 0,
    adaptiveChecks = false, maxCheckEvery = checkEvery * 16, finalEvaluation = 'float64',
    maxRuntimeMs, maxMemoryBytes, baseline, incumbent, hero = 0, cancelFlag,
  } = {}) {
    for (const [name, value] of Object.entries({ targetExploitability, targetEVWidth, targetEVLossWidth, maxRuntimeMs, maxMemoryBytes })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw Error('Invalid ' + name + '.')
    }
    if (!Number.isSafeInteger(maxIterations) || maxIterations < 0 ||
        !Number.isSafeInteger(checkEvery) || checkEvery < 1 ||
        !Number.isSafeInteger(minIterations) || minIterations < 0 || minIterations > maxIterations)
      throw Error('Invalid iteration or check interval budget.')
    if (typeof adaptiveChecks !== 'boolean' || adaptiveChecks &&
      (!Number.isSafeInteger(maxCheckEvery) || maxCheckEvery < checkEvery))
      throw Error('Invalid adaptive convergence schedule.')
    if (!['float64', 'javascript'].includes(finalEvaluation)) throw Error('Unknown final evaluator.')
    if (cancelFlag !== undefined && (!(cancelFlag instanceof Int32Array) ||
      !(cancelFlag.buffer instanceof SharedArrayBuffer) || !cancelFlag.length)) throw Error('Invalid cancellation flag.')
    if (targetEVLossWidth !== undefined && !baseline) throw Error('EV-loss uncertainty requires an unrestricted baseline.')
    if (hero !== 0 && hero !== 1) throw Error('Hero must be player 0 or 1.')

    const solver = this.#solver
    const game = solver.game
    const began = performance.now()
    const initialIteration = solver.iteration
    const stopIteration = initialIteration + maxIterations
    if (!Number.isSafeInteger(stopIteration)) throw Error('Iteration budget overflows the counter.')
    let solvingMs = 0, evaluationMs = 0, checks = 0, terminationReason, metrics
    let lastWidth, lastCheckIteration, nextCheck = Math.ceil(minIterations / checkEvery) * checkEvery
    const checkIterations = []
    const hasTarget = targetEVWidth !== undefined || targetExploitability !== undefined ||
      targetEVLossWidth !== undefined || !!incumbent
    let peakObservedRssBytes = process.memoryUsage.rss()
    const memoryUsed = () => {
      const rss = process.memoryUsage.rss()
      peakObservedRssBytes = Math.max(peakObservedRssBytes, rss)
      return Math.max(rss, game.memory)
    }
    const elapsed = () => performance.now() - began
    const check = (final = false) => {
      const start = performance.now()
      const latest = final ? solver.summary({ independent: finalEvaluation === 'javascript' }) :
        solver.checkConvergence({ includeUnrestricted: false })
      const cost = performance.now() - start
      evaluationMs += cost
      checks++
      checkIterations.push(solver.iteration)
      memoryUsed()
      return { latest, cost }
    }
    const targetReason = latest => {
      if (incumbent && candidateIsWorse(latest, incumbent, hero)) return 'candidate-eliminated'
      if (targetEVWidth !== undefined && latest.equilibriumBounds.width <= targetEVWidth) return 'ev-uncertainty'
      if (targetEVLossWidth !== undefined && compareEvLoss(baseline, latest, hero).width <= targetEVLossWidth)
        return 'ev-loss-uncertainty'
      if (targetExploitability !== undefined && latest.constrainedExploitability <= targetExploitability &&
        (latest.qreResidual === null || latest.qreResidual <= targetExploitability)) return 'target-exploitability'
    }
    const budgetReason = () => {
      if (cancelFlag && Atomics.load(cancelFlag, 0)) return 'canceled'
      if (maxMemoryBytes !== undefined && memoryUsed() > maxMemoryBytes) return 'memory-limit'
      if (maxRuntimeMs !== undefined && elapsed() >= maxRuntimeMs) return 'runtime-limit'
    }

    for (;;) {
      terminationReason = budgetReason()
      if (terminationReason) break

      const worked = solver.iteration - initialIteration
      const atLimit = solver.iteration === stopIteration
      if (atLimit) {
        metrics = check(true).latest
        terminationReason = worked >= minIterations && targetReason(metrics) || 'iteration-limit'
        break
      }
      if (hasTarget && worked >= nextCheck) {
        const { latest, cost } = check()
        if (targetReason(latest)) {
          metrics = check(true).latest
          terminationReason = targetReason(metrics)
          if (terminationReason) break
          metrics = undefined
        }
        let interval = checkEvery
        if (adaptiveChecks && worked > 0) {
          const width = latest.equilibriumBounds.width
          const gapTarget = Math.max(targetEVWidth ?? 0, 2 * (targetExploitability ?? 0),
            targetEVLossWidth === undefined ? 0 : Math.max(0, targetEVLossWidth - baseline.equilibriumBounds.width))
          const remaining = maxRuntimeMs === undefined ? Infinity : Math.max(0, maxRuntimeMs - elapsed())
          const stepCost = Math.max(.001, solvingMs / worked)
          const costInterval = Math.ceil(4 * cost / stepCost)
          const rate = lastWidth > width && width > 0 ? Math.log(lastWidth / width) / (worked - lastCheckIteration) : 0
          const towardTarget = gapTarget > 0 && rate > 0 && width > gapTarget ?
            Math.ceil(Math.log(width / gapTarget) / rate) : Infinity
          // Near a requested target or an incumbent, probe at the ordinary cadence.
          const near = gapTarget > 0 && width < 1.5 * gapTarget ||
            incumbent && latest.equilibriumBounds.centered[hero].upper - incumbent.equilibriumBounds.centered[hero].lower < width * .25
          if (!near) interval = Math.max(checkEvery, Math.min(maxCheckEvery, costInterval, towardTarget,
            Math.floor(remaining / stepCost / 2)))
          lastWidth = width
          lastCheckIteration = worked
        }
        nextCheck = worked + interval
        terminationReason = budgetReason()
        if (terminationReason) break
      }
      const start = performance.now()
      solver.step()
      solvingMs += performance.now() - start
    }

    if (!metrics && terminationReason !== 'canceled') metrics = check(true).latest
    const evLoss = baseline && metrics ? compareEvLoss(baseline, metrics, hero) : null
    const iterations = solver.iteration - initialIteration
    return {
      ...metrics, hero, evLoss, terminationReason, initialIteration, iterations, checks, checkIterations,
      runtimeMs: elapsed(), solvingMs, evaluationMs, iterationsPerSecond: solvingMs > 0 ? iterations * 1000 / solvingMs : 0,
      fingerprint: this.fingerprint, backend: game.compiled?.mode ?? 'javascript',
      structuralNodes: game.nodes.length, canonicalNodes: game.suitIsomorphism.canonicalNodes,
      peakObservedRssBytes, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      session: this.statistics,
    }
  }
}
