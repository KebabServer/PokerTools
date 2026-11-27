import assert from 'node:assert/strict'
import test from 'node:test'
import { core, compile, codec } from '../scripts/solver/harness.mjs'

const card = core.cardId
const combo = (a,b) => core.comboId(card(a),card(b))
const range = entries => {
  const weights = new Float64Array(1326)
  for (const [a,b,w=1] of entries) weights[combo(a,b)] = w
  return weights
}
const turn = {
  board:['As','Ah','7d','2c'].map(card), pot:60, stack:120, maxRaises:0, allIn:false,
  sizes0:[50], sizes1:[], turnSizes0:[50], turnSizes1:[50],
  maxNodes:15_000, gtoAlgorithm:'dcfr',
  weights0:range([['Ks','Qs'],['Kh','Qh'],['Ks','Kh'],['Jd','Td'],['6c','5c']]),
  weights1:range([['Js','Ts'],['Jh','Th'],['Kd','Qd'],['Jc','Tc'],['6s','6h']]),
}
const river = {...turn, board:[...turn.board,card('8d')]}
function lock(node, mix) {
  return {nodeId:node.id, history:node.history, player:node.p, actions:node.actions.map(action=>action.label), ...mix}
}
function solve(game, steps=12) {
  const solver = new core.CFRSolver(game)
  for(let i=0;i<steps;i++)solver.step()
  return solver
}
const near = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance, `${a} vs ${b}`)
function compareReports(a,b,tolerance) {
  for (const key of ['value0','value1','br0','br1','exploitability','unrestrictedExploitability'])
    near(a[key],b[key],tolerance)
  if(a.qreResidual!==null)near(a.qreResidual,b.qreResidual,tolerance)
  assert.equal(a.nodes.length,b.nodes.length)
  for (const [id,record] of a.nodes.entries()) if(record) {
    const other=b.nodes[id]
    assert.deepEqual(record.hands.map(row=>row[0]),other.hands.map(row=>row[0]))
    for (const [i,row] of record.hands.entries()) {
      assert.ok(row[3].every(prob=>Number.isFinite(prob)&&prob>=0&&prob<=1))
      near(row[3].reduce((sum,p)=>sum+p,0),1)
      if(row[1]>1e-10&&other.hands[i][1]>1e-10)
        row[3].forEach((p,k)=>near(p,other.hands[i][3][k],tolerance))
    }
  }
}

test('compact JS and WASM match the dense game and reconstruct physical combos',()=>{
  const config={...turn,useSuitIsomorphism:false,frequencyIncrements:{turn:[25,0],river:[0,50]}}
  const dense=core.makeGame({...config,storageLayout:'dense'})
  const compact=core.makeGame({...config,storageLayout:'compact'})
  const native=core.makeGame({...config,storageLayout:'compact'})
  native.compiled=compile(native)
  assert.equal(native.compiled?.mode,'wasm-compact-f64')
  let nativeUpdates=0
  const update=native.compiled.regret
  native.compiled.regret=(...args)=>{const used=update(...args);nativeUpdates+=Number(used);return used}
  assert.ok(compact.stateStorage.length<dense.stateStorage.length)
  const forced=compact.nodes.filter(node=>node.compact&&node.actions.length===1)
  assert.ok(forced.length>0&&forced.every(node=>!node.regret.length&&!node.averageSum.length&&!node.current.length))
  const decision=compact.nodes.find(node=>node.river===card('Ks')&&node.p===0&&node.actions?.length>1)
  const blocked=compact.players[0].index[combo('Ks','Qs')]
  assert.equal(decision.compact.map[blocked],-1)
  const reference=solve(dense)
  const js=solve(compact)
  const wasm=solve(native)
  assert.ok(nativeUpdates>0)
  compareReports(reference.report(),js.report())
  compareReports(js.report(),wasm.report())
  near(wasm.summary().exploitability,wasm.report().exploitability)
  assert.deepEqual(wasm.saveCheckpoint().storage,js.saveCheckpoint().storage)
})

test('setwise public stabilizers and compatible locks preserve the complete weighted game',()=>{
  const shape=core.makeGame({...turn,storageLayout:'dense',useSuitIsomorphism:false},{preview:true})
  const root=shape.nodes[shape.root]
  const paired=lock(root,{comboPercentages:{
    [combo('Ks','Qs')]:[50,50],[combo('Kh','Qh')]:[50,50],
  }})
  const single=lock(root,{comboPercentages:{[combo('Ks','Qs')]:[50,50]}})
  const build=(nodeLocks,storageLayout='compact',useSuitIsomorphism=true)=>
    core.makeGame({...turn,nodeLocks,storageLayout,useSuitIsomorphism})
  const compact=build([paired])
  assert.equal(compact.suitIsomorphism.groupSize,2)
  assert.ok(compact.suitIsomorphism.aliasedDecisions>0)
  assert.ok(compact.numericStorage.orbitRows>0)
  assert.equal(compact.nodes[root.id].compact.map[compact.players[0].index[combo('Ks','Qs')]],-1)
  compact.compiled=compile(compact)
  assert.equal(compact.compiled?.mode,'wasm-compact-f64')
  const solver=solve(compact,18)
  compareReports(solve(build([paired],'dense',false),18).report(),solver.report(),1e-7)
  near(solver.summary().exploitability,solver.report().exploitability)
  assert.equal(build([single]).suitIsomorphism.groupSize,1)
  assert.equal(build([paired]).suitIsomorphism.groupSize,2)
  const whole=build([lock(root,{percentages:[100,0]})])
  assert.equal(whole.suitIsomorphism.groupSize,2)
  assert.equal(whole.nodes[root.id].regret.length,0)
  assert.equal(whole.nodes[root.id].lockedRows.length,2)
  const descendant=whole.nodes[whole.nodes[root.id].actions[1].child]
  assert.ok(descendant.compact.reps.length>0,'A zero-probability action at a lock cannot cull physical rows')
})

test('checkpoint round trips keep Float64 state while warm starts revalidate changed locks',()=>{
  const game=core.makeGame({...river,storageLayout:'compact'})
  const solver=solve(game,9)
  const decoded=codec.decode(codec.encode(solver.saveCheckpoint(),{...river,storageLayout:'auto'}))
  assert.equal(decoded.config.storageLayout,'compact')
  const restoredGame=core.makeGame(decoded.config)
  restoredGame.compiled=compile(restoredGame)
  const restored=core.CFRSolver.resume(restoredGame,decoded.checkpoint)
  solver.step();restored.step()
  assert.deepEqual(restored.saveCheckpoint().storage,solver.saveCheckpoint().storage)
  const root=game.nodes[game.root],changed=[lock(root,{comboPercentages:{[combo('Ks','Qs')]:[100,0]}})]
  const newGame=core.makeGame({...river,storageLayout:'compact',nodeLocks:changed})
  assert.throws(()=>core.CFRSolver.resume(newGame,decoded.checkpoint),/does not match/)
  const warm=core.CFRSolver.warmStart(newGame,solver)
  assert.equal(warm.iteration,0)
  const row=warm.nodeReport(root.id).hands.find(h=>h[0]===combo('Ks','Qs'))
  assert.deepEqual(row[3],[1,0])
  warm.step()
  const plain=core.makeGame({...river,storageLayout:'dense'})
  const again=core.CFRSolver.warmStart(plain,warm)
  assert.ok(again.summary().exploitability>=0)
  assert.throws(()=>core.CFRSolver.warmStart(core.makeGame({...river,pot:70}),warm),/same physical tree/)
})

test('compact omission uses deal support rather than current reach and works with Float64 QRE',()=>{
  const config={...river,useRiverHandSymmetry:false,equilibrium:'qre',gtoAlgorithm:'cfrplus',
    weights0:range([['Ks','Qs'],['6c','5c']]),weights1:range([['Ks','Js']])}
  const compact=core.makeGame({...config,storageLayout:'compact'})
  const root=compact.nodes[compact.root]
  assert.equal(root.compact.map[compact.players[0].index[combo('Ks','Qs')]],-1)
  assert.ok(root.compact.map[compact.players[0].index[combo('6c','5c')]]>=0)
  const dense=solve(core.makeGame({...config,storageLayout:'dense'}),8)
  const solver=solve(compact,8)
  compareReports(dense.report(),solver.report())
  near(solver.summary().qreResidual,solver.report().qreResidual)
})

test('public chance locks must map to the same restriction on every paired runout',()=>{
  const preview=core.makeGame({...turn,storageLayout:'dense',useSuitIsomorphism:false},{preview:true})
  const chance=preview.nodes.find(node=>node.chance)
  const lockAt=(s,mix)=>lock(preview.nodes[chance.runouts.find(o=>o.card===card(s)).child],{percentages:mix})
  const create=nodeLocks=>core.makeGame({...turn,storageLayout:'compact',nodeLocks},{preview:true})
  const left=lockAt('Ks',[35,65]),right=lockAt('Kh',[35,65])
  assert.equal(create([left,right]).suitIsomorphism.groupSize,2)
  assert.equal(create([left]).suitIsomorphism.groupSize,1)
  assert.equal(create([left,lockAt('Kh',[36,64])]).suitIsomorphism.groupSize,1)
  assert.equal(create([right,left]).suitIsomorphism.groupSize,2)
})

test('full-flop aliases can chain through both chance streets and seeded samples preserve only actual automorphisms',()=>{
  const config={...turn,board:['As','7s','2s'],storageLayout:'compact',pot:60,stack:90,
    flopSizes0:[],flopSizes1:[],turnSizes0:[],turnSizes1:[],sizes0:[50],sizes1:[],
    flopTurnSamples:49,flopRiverSamples:48,maxNodes:40_000,
    weights0:range([['Ks','Qs'],['Kh','Qh'],['Kc','Qc'],['Kd','Qd']]),
    weights1:range([['Js','Ts'],['Jh','Th'],['Jc','Tc'],['Jd','Td']])}
  const game=core.makeGame(config)
  assert.equal(game.suitIsomorphism.groupSize,6)
  assert.ok(game.nodes.some(n=>n.isoAlias&&game.nodes[n.isoAlias.source].isoAlias))
  const compact=solve(game,3)
  const dense=solve(core.makeGame({...config,storageLayout:'dense',useSuitIsomorphism:false}),3)
  const full=compact.report(),reference=dense.report()
  near(full.value0,reference.value0)
  near(full.exploitability,reference.exploitability)
  near(compact.summary().exploitability,full.exploitability)
  for(const node of game.nodes)if(node.isoAlias){
    const source=full.nodes[node.isoAlias.source]
    const destination=full.nodes[node.id]
    for(const [i,h] of source.hands.entries())assert.deepEqual(h[3],destination.hands[node.isoAlias.map[i]][3])
  }
  for(const seed of [3,79]){
    const sampled={...config,flopTurnSamples:4,flopRiverSamples:3,flopSamplingSeed:seed}
    const solver=solve(core.makeGame(sampled),4)
    compareReports(solve(core.makeGame({...sampled,storageLayout:'dense',useSuitIsomorphism:false}),4).report(),solver.report(),1e-7)
  }
})

test('auto chooses dense for a small game and can use compact to fit the memory limit',()=>{
  const config={...turn,useSuitIsomorphism:false}
  assert.equal(core.makeGame(config).numericStorage.mode,'dense')
  const dense=core.makeGame({...config,storageLayout:'dense'})
  const compact=core.makeGame({...config,storageLayout:'compact'})
  assert.ok(compact.memory<dense.memory)
  const memoryLimitBytes=Math.floor((dense.memory+compact.memory)/2)
  assert.equal(core.makeGame({...config,memoryLimitBytes}).numericStorage.mode,'compact')
  assert.throws(()=>core.makeGame({...config,memoryLimitBytes,storageLayout:'dense'}),/memory budget/)
})

test('legacy dense checkpoints retain their original fingerprint and reopen through the decoder',()=>{
  const config={...river,board:['As','Ah','7d','2c','8d'],storageLayout:'dense',
    weights0:range([['Ks','Qs']]),weights1:range([['Js','Ts']])}
  const solver=solve(core.makeGame(config),3)
  const {storageLayout: _checkpointLayout,...oldCheckpoint}=solver.saveCheckpoint()
  const {storageLayout: _configurationLayout,...oldConfiguration}=config
  assert.equal(oldCheckpoint.fingerprint,'e2ceb10c75f3558d')
  const encoded=codec.encode(oldCheckpoint,oldConfiguration)
  const decoded=codec.decode(encoded)
  assert.equal(decoded.config.storageLayout,'dense')
  const restored=core.CFRSolver.resume(core.makeGame(decoded.config),decoded.checkpoint)
  assert.deepEqual(restored.saveCheckpoint().storage,solver.saveCheckpoint().storage)
})
