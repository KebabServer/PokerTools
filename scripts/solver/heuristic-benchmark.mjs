import { readFileSync } from 'node:fs'
import { compile, heuristicTester } from './harness.mjs'
import { precisionCases } from './benchmark-fixtures.mjs'

const config={...precisionCases['exact-flop'].config,storageLayout:'dense',memoryLimitBytes:512*1048576}
const candidates=JSON.parse(readFileSync(new URL('../../docs/heuristic-candidates.example.json',import.meta.url),'utf8'))
const trials=Number(process.env.SOLVER_HEURISTIC_TRIALS??2)
const maxIterations=Number(process.env.SOLVER_HEURISTIC_MAX??500)
const targetWidthPercent=Number(process.env.SOLVER_HEURISTIC_WIDTH??.1)
if(!Number.isSafeInteger(trials)||trials<1)throw Error('Choose a positive number of benchmark trials')

for(let trial=0;trial<trials;trial++){
  const modes=trial%2?['warm','cold']:['cold','warm']
  for(const initialization of modes){
    globalThis.gc?.()
    const result=await heuristicTester.evaluateStudy({config,selection:0,candidates,maxIterations,targetWidthPercent,initialization},
      {compile:(game,limit)=>{
        const kernel=compile(game,limit,'simd')
        if(!kernel?.simd)throw Error('SIMD WebAssembly is required for this benchmark')
        return kernel
      }})
    console.log(JSON.stringify({trial:trial+1,initialization,targetWidthPercent,evaluationGame:result.evaluationGame,
      totalMs:result.elapsedMs,baseline:result.baseline,results:result.results}))
  }
}
