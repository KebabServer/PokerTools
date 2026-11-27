import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { availableParallelism, cpus, release } from 'node:os'
import { parseArgs } from 'node:util'
import { runInThisContext } from 'node:vm'
import { runBatch } from '../solver/batch.mjs'
import { rangeRevision, realisticCases } from './turn-river-realistic-cases.mjs'

const { values: options } = parseArgs({ options: {
  backend: { type: 'string', default: 'wasm-simd' },
  repetitions: { type: 'string', default: '3' },
  workers: { type: 'string', default: '2' },
  'max-iterations': { type: 'string', default: '170' },
} })
const integers = ['repetitions', 'workers', 'max-iterations'].map(name => Number(options[name]))
if (integers.some(n => !Number.isSafeInteger(n) || n < 1)) throw Error('Provide positive benchmark budgets.')
const [repetitions, workers, maxIterations] = integers
const source = readFileSync(new URL('../public/turn-river-lab/core.js', import.meta.url), 'utf8')
const core = runInThisContext(source + '\ncreateSolverCore()')
const { config } = realisticCases(core).find(c => c.id === 'btn-bb-sampled-one')
const { pot } = config
const targetEVWidth = pot * .001
const cases = [29, 103].map(seed => ({
  id: 'btn-bb:' + seed,
  estimatedMemoryBytes: 192 * 1024 ** 2,
  config: { ...config, strategyStorage: 'compact', flopSamplingSeed: seed },
  backend: options.backend,
  solve: { hero: 1, targetEVWidth, maxIterations },
  candidates: [25, 50, 75, 100].map(bet => ({
    id: 'bet-' + bet,
    nodeLocks: [{ history: ['Flop', 'Check'], percentages: [100 - bet, bet] }],
  })),
}))
const firstRound = Math.max(1, Math.floor(maxIterations * .15))
const secondRound = Math.max(1, Math.floor(maxIterations * .25))
const rounds = [firstRound, secondRound, Math.max(1, maxIterations - firstRound - secondRound)]
const rows = []
const total = (records, metric) => records.reduce((sum, record) => sum + (record[metric] ?? 0), 0)

for (let repeat = 0; repeat < repetitions; repeat++) {
  for (const parallelism of new Set([1, workers])) {
    for (const staged of repeat % 2 ? [true, false] : [false, true]) {
      const jobs = staged ? cases.map(job => ({
        ...job,
        candidateRounds: rounds,
        solve: { ...job.solve, adaptiveChecks: true },
        candidates: job.candidates.map(candidate => ({ ...candidate, eliminateAgainstIncumbent: true })),
      })) : cases
      const began = performance.now()
      const results = await runBatch(jobs, { workers: parallelism, maxMemoryBytes: 1024 ** 3 })
      const wallMs = performance.now() - began
      const summaries = results.map(job => {
        if (job.error) return { id: job.id, error: job.error }
        const candidates = job.candidates.map(({ id, error, rounds, result }) => {
          if (error) return { id, error }
          return {
            id, rounds, reason: result.terminationReason, baselineWidth: job.baseline.equilibriumBounds.width,
            iterations: rounds ? total(rounds, 'iterations') : result.iterations, resumedAt: result.initialIteration,
            bound: result.equilibriumBounds.foldZero[1], evLoss: result.evLoss, checks: result.checks,
            backend: result.backend, fingerprint: result.fingerprint,
          }
        })
        const bestLower = Math.max(...candidates.filter(c => c.bound).map(c => c.bound.lower))
        const feasibleBest = candidates.filter(c => c.bound?.upper >= bestLower).map(c => c.id)
        return { id: job.id, rulesFingerprint: job.baseline.rulesFingerprint, candidates, feasibleBest }
      })
      rows.push({ repeat: repeat + 1, staged, workers: parallelism, wallMs,
        candidateIterations: total(summaries.flatMap(job => job.candidates ?? []), 'iterations'),
        eliminated: summaries.flatMap(job => job.candidates ?? []).filter(c => c.reason === 'candidate-eliminated').length,
        peakProcessRssBytes: process.resourceUsage().maxRSS * 1024, jobs: summaries })
    }
  }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch,
  osRelease: release(), cpu: cpus()[0].model, availableParallelism: availableParallelism(), backend: options.backend,
  rangeRevision, rangeFingerprint: createHash('sha256').update(JSON.stringify(
    [Array.from(config.weights0), Array.from(config.weights1)])).digest('hex'),
  seeds: cases.map(job => job.config.flopSamplingSeed), targetEVWidth, startingPot: pot, maxIterations, rounds,
  peakRssScope: 'process high-water mark across benchmark rows', rows }, null, 2))
