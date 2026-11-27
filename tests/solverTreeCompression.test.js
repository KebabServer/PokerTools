import assert from 'node:assert/strict'
import test from 'node:test'
import { core, compile, codec } from '../scripts/solver/harness.mjs'

const card = core.cardId
const range = entries => {
  const weights = new Float64Array(1326)
  for (const [a,b,w] of entries) weights[core.comboId(card(a),card(b))] = w
  return weights
}
const flop = {
  board:['As','Th','2d'].map(card), pot:80, stack:100, maxRaises:1, allIn:true,
  flopSizes0:[40,75], flopSizes1:[50], turnSizes0:[], turnSizes1:[], sizes0:[], sizes1:[],
  flopRaiseSizes0:[50], flopRaiseSizes1:[50], flopTurnSamples:5, flopRiverSamples:7, flopSamplingSeed:193,
  storageLayout:'dense', maxNodes:100_000, useSuitIsomorphism:false,
  weights0:range([['Ah','Ac',.8],['Ks','Qs',1],['Kd','Qd',.4],['Kh','Qh',.2],['3d','4d',.1]]),
  weights1:range([['Ah','Ac',.2],['Ks','Js',.9],['Kc','Qc',.6],['Ad','9c',.7],['8s','8c',1]]),
}
const close = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b)<=tolerance, `${a} vs ${b}`)
const compare = (a,b,tolerance) => {
  for(const k of ['value0','value1','br0','br1','exploitability','unrestrictedExploitability','zeroSumError'])
    if(k in a||k in b)close(a[k],b[k],tolerance)
}
const valueAt = (game,id,target,reach=game.players[1-target].priors) =>
  core.traverseCfr(game,id,target,reach)
const follow = (game,id,label) => {
  const node=game.nodes[id]
  return (node.chance?node.runouts:node.actions).find(edge=>edge.label===label).child
}
function flopAllIn(game) {
  const root=game.nodes[0]
  const bet=root.actions.find(a=>a.label.startsWith('All-in'))
  return follow(game,bet.child,'Call 100')
}
function solve(game,steps=7) {
  const solver=new core.CFRSolver(game)
  for(let i=0;i<steps;i++)solver.step()
  return solver
}
function manual(game,id,target,reach) {
  const mine=game.players[target],opp=game.players[1-target]
  const payoff=game.pot/2+game.stack
  const result=Float64Array.from(mine.ids,()=>0)
  let ties=0,blocked=0
  function walk(cursor,publicCards,weight) {
    const node=game.nodes[cursor]
    if(node.chance){
      for(const runout of node.runouts)walk(runout.child,[...publicCards,runout.card],weight*runout.weight)
      return
    }
    for(const [i,mi] of mine.ids.entries())for(const [j,oi] of opp.ids.entries()){
      const a=core.ALL_COMBOS[mi],b=core.ALL_COMBOS[oi]
      if(!core.compatible(a,b)||[...a,...b].some(card=>publicCards.includes(card))){blocked++;continue}
      const own=core.evaluate7([...game.board,...publicCards,...a])
      const other=core.evaluate7([...game.board,...publicCards,...b])
      if(own===other)ties++
      result[i]+=weight*reach[j]*Math.sign(own-other)*payoff
    }
  }
  walk(id,[],1)
  return {result,ties,blocked}
}
function compareVectors(a,b) {
  assert.equal(a.length,b.length)
  for(let i=0;i<a.length;i++)close(a[i],b[i])
}

test('all-in operators match an independent weighted physical-deal calculation',()=>{
  for(const fixture of [flop,{...flop,board:[...flop.board,card('8h')]},
    {...flop,flopTurnSamples:49,flopRiverSamples:48,flopSizes0:[],flopSizes1:[],maxRaises:0}]){
    const original=core.makeGame({...fixture,treeLayout:'explicit'})
    const id=flopAllIn(original)
    const expected=[0,1].map(target=>manual(original,id,target,original.players[1-target].priors))
    assert.ok(expected.some(result=>result.blocked>0))
    assert.ok(expected.some(result=>result.ties>0))
    for(const mode of ['counts','float64','boards','ondemand']){
      const packed=core.makeGame({...fixture,allInEvaluation:mode})
      assert.equal(packed.nodes[id].allInSpan.plan.mode,mode)
      for(const target of [0,1]){
        compareVectors(valueAt(original,id,target),expected[target].result)
        compareVectors(valueAt(packed,id,target),expected[target].result)
      }
    }
  }
})

test('packed logical paths, turn and river leaves, IDs and checkpoint compatibility match the explicit tree',()=>{
  for(const board of [flop.board,[...flop.board,card('8h')],[...flop.board,card('8h'),card('6c')]]){
    const explicit=core.makeGame({...flop,board,treeLayout:'explicit'})
    const packed=core.makeGame({...flop,board})
    assert.equal(packed.nodes.length,explicit.nodes.length)
    assert.equal(core.gameSignature(packed),core.gameSignature(explicit))
    if(board.length<5)assert.ok(packed.treeStorage.implicitNodes>0)
    for (const node of explicit.nodes){
      const mapped=packed.nodes[node.id]
      const {id,terminal,type,winner,p,pot,turn,river,history}=mapped
      assert.deepEqual({id,terminal,type,winner,p,pot,turn,river,history},
        {id:node.id,terminal:node.terminal,type:node.type,winner:node.winner,p:node.p,
          pot:node.pot,turn:node.turn,river:node.river,history:node.history})
      const children=node.chance?node.runouts:node.actions
      if(children){
        assert.equal(JSON.stringify(mapped.chance?mapped.runouts:mapped.actions),JSON.stringify(children))
        for(const edge of children)assert.deepEqual(packed.parentOf(edge.child),[node.id,edge.label])
      }
    }
    const old=solve(explicit,2),saved=old.saveCheckpoint()
    const restored=core.CFRSolver.resume(packed,saved)
    assert.deepEqual(restored.saveCheckpoint().storage,saved.storage)
    compare(restored.summary(),old.summary())
    compare(solve(core.makeGame({...flop,board}),2).summary(),old.summary())
  }
})

test('packed native rows share immutable continuations while locks and unrestricted responses remain exact',()=>{
  const preview=core.makeGame(flop,{preview:true})
  const target=preview.nodes[preview.nodes[0].actions[1].child]
  const lock={nodeId:target.id,history:target.history,player:target.p,actions:target.actions.map(e=>e.label),
    comboPercentages:{[core.comboId(card('Ks'),card('Js'))]:[100,...target.actions.slice(1).map(()=>0)]}}
  const locked={...flop,storageLayout:'compact',nodeLocks:[lock]}
  const before=solve(core.makeGame({...locked,treeLayout:'explicit'}))
  const after=solve(core.makeGame(locked))
  compare(after.summary(),before.summary())
  assert.ok(after.summary().unrestrictedExploitability>after.summary().exploitability)
  const saved=after.saveCheckpoint()
  const roundtrip=codec.decode(codec.encode(saved,locked)).checkpoint
  compare(core.CFRSolver.resume(core.makeGame(locked),roundtrip).summary(),after.summary())
  const warm=core.CFRSolver.warmStart(core.makeGame({...locked,nodeLocks:[]}),after)
  assert.equal(warm.iteration,0)
  warm.step()

  const native=core.makeGame(flop)
  native.coreCompatibilityMass=(p,r,n)=>core.compatibilityMass(native,p,r,n)
  native.compiled=compile(native)
  assert.equal(native.compiled.mode,'wasm-full-tree-f64')
  assert.ok(native.compiled.treeRecords<native.treeStorage.physicalSlots)
  const explicit=core.makeGame({...flop,treeLayout:'explicit'})
  explicit.compiled=compile(explicit)
  const id=flopAllIn(native)
  compareVectors(valueAt(native,id,0),valueAt(explicit,id,0))
  const firstTurn=native.nodes[id].runouts[0].child
  const leaf=native.nodes[firstTurn].runouts[0].child
  for(const cursor of [firstTurn,leaf])compareVectors(valueAt(native,cursor,0),valueAt(explicit,cursor,0))
  const reference=solve(explicit),optimized=solve(native)
  compare(optimized.summary(),reference.summary())
  const detail=optimized.nodeReport(target.id),oldDetail=reference.nodeReport(target.id)
  close(detail.rangeEV,oldDetail.rangeEV)
  assert.equal(detail.id,target.id)
})

test('full exact flop fits a physical node budget that rejects the original tree',()=>{
  const config={...flop,maxNodes:24_000,flopTurnSamples:49,flopRiverSamples:48,
    flopSizes0:[],flopSizes1:[],maxRaises:0,stack:80}
  const packed=core.makeGame(config,{preview:true})
  assert.ok(packed.nodes.length>config.maxNodes)
  assert.ok(packed.treeStorage.budgetRecords<config.maxNodes)
  assert.throws(()=>core.makeGame({...config,treeLayout:'explicit'},{preview:true}),/node budget/)
})

test('packed native policy variants retain logical decisions and exact payoffs',()=>{
  const quick={...flop,flopTurnSamples:2,flopRiverSamples:3,flopSizes0:[50],flopSizes1:[]}
  for(const settings of [{gtoAlgorithm:'optimistic'},{gtoAlgorithm:'dcfr-predictive'},{equilibrium:'qre'}]){
    const original=core.makeGame({...quick,...settings,treeLayout:'explicit'})
    const packed=core.makeGame({...quick,...settings})
    original.compiled=compile(original)
    packed.compiled=compile(packed)
    assert.equal(packed.compiled.mode,'wasm-full-tree-f64')
    const before=solve(original,4).summary(),after=solve(packed,4).summary()
    compare(after,before,1e-8)
    if(before.qreResidual!=null)close(after.qreResidual,before.qreResidual)
  }
})

test('all-in matrices allocate only when used and stay within the solver memory budget',()=>{
  const config={...flop,flopTurnSamples:2,flopRiverSamples:3,allInEvaluation:'counts'}
  const game=core.makeGame(config)
  const root=flopAllIn(game)
  const plan=game.nodes[root].allInSpan.plan
  assert.equal(plan.matrix,null)
  const before=game.memory
  const result=valueAt(game,root,0)
  assert.ok(plan.matrix instanceof Int16Array)
  assert.equal(game.memory,before+plan.matrix.byteLength)
  const restricted=core.makeGame({...config,memoryLimitBytes:before})
  assert.equal(restricted.nodes[root].allInSpan.plan.mode,'boards')
  compareVectors(result,valueAt(restricted,root,0))
  assert.equal(restricted.memory,before)
})
