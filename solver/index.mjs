import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'

const assets = new URL('../public/turn-river-lab/', import.meta.url)
const scripts = ['core.js', 'wasm-kernel-data.js', 'native-kernel-data.js', 'compiled-traversal.js', 'checkpoint-format.js']
const source = scripts.map(name => readFileSync(new URL(name, assets), 'utf8')).join('\n')
const { core, compile, checkpointFormat } = runInThisContext(`(() => {
  ${source}
  return {
    core: createSolverCore(),
    compile: game => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, game.memoryLimitBytes),
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

export function prepareGame(config, { backend = 'wasm', profile = false } = {}) {
  if (!['wasm', 'javascript'].includes(backend)) throw Error('Backend must be wasm or javascript.')
  const settings = structuredClone(config)
  const start = performance.now()
  const prepared = core.prepareGame(settings)
  const preparationMs = performance.now() - start
  return Object.freeze({
    rulesFingerprint: prepared.rulesFingerprint,
    immutableBytes: prepared.immutableBytes,
    preparationMs,
    createSession({ nodeLocks = settings.nodeLocks ?? [], checkpoint } = {}) {
      return new SolverSession(prepared, settings, backend, profile, nodeLocks, checkpoint)
    },
  })
}

class SolverSession {
  #solver
  #settings
  #backend
  #profile
  #cachedFingerprint
  #stats

  constructor(prepared, settings, backend, profile, nodeLocks, checkpoint) {
    this.#settings = settings
    this.#backend = backend
    this.#profile = profile
    const started = performance.now()
    const game = prepared.createGame(nodeLocks, { deferState: backend === 'wasm' })
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
      game.compiled = compile(game)
    } catch {
      game.compiled = null
    }
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
      canonicalDecisions: game.nodes.length - game.nodes.filter(n => n.terminal || n.chance || n.isoAlias).length,
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
    return checkpointFormat.encode(this.saveCheckpoint(), { ...this.#settings, nodeLocks: this.#solver.game.nodeLocks })
  }

  restoreCheckpoint(checkpoint) {
    this.#solver = core.CFRSolver.resume(this.#solver.game, checkpoint)
    return this
  }

  metrics() { return this.#solver.summary() }

  nodeReport(id) { return this.#solver.nodeReport(id) }

  counterfactualActionValues(id, continuation) {
    return this.#solver.counterfactualActionValues(id, continuation)
  }

  solveUntil({
    targetExploitability, targetEVWidth, maxIterations = 2000, checkEvery = 10, minIterations = 0,
    maxRuntimeMs, maxMemoryBytes, baseline, incumbent, hero = 0,
  } = {}) {
    for (const [name, value] of Object.entries({ targetExploitability, targetEVWidth, maxRuntimeMs, maxMemoryBytes })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw Error('Invalid ' + name + '.')
    }
    if (!Number.isSafeInteger(maxIterations) || maxIterations < 0 ||
        !Number.isSafeInteger(checkEvery) || checkEvery < 1 ||
        !Number.isSafeInteger(minIterations) || minIterations < 0 || minIterations > maxIterations)
      throw Error('Invalid iteration or check interval budget.')
    if (hero !== 0 && hero !== 1) throw Error('Hero must be player 0 or 1.')

    const solver = this.#solver
    const game = solver.game
    const began = performance.now()
    const initialIteration = solver.iteration
    const stopIteration = initialIteration + maxIterations
    if (!Number.isSafeInteger(stopIteration)) throw Error('Iteration budget overflows the counter.')
    let solvingMs = 0, evaluationMs = 0, checks = 0, terminationReason
    let peakObservedRssBytes = process.memoryUsage.rss()
    const memoryUsed = () => {
      const rss = process.memoryUsage.rss()
      peakObservedRssBytes = Math.max(peakObservedRssBytes, rss)
      return Math.max(rss, game.memory)
    }
    const elapsed = () => performance.now() - began
    const check = (final = false) => {
      const start = performance.now()
      const metrics = final ? solver.summary() : solver.checkConvergence({ includeUnrestricted: false })
      evaluationMs += performance.now() - start
      checks++
      memoryUsed()
      return metrics
    }

    for (;;) {
      if (maxMemoryBytes !== undefined && memoryUsed() > maxMemoryBytes) terminationReason = 'memory-limit'
      else if (maxRuntimeMs !== undefined && elapsed() >= maxRuntimeMs) terminationReason = 'runtime-limit'
      if (terminationReason) break

      const worked = solver.iteration - initialIteration
      if (worked >= minIterations && (worked % checkEvery === 0 || solver.iteration === stopIteration) &&
          (targetEVWidth !== undefined || targetExploitability !== undefined || incumbent)) {
        const latest = check()
        if (incumbent && candidateIsWorse(latest, incumbent, hero)) terminationReason = 'candidate-eliminated'
        else if (targetEVWidth !== undefined && latest.equilibriumBounds.width <= targetEVWidth)
          terminationReason = 'ev-uncertainty'
        else if (targetExploitability !== undefined && latest.constrainedExploitability <= targetExploitability &&
          (latest.qreResidual === null || latest.qreResidual <= targetExploitability))
          terminationReason = 'target-exploitability'
      }
      if (terminationReason) break
      if (solver.iteration >= stopIteration) { terminationReason = 'iteration-limit'; break }
      const start = performance.now()
      solver.step()
      solvingMs += performance.now() - start
    }

    const metrics = check(true)
    const evLoss = baseline ? compareEvLoss(baseline, metrics, hero) : null
    const iterations = solver.iteration - initialIteration
    return {
      ...metrics, hero, evLoss, terminationReason, initialIteration, iterations, checks,
      runtimeMs: elapsed(), solvingMs, evaluationMs, iterationsPerSecond: solvingMs > 0 ? iterations * 1000 / solvingMs : 0,
      fingerprint: this.fingerprint, backend: game.compiled?.mode ?? 'javascript',
      structuralNodes: game.nodes.length, canonicalNodes: game.suitIsomorphism.canonicalNodes,
      peakObservedRssBytes, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      session: this.statistics,
    }
  }
}
