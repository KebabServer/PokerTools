import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values: options } = parseArgs({ options: {
  group: { type: 'string', default: 'engine' },
  'baseline-source': { type: 'string' },
  'baseline-revision': { type: 'string', default: '4f68dcc' },
  revision: { type: 'string', default: 'working-tree' },
  repetitions: { type: 'string', default: '3' },
  output: { type: 'string' },
  compiler: { type: 'string', default: 'clang-19' },
  'native-addon': { type: 'string', default: 'solver/native/build/turn-river.node' },
  'native-scalar-addon': { type: 'string' },
  'native-avx2-addon': { type: 'string' },
  'native-avx512-addon': { type: 'string' },
  mode: { type: 'string' }, case: { type: 'string' },
} })
const repetitions = Number(options.repetitions)
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw Error('Repetitions must be positive.')

const compact = ['--storage', 'compact']
const derived = [...compact, '--current-policy', 'derived']
const simd = ['--backend', 'wasm-simd']
const native = ['--backend', 'native', '--native-addon', options['native-addon']]
const modes = {
  baseline: options['baseline-source'] && ['--source', options['baseline-source'], '--revision', options['baseline-revision']],
  compact, derived, simd, native,
  'native-derived': [...native, '--current-policy', 'derived'],
  A: [...simd, '--precision', 'f32-regret'],
  B: [...simd, '--precision', 'f32-average'],
  C: [...simd, '--precision', 'f32'],
  D: [...simd, '--precision', 'scaled'],
  'explicit-scalar': [...compact, '--all-in-runouts', 'explicit'],
  'implicit-scalar': [...compact, '--all-in-runouts', 'implicit'],
  'pair-equity-scalar': [...compact, '--all-in-runouts', 'pair-equity'],
}
for (const isa of ['scalar', 'avx2', 'avx512']) {
  const addon = options['native-' + isa + '-addon']
  if (addon) modes['native-' + isa] = ['--backend', 'native', '--native-addon', addon]
}
const algorithms = ['dcfr', 'cfrplus', 'dcfr-scheduled', 'dcfr-predictive', 'dcfr-2-0.5-2']
for (const variant of algorithms) modes[variant] = [...simd, '--algorithm', variant]
const engineModes = ['baseline', 'compact', 'simd', 'native', 'native-derived']
const precisionModes = ['simd', 'A', 'B', 'C', 'D']
const allInModes = ['explicit-scalar', 'implicit-scalar', 'pair-equity-scalar']
const realistic = (id, iterations, modes, extra = []) => ({ suite: 'realistic', id, iterations, modes, extra })
const synthetic = (suite, id, iterations, modes, extra = []) => ({ suite, id, iterations, modes, extra })
const plans = {
  engine: [
    realistic('btn-bb-sampled-one', 160, engineModes),
    realistic('btn-bb-exact-river-only', 40, ['baseline', 'simd', 'native', 'native-derived']),
    realistic('btn-bb-exact-one', 10, ['baseline', 'simd', 'native-derived']),
    realistic('btn-bb-exact-one-locked', 10, ['baseline', 'native-derived']),
    realistic('btn-bb-exact-monotone-orbits', 10, ['baseline', 'native-derived']),
  ],
  precision: [
    synthetic('standard', 'river-narrow', 1800, precisionModes, ['--target-pot-percent', '.01', '--fixed-iterations']),
    realistic('btn-bb-sampled-one', 150, precisionModes, ['--fixed-iterations']),
    realistic('btn-bb-sampled-one-locked', 150, precisionModes, ['--fixed-iterations']),
  ],
  equity: [
    synthetic('capacity', 'turn-all-in-equity', 80, allInModes, ['--fixed-iterations']),
    synthetic('capacity', 'flop-all-in-equity', 10, allInModes, ['--fixed-iterations']),
  ],
  accuracy: [
    ...['1.0', '0.5', '0.1', '0.05', '0.01'].map(target =>
      realistic('btn-bb-sampled-one', 350, ['native'], ['--target-pot-percent', target])),
    realistic('btn-bb-exact-river-only', 160, ['baseline', 'native-derived'], ['--target-pot-percent', '.01']),
    realistic('btn-bb-exact-one', 160, ['baseline', 'native-derived'], ['--target-pot-percent', '.1']),
    realistic('btn-bb-exact-one-locked', 160, ['baseline', 'native-derived'], ['--target-pot-percent', '.1']),
  ],
  capacity: [
    realistic('btn-bb-exact-multi-flop', 2, ['baseline', 'native-derived']),
    realistic('btn-bb-exact-flop-raise', 2, ['native-derived'], ['--memory-mib', '1024', '--max-nodes', '500000']),
    realistic('btn-bb-exact-multi', 2, ['baseline', 'native-derived']),
    realistic('btn-bb-exact-multi', 2, ['native-derived', 'C'], ['--memory-mib', '1024', '--max-nodes', '500000']),
    realistic('btn-bb-exact-multi', 2, ['C'], ['--memory-mib', '1280', '--max-nodes', '500000']),
    realistic('btn-bb-exact-stretch', 2, ['baseline']),
    realistic('btn-bb-exact-stretch', 2, ['native-derived', 'C'], ['--memory-mib', '1536', '--max-nodes', '1000000']),
  ],
  textures: ['co-bb-sampled', 'btn-sb-sampled-3bet', 'btn-bb-sampled-3bet', 'btn-bb-sampled-4bet', 'btn-sb-sampled-4bet',
    'btn-bb-sampled-paired', 'btn-bb-sampled-double-broadway', 'btn-bb-sampled-rainbow', 'btn-bb-sampled-two-tone',
    'btn-bb-sampled-monotone', 'btn-bb-sampled-raised', 'btn-bb-sampled-later-sizes'].map(id => realistic(id, 150, ['native'])),
  algorithms: [
    synthetic('standard', 'river-narrow', 500, algorithms, ['--target-pot-percent', '.05']),
    synthetic('standard', 'turn-symmetric-lock', 300, algorithms, ['--target-pot-percent', '.1']),
    realistic('btn-bb-sampled-one', 230, algorithms),
    realistic('btn-bb-sampled-one-locked', 230, algorithms),
    synthetic('standard', 'flop-exact-narrow', 120, algorithms, ['--target-pot-percent', '.1']),
  ],
  isa: [
    realistic('btn-bb-sampled-one', 90, ['compact', 'simd', 'native', 'native-scalar', 'native-avx2', 'native-avx512']),
    realistic('btn-bb-exact-river-only', 10, ['compact', 'simd', 'native', 'native-scalar', 'native-avx2', 'native-avx512']),
  ],
}
const matrix = plans[options.group]?.map(plan => ({ ...plan,
  modes: options.mode ? plan.modes.filter(mode => mode === options.mode) : plan.modes }))
  .filter(plan => plan.modes.length && (!options.case || plan.id === options.case))
if (!matrix?.length) throw Error('Unknown benchmark group or filter.')
if (matrix.some(p => p.modes.includes('baseline')) && !modes.baseline) throw Error('Provide --baseline-source for the before revision.')
for (const mode of new Set(matrix.flatMap(plan => plan.modes))) {
  if (!mode.startsWith('native')) continue
  const addon = modes[mode]?.[3]
  if (!addon || !existsSync(addon)) throw Error('Build or provide the addon for ' + mode + '.')
}

const benchmark = fileURLToPath(new URL('./benchmark-turn-river.mjs', import.meta.url))
const rows = []
let environment
for (const [caseIndex, plan] of matrix.entries()) {
  for (let repeat = 0; repeat < repetitions; repeat++) {
    const rotation = repeat % plan.modes.length
    for (const mode of plan.modes.slice(rotation).concat(plan.modes.slice(0, rotation))) {
      const args = ['--expose-gc', benchmark, '--suite', plan.suite, '--case', plan.id, '--max-iterations',
        String(plan.iterations), '--repetitions', '1', '--revision', options.revision, '--independent', ...modes[mode], ...plan.extra]
      const output = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
      const { rows: [row], revision, sourceFingerprint, rangeRevision, suite, repetitions: _, ...host } = output
      environment ??= host
      rows.push({ ...row, caseIndex, mode, repeat: repeat + 1, revision, sourceFingerprint, rangeRevision, suite })
      process.stderr.write(`${options.group} ${plan.id} ${mode} #${repeat + 1} ${row.error ?? row.iterations + ' iterations'}\n`)
    }
  }
}

function compilerVersion(command) {
  try { return execFileSync(command, ['--version'], { encoding: 'utf8' }).split('\n')[0] } catch { return null }
}
const measured = ['prepareMs', 'wasmMs', 'stepMsPerIteration', 'bestResponseMsPerCheck', 'targetMs', 'wallMs',
  'stateBytes', 'memoryBytes', 'solvePeakRssBytes', 'peakProcessRssBytes', 'evIntervalWidth']
const summaries = matrix.flatMap((plan, caseIndex) => plan.modes.map(mode => {
  const group = rows.filter(row => row.caseIndex === caseIndex && row.mode === mode)
  const stats = Object.fromEntries(measured.flatMap(key => {
    const values = group.map(row => row[key]).filter(Number.isFinite).sort((a, b) => a - b)
    if (!values.length) return []
    const middle = Math.floor(values.length / 2)
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
    return [[key, { median, min: values[0], max: values.at(-1) }]]
  }))
  return { caseIndex, id: plan.id, mode, samples: group.length, reached: group.filter(row => row.reached).length,
    errors: group.filter(row => row.error).map(row => row.error), stats }
}))
const report = JSON.stringify({ group: options.group, repetitions, environment: {
  ...environment, peakRssScope: 'each row runs in a fresh process; RSS includes independent validation',
  wasmCompiler: compilerVersion(options.compiler), nativeCompiler: compilerVersion(process.env.CC ?? 'cc'),
}, summaries, rows }, null, 2) + '\n'
if (options.output) writeFileSync(options.output, report)
else process.stdout.write(report)
