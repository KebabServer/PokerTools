import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { runBatch } from '../solver/batch.mjs'

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  workers: { type: 'string' }, 'memory-mib': { type: 'string' }, 'worker-heap-mib': { type: 'string' },
} })
if (positionals.length !== 1) {
  console.error('Usage: node scripts/solve-turn-river.mjs jobs.json [--workers 2] [--memory-mib 512] [--worker-heap-mib 192]')
  process.exit(1)
}
const input = JSON.parse(readFileSync(positionals[0], 'utf8'))
const controller = new AbortController()
const interrupt = () => controller.abort()
process.once('SIGINT', interrupt)
let results
try {
  results = await runBatch(Array.isArray(input) ? input : [input], {
    workers: values.workers === undefined ? undefined : Number(values.workers),
    maxMemoryBytes: values['memory-mib'] === undefined ? undefined : Number(values['memory-mib']) * 1024 ** 2,
    workerHeapMb: values['worker-heap-mib'] === undefined ? undefined : Number(values['worker-heap-mib']),
    signal: controller.signal,
  })
} finally {
  process.off('SIGINT', interrupt)
}
console.log(JSON.stringify(results, null, 2))
if (controller.signal.aborted) process.exitCode = 130
else if (results.some(result => result.error || result.candidates?.some(candidate => candidate.error))) process.exitCode = 1
