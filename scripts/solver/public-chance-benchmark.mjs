import { performance } from 'node:perf_hooks'
import { core, compile } from './harness.mjs'
import { precisionCases } from './benchmark-fixtures.mjs'

const [, , scenario='unrestricted', selection='all'] = process.argv
if(!['unrestricted','locked'].includes(scenario))throw Error('Expected unrestricted or locked')
const capMs=Number(process.env.SOLVER_CHANCE_CAP_MS??12_000)
const cadenceMs=Number(process.env.SOLVER_CHANCE_CHECK_MS??750)
const seeds=(process.env.SOLVER_CHANCE_SEEDS??'79,173,421').split(',').map(Number)
const repeats=Number(process.env.SOLVER_CHANCE_REPEATS??2)
if(![capMs,cadenceMs].every(ms=>Number.isFinite(ms)&&ms>0)||!Number.isSafeInteger(repeats)||repeats<0||
   seeds.some(seed=>!Number.isSafeInteger(seed)||seed<0||seed>2147483647))throw Error('Invalid benchmark settings')

const base={...precisionCases['exact-flop'].config,storageLayout:'dense',storagePrecision:'float64',
  useSuitIsomorphism:true,memoryLimitBytes:1024*1048576}
const locked=scenario==='locked',root=core.makeGame(base,{preview:true}).nodes[0]
const targets=[.5,.1,.05]
const strategies=[
  {name:'full',budgets:[49,48],seed:0},
  {name:'fixed-16x12',budgets:[16,12],seed:seeds[0]},
  ...[
    ['stratified',[6,6]],['stratified',[16,12]],['stratified',[32,24]],['uniform',[16,12]],
  ].flatMap(([method,budgets])=>seeds.map(seed=>({name:method+'-'+budgets.join('x'),method,budgets,seed}))),
]
function configure(mix,setting){
  const {method,seed,budgets:[flopTurnSamples,flopRiverSamples]}=setting
  return {...base,flopChanceMode:method?'dynamic':'fixed',flopSamplingMethod:method,
    flopTurnSamples,flopRiverSamples,flopSamplingSeed:seed,
    nodeLocks:locked?[{nodeId:root.id,history:root.history,player:root.p,
      actions:root.actions.map(a=>a.label),percentages:[100-mix,mix]}]:[]}
}
function build(config){
  const game=core.makeGame(config)
  game.compiled=compile(game,config.memoryLimitBytes,'simd')
  if(!game.compiled?.simd||!game.compiled.sourceBacked)throw Error('SIMD traversal unavailable')
  return game
}
function inspect(game,policy){
  const value=(p,mode)=>core.rangeValue(game,p,core.evaluatePolicy(game,policy,p,mode))
  const mode=locked?'constrainedBest':'best',br0=value(0,mode),br1=value(1,mode),offset=game.pot/2
  const unrestricted=locked?(value(0,'best')+value(1,'best'))/2:(br0+br1)/2
  return {lower:offset-br1,upper:offset+br0,widthPct:(br0+br1)*100/game.pot,
    ev:offset+value(0,'profile'),unrestricted:Math.max(0,unrestricted)}
}
function lift(game,physical){
  const key=node=>node.history.join('\u001f')
  const source=core.averagePolicy(game),strategy=core.averagePolicy(physical)
  // Same weighted ranges and legal actions. Seed missing public histories
  // with the full game's initial policy, including any applicable locks.
  const ids=new Map(physical.decisionNodes.map(node=>[key(node),node.id]))
  for(const node of game.decisionNodes){
    const id=ids.get(key(node)),prior=strategy[id]
    if(!prior||prior.length!==source[node.id].length||physical.nodes[id].p!==node.p)
      throw Error('Fixed-tree node does not correspond to the full game')
    strategy[id]=source[node.id]
  }
  return strategy
}
function exactAudit(game,physical){
  const policy=game.sampledChance?lift(game,physical):core.averagePolicy(game)
  policy.suitIsomorphic=false
  return inspect(physical,policy)
}
function assertParity(report,result){
  const error=Math.max(...[[report.oopEvBounds.lower,result.lower],[report.oopEvBounds.upper,result.upper],
    [report.unrestrictedExploitability,result.unrestricted]].map(([a,b])=>Math.abs(a-b)))
  if(!(error<1e-8))throw Error('Full Float64 reference disagreed by '+error+' chips')
  return error
}
function deterministicVisits(game){
  const memo=new Map()
  function walk(id){
    if(memo.has(id))return memo.get(id)
    const node=game.nodeAt(id),children=node.terminal?[]:node.chance?
      (node.isoGroups?.map(group=>group.representative)??node.runouts):node.actions
    let visits=1
    for(const edge of children)visits+=walk(edge.child)
    memo.set(id,visits)
    return visits
  }
  return 2*walk(game.root)
}
function solve(solver,physical){
  const game=solver.game,visits=game.publicChance?0:deterministicVisits(game)
  let trainMs=0,checkMs=0,check,audit,wall=0,parity=0
  const hits={}
  do{
    const begin=performance.now()
    do{solver.step()}while(performance.now()-begin<Math.min(cadenceMs,capMs-wall))
    trainMs+=performance.now()-begin
    const checking=performance.now()
    check=solver.checkConvergence()
    checkMs+=performance.now()-checking
    wall=trainMs+checkMs
    const newHits=targets.filter(target=>!hits[target]&&100*check.nashConv/game.pot<=target)
    if(!game.sampledChance&&(newHits.length||wall>=capMs)){
      audit=exactAudit(game,physical)
      parity=Math.max(parity,assertParity(check,audit))
      for(const target of newHits)if(audit.widthPct<=target)hits[target]={wall,iteration:solver.iteration}
    }
    if(game.sampledChance&&(newHits.length||wall>=capMs)){
      // Local exact checks signal when to re-audit the lifted policy. Only
      // the independent full-game width can qualify for the common target.
      audit=exactAudit(game,physical)
      if(audit.widthPct<=targets[0])for(const target of targets)
        if(audit.widthPct<=target&&!hits[target])hits[target]={wall,iteration:solver.iteration}
    }
  }while(wall<capMs&&!hits[targets.at(-1)]&&(!game.sampledChance||100*check.nashConv/game.pot>targets.at(-1)))
  const final=solver.summary()
  audit??=exactAudit(game,physical)
  if(!game.sampledChance){
    parity=Math.max(parity,assertParity(final,audit))
    if(Math.abs(final.value0-audit.ev)>1e-8)throw Error('Full Float64 profile EV disagreed')
  }
  const nodes=check.trainingChance?.visitedNodes??visits*solver.iteration
  return {iterations:solver.iteration,trainMs,checkMs,wall,nodes,nodesPerSecond:nodes*1000/trainMs,
    branchesPerIteration:check.trainingChance?.branchesPerIteration??null,
    localWidthPct:100*check.nashConv/game.pot,localEv:final.value0,full:audit,hits,parity}
}

for(const setting of strategies.filter(setting=>selection==='all'||selection.split(',').includes(setting.name))){
  globalThis.gc?.()
  const config=configure(38,setting),start=performance.now(),game=build(config)
  const buildMs=performance.now()-start,solver=new core.CFRSolver(game)
  const physicalSetting=strategies[0],reference=mix=>core.makeGame({...configure(mix,physicalSetting),
    storageLayout:'compact',useSuitIsomorphism:false})
  const result=solve(solver,reference(38)),rebuilds=[]
  if(locked&&(setting.name==='full'||setting.seed===seeds[0]&&['stratified-16x12','fixed-16x12'].includes(setting.name))){
    let previous=solver
    for(let n=0;n<repeats;n++){
      const mix=38+(n+1)*.25,t=performance.now(),next=build(configure(mix,setting))
      previous=core.CFRSolver.warmStart(next,previous)
      const setupMs=performance.now()-t,updated=solve(previous,reference(mix))
      rebuilds.push({mix,setupMs,...updated})
    }
  }
  console.log(JSON.stringify({scenario,...setting,buildMs,records:game.treeStorage.budgetRecords,
    combos:game.players.map(player=>player.ids.length),memoryMiB:game.memory/1048576,...result,rebuilds}))
}
