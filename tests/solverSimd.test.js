import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInThisContext } from 'node:vm'
import { core, compile, codec } from '../scripts/solver/harness.mjs'

const card=core.cardId
const hand=(a,b)=>core.comboId(card(a),card(b))
function range(hands){
  const out=new Float64Array(1326)
  for(const [a,b,w=1] of hands)out[hand(a,b)]=w
  return out
}
const turn={
  board:['As','Ah','7d','2c'],pot:100,stack:105,maxRaises:1,allIn:true,maxNodes:100_000,
  sizes0:[33,66],sizes1:[50],turnSizes0:[50],turnSizes1:[],
  weights0:range([['Ks','Qs'],['Kh','Qh'],['Kd','Qc',.6],['Jc','Jd',.3],['Tc','6d',.01]]),
  weights1:range([['Js','Ts'],['Jh','Th'],['Qd','9c',.8],['6c','6d',.5],['Kc','5c',1e-11]]),
}
const flop={
  ...turn,board:['As','7s','2s'],flopSizes0:[33],flopSizes1:[66],sizes0:[50],sizes1:[],
  flopTurnSamples:4,flopRiverSamples:5,flopSamplingSeed:61,
}
function lockAt(node,restriction){
  return {nodeId:node.id,history:node.history,player:node.p,actions:node.actions.map(a=>a.label),...restriction}
}
function game(config,backend){
  const game=core.makeGame(config)
  if(backend!=='js'){
    game.compiled=compile(game,config.memoryLimitBytes,backend)
    assert.equal(game.compiled?.mode,backend==='scalar'?'wasm-scalar':'wasm-simd128')
    assert.ok(game.compiled.fullTraversal)
    assert.equal(game.compiled.simd,backend!=='scalar')
  }
  return game
}
function solve(config,backend,iterations){
  const solver=new core.CFRSolver(game(config,backend))
  for(let i=0;i<iterations;i++)solver.step()
  return solver
}
function near(a,b,tolerance=1e-9){
  assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`)
}
function expectReport(source,reference,tolerance){
  const a=source.summary(),b=reference.summary()
  for(const name of ['value0','value1','exploitability','unrestrictedExploitability','zeroSumError'])
    near(a[name],b[name],tolerance)
  near(a.oopEvBounds.lower,b.oopEvBounds.lower,tolerance)
  near(a.oopEvBounds.upper,b.oopEvBounds.upper,tolerance)
  assert.ok(a.oopEvBounds.lower<=a.value0+1e-10)
  assert.ok(a.oopEvBounds.upper>=a.value0-1e-10)
  const policy=core.averagePolicy(source.game)
  for(const node of source.game.decisionNodes){
    const actions=node.actionCount,probs=policy[node.id]
    for(let i=0;i<probs.length;i+=actions){
      let sum=0
      for(let k=0;k<actions;k++){assert.ok(probs[i+k]>=0&&probs[i+k]<=1);sum+=probs[i+k]}
      near(sum,1,1e-13)
    }
  }
  const js=source.report()
  near(js.exploitability,a.exploitability)
  near(js.value0,a.value0)
}
test('source scalar and SIMD match the Float64 JS reference in dense and compact layouts',()=>{
  for(const layout of ['dense','compact'])for(const fixture of [turn,flop]){
    const config={...fixture,storageLayout:layout}
    const reference=solve(config,'js',9)
    const scalar=solve(config,'scalar',9),simd=solve(config,'simd',9)
    expectReport(scalar,reference)
    expectReport(simd,scalar)
    if(fixture===turn&&layout==='compact'){
      assert.ok(simd.game.suitIsomorphism.enabled)
      assert.ok(simd.game.numericStorage.orbitRows>0)
    }
  }
})
test('all mixed-precision arenas match their JS policies and resume across the two native builds',()=>{
  for(const precision of Object.keys(core.storagePrecisions).filter(m=>m!=='float64'))
    for(const layout of ['dense','compact']){
      const config={...flop,storageLayout:layout,storagePrecision:precision,flopTurnSamples:2,flopRiverSamples:3}
      const reference=solve(config,'js',8),source=solve(config,'simd',8)
      // Float32 storage can amplify ordinary Float64 summation differences.
      expectReport(source,reference,precision==='f32-all'?3e-6:1e-6)
      const binary=codec.encode(source.saveCheckpoint(),config)
      const decoded=codec.decode(binary)
      const continued=core.CFRSolver.resume(game(decoded.config,'scalar'),decoded.checkpoint)
      assert.deepEqual(continued.saveCheckpoint().storage,decoded.checkpoint.storage)
      for(let i=0;i<3;i++){continued.step();source.step()}
      expectReport(continued,source,1e-9)
    }
})
test('both builds evaluate constrained and unrestricted best responses for full and combo locks',()=>{
  const base={...flop,storageLayout:'compact',flopTurnSamples:3,flopRiverSamples:4}
  const root=core.makeGame(base,{preview:true}).nodes[0]
  const mix=[71,...Array(root.actionCount-1).fill(29/(root.actionCount-1))]
  const opponent=root.actions[0].child
  const op=core.makeGame(base,{preview:true}).nodes[opponent]
  const opponentMix=[84,...Array(op.actionCount-1).fill(16/(op.actionCount-1))]
  const first={...base,nodeLocks:[lockAt(root,{percentages:mix})]}
  const second={...base,nodeLocks:[lockAt(root,{comboPercentages:{[hand('Ks','Qs')]:mix}})]}
  second.nodeLocks.push(lockAt(op,{percentages:opponentMix}))
  for(const config of [first,second]){
    const reference=solve(config,'js',13),scalar=solve(config,'scalar',13),simd=solve(config,'simd',13)
    assert.ok(simd.game.compiled.constrainedBest)
    expectReport(scalar,reference)
    expectReport(simd,scalar)
    assert.ok(simd.summary().unrestrictedExploitability>simd.summary().exploitability)
    const warm=core.CFRSolver.warmStart(game(second,'simd'),simd)
    assert.equal(warm.iteration,0)
    warm.step()
    assert.equal(warm.summary().lockedNodes,2)
  }
})
test('full flop SIMD and scalar retain terminal card removal and exact Float64 bounds',()=>{
  // The complete 49 × 48 schedule remains affordable with these small ranges.
  const config={...flop,flopTurnSamples:49,flopRiverSamples:48,flopSizes0:[],flopSizes1:[],
    turnSizes0:[],turnSizes1:[],sizes0:[],sizes1:[],maxRaises:0,storageLayout:'compact'}
  const simd=solve(config,'simd',3),scalar=solve(config,'scalar',3),reference=solve(config,'js',3)
  expectReport(simd,scalar)
  expectReport(simd,reference)
  const g=simd.game
  const response=g.nodes[g.nodes[0].actions.find(a=>a.type==='bet').child]
  const showdown=g.nodes[g.nodes[g.nodes[response.actions.find(a=>a.type==='call').child].runouts[0].child].runouts[0].child]
  for(const player of [0,1]){
    const reaches=g.players[1-player].priors
    const expected=core.terminalCfv(reference.game,reference.game.nodes[showdown.id],player,reaches)
    const actual=core.traverseCfr(g,showdown.id,player,reaches)
    expected.forEach((v,i)=>near(v,actual[i]))
  }
})
test('legacy Float64 checkpoints open in the SIMD engine',()=>{
  const config={...turn,storageLayout:'dense'}
  const previous=core.makeGame(config)
  previous.compiled=compile(previous)
  const baseline=new core.CFRSolver(previous)
  for(let i=0;i<5;i++)baseline.step()
  const snapshot=codec.decode(codec.encode(baseline.saveCheckpoint(),config))
  const migrated=core.CFRSolver.resume(game(snapshot.config,'simd'),snapshot.checkpoint)
  assert.deepEqual(migrated.saveCheckpoint().storage,snapshot.checkpoint.storage)
  for(let i=0;i<5;i++){baseline.step();migrated.step()}
  expectReport(migrated,baseline)
})
test('automatic selection falls back to scalar when the SIMD module fails validation',()=>{
  const source=name=>readFileSync(new URL('../public/turn-river-lab/'+name,import.meta.url),'utf8')
  const fallback=runInThisContext(`(() => {
    ${source('compiled-traversal.js')}
    ${source('wasm-kernel-data.js')}
    ${source('source-kernel-data.js').replace(/const WASM_SOURCE_SIMD = '[^']+'/,"const WASM_SOURCE_SIMD = 'AA=='")}
    return game=>createCompiledTraversal(game,WASM_TRAVERSAL_BYTES,0)
  })()`)
  const config={...turn,board:[...turn.board,'8h']}
  assert.equal(fallback(core.makeGame(config)).mode,'wasm-scalar')
  assert.equal(compile(core.makeGame(config),undefined,'auto').mode,'wasm-simd128')
  const unsupported=core.makeGame({...config,frequencyIncrements:{river:[25,0]}})
  assert.equal(compile(unsupported,undefined,'auto').sourceBacked,false)
})
