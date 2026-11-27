import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'

const load = name => readFileSync(new URL('../../public/turn-river-lab/' + name, import.meta.url), 'utf8')

export const { core, compile, codec } = runInThisContext(`(() => {
  ${load('core.js')}
  ${load('compiled-traversal.js')}
  ${load('wasm-kernel-data.js')}
  ${load('checkpoint-format.js')}
  return {
    core: createSolverCore(),
    compile: (game, limit) => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, limit),
    codec: createCheckpointFormat(),
  }
})()`)
