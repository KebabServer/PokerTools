import assert from 'node:assert/strict'
import test from 'node:test'
import { core, compile, codec } from '../scripts/solver/harness.mjs'

const modes=Object.keys(core.storagePrecisions)
const id=(a,b)=>core.comboId(core.cardId(a),core.cardId(b))
const range=entries=>{
  const weights=new Float64Array(1326)
  for(const [a,b,w=1] of entries)weights[id(a,b)]=w
  return weights
}
const turn={
  board:['As','Ah','7d','2c'],pot:100,stack:150,maxRaises:1,allIn:false,maxNodes:20_000,
  turnSizes0:[50],turnSizes1:[],sizes0:[33],sizes1:[75],
  weights0:range([['Ks','Qs'],['Kh','Qh'],['Kd','Qc',.5],['3d','3c',.1],['Td','9d',1e-18]]),
  weights1:range([['Js','Ts'],['Jh','Th'],['Jd','Tc',.8],['6d','6c',.5],['Qd','9c',1e-20]]),
}
const river={...turn,board:[...turn.board,'8d'],sizes1:[],maxRaises:0}
const near=(actual,expected,tol=1e-11)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} vs ${expected} (tolerance ${tol})`)
function build(config,precision='float64',layout='compact') {
  return core.makeGame({...config,storagePrecision:precision,storageLayout:layout})
}
function step(game,n) {
  const solver=new core.CFRSolver(game)
  for(let i=0;i<n;i++)solver.step()
  return solver
}
function independent(config,game) {
  const reference=build({...config,treeLayout:'explicit',useSuitIsomorphism:false},'float64','dense')
  assert.equal(core.gameSignature(reference,true),core.gameSignature(game,true))
  const policy=core.averagePolicy(game)
  policy.suitIsomorphic=false
  const value=(p,mode)=>core.rangeValue(reference,p,core.evaluatePolicy(reference,policy,p,mode))
  const mode=config.nodeLocks?.length?'constrainedBest':'best'
  const br0=value(0,mode),br1=value(1,mode),ev=value(0,'profile')
  return {ev:ev+game.pot/2,lower:game.pot/2-br1,upper:game.pot/2+br0,
    gap:Math.max(0,(br0+br1)/2),unrestricted:(value(0,'best')+value(1,'best'))/2}
}
function lock(node,mix) {
  return {nodeId:node.id,history:node.history,player:node.p,actions:node.actions.map(a=>a.label),...mix}
}

test('precision selection allocates only the requested typed planes in both layouts',()=>{
  assert.equal(core.makeGame(river).numericStorage.precision,'float64')
  assert.throws(()=>build(river,'unknown'),/precision/)
  for(const layout of ['dense','compact']){
    const config={...river,gtoAlgorithm:'optimistic'}
    const counts=[]
    for(const precision of modes){
      const game=build(config,precision,layout)
      const preview=core.makeGame({...config,storagePrecision:precision,storageLayout:layout},{preview:true})
      const root=game.nodes[game.root]
      const reference=precision==='float64'
      assert.equal(preview.numericStorage.stateBytes,game.stateStorage.byteLength)
      assert.equal(game.numericStorage.stateBytes,game.stateStorage.byteLength)
      assert.ok(root.regret instanceof (reference?Float64Array:Float32Array))
      assert.ok(root.averageSum instanceof (['float64','f32-regrets'].includes(precision)?Float64Array:Float32Array))
      assert.ok(root.current instanceof (precision==='f32-all'?Float32Array:Float64Array))
      assert.ok(root.previousDelta instanceof Float64Array)
      assert.equal(root.averageExponent instanceof Int8Array,precision==='f32-scaled-averages')
      assert.ok(game.players.every(p=>p.priors instanceof Float64Array))
      assert.ok(core.traverseCfr(game,game.root,0,game.players[1].priors) instanceof Float64Array)
      const compiled=compile(game)
      if(reference)assert.ok(compiled||layout==='compact','Dense Float64 should remain native-eligible')
      else assert.equal(compiled,null,'Never pass mixed-width offsets to the Float64 ABI')
      counts.push(game.stateStorage.byteLength)
    }
    const [f64,regrets,averages,all,scaled]=counts
    assert.ok(f64>regrets&&regrets>scaled&&scaled>averages&&averages>all)
  }
})

test('Float64 audits agree with every mode on weighted ranges, suit orbits and constrained equilibria',()=>{
  const root=build(turn).nodes[0]
  const constrained={...turn,nodeLocks:[lock(root,{comboPercentages:{[id('Ks','Qs')]:[83.25,16.75],[id('Kh','Qh')]:[83.25,16.75]}})]}
  for(const config of [turn,constrained]){
    const reference=independent(config,step(build(config),20).game)
    for(const precision of modes){
      const game=build(config,precision),solver=step(game,20)
      assert.ok(game.suitIsomorphism.groupSize>1)
      const measured=solver.summary(),audit=independent(config,game)
      near(measured.exploitability,audit.gap)
      near(measured.oopEvBounds.lower,audit.lower)
      near(measured.oopEvBounds.upper,audit.upper)
      near(measured.value0,audit.ev)
      near(audit.ev,reference.ev,2e-5)
      near(audit.gap,reference.gap,2e-5)
      if(config.nodeLocks){
        assert.ok(audit.unrestricted>audit.gap)
        const strategy=core.averagePolicy(game)
        const hand=game.players[0].index[id('Ks','Qs')]
        assert.deepEqual(Array.from(strategy[root.id].slice(2*hand,2*hand+2)),[.8325,.1675])
      }
    }
  }
})

test('mixed checkpoints preserve bytewise continuation and warm starts can change precision and locks',()=>{
  for(const precision of modes.slice(1)){
    const config={...river,gtoAlgorithm:'dcfr-predictive',frequencyIncrements:{river:[2,0]}}
    const source=step(build(config,precision),8)
    const snapshot=source.saveCheckpoint(),binary=codec.encode(snapshot,config)
    assert.equal(new Uint8Array(binary)[7],2)
    assert.ok(snapshot.storage instanceof Uint8Array)
    const decoded=codec.decode(binary)
    assert.equal(decoded.config.storagePrecision,precision)
    assert.equal(decoded.config.storageLayout,'compact')
    const restored=core.CFRSolver.resume(core.makeGame(decoded.config),decoded.checkpoint)
    assert.deepEqual(restored.saveCheckpoint().storage,snapshot.storage)
    for(let i=0;i<5;i++){source.step();restored.step()}
    assert.deepEqual(restored.saveCheckpoint().storage,source.saveCheckpoint().storage)
    assert.throws(()=>core.CFRSolver.resume(build(config),snapshot),/precision/)
    new Uint8Array(binary)[binary.byteLength-1]^=1
    assert.throws(()=>codec.decode(binary),/checksum/)
    const corrupt=snapshot.storage.slice()
    new DataView(corrupt.buffer).setFloat32(source.game.nodes[0].regret.byteOffset,NaN,true)
    assert.throws(()=>core.CFRSolver.resume(build(config,precision),{...snapshot,storage:corrupt}),/non-finite/)
    const node=source.game.nodes[0],locked={...config,nodeLocks:[lock(node,{percentages:[62,38]})]}
    const fresh=build(locked)
    const warm=core.CFRSolver.warmStart(fresh,source)
    assert.equal(warm.iteration,0)
    assert.deepEqual(Array.from(core.averagePolicy(fresh)[0].slice(0,2)),[.62,.38])
    const reverse=core.CFRSolver.warmStart(build(locked,precision,'dense'),warm)
    for(let i=0;i<3;i++)reverse.step()
    assert.ok(Number.isFinite(reverse.summary().value0))
  }
})

test('Float32 current rows preserve rare probabilities, exact frequency units and the QRE floor',()=>{
  const game=build({...river,sizes0:[33,67]},'f32-all','dense'),node=game.nodes[0]
  for(let i=0;i<node.regret.length;i+=3)node.regret.set([2**-110,.8,.2],i)
  core.currentPolicy(game,0)
  const probs=Array.from({length:3},(_,k)=>core.currentProbability(node,0,k))
  assert.ok(probs[0]>0)
  near(probs.reduce((a,b)=>a+b,0),1)
  const grid=build({...river,sizes0:[33,67],frequencyIncrements:{river:[2,0]}},'f32-all','dense')
  step(grid,30)
  for(const nd of grid.decisionNodes)if(nd.frequencyUnits)for(let h=0;h<grid.players[nd.p].ids.length;h++){
    let total=0
    for(let k=0;k<nd.actionCount;k++){
      const raw=nd.current[h*nd.actionCount+k]
      assert.ok(Number.isInteger(raw))
      assert.equal(core.currentProbability(nd,h,k),raw/50)
      total+=raw
    }
    assert.equal(total,50)
  }
  const config={...river,sizes1:[75],equilibrium:'qre'}
  for(const layout of ['dense','compact']){
    const reference=step(build(config,'float64',layout),80).summary(),mixed=step(build(config,'f32-all',layout),80)
    near(mixed.summary().qreResidual,reference.qreResidual,5e-6)
    const policy=core.averagePolicy(mixed.game)
    for(const nd of mixed.game.decisionNodes)for(const mix of policy[nd.id]??[])
      assert.ok(mix>=core.QRE_PROBABILITY_FLOOR-1e-15&&mix<=1)
  }
})

test('binary-scaled averaging retains tiny and huge realization weights',()=>{
  const modesForAverage=['float64','f32-regrets-averages','f32-scaled-averages']
  const sample=(precision,weight)=>{
    const game=build(river,precision),root=game.nodes[0]
    for(let i=0;i<root.current.length;i+=2)root.current.set([.75,.25],i)
    core.accumulate(game,weight)
    for(let i=0;i<root.current.length;i+=2)root.current.set([.25,.75],i)
    core.accumulate(game,3*weight)
    return {p:core.averagePolicy(game)[0][0],scale:root.averageExponent?.[0]}
  }
  const tiny=modesForAverage.map(mode=>sample(mode,2**-1000))
  near(tiny[0].p,.375)
  near(tiny[1].p,.25)
  near(tiny[2].p,tiny[0].p)
  assert.ok(tiny[2].scale<0)
  const huge=sample('f32-scaled-averages',2**900)
  near(huge.p,sample('float64',2**900).p)
  assert.ok(huge.scale>0)
  // A row can move from a tiny scale to a large scale without overflowing or
  // changing the normalized policy implied by the Float64 weighted sum.
  const scaled=build(river,'f32-scaled-averages')
  core.accumulate(scaled,2**-800)
  const node=scaled.nodes[0]
  for(let i=0;i<node.current.length;i+=2)node.current.set([1,0],i)
  core.accumulate(scaled,2**800)
  assert.equal(core.averagePolicy(scaled)[0][0],1)
  assert.ok(node.averageSum.every(Number.isFinite))
})

test('large pot regrets and high-power averaging stay finite near the browser iteration cap',()=>{
  const config={...river,pot:2**140,stack:2**141,gtoAlgorithm:'dcfr-scheduled-cubic',scheduledAveragingPower:4}
  const evaluated=modes.map(precision=>{
    const game=build(config,precision),solver=new core.CFRSolver(game)
    solver.iteration=9_999_900
    for(let i=0;i<100;i++)solver.step()
    for(const node of game.decisionNodes){
      if(node.isoAlias)continue
      assert.ok(node.regret.every(Number.isFinite))
      assert.ok(node.averageSum.every(Number.isFinite))
    }
    return solver.summary().value0/game.pot
  })
  for(const value of evaluated)near(value,evaluated[0],2e-6)
})
