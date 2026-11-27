import assert from 'node:assert/strict'
import test from 'node:test'
import { compile, core, heuristicTester as H } from '../scripts/solver/harness.mjs'

function id(combo){return core.comboId(core.cardId(combo.slice(0,2)),core.cardId(combo.slice(2)))}
function range(combos){
  const weights=new Float64Array(1326)
  for(const [i,combo] of combos.entries())weights[id(combo)]=1/(i%3+1)
  return weights
}
const fixture={board:['Kh','9h','6c'],pot:100,stack:80,maxRaises:0,allIn:false,maxNodes:100000,
  flopSizes0:[50],flopSizes1:[50],turnSizes0:[],turnSizes1:[],sizes0:[33],sizes1:[],
  flopTurnSamples:3,flopRiverSamples:4,flopSamplingSeed:21,storageLayout:'compact',
  weights0:range(['Ks2s','KdQs','Kc4s','9d2s','6d2c','AcAd','4c4d','TdTc','AhJh','8s7s','8d5c','Ks9c','6s6h','6hAh','3c2d']),
  weights1:range(['JdJc','AsQs','Ts9s','KcKd','7d8d','2s2h'])}
const rule=(type,values,mix)=>({match:{type,values},mix})
const preview=(config=fixture)=>core.makeGame(H.referenceConfig(config,'fixed'),{preview:true})
function expectedRows(candidate,expectations){
  for(const [combo,mix] of Object.entries(expectations))assert.deepEqual(candidate.lock.comboPercentages[id(combo)],mix,combo)
}
function near(a,b,eps=1e-8){assert.ok(Math.abs(a-b)<eps,`${a} versus ${b}`)}
const control={name:'Control',unrestricted:true}
const cbet={name:'Range bet',rules:[],default:'Bet 50%'}

test('compiles the first matching rule for every legal combo and validates exact mixes',()=>{
  const game=preview(),{compiled:[candidate,entire]}=H.compileCandidates(game,0,[{name:'Ordered mixes',rules:[
    rule('combo',['2sKs'],{'Check':75,'Bet 50%':25}),
    rule('class',['kqo'],'Check'),
    rule('made',['two-pair','trips'],'Bet 50%'),
    rule('pair',['top-pair','overpair'],'Bet 50%'),
    rule('pair',['middle-pair','bottom-pair'],{'Check':60,'Bet 50%':40}),
    rule('pair',['underpair'],{'Check':70,'Bet 50%':30}),
    rule('draw',['flush-draw'],{'Check':20,'Bet 50%':80}),
    rule('draw',['open-ended'],{'Check':30,'Bet 50%':70}),
    rule('draw',['gutshot'],{'Check':80,'Bet 50%':20}),
  ],default:'Check'},{name:'All combos',rules:[{match:{type:'all'},mix:'Bet 50%'}],default:'Check'}])
  expectedRows(candidate,{Ks2s:[75,25],KdQs:[100,0],Kc4s:[0,100],AcAd:[0,100],
    '9d2s':[60,40],'6d2c':[60,40],'6hAh':[60,40],'4c4d':[70,30],TdTc:[100,0],
    AhJh:[20,80],'8s7s':[30,70],'8d5c':[80,20],Ks9c:[0,100],'6s6h':[0,100],'3c2d':[100,0]})
  assert.deepEqual(candidate.rows.map(row=>row.id),game.players[0].ids)
  assert.ok(entire.rows.every(row=>row.rule===1&&row.mix[1]===100))
  assert.equal(candidate.rows.find(row=>row.id===id('6hAh')).rule,5)
  assert.equal(candidate.rows.find(row=>row.id===id('3c2d')).rule,null)
  assert.equal(candidate.lock.nodeId,game.root)
})

test('distinguishes two live straight ends, wheel edges, double gutshots, and made straights',()=>{
  const rules=[rule('made',['straight'],'Bet 50%'),rule('draw',['open-ended'],{'Check':20,'Bet 50%':80}),
    rule('draw',['gutshot'],{'Check':80,'Bet 50%':20})]
  const analyze=(board,combos)=>H.compileCandidates(preview({...fixture,board,weights0:range(combos)}),0,[
    {name:'Straight shapes',rules,default:'Check'},
  ]).compiled[0]
  expectedRows(analyze(['As','2h','3d'],['4cKd','4h5s','KcQd']),{'4cKd':[80,20],'4h5s':[0,100],KcQd:[100,0]})
  expectedRows(analyze(['5c','6d','7h'],['3s9s','8cKd','8d9c']),{'3s9s':[80,20],'8cKd':[20,80],'8d9c':[0,100]})
  const paired=H.compileCandidates(preview({...fixture,board:['Kh','Kd','6c'],weights0:range(['Ks2s','AcAd','9c2s'])}),0,[
    {name:'Paired flop',rules:[rule('pair',['top-pair','overpair'],'Bet 50%')],default:'Check'},
  ]).compiled[0]
  assert.ok(paired.rows.every(row=>row.rule===null))
})

test('rejects unavailable actions, invalid totals, blocked or absent combos, and incomplete rules',()=>{
  const game=preview(),apply=candidate=>H.compileCandidates(game,0,[{name:'Invalid',rules:[],default:'Check',...candidate}])
  assert.throws(()=>apply({default:'Bet 33%'}),/unavailable/)
  assert.throws(()=>apply({default:{Check:30,'Bet 50%':69}}),/total 100/)
  assert.throws(()=>apply({default:{Check:'100'}}),/must be a number/)
  assert.throws(()=>apply({rules:[rule('combo',['KhAd'],'Check')]}),/blocked by the flop/)
  assert.throws(()=>apply({rules:[rule('combo',['JsTs'],'Check')]}),/outside Hero’s range/)
  assert.throws(()=>apply({rules:[rule('combo',['KsKs'],'Check')]}),/two distinct cards/)
  assert.throws(()=>apply({rules:[rule('class',['22s'],'Check')]}),/Unknown starting-hand/)
  assert.throws(()=>apply({rules:[rule('draw',['backdoor'],'Check')]}),/Unknown draw/)
  assert.throws(()=>H.compileCandidates(game,0,[{name:'No default',rules:[]}]),/explicit default/)
  assert.throws(()=>H.compileCandidates(game,999,[control]),/Choose a flop decision/)
})

test('converts IP bounds with the starting pot and intersects the difference with nonnegative loss',()=>{
  assert.deepEqual(H.heroBounds({lower:31,upper:32},1,80),{lower:48,upper:49})
  assert.deepEqual(H.evLoss({lower:52,upper:54},{lower:48,upper:51},0,100).chips,{lower:1,upper:6,estimate:3.5})
  assert.deepEqual(H.evLoss({lower:31,upper:32},{lower:35,upper:36},1,80),{
    chips:{lower:3,upper:5,estimate:4},potPercent:{lower:3.75,upper:6.25,estimate:5},
  })
  assert.deepEqual(H.evLoss({lower:49,upper:52},{lower:50,upper:53},0,100).chips,{lower:0,upper:2,estimate:1})
  assert.throws(()=>H.evLoss({lower:49,upper:50},{lower:51,upper:52},0,100),/inconsistent/)
})

test('rejects a different game or an opponent or additional downstream lock',()=>{
  const cfg=H.referenceConfig(fixture,'fixed'),base=preview(),reference=H.gameKey(base)
  const {decision,compiled:[candidate]}=H.compileCandidates(base,0,[cbet])
  const other=base.nodes[base.nodes[0].actions[0].child]
  const opponent=H.compileCandidates(base,other.id,[cbet]).compiled[0].lock
  assert.throws(()=>H.assertCandidateGame(core.makeGame({...cfg,nodeLocks:[opponent]},{preview:true}),reference,decision),/only the selected Hero/)
  assert.throws(()=>H.assertCandidateGame(core.makeGame({...cfg,nodeLocks:[candidate.lock,opponent]},{preview:true}),reference,decision),/only the selected Hero/)
  for(const edits of [{flopSamplingSeed:22},{pot:110},{sizes0:[66]},
    {weights0:Float64Array.from(cfg.weights0,value=>value/2)},{flopTurnSamples:49,flopRiverSamples:48}]){
    const game=core.makeGame({...cfg,...edits},{preview:true})
    assert.throws(()=>H.assertCandidateGame(game,reference,decision),/same weighted ranges/)
  }
})

test('sequential WASM results match independently constructed Float64 manual locks for OOP and IP',async()=>{
  const base=preview(),cfg=H.referenceConfig(fixture,'fixed')
  for(const selected of [base.nodes[base.root],base.nodes[base.nodes[base.root].actions[0].child]]){
    const hero=selected.p,maxIterations=80,created=[]
    const result=await H.evaluateStudy({config:{...fixture,nodeLocks:[{bad:true}]},scope:'fixed',
      selection:H.decisionDescriptor(selected),candidates:[control,cbet],maxIterations,targetWidthPercent:0},
    {compile:(game,limit)=>{
      assert.deepEqual(game.decisionNodes.filter(node=>node.locked).map(node=>node.id),created.length?[selected.id]:[])
      created.push(game.nodeLocks.length)
      const native=compile(game,limit,'auto');assert.ok(native?.sourceBacked);return native
    }})
    assert.deepEqual(created,[0,1])
    assert.equal(result.evaluationGame,'fixed-sampled-flop')
    assert.deepEqual(result.results[0].loss.chips,{lower:0,upper:0,estimate:0})
    const locked=result.results[1]
    assert.ok(locked.loss.chips.lower>=0)
    const manual={nodeId:selected.id,history:selected.history,player:hero,actions:['Check','Bet 50%'],
      comboPercentages:Object.fromEntries(base.players[hero].ids.map(hand=>[hand,[0,100]]))}
    const independent=core.makeGame({...cfg,useSuitIsomorphism:false,nodeLocks:[manual]})
    const solver=new core.CFRSolver(independent)
    for(let i=0;i<locked.equilibrium.iterations;i++)solver.step()
    const expected=solver.checkConvergence().oopEvBounds
    near(locked.equilibrium.oopBounds.lower,expected.lower)
    near(locked.equilibrium.oopBounds.upper,expected.upper)
    near(locked.equilibrium.heroBounds.lower,hero?cfg.pot-expected.upper:expected.lower)
    near(locked.equilibrium.heroBounds.upper,hero?cfg.pot-expected.lower:expected.upper)
    assert.ok(locked.equilibrium.heroBounds.lower<=result.baseline.heroBounds.upper+1e-8)
  }
})

test('defaults to the exact reference, strips other restrictions, and returns completed rows on cancellation',async()=>{
  const config={...fixture,gtoAlgorithm:'cfrplus',equilibrium:'qre',frequencyIncrements:{flop:[25,25]},
    flopChanceMode:'dynamic',storagePrecision:'f32-all',useActionFrequencyPruning:true,
    turnSizes0:[],turnSizes1:[],sizes0:[],sizes1:[],flopSizes1:[]}
  assert.throws(()=>H.referenceConfig(config,'fixed'),/Fixed runout tree/)
  const frozen=H.referenceConfig(config)
  assert.equal(frozen.gtoAlgorithm,'dcfr')
  assert.equal(frozen.equilibrium,'gto')
  assert.equal(frozen.storagePrecision,'float64')
  assert.equal(frozen.frequencyIncrements,undefined)
  assert.equal(frozen.useActionFrequencyPruning,false)
  assert.equal(frozen.flopChanceMode,'fixed')
  assert.notEqual(frozen.weights0,config.weights0)
  let cancelled=false
  const result=await H.evaluateStudy({config,selection:0,candidates:[control,cbet],maxIterations:2,targetWidthPercent:0},
    {compile:(game,limit)=>compile(game,limit,'auto'),shouldCancel:()=>cancelled,
      onProgress:progress=>{if(progress.type==='candidate')cancelled=true}})
  assert.equal(result.evaluationGame,'full-flop')
  assert.equal(result.config.flopTurnSamples,49)
  assert.equal(result.config.flopRiverSamples,48)
  assert.equal(result.cancelled,true)
  assert.equal(result.results.length,1)
  assert.equal(result.results[0].name,'Control')
  assert.match(result.baseline.backend,/WebAssembly/)
})

test('full-game scalar WASM candidate bounds agree with an independent full-tree manual lock',async()=>{
  const config={...fixture,flopSizes1:[],sizes0:[],sizes1:[],
    weights0:range(['Ks2s','8s7s','AcAd']),weights1:range(['JdJc','7d8d','AsQs'])}
  const result=await H.evaluateStudy({config,selection:0,candidates:[cbet],maxIterations:12,targetWidthPercent:0},
    {compile:(game,limit)=>compile(game,limit,'scalar')})
  assert.equal(result.evaluationGame,'full-flop')
  const actual=result.results[0].equilibrium
  assert.equal(actual.backend,'Scalar WebAssembly')
  const manual={nodeId:0,history:['Flop'],player:0,actions:['Check','Bet 50%'],
    comboPercentages:Object.fromEntries(['Ks2s','8s7s','AcAd'].map(combo=>[id(combo),[0,100]]))}
  const solver=new core.CFRSolver(core.makeGame({...H.referenceConfig(config),useSuitIsomorphism:false,nodeLocks:[manual]}))
  for(let i=0;i<actual.iterations;i++)solver.step()
  const expected=solver.checkConvergence().oopEvBounds
  near(actual.oopBounds.lower,expected.lower)
  near(actual.oopBounds.upper,expected.upper)
})
