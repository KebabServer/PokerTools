import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const clang = process.env.SOLVER_CLANG || 'clang-19'
const check = process.argv.includes('--check')
const autoOnly = process.argv.includes('--autovector-only')
const outputPath = process.env.SOLVER_WASM_OUTPUT
if (autoOnly && !outputPath) throw Error('Set SOLVER_WASM_OUTPUT for the experimental auto-vectorized build')
const scratch = mkdtempSync(join(tmpdir(), 'pokertools-wasm-'))
const source = fileURLToPath(new URL('./wasm/traversal.c', import.meta.url))
const output = outputPath || new URL('../../public/turn-river-lab/source-kernel-data.js', import.meta.url)
try {
  const artifacts = [
    ['WASM_SOURCE_SCALAR', ['-mno-simd128']],
    ['WASM_SOURCE_SIMD', ['-msimd128', ...(autoOnly ? ['-DPOKERTOOLS_AUTOVECTOR_ONLY'] : [])]],
  ]
  const lines = artifacts.map(([name, flags]) => {
    const file = join(scratch, name + '.wasm')
    execFileSync(clang, ['--target=wasm32', '-O3', '-std=c11', '-ffreestanding', '-nostdlib',
      '-fno-fast-math', '-ffp-contract=off', '-fuse-ld=lld', ...flags,
      '-Wl,--no-entry,--import-memory,--initial-memory=131072,-z,stack-size=65536,--strip-all',
      source, '-o', file], { stdio: 'inherit' })
    const bytes = readFileSync(file)
    // Scalar output is also validated with SIMD disabled in parity testing.
    if (!WebAssembly.validate(bytes)) throw Error('Invalid WebAssembly build for ' + name)
    return `const ${name} = '${bytes.toString('base64')}';`
  })
  const text = ['/* Generated from scripts/solver/wasm/traversal.c by build-wasm.mjs. */', ...lines, ''].join('\n')
  if (check) {
    if (readFileSync(output, 'utf8') !== text) throw Error('Committed WebAssembly is out of date')
  } else writeFileSync(output, text)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
