import { readFileSync } from 'node:fs'
import { compile, core, heuristicTester, multiFlopTester } from './harness.mjs'
import { precisionCases } from './benchmark-fixtures.mjs'

const config={...precisionCases['exact-flop'].config,storageLayout:'dense',memoryLimitBytes:512*1048576}
const candidates=JSON.parse(readFileSync(new URL('../../docs/heuristic-candidates.example.json',import.meta.url),'utf8'))
const decision=core.makeGame({...config,flopTurnSamples:1,flopRiverSamples:1},{preview:true}).nodes[0]
const collection={mode:'selected',boards:['As Th 2d','Kh Qh 7c','8c 8d 3s']}
const maxIterations=Number(process.env.SOLVER_MULTI_MAX??160)
const targetWidthPercent=Number(process.env.SOLVER_MULTI_WIDTH??.5)
globalThis.gc?.()
const startRSS=process.memoryUsage().rss
const result=await multiFlopTester.evaluate({config,candidates,collection,maxIterations,targetWidthPercent,
  selection:heuristicTester.decisionDescriptor(decision)}, {
  yieldControl:()=>new Promise(resolve=>setTimeout(resolve,0)),
  compile:(game,limit)=>{
    const kernel=compile(game,limit,'simd')
    if(!kernel?.simd)throw Error('SIMD WebAssembly is required for this benchmark')
    return kernel
  },
  onProgress:event=>{
    if(event.type==='multi-board-completed')console.error(`Completed ${event.completed}/${event.total} at ${(event.elapsedMs/1000).toFixed(2)} s`)
  },
})
const peakRSS=process.resourceUsage().maxRSS*1024
console.log(JSON.stringify({startRSS,peakRSS,maxIterations,targetWidthPercent,elapsedMs:result.elapsedMs,
  peakSolverBytes:result.peakSolverBytes,plan:result.plan,completedCoverage:result.completedCoverage,
  boards:result.completed.map(row=>({board:multiFlopTester.boardText(row.board),probability:row.probability,
    baseline:row.baseline,results:row.results})),failed:result.failed,aggregate:result.aggregate},null,2))
if(result.failed.length)process.exitCode=1
