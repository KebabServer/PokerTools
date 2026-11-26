import { availableParallelism } from 'node:os'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { flopFidelities, prepareGame } from './index.mjs'

function resolveLocks(session, entries) {
  if (!Array.isArray(entries)) throw Error('Candidate nodeLocks must be an array.')
  return entries.map(entry => {
    if (entry.nodeId !== undefined) return entry
    const node = session.findDecision(entry.history)
    if (!node) throw Error('Locked decision is missing from this chance tree: ' + entry.history.join(' / '))
    return session.makeLock(node.nodeId, entry)
  })
}

function runJob(job, limits) {
  const began = performance.now()
  const requested = job.config.memoryLimitBytes || Infinity
  const sessions = job.candidates?.length ? 2 : 1
  const perSessionBudget = limits.perJobMemoryBytes === undefined ? Infinity :
    Math.max(1, Math.floor(limits.perJobMemoryBytes / sessions))
  const memoryLimitBytes = Math.min(requested, perSessionBudget)
  if (limits.maxMemoryBytes !== undefined && process.memoryUsage.rss() > limits.maxMemoryBytes)
    return { id: job.id, terminationReason: 'memory-limit', result: null }

  const prepared = prepareGame({ ...job.config, memoryLimitBytes: Number.isFinite(memoryLimitBytes) ? memoryLimitBytes : 0 },
    { backend: job.backend })
  const runner = prepared.createSession()
  const solve = (session, options) => session.solveUntil({
    ...options, maxMemoryBytes: limits.maxMemoryBytes === undefined ? options?.maxMemoryBytes :
      Math.min(limits.maxMemoryBytes, options?.maxMemoryBytes ?? Infinity),
  })

  if (!job.candidates?.length) {
    const result = solve(runner, job.solve)
    return { id: job.id, preparationMs: prepared.preparationMs, runtimeMs: performance.now() - began, result }
  }
  const baseline = solve(runner, job.solve)
  const candidates = []
  const session = prepared.createSession()
  let incumbent = null
  for (const candidate of job.candidates) {
    try {
      session.setNodeLocks(resolveLocks(session, candidate.nodeLocks))
      if (candidate.warmStart) session.warmStartFrom(runner, candidate.warmStart)
      const result = solve(session, { ...job.solve, ...candidate.solve, baseline,
        incumbent: candidate.eliminateAgainstIncumbent ? incumbent : undefined })
      if (result.lockPlayers.every(p => p === result.hero) && (!incumbent ||
          (incumbent.hero === result.hero && result.equilibriumBounds.centered[result.hero].lower >
            incumbent.equilibriumBounds.centered[incumbent.hero].lower))) incumbent = result
      candidates.push({ id: candidate.id, result })
    } catch (error) {
      candidates.push({ id: candidate.id, error: error.message,
        terminationReason: /memory budget/.test(error.message) ? 'memory-limit' : 'error' })
    }
  }
  return { id: job.id, preparationMs: prepared.preparationMs, runtimeMs: performance.now() - began, baseline, candidates }
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

export async function runBatch(jobs, { workers = availableParallelism(), maxMemoryBytes, workerHeapMb } = {}) {
  if (!Array.isArray(jobs)) throw Error('Jobs must be an array.')
  if (!Number.isSafeInteger(workers) || workers < 1) throw Error('Workers must be a positive integer.')
  for (const value of [maxMemoryBytes, workerHeapMb])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw Error('Invalid worker memory budget.')

  const workerCount = Math.min(workers, jobs.length, availableParallelism())
  const results = new Array(jobs.length)
  let next = 0
  const limits = { maxMemoryBytes, perJobMemoryBytes: maxMemoryBytes === undefined ? undefined :
    Math.max(1, Math.floor(maxMemoryBytes / Math.max(1, workerCount))) }

  async function drain() {
    let worker
    try {
      while (next < jobs.length) {
        const index = next++
        try {
          worker ??= new Worker(new URL(import.meta.url), {
            execArgv: [],
            resourceLimits: workerHeapMb === undefined ? undefined : { maxOldGenerationSizeMb: workerHeapMb },
          })
          results[index] = await request(worker, { job: jobs[index], limits })
        } catch (error) {
          if (worker) await worker.terminate()
          worker = undefined
          results[index] = { id: jobs[index]?.id, error: error.message }
        }
      }
    } finally {
      if (worker) await worker.terminate()
    }
  }

  await Promise.all(Array.from({ length: workerCount }, drain))
  return results
}

// Each fidelity and seed has its own baseline and comparable candidate bounds.
export function runFlopValidation({
  config, candidates, fidelities = ['fast', 'intermediate', 'high', 'exact'], seeds = [0, 1, 2], solve, backend,
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
      solve, backend, candidates,
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
