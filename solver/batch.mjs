import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { candidateIsWorse, decodeCheckpoint, flopFidelities, prepareGame } from './index.mjs'

function resolveLocks(session, entries) {
  if (!Array.isArray(entries)) throw Error('Candidate nodeLocks must be an array.')
  return entries.map(entry => {
    if (entry.nodeId !== undefined) return entry
    const node = session.findDecision(entry.history)
    if (!node) throw Error('Locked decision is missing from this chance tree: ' + entry.history.join(' / '))
    return session.makeLock(node.nodeId, entry)
  })
}

function sessionBudgetCount(job) {
  const donors = job.candidates?.some(candidate => candidate.warmStart) ? 1 : 0
  const checkpoints = job.candidates?.length && (job.candidateRounds?.length > 1 || job.checkpointDirectory) ? 1 : 0
  return 1 + donors + checkpoints
}

function estimateWork(job) {
  const config = job.config
  const [turns, rivers] = config?.board?.length === 3 ? flopFidelities[config.flopFidelity ?? 'fast'] ?? [1, 1] :
    [1, config?.board?.length === 4 ? 48 : 1]
  return (job.solve?.maxIterations ?? 2000) * (config?.flopTurnSamples ?? turns) *
    (config?.flopRiverSamples ?? rivers) * (1 + (job.candidates?.length ?? 0))
}

function runJob(job, limits) {
  const began = performance.now()
  const requested = job.config.memoryLimitBytes || Infinity
  const rounds = job.candidateRounds
  if (rounds !== undefined && (!Array.isArray(rounds) || !rounds.length ||
    rounds.some(n => !Number.isSafeInteger(n) || n < 1) || !Number.isSafeInteger(rounds.reduce((a, b) => a + b, 0))))
    throw Error('Candidate rounds must be positive iteration budgets.')
  if (job.candidates?.length && job.config.nodeLocks?.length)
    throw Error('Candidate batches require an unrestricted baseline configuration.')
  const needsDonor = job.candidates?.some(candidate => candidate.warmStart)
  const perSessionBudget = limits.perJobMemoryBytes === undefined ? Infinity :
    Math.max(1, Math.floor(limits.perJobMemoryBytes / sessionBudgetCount(job)))
  const memoryLimitBytes = Math.min(requested, perSessionBudget)
  if (Atomics.load(limits.cancelFlag, 0)) return { id: job.id, terminationReason: 'canceled', result: null }
  if (limits.maxMemoryBytes !== undefined && process.memoryUsage.rss() > limits.maxMemoryBytes)
    return { id: job.id, terminationReason: 'memory-limit', result: null }

  const config = { ...job.config, memoryLimitBytes: Number.isFinite(memoryLimitBytes) ? memoryLimitBytes : 0 }
  const key = limits.maxMemoryBytes === undefined ? preparationKey(job, config) : null
  const reusedPreparation = !!key && recentPreparation?.key === key
  const prepared = reusedPreparation ? recentPreparation.prepared :
    prepareGame(config, { backend: job.backend, nativeAddon: job.nativeAddon })
  recentPreparation = key ? { key, prepared } : null
  const timing = { preparationMs: reusedPreparation ? 0 : prepared.preparationMs, reusedPreparation,
    reservedBytes: limits.perJobMemoryBytes ?? null }
  let runner = prepared.createSession()
  const solve = (session, options) => session.solveUntil({
    ...options, cancelFlag: limits.cancelFlag, maxMemoryBytes: limits.maxMemoryBytes === undefined ? options?.maxMemoryBytes :
      Math.min(limits.maxMemoryBytes, options?.maxMemoryBytes ?? Infinity),
  })

  if (!job.candidates?.length) {
    const result = solve(runner, job.solve)
    return { id: job.id, ...timing, runtimeMs: performance.now() - began, result }
  }
  const baselineSolve = { ...job.solve }
  delete baselineSolve.targetEVLossWidth
  const baseline = solve(runner, baselineSolve)
  if (baseline.terminationReason === 'canceled') return { id: job.id, ...timing, baseline, terminationReason: 'canceled' }
  let firstLocks
  try { firstLocks = resolveLocks(runner, job.candidates[0].nodeLocks) } catch { /* Report the candidate error in its round. */ }
  if (!needsDonor) runner = null
  const candidates = runCandidates(job, limits, prepared, runner, baseline, solve, rounds, firstLocks)
  return { id: job.id, ...timing, runtimeMs: performance.now() - began, baseline, candidates }
}

let recentPreparation
function preparationKey(job, config = job.config) {
  return createHash('sha256').update(JSON.stringify([job.backend ?? 'wasm', job.nativeAddon, config],
    (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value)).digest('hex')
}

function runCandidates(job, limits, prepared, runner, baseline, solve, rounds, firstLocks) {
  let session
  if (firstLocks) {
    try { session = prepared.createSession({ nodeLocks: firstLocks }) } catch { /* Isolate a failed candidate below. */ }
  }
  session ??= prepared.createSession()
  const incumbents = new Map()
  const schedules = rounds ?? [Infinity]
  const needsFiles = schedules.length > 1 || !!job.checkpointDirectory
  const temporary = needsFiles && !job.checkpointDirectory
  const directory = temporary ? mkdtempSync(join(tmpdir(), 'poker-candidates-')) : job.checkpointDirectory
  if (directory && !temporary) mkdirSync(directory, { recursive: true })
  const configKey = directory ? preparationKey(job) : null
  const states = job.candidates.map(candidate => ({ id: candidate.id, rounds: [], pending: true }))
  try {
    for (const allowance of schedules) {
      for (const [index, candidate] of job.candidates.entries()) {
        const state = states[index]
        if (!state.pending) continue
        if (Atomics.load(limits.cancelFlag, 0)) {
          state.terminationReason = 'canceled'
          continue
        }
        try {
          const key = directory ? createHash('sha256').update(JSON.stringify([job.id, configKey, index,
            candidate.id, candidate.nodeLocks])).digest('hex') : null
          const saved = directory ? join(directory, key.slice(0, 32) + '.trlc') : null
          const options = { ...job.solve, ...candidate.solve }
          const hero = options.hero ?? 0
          const incumbent = candidate.eliminateAgainstIncumbent ? incumbents.get(hero) : undefined
          if (state.result && incumbent && candidateIsWorse(state.result, incumbent, hero)) {
            state.result = { ...state.result, terminationReason: 'candidate-eliminated' }
            state.pending = false
            if (saved) rmSync(saved, { force: true })
            continue
          }
          const locks = resolveLocks(session, candidate.nodeLocks)
          session.setNodeLocks(locks)
          if (saved && existsSync(saved)) session.restoreCheckpoint(decodeCheckpoint(readFileSync(saved)).checkpoint)
          else if (candidate.warmStart) session.warmStartFrom(runner, candidate.warmStart)
          const totalBudget = options.maxIterations ?? 2000
          if (!Number.isSafeInteger(totalBudget) || totalBudget < 0) throw Error('Invalid candidate iteration budget.')
          const remaining = Math.max(0, totalBudget - session.iteration)
          const maxIterations = Math.min(allowance, remaining)
          const result = solve(session, { ...options, baseline, incumbent, maxIterations,
            minIterations: Math.min(options.minIterations ?? 0, maxIterations) })
          state.result = result
          state.rounds.push({ from: result.initialIteration, iterations: result.iterations,
            reason: result.terminationReason, width: result.equilibriumBounds?.width })
          const previous = incumbents.get(hero)
          if (result.lockPlayers?.every(p => p === hero) && (!previous ||
            result.equilibriumBounds.centered[hero].lower > previous.equilibriumBounds.centered[hero].lower))
            incumbents.set(hero, result)
          state.pending = result.terminationReason === 'iteration-limit' && session.iteration < totalBudget
          if (saved && (state.pending || (job.checkpointDirectory && result.terminationReason !== 'candidate-eliminated'))) {
            const pending = saved + '.' + process.pid + '.' + limits.workerSlot + '.tmp'
            try { writeFileSync(pending, Buffer.from(session.encodeCheckpoint())); renameSync(pending, saved) }
            finally { rmSync(pending, { force: true }) }
          } else if (saved) rmSync(saved, { force: true })
        } catch (error) {
          state.error = error.message
          state.terminationReason = /memory budget/.test(error.message) ? 'memory-limit' : 'error'
          state.pending = false
        }
      }
    }
  } finally {
    if (temporary) rmSync(directory, { recursive: true, force: true })
  }
  return states.map(({ pending, rounds: history, ...state }) => rounds ? { ...state, rounds: history } : state)
}

function request(worker, message) {
  return new Promise((resolve, reject) => {
    const onMessage = result => { cleanup(); resolve(result) }
    const onError = error => { cleanup(); reject(error) }
    const onExit = code => onError(Error('Solver worker exited with code ' + code))
    function cleanup() {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    try { worker.postMessage(message) } catch (error) { onError(error) }
  })
}

export async function runBatch(jobs, { workers = availableParallelism(), maxMemoryBytes, workerHeapMb, signal } = {}) {
  if (!Array.isArray(jobs)) throw Error('Jobs must be an array.')
  if (!Number.isSafeInteger(workers) || workers < 1) throw Error('Workers must be a positive integer.')
  for (const value of [maxMemoryBytes, workerHeapMb])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw Error('Invalid worker memory budget.')

  if (signal !== undefined && !(signal instanceof AbortSignal)) throw Error('Signal must be an AbortSignal.')
  if (!jobs.length) return []
  const workerCount = Math.min(workers, jobs.length, availableParallelism())
  const results = new Array(jobs.length)
  const cancelFlag = new Int32Array(new SharedArrayBuffer(4))
  const cancel = () => Atomics.store(cancelFlag, 0, 1)
  const checkpointScopes = new Set()
  const queue = jobs.map((job, index) => {
    if (!job || typeof job !== 'object') throw Error('Invalid batch job.')
    if (job.checkpointDirectory) {
      const scope = JSON.stringify([job.checkpointDirectory, job.id, preparationKey(job)])
      if (checkpointScopes.has(scope)) throw Error('Checkpointed jobs need distinct job IDs per configuration and directory.')
      checkpointScopes.add(scope)
    }
    if (job.estimatedMemoryBytes !== undefined &&
      (!Number.isSafeInteger(job.estimatedMemoryBytes) || job.estimatedMemoryBytes < 1))
      throw Error('Invalid estimated job memory.')
    if (job.estimatedWork !== undefined && (!Number.isFinite(job.estimatedWork) || job.estimatedWork < 0))
      throw Error('Invalid estimated job work.')
    let reserve = 0
    if (maxMemoryBytes !== undefined) {
      const configBudget = job.config?.memoryLimitBytes
      const defaultReserve = configBudget > 0 ? configBudget * sessionBudgetCount(job) :
        Math.max(1, Math.floor(maxMemoryBytes / workerCount))
      reserve = Math.min(maxMemoryBytes, job.estimatedMemoryBytes ?? defaultReserve)
    }
    return { index, key: preparationKey(job), work: job.estimatedWork ?? estimateWork(job),
      reserve }
  }).sort((a, b) => b.work - a.work || a.index - b.index)
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const slots = Array.from({ length: workerCount }, (_, id) => ({ id, worker: null, key: null }))
  const active = new Map()
  let reserved = 0
  try {
    while (queue.length || active.size) {
      if (Atomics.load(cancelFlag, 0)) {
        for (const { index } of queue) results[index] = { id: jobs[index].id, terminationReason: 'canceled' }
        queue.length = 0
      }
      for (const slot of slots) {
        if (active.has(slot.id)) continue
        const affordable = item => maxMemoryBytes === undefined || item.reserve + reserved <= maxMemoryBytes
        let next = slot.key ? queue.findIndex(item => item.key === slot.key && affordable(item)) : -1
        if (next < 0) next = queue.findIndex(affordable)
        if (next < 0) continue
        const [{ index, key, reserve }] = queue.splice(next, 1)
        reserved += reserve
        const task = async () => {
          try {
            const job = jobs[index]
            const attempts = job.checkpointDirectory ? 2 : 1
            for (let attempt = 1; attempt <= attempts; attempt++) {
              try {
                slot.worker ??= new Worker(new URL(import.meta.url), { execArgv: [],
                  resourceLimits: workerHeapMb === undefined ? undefined : { maxOldGenerationSizeMb: workerHeapMb } })
                results[index] = await request(slot.worker, { job, limits: { maxMemoryBytes, cancelFlag,
                  perJobMemoryBytes: reserve || undefined, workerSlot: slot.id } })
                if (attempt > 1) results[index].workerAttempts = attempt
                slot.key = key
                break
              } catch (error) {
                if (slot.worker) await slot.worker.terminate()
                slot.worker = slot.key = null
                if (attempt === attempts || Atomics.load(cancelFlag, 0)) {
                  results[index] = { id: job.id, error: error.message }
                  break
                }
              }
            }
          } finally {
            reserved -= reserve
            active.delete(slot.id)
          }
        }
        active.set(slot.id, Promise.resolve().then(task))
      }
      if (active.size) await Promise.race(active.values())
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await Promise.all(slots.map(slot => slot.worker?.terminate()))
  }
  return results
}

// Each fidelity and seed has its own baseline and comparable candidate bounds.
export function runFlopValidation({
  config, candidates, fidelities = ['fast', 'intermediate', 'high', 'exact'], seeds = [0, 1, 2], solve, backend, nativeAddon,
  candidateRounds, estimatedMemoryBytes,
}, limits) {
  if (config?.board?.length !== 3 || config.nodeLocks?.length)
    throw Error('Flop validation requires an unlocked three-card starting game.')
  if (!Array.isArray(fidelities) || !fidelities.length || !Array.isArray(seeds) || !seeds.length ||
      !Array.isArray(candidates) || !candidates.length)
    throw Error('Flop validation requires fidelities, seeds and candidates.')
  const jobs = []
  for (const fidelity of fidelities) {
    const { name, turns, riversPerTurn } = typeof fidelity === 'string' ? { name: fidelity } : fidelity
    if (!Object.hasOwn(flopFidelities, name)) throw Error('Unknown flop fidelity: ' + name)
    const [defaultTurns, defaultRivers] = flopFidelities[name]
    const turnSamples = turns ?? defaultTurns, riverSamples = riversPerTurn ?? defaultRivers
    const seedsForGame = turnSamples === 49 && riverSamples === 48 ? [seeds[0]] : seeds
    for (const seed of seedsForGame) jobs.push({
      id: name + ':' + seed,
      config: { ...config, flopFidelity: name, flopTurnSamples: turnSamples, flopRiverSamples: riverSamples,
        flopSamplingMethod: config.flopSamplingMethod ?? 'uniform', flopSamplingSeed: seed },
      solve, backend, nativeAddon, candidates, candidateRounds, estimatedMemoryBytes,
    })
  }
  return runBatch(jobs, limits)
}

if (!isMainThread) {
  parentPort.on('message', ({ job, limits }) => {
    try { parentPort.postMessage(runJob(job, limits)) }
    catch (error) {
      parentPort.postMessage({ id: job?.id, error: error.message,
        terminationReason: /memory budget/.test(error.message) ? 'memory-limit' : 'error' })
    }
  })
}
