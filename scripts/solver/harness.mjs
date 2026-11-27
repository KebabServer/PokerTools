import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'

const load = name => readFileSync(
  (name === 'source-kernel-data.js' && process.env.SOLVER_WASM_OUTPUT) ||
    new URL('../../public/turn-river-lab/' + name, import.meta.url), 'utf8',
)

export const { core, compile, codec, heuristicTester } = runInThisContext(`(() => {
  ${load('core.js')}
  ${load('compiled-traversal.js')}
  ${load('wasm-kernel-data.js')}
  ${load('source-kernel-data.js')}
  ${load('checkpoint-format.js')}
  ${load('heuristic-tester.js')}
  const core = createSolverCore();
  return {
    core,
    compile: (game, limit, preference = 'legacy') => createCompiledTraversal(game, WASM_TRAVERSAL_BYTES, limit, preference),
    codec: createCheckpointFormat(),
    heuristicTester: createHeuristicTester(core),
  }
})()`)
