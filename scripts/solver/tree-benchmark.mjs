import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { core, compile } from './harness.mjs'

const [, , suite='capacity', name='jam', layout='packed', backend='wasm', operator='auto'] = process.argv
const mib = bytes => Number((bytes/1048576).toFixed(2))
const rankWeights = (minPair,minHigh,minKicker) => Float64Array.from(core.ALL_COMBOS,([a,b])=>{
  const hi=Math.max(core.rank(a),core.rank(b)),lo=Math.min(core.rank(a),core.rank(b))
  if(hi===lo)return hi>=minPair?1:0
  const suited=(a&3)===(b&3)
  if(hi<minHigh||lo<minKicker)return 0
  if(suited)return lo+2>=hi||hi>=12?1:.45
  return hi>=12&&lo>=9?.65:0
})
const root = {
  board:['As','Th','2d'], pot:100, stack:85, maxRaises:1, allIn:true,
  sizes0:[], sizes1:[], turnSizes0:[], turnSizes1:[], flopSizes0:[], flopSizes1:[],
  flopTurnSamples:49, flopRiverSamples:48, maxNodes:100_000, gtoAlgorithm:'dcfr',
  weights0:rankWeights(7,10,7), weights1:rankWeights(5,10,6),
  storageLayout:'dense', memoryLimitBytes:Number(process.env.SOLVER_TREE_MEMORY_MIB??1024)*1048576,
}
const cases={
  jam:{},
  'one-size':{flopSizes0:[33]},
  'multi-size':{flopSizes0:[33,65],flopSizes1:[50]},
  'turn-pressure':{flopSizes0:[33,65],flopSizes1:[50],turnSizes0:[50]},
  'full-multisize':{flopSizes0:[33,65],flopSizes1:[50],turnSizes0:[33,65],turnSizes1:[50],
    sizes0:[50],sizes1:[50],stack:150},
}
const gc = () => { globalThis.gc?.(); return process.memoryUsage() }
function delta(before,after) {
  return {heapMiB:mib(after.heapUsed-before.heapUsed),externalMiB:mib(after.external-before.external),
    rssMiB:mib(after.rss-before.rss)}
}
function engine(){
  const files=process.env.SOLVER_BASELINE_DIRECTORY
  if(!files)return {core,compile}
  const load = file => readFileSync(files+'/'+file,'utf8')
  return runInThisContext(`(() => {
    ${load('core.js')}
    ${load('compiled-traversal.js')}
    ${load('wasm-kernel-data.js')}
    return {core:createSolverCore(),compile:(game,limit)=>createCompiledTraversal(game,WASM_TRAVERSAL_BYTES,limit)}
  })()`)
}
const E=engine()
function measureGame(config){
  const before=gc(),start=performance.now()
  const game=E.core.makeGame({...config,treeLayout:layout,allInEvaluation:layout==='explicit'?'auto':operator})
  if(backend==='wasm'){
    game.compiled=E.compile(game,config.memoryLimitBytes)
    if(!game.compiled?.fullTraversal)throw Error('Native full traversal did not fit the memory budget')
  }
  const buildMs=performance.now()-start,after=gc()
  return {game,metrics:{
    logical:game.nodes.length,treeRecords:game.treeStorage?.budgetRecords??game.nodes.length,
    linkSlots:game.treeStorage?.physicalSlots??game.nodes.length,
    nativeRecords:game.compiled?.treeRecords??(game.compiled?game.nodes.length:null),
    ranges:game.players.map(player=>player.ids.length),accountedMiB:mib(game.memory),
    ...delta(before,after),buildMs:Math.round(buildMs),
    selectedMatrixKiB:Number(((game.allInOperators?.bytes??0)/1024).toFixed(2))
  }}
}
function capacity(){
  const {game,metrics}=measureGame({...root,...cases[name]})
  const solver=new E.core.CFRSolver(game)
  const target=Number(process.env.SOLVER_TREE_TARGET??2)
  const max=Number(process.env.SOLVER_TREE_STEPS??20)
  const started=performance.now()
  let check=solver.checkConvergence()
  do {
    solver.step()
    if(solver.iteration%2===0||solver.iteration===max)check=solver.checkConvergence()
  }while(solver.iteration<max&&check.exploitability>target)
  const solveMs=performance.now()-started
  return {...metrics,target,hit:check.exploitability<=target,gap:check.exploitability,iterations:solver.iteration,
    solveMs:Math.round(solveMs),oopEV:solver.summary().value0}
}
function kernels(){
  // Narrow is an exact all-in subtree for weighted subsets of the two ranges.
  // Wide uses the full ranges fed to the capacity benchmark.
  const narrow=weights=>{
    let picked=0
    return Float64Array.from(weights,(w,i)=>w&&i%3===0&&picked++<12?w:0)
  }
  const board=name.endsWith('turn')?[...root.board,'8c']:root.board
  const {game,metrics}=measureGame({...root,board,
    weights0:name.startsWith('wide')?root.weights0:narrow(root.weights0),weights1:name.startsWith('wide')?root.weights1:narrow(root.weights1)})
  const [jam]=game.nodes[0].actions.filter(action=>action.type==='bet')
  const allIn=game.nodes[jam.child].actions.find(action=>action.type==='call').child
  const node=game.nodes[allIn],mode=node.allInSpan?.plan?.mode??'explicit'
  const repetitions=Number(process.env.SOLVER_KERNEL_REPEATS??(mode==='ondemand'&&name.startsWith('wide')?3:60))
  const priors=game.players[1].priors
  const compute=()=>E.core.traverseCfr(game,allIn,0,priors)
  const firstStart=performance.now(),first=compute(),firstMs=performance.now()-firstStart
  const start=performance.now()
  let checksum=0
  for(let i=0;i<repetitions;i++)checksum+=compute()[0]
  return {...metrics,mode,firstMs:Number(firstMs.toFixed(3)),msPerCall:Number(((performance.now()-start)/repetitions).toFixed(4)),
    repetitions,operatorMatrixKiB:Number(((node.allInSpan?.plan.matrix?.byteLength??0)/1024).toFixed(2)),firstCfv:first[0],checksum}
}
const context={suite,name,layout,backend,operator,baseline:!!process.env.SOLVER_BASELINE_DIRECTORY}
try {
  if(suite==='preview'){
    const game=E.core.makeGame({...root,...cases[name],treeLayout:layout},{preview:true})
    console.log(JSON.stringify({...context,accountedMiB:mib(game.memory),...game.treeStorage,logical:game.nodes.length}))
  }else console.log(JSON.stringify({...context,...(suite==='kernels'?kernels():capacity())}))
} catch(error) {
  console.log(JSON.stringify({...context,error:error.message}))
  process.exitCode=1
}
