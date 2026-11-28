import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const researchEngineDirectory = dirname(fileURLToPath(import.meta.url))
const legacyWasm = fileURLToPath(new URL('../../public/turn-river-lab/wasm-kernel-data.js', import.meta.url))

export function readEngineSource(directory = researchEngineDirectory, { checkpoints = false } = {}) {
  const files = ['core.js', 'wasm-kernel-data.js', 'native-kernel-data.js', 'compiled-traversal.js']
  if (checkpoints) files.push('checkpoint-format.js')
  return files.flatMap(file => {
    const path = file === 'wasm-kernel-data.js' && directory === researchEngineDirectory
      ? legacyWasm : join(directory, file)
    if (file === 'native-kernel-data.js' && directory !== researchEngineDirectory && !existsSync(path)) return []
    return [readFileSync(path, 'utf8')]
  }).join('\n')
}
