import { performance } from 'node:perf_hooks'
import { compile, core } from './harness.mjs'

const [, , scenario='sampled-flop', precision='float64', layout='compact', backend='javascript'] = process.argv

function weightedRange(minPair,minHigh,minKicker) {
  return Float64Array.from(core.ALL_COMBOS,([a,b])=>{
    const hi=Math.max(core.rank(a),core.rank(b)),lo=Math.min(core.rank(a),core.rank(b))
    if(hi===lo)return hi>=minPair?1:0
    if(hi<minHigh||lo<minKicker)return 0
    if((a&3)===(b&3))return lo+2>=hi||hi>=12?1:.45
    return hi>=12&&lo>=9?.65:0
  })
}
function stressRange(weights) {
  return Float64Array.from(weights,(w,i)=>w&&i%5===0?w*10**(-(i%19)):0)
}
const wide0=weightedRange(7,10,7),wide1=weightedRange(5,10,6)
const flop={
  board:['As','Th','2d'],pot:100,stack:100,maxRaises:1,allIn:true,maxNodes:100_000,
  flopSizes0:[33,66],flopSizes1:[50],flopRaiseSizes0:[50],flopRaiseSizes1:[50],
  turnSizes0:[50],turnSizes1:[],sizes0:[],sizes1:[],
  flopSamplingSeed:79,flopTurnSamples:3,flopRiverSamples:4,
  weights0:wide0,weights1:wide1,
}
const river={
  ...flop,board:[...flop.board,'8h','4c'],sizes0:[50],sizes1:[75],allIn:false,maxRaises:0,
}
const cases={
  'sampled-flop':{config:flop,steps:1000,every:50},
  'exact-flop':{
    config:{...flop,flopTurnSamples:49,flopRiverSamples:48,flopSizes0:[50],flopSizes1:[],
      turnSizes0:[],turnSizes1:[],sizes0:[33],allIn:false,maxRaises:0},
    steps:40,every:8,
  },
  'locked-a':{config:river,lock:62,steps:5000,every:500},
  'locked-b':{config:river,lock:62.25,steps:5000,every:500},
  long:{
    config:{...river,pot:900_000,stack:900_000,weights0:stressRange(wide0),weights1:stressRange(wide1),
      gtoAlgorithm:'dcfr-scheduled-cubic',scheduledAveragingPower:4},
    steps:50_000,every:5000,
  },
}
const fixture=cases[scenario]
if(!fixture)throw Error('Unknown benchmark scenario '+scenario)
const steps=Number(process.env.SOLVER_PRECISION_STEPS??fixture.steps)
const every=Number(process.env.SOLVER_PRECISION_EVERY??fixture.every)
if(!Number.isSafeInteger(steps)||steps<1||!Number.isSafeInteger(every)||every<1)
  throw Error('Steps and check cadence must be positive whole numbers')
const config={...fixture.config,storageLayout:layout,storagePrecision:precision,memoryLimitBytes:1536*1048576}
if(fixture.lock!==undefined){
  const root=core.makeGame(config,{preview:true}).nodes[0]
  config.nodeLocks=[{nodeId:root.id,history:root.history,player:root.p,
    actions:root.actions.map(action=>action.label),percentages:[fixture.lock,100-fixture.lock]}]
}
const targets=[0.1,0.05,0.01]
const targetMetric=process.env.SOLVER_PRECISION_TARGET_METRIC??'exploitability'
if(!['exploitability','interval'].includes(targetMetric))throw Error('Unknown target metric')
const mib=bytes=>Number((bytes/1048576).toFixed(2))
const memory=()=>{globalThis.gc?.();return process.memoryUsage()}
const before=memory(),started=performance.now()
const game=core.makeGame(config)
if(backend==='wasm'){
  game.compiled=compile(game,config.memoryLimitBytes)
  if(!game.compiled)throw Error('This precision and layout has no native backend')
}
const solver=new core.CFRSolver(game)
const buildMs=performance.now()-started,after=memory()
const targetPercent=gap=>(targetMetric==='interval'?2:1)*100*gap/game.pot
function footprint(){
  return {scenario,precision,layout:game.numericStorage.mode,backend:game.compiled?.mode??'javascript',
    pot:game.pot,board:config.board,ranges:game.players.map(p=>p.ids.length),logicalNodes:game.nodes.length,
    stateMiB:mib(game.stateStorage.byteLength),accountedMiB:mib(game.memory),
    heapMiB:mib(after.heapUsed-before.heapUsed),externalMiB:mib(after.external-before.external),
    rssMiB:mib(after.rss-before.rss),buildMs:Math.round(buildMs)}
}
if(process.env.SOLVER_PRECISION_MEMORY_ONLY==='1'){
  // Measure the solver and its diagnostic buffers in a fresh process.
  // The separate audit game deliberately lives outside this measurement.
  for(let i=0;i<steps;i++){
    solver.step()
    if((i+1)%every===0||i+1===steps)solver.checkConvergence()
  }
  console.log(JSON.stringify({...footprint(),steps,peakRssMiB:mib(process.resourceUsage().maxRSS*1024)}))
  process.exit(0)
}
let auditGame
function independent() {
  // Reconstruct the original physical tree with Float64 state and no suit
  // grouping. Import the trained average policy, then evaluate every runout.
  auditGame??=core.makeGame({...config,treeLayout:'explicit',storagePrecision:'float64',
    storageLayout:'compact',useSuitIsomorphism:false,useRiverHandSymmetry:false})
  const policy=core.averagePolicy(game)
  policy.suitIsomorphic=false
  const value=(p,mode)=>core.rangeValue(auditGame,p,core.evaluatePolicy(auditGame,policy,p,mode))
  const locked=!!config.nodeLocks?.length,mode=locked?'constrainedBest':'best'
  const br0=value(0,mode),br1=value(1,mode),offset=game.pot/2
  const x=value(0,'profile'),y=value(1,'profile')
  return {ev:x+offset,lower:offset-br1,upper:offset+br0,zeroSumError:Math.abs(x+y),
    gap:Math.max(0,(br0+br1)/2),unrestrictedGap:locked?Math.max(0,(value(0,'best')+value(1,'best'))/2):Math.max(0,(br0+br1)/2)}
}
const wallStart=performance.now(),hits={}
let trainMs=0,checkMs=0,auditMs=0,minimumObserved=Infinity,minimumVerified=Infinity,final,convergenceAgreement=0
while(solver.iteration<steps){
  const end=Math.min(steps,solver.iteration+every)
  let mark=performance.now()
  while(solver.iteration<end)solver.step()
  trainMs+=performance.now()-mark
  mark=performance.now()
  const check=solver.checkConvergence()
  checkMs+=performance.now()-mark
  minimumObserved=Math.min(minimumObserved,check.exploitability)
  const pending=targets.filter(t=>!hits[t]&&targetPercent(check.exploitability)<=t)
  if(pending.length||end===steps){
    mark=performance.now()
    final=independent()
    auditMs+=performance.now()-mark
    if(!Object.values(final).every(Number.isFinite))throw Error('Non-finite independent evaluation')
    minimumVerified=Math.min(minimumVerified,final.gap)
    convergenceAgreement=Math.max(convergenceAgreement,Math.abs(final.gap-check.exploitability))
    for(const t of pending)if(targetPercent(final.gap)<=t)hits[t]={iteration:end,ms:Math.round(performance.now()-wallStart),gap:final.gap}
  }
}
console.log(JSON.stringify({...footprint(),steps,checkEvery:every,trainMs:Math.round(trainMs),iterationsPerSecond:1000*steps/trainMs,
  checkMs:Math.round(checkMs),auditMs:Math.round(auditMs),wallMs:Math.round(performance.now()-wallStart),
  targetMetric,hits,minimumObserved,minimumVerified,convergenceAgreement,final}))
