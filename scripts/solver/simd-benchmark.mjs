import { performance } from 'node:perf_hooks'
import { Session } from 'node:inspector/promises'
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { core, compile } from './harness.mjs'
import { precisionCases, pairedTurn, fixedRiver } from './benchmark-fixtures.mjs'

const [, , fixture='sampled-flop', layout='dense', precision='float64', backends='legacy,scalar,simd'] = process.argv
const locked=fixture.startsWith('locked-')
const scenario=fixture.replace(/^locked-/,'')
const cases={
  river:{config:fixedRiver,steps:500,every:10},
  turn:{config:pairedTurn,steps:240,every:8},
  'sampled-flop':{...precisionCases['sampled-flop'],steps:500,every:10},
  'exact-flop':{...precisionCases['exact-flop'],steps:80,every:8},
}
const selected=cases[scenario]
if(!selected)throw Error('Unknown benchmark fixture: '+fixture)
const maximum=Number(process.env.SOLVER_SIMD_STEPS??selected.steps)
const cadence=selected.every
const trials=Number(process.env.SOLVER_BENCH_TRIALS??3)
const target=Number(process.env.SOLVER_SIMD_TARGET??0.05)
const repeat=locked?Number(process.env.SOLVER_SIMD_REBUILDS??0):0
if(![maximum,trials,cadence].every(x=>Number.isSafeInteger(x)&&x>0)||
   !Number.isFinite(target)||target<0||!Number.isSafeInteger(repeat)||repeat<0)
  throw Error('Invalid benchmark settings')
const mib=bytes=>+(bytes/1048576).toFixed(2)
const baseConfig={...selected.config,storageLayout:layout,storagePrecision:precision,memoryLimitBytes:1024*1048576}
const root=core.makeGame(baseConfig,{preview:true}).nodes[0]
const lockedConfig=mix=>{
  const rest=(100-mix)/(root.actionCount-1)
  return {...baseConfig,nodeLocks:[{nodeId:root.id,history:root.history,player:root.p,
    actions:root.actions.map(a=>a.label),percentages:[mix,...Array(root.actionCount-1).fill(rest)]}]}
}
const config=locked?lockedConfig(62):baseConfig
const baselineDirectory=process.env.SOLVER_BASELINE_DIRECTORY
const baselineFile=file=>readFileSync(baselineDirectory+'/'+file,'utf8')
const original=baselineDirectory?runInThisContext(`(() => {
  ${baselineFile('core.js')}
  ${baselineFile('compiled-traversal.js')}
  ${baselineFile('wasm-kernel-data.js')}
  return {core:createSolverCore(),compile:(game,limit)=>createCompiledTraversal(game,WASM_TRAVERSAL_BYTES,limit)}
})()`):null
function newGame(cfg,pref){
  const game=(pref==='original'?original.core:core).makeGame(cfg)
  if(pref==='original'){
    game.compiled=original.compile(game,cfg.memoryLimitBytes)
    if(game.compiled)game.compiled.backend='Previous '+(game.compiled.simd?'SIMD128 WASM':'WASM')
  }else if(pref!=='javascript'){
    game.compiled=compile(game,cfg.memoryLimitBytes,pref)
    if(['scalar','simd'].includes(pref)&&!game.compiled?.sourceBacked)
      throw Error('Source-backed traversal unavailable for '+pref)
  }
  return game
}
let audit
function compare(game,summary){
  audit??=core.makeGame({...config,storageLayout:'compact',storagePrecision:'float64',
    useSuitIsomorphism:false,useRiverHandSymmetry:false})
  const policy=core.averagePolicy(game)
  policy.suitIsomorphic=false
  const value=(p,mode)=>core.rangeValue(audit,p,core.evaluatePolicy(audit,policy,p,mode))
  const mode=locked?'constrainedBest':'best'
  const br0=value(0,mode),br1=value(1,mode),offset=game.pot/2
  const unrestricted=locked?(value(0,'best')+value(1,'best'))/2:(br0+br1)/2
  const expected=[offset+value(0,'profile'),Math.max(0,(br0+br1)/2),offset-br1,offset+br0,Math.max(0,unrestricted)]
  const actual=[summary.value0,summary.exploitability,summary.oopEvBounds.lower,summary.oopEvBounds.upper,
    summary.unrestrictedExploitability??summary.exploitability]
  const discrepancy=Math.max(...expected.map((v,i)=>Math.abs(v-actual[i])))
  if(!(discrepancy<=1e-8))throw Error('Float64 independent evaluation disagreed by '+discrepancy)
  return discrepancy
}
function solve(solver){
  let train=0,checkMs=0,check
  const started=performance.now()
  while(solver.iteration<maximum){
    const batch=Math.min(cadence,maximum-solver.iteration)
    const t=performance.now()
    for(let i=0;i<batch;i++)solver.step()
    train+=performance.now()-t
    const checking=performance.now()
    check=solver.checkConvergence()
    checkMs+=performance.now()-checking
    if(solver.iteration>=20&&check.exploitability<=target)break
  }
  return {train,checkMs,wall:performance.now()-started,hit:check.exploitability<=target}
}
function rebuild(solver,pref){
  if(!repeat)return null
  const start=performance.now()
  let hits=0
  for(let i=0;i<repeat;i++){
    const game=newGame(lockedConfig(62+(i+1)*.25),pref)
    solver=(pref==='original'?original.core:core).CFRSolver.warmStart(game,solver)
    const result=solve(solver)
    hits+=Number(result.hit)
  }
  return {hits,solvesPerSecond:1000*hits/(performance.now()-start)}
}
if(!original&&backends.split(',').includes('original'))throw Error('Set SOLVER_BASELINE_DIRECTORY for the original backend')
const totalSamples={}
function collect(profile){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node.callFrame]))
  profile.samples.forEach((id,i)=>{
    const n=nodes.get(id),tag=n.functionName||n.url.slice(-40)||'(anonymous)'
    totalSamples[tag]=(totalSamples[tag]??0)+(profile.timeDeltas[i]??0)/1000
  })
}
for(let trial=0;trial<trials;trial++){
  const order=backends.split(',')
  for(const pref of trial%2?order.reverse():order){
    globalThis.gc?.()
    const before=process.memoryUsage(),started=performance.now()
    const game=newGame(config,pref)
    const Engine=pref==='original'?original.core:core
    const solver=new Engine.CFRSolver(game)
    const buildMs=performance.now()-started
    globalThis.gc?.()
    const rssMiB=mib(process.memoryUsage().rss-before.rss)
    let inspector
    if(process.env.SOLVER_SIMD_PROFILE==='1'){
      inspector=new Session()
      inspector.connect()
      await inspector.post('Profiler.setSamplingInterval',{interval:100})
      await inspector.post('Profiler.enable')
      await inspector.post('Profiler.start')
    }
    const result=solve(solver)
    if(inspector){
      const {profile}=await inspector.post('Profiler.stop')
      collect(profile)
      inspector.disconnect()
    }
    const final=solver.summary(),auditError=trial===0?compare(game,final):null
    const repeated=rebuild(solver,pref)
    console.log(JSON.stringify({fixture,layout,precision,pref,trial,backend:final.backend??game.compiled?.backend??'JavaScript',target,
      ranges:game.players.map(p=>p.ids.length),nodes:game.nodes.length,accountedMiB:mib(final.memoryBytes),rssMiB,
      iterations:solver.iteration,hit:result.hit,gap:final.exploitability,unrestricted:final.unrestrictedExploitability??final.exploitability,
      ev:final.value0,bounds:final.oopEvBounds,auditError,
      trainMs:result.train,checkMs:result.checkMs,wallMs:result.wall,buildMs,
      ips:solver.iteration*1000/result.train,repeated}))
  }
}
if(Object.keys(totalSamples).length)
  console.log(JSON.stringify({profile:Object.entries(totalSamples).sort((a,b)=>b[1]-a[1]).slice(0,18)}))
