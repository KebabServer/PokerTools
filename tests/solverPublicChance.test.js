import assert from 'node:assert/strict'
import test from 'node:test'
import { core, compile, codec } from '../scripts/solver/harness.mjs'

const hand=(a,b)=>core.comboId(core.cardId(a),core.cardId(b))
function range(hands){
  const weights=new Float64Array(1326)
  for(const [a,b,w] of hands)weights[hand(a,b)]=w
  return weights
}
const base={
  board:['As','7s','2s'],pot:100,stack:45,maxRaises:0,allIn:true,maxNodes:100000,
  flopSizes0:[50],flopSizes1:[],turnSizes0:[],turnSizes1:[],sizes0:[30],sizes1:[],
  weights0:range(['s','h','d','c'].map(s=>['K'+s,'Q'+s,s==='s'?1:.7])),
  weights1:range(['s','h','d','c'].map(s=>['J'+s,'T'+s,s==='s'?.4:1])),
  storageLayout:'compact',flopChanceMode:'dynamic',flopTurnSamples:7,flopRiverSamples:6,flopSamplingSeed:141,
}
function near(a,b,eps=1e-9){assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b} by more than ${eps}`)}
function make(config,backend='javascript'){
  const game=core.makeGame(config)
  if(backend!=='javascript'){
    game.compiled=compile(game,config.memoryLimitBytes,backend)
    assert.ok(game.compiled?.sourceBacked)
    assert.equal(game.compiled.mode,backend==='scalar'?'wasm-scalar':'wasm-simd128')
  }
  return game
}
function step(solver,count){for(let n=0;n<count;n++)solver.step();return solver}
function solve(config,backend,count){return step(new core.CFRSolver(make(config,backend)),count)}
function minmax(report){return [report.value0,report.exploitability,report.unrestrictedExploitability,
  report.oopEvBounds.lower,report.oopEvBounds.upper,report.zeroSumError]}
function compare(a,b,eps){minmax(a).forEach((value,i)=>near(value,minmax(b)[i],eps))}
function lock(node,restriction){return {nodeId:node.id,history:node.history,
  player:node.p,actions:node.actions.map(action=>action.label),...restriction}}

test('public draws are repeatable and preserve joint blocker-weighted expectations',()=>{
  // Use a small ordered chance tree with two blocked cards per private hand.
  // All legal pairs get 1/(8×7), once both private hands have been removed.
  const all=Array.from({length:12},(_,i)=>i),turnAllowed=t=>![0,3,7,10].includes(t)
  const payoff=(t,r)=>((t+3)*(r+7)%13)/8
  let expected=0
  for(const t of all.filter(turnAllowed))for(const r of all.filter(r=>r!==t&&turnAllowed(r)))
    expected+=payoff(t,r)/(8*7)
  for(const method of ['uniform','stratified']){
    const first=core.drawPublicChance(12,3,method,321,1,0,52)
    assert.deepEqual(core.drawPublicChance(12,3,method,321,1,0,52),first)
    assert.notDeepEqual(core.drawPublicChance(12,3,method,321,2,0,52).indices,first.indices)
    let estimate=0
    const hits=new Uint32Array(12),trials=8000
    for(let iteration=1;iteration<=trials;iteration++){
      const turns=core.drawPublicChance(12,3,method,321,iteration,0,52)
      assert.equal(new Set(turns.indices.subarray(0,3)).size,3)
      for(let ti=0;ti<turns.count;ti++){
        const t=turns.indices[ti],tw=turns.multipliers[ti]*turns.scale
        hits[t]+=tw
        if(!turnAllowed(t))continue
        const rest=all.filter(r=>r!==t)
        const rivers=core.drawPublicChance(rest.length,4,method,321,iteration,0,t)
        assert.equal(new Set(rivers.indices.subarray(0,4)).size,4)
        for(let ri=0;ri<rivers.count;ri++){
          const r=rest[rivers.indices[ri]],rw=rivers.multipliers[ri]*rivers.scale
          if(turnAllowed(r))estimate+=tw*rw*payoff(t,r)/(8*7)
        }
      }
    }
    hits.forEach(count=>near(count/trials,1,.055))
    near(estimate/trials,expected,.02)
  }
})

test('full budgets reproduce deterministic DCFR including flop and turn all-ins',()=>{
  const config={...base,flopTurnSamples:49,flopRiverSamples:48}
  const staticConfig={...config,flopChanceMode:'fixed',flopSamplingSeed:0}
  const exact=solve(staticConfig,'simd',7),reference=exact.summary()
  const simd=solve(config,'simd',7),js=solve(config,'javascript',7)
  for(const solver of [simd,js]){
    compare(solver.summary(),reference)
    assert.equal(core.gameSignature(solver.game,true),core.gameSignature(exact.game,true))
    assert.ok(solver.game.allInSpans.some(span=>span.street==='deal-turn'))
    assert.ok(solver.game.allInSpans.some(span=>span.street==='deal-river'))
    assert.ok(solver.game.suitIsomorphism.enabled)
    assert.ok(solver.game.numericStorage.orbitRows>0)
    assert.ok(solver.game.publicChance.last.every(t=>t===7))
  }
  assert.deepEqual(simd.summary().trainingChance,js.summary().trainingChance)
  assert.equal(reference.evaluationGame,'full-flop')
  assert.equal(solve({...base,flopChanceMode:'fixed'},'simd',1).summary().evaluationGame,'fixed-sampled-flop')
})

test('sampled training retains dormant strategies and exact full-game diagnostics with node locks',()=>{
  const config={...base,turnSizes0:[25],sizes0:[],allIn:false}
  const preview=core.makeGame(config,{preview:true}),root=preview.nodes[0]
  const turnDeal=preview.nodes[preview.nodes[root.actions[0].child].actions[0].child]
  const turn=preview.nodes[turnDeal.runouts.find(x=>x.card===core.cardId('8h')).child]
  const flopResponse=preview.nodes[root.actions[1].child]
  const locks=[lock(root,{percentages:[62,38]}),lock(flopResponse,{percentages:[25,75]}),
    lock(turn,{comboPercentages:{[hand('Kh','Qh')]:[27,73]}})]
  const restricted={...config,nodeLocks:locks},solver=solve(restricted,'simd',1)
  const {game}=solver
  assert.ok(game.publicChance.last.some(t=>t===0))
  assert.ok(game.publicChance.last.some(t=>t===1))
  assert.ok(game.suitIsomorphism.enabled)
  assert.ok(game.suitIsomorphism.groupSize<6)
  const dormant=game.decisionNodes.find(n=>n.chanceClock!==undefined&&game.publicChance.last[n.chanceClock]===0)
  const strategy=core.averagePolicy(game),probs=strategy[dormant.id]
  for(let off=0;off<probs.length;off+=dormant.actionCount){
    const row=probs.subarray(off,off+dormant.actionCount)
    assert.ok(row.every(p=>p>=0&&p<=1));near(row.reduce((a,b)=>a+b,0),1)
  }
  step(solver,17)
  const scalar=solve(restricted,'scalar',18),js=solve(restricted,'javascript',18)
  const summary=solver.summary(),check=solver.checkConvergence()
  for(const other of [scalar,js]){
    compare(other.summary(),summary)
    assert.deepEqual(other.summary().trainingChance,summary.trainingChance)
  }
  const physical=make({...restricted,flopChanceMode:'fixed',flopTurnSamples:49,flopRiverSamples:48,useSuitIsomorphism:false})
  const expanded=core.averagePolicy(game)
  expanded.suitIsomorphic=false
  const value=(p,mode)=>core.rangeValue(physical,p,core.evaluatePolicy(physical,expanded,p,mode))
  const b0=value(0,'constrainedBest'),b1=value(1,'constrainedBest')
  near(summary.exploitability,(b0+b1)/2)
  near(summary.oopEvBounds.lower,50-b1)
  near(summary.oopEvBounds.upper,50+b0)
  near(summary.value0,50+value(0,'profile'))
  near(summary.unrestrictedExploitability,(value(0,'best')+value(1,'best'))/2)
  assert.ok(summary.oopEvBounds.lower<=summary.value0&&summary.value0<=summary.oopEvBounds.upper)
  assert.deepEqual(check.trainingChance,summary.trainingChance)
  assert.equal(check.evaluationGame,'full-flop')
  const after=samePolicyWithNewLocks(restricted,solver,locks.slice(0,2))
  assert.equal(after.game.suitIsomorphism.groupSize,6)
  assert.ok(after.game.publicChance.last.every(t=>t===0))
  step(after,2)
  assert.ok(after.summary().trainingChance.visitedBranches>0)
})

function samePolicyWithNewLocks(config,previous,nextLocks){
  const next={...config,nodeLocks:nextLocks,flopTurnSamples:11,flopSamplingSeed:325}
  return core.CFRSolver.warmStart(make(next,'scalar'),previous)
}

test('all precision modes preserve seeded checkpoint continuation on scalar and SIMD',()=>{
  for(const [i,storagePrecision] of Object.keys(core.storagePrecisions).entries()){
    const config={...base,storagePrecision,flopSamplingMethod:i%2?'uniform':'stratified'}
    const solver=solve(config,'simd',5),checkpoint=solver.saveCheckpoint()
    const decoded=codec.decode(codec.encode(checkpoint,config))
    assert.deepEqual(decoded.checkpoint.publicChance,checkpoint.publicChance)
    const resumed=core.CFRSolver.resume(make(decoded.config,'scalar'),decoded.checkpoint)
    const reference=solve(config,'javascript',9)
    step(solver,4);step(resumed,4)
    assert.deepEqual(resumed.saveCheckpoint().storage,solver.saveCheckpoint().storage)
    assert.deepEqual(resumed.saveCheckpoint().publicChance,solver.saveCheckpoint().publicChance)
    compare(solver.summary(),reference.summary(),3e-6)
    if(i===0){
      assert.throws(()=>core.CFRSolver.resume(make({...config,flopSamplingSeed:999}),checkpoint),/does not match/)
      assert.throws(()=>core.CFRSolver.resume(make(config),{...checkpoint,publicChance:undefined}),/public chance checkpoint/)
    }
  }
})

test('small dynamic budgets reduce visits and remain on dynamic JS for grids',()=>{
  const full=solve({...base,storageLayout:'dense',flopTurnSamples:49,flopRiverSamples:48},'simd',2)
  const less=solve({...base,storageLayout:'dense'},'simd',2)
  assert.ok(less.summary().trainingChance.visitedNodes<full.summary().trainingChance.visitedNodes/2)
  const grid=make({...base,frequencyIncrements:{flop:[25,0]}})
  assert.equal(compile(grid,null,'auto'),null)
  const solver=step(new core.CFRSolver(grid),2),policy=core.averagePolicy(grid)
  assert.ok(policy[0].every(p=>p*4===Math.round(p*4)))
  assert.equal(solver.checkConvergence().evaluationGame,'full-flop')
  assert.ok(solver.summary().trainingChance.lastNodes>0)
  assert.throws(()=>make({...base,gtoAlgorithm:'cfrplus'}),/standard DCFR/)
  assert.throws(()=>make({...base,useActionFrequencyPruning:true}),/culling/)
})
