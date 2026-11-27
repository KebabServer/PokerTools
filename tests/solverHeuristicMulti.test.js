import assert from 'node:assert/strict'
import test from 'node:test'
import { compile, core, heuristicTester as single, multiFlopTester as multi } from '../scripts/solver/harness.mjs'

const card=core.cardId
const combo=cards=>core.comboId(card(cards.slice(0,2)),card(cards.slice(2)))
function range(ordered){
  const result=new Float64Array(1326)
  for(const [cards,weight] of Object.entries(ordered))result[combo(cards)]=weight
  return result
}
const config={board:['7h','5s','2d'],pot:100,stack:80,maxRaises:0,allIn:false,maxNodes:100000,
  flopSizes0:[50],flopSizes1:[50],turnSizes0:[],turnSizes1:[],sizes0:[33],sizes1:[],
  flopTurnSamples:3,flopRiverSamples:4,flopSamplingSeed:21,storageLayout:'compact',
  weights0:range({AsKs:1,KhKc:.2,QdJd:.6,'9s9d':1,'6c5c':.4}),
  weights1:range({AhKd:1,QhQs:.4,ThTs:.3,'8s7s':.7,'4d3d':1,'2h2c':.2})}
const root={player:0,history:['Flop'],actions:['Check','Bet 50%'],actionTotals:[0,50]}
const control={name:'Control',unrestricted:true}
const bet={name:'Bet range',rules:[],default:'Bet 50%'}
const check={name:'Check range',rules:[],default:'Check'}
const defaults={config,selection:root,candidates:[control,bet],maxIterations:16,targetWidthPercent:0,scope:'fixed',
  collection:{mode:'selected',boards:['As 8h 3d','Kh Qh 7c','Jc Td 9s']}}
const exactBoards=48*47*46/6
function near(got,want,tolerance=1e-10){assert.ok(Math.abs(got-want)<tolerance,`${got} differs from ${want}`)}
function rawMass(w0,w1,board){
  const allowed=hand=>hand.every(c=>!board.includes(c));let total=0
  for(const [i,a] of core.ALL_COMBOS.entries())if(w0[i]&&allowed(a))
    for(const [j,b] of core.ALL_COMBOS.entries())if(w1[j]&&allowed(b)&&core.compatible(a,b))total+=w0[i]*w1[j]
  return total
}

test('flop probability includes both weighted ranges, blockers and hole-card compatibility',()=>{
  const w0=range({AsKh:1,QdQc:.5}),w1=range({JcTd:.25,As9c:1})
  const model=multi.flopProbabilities(w0,w1),rawTotal=rawMass(w0,w1,[])
  near(rawTotal,.875)
  near(model.jointZ,rawTotal/(1.5*1.25))
  for(const board of multi.readBoards(['2c 3d 4h','As 3d 4h','Qd 3d 4h','Jc 3d 4h','Kh As Jc'])){
    const probability=model.probability(board)
    near(probability,rawMass(w0,w1,board)/rawTotal/exactBoards,1e-15)
    if(probability){
      const game=core.makeGame({...config,weights0:w0,weights1:w1,board})
      const [a,b]=game.players
      near(probability,game.jointZ*a.rawTotal*b.rawTotal/rawTotal/exactBoards,1e-15)
    }
  }
  // Sum over physical boards rather than assuming equal suited class mass.
  let total=0
  for(let a=0;a<50;a++)for(let b=a+1;b<51;b++)for(let c=b+1;c<52;c++)total+=model.probability([a,b,c])
  near(total,1)
})

test('all valid classes use true suit-orbit multiplicities and cover the complete population',async()=>{
  const wide=new Float64Array(1326).fill(1)
  const request={...defaults,config:{...config,weights0:wide,weights1:wide},scope:'full',collection:{mode:'all'}}
  const plan=await multi.prepare(request)
  assert.equal(plan.meta.plan.suitPermutations,24)
  assert.equal(plan.meta.plan.solveCount,1755)
  assert.equal(plan.meta.plan.physicalBoards,22100)
  assert.equal(plan.meta.plan.population,'complete-population')
  near(plan.meta.plan.probabilityCoverage,1)
  const lookup=board=>plan.units.find(unit=>multi.boardText(unit.board)===board)
  assert.equal(lookup('4s 3s 2s').multiplicity,4)
  assert.ok(plan.units.some(unit=>unit.multiplicity===24&&Math.abs(unit.probability-24/22100)<1e-13))
  assert.ok(plan.units.every(unit=>Math.abs(unit.probability-unit.multiplicity/22100)<1e-14))
  await assert.rejects(multi.evaluate(request,{compile:()=>assert.fail('unconfirmed collection solved')}),/explicitly run/)
})

test('selected flops only collapse their own multiplicity and exact rules or sampled runouts restrict symmetry',async()=>{
  const wide=new Float64Array(1326).fill(1),collection={mode:'selected',boards:['4s 3s 2s','4h 3h 2h','4c 3c 2c']}
  const full={...defaults,config:{...config,weights0:wide,weights1:wide},collection,scope:'full'}
  const linked=await multi.prepare(full)
  assert.equal(linked.units.length,1)
  assert.equal(linked.units[0].multiplicity,3)
  near(linked.units[0].probability,3/22100,1e-14)
  const named={name:'Exact override',rules:[{match:{type:'combo',values:['AsKd']},mix:'Bet 50%'}],default:'Check'}
  const reduced=await multi.prepare({...full,candidates:[named]})
  assert.equal(reduced.meta.plan.suitPermutations,2)
  assert.deepEqual(reduced.units.map(unit=>unit.multiplicity),[1,2])
  const fixed=await multi.prepare({...full,scope:'fixed'})
  assert.equal(fixed.meta.plan.suitPermutations,1)
  assert.deepEqual(fixed.units.map(unit=>unit.multiplicity),[1,1,1])
  const asymmetric=await multi.prepare({...full,config:{...config,weights0:range({AsKd:1}),weights1:range({QhJc:1})}})
  assert.equal(asymmetric.meta.plan.suitPermutations,1)
  assert.equal(asymmetric.units.length,3)
  near(asymmetric.units[0].probability,1/exactBoards,1e-15)
})

test('aggregate loss, bounds, medians, extremes and threshold probabilities use completed mass',()=>{
  const loss=(lower,upper)=>{
    const bounds={lower,upper,estimate:(lower+upper)/2}
    return {chips:bounds,potPercent:bounds}
  }
  const rows=[{board:[0,5,10],probability:.1,multiplicity:1,results:[{name:'A',loss:loss(0,2)},{name:'B',loss:loss(0,0)}]},
    {board:[1,6,11],probability:.3,multiplicity:3,results:[{name:'A',loss:loss(4,6)},{name:'B',loss:loss(0,0)}]}]
  const [best,row]=multi.summarize(rows,100,[5])
  assert.equal(best.name,'B')
  near(row.loss.chips.estimate,4)
  near(row.loss.chips.lower,3)
  near(row.loss.chips.upper,5)
  assert.equal(row.medianChips,5)
  assert.equal(row.weightedMedianChips,5)
  assert.deepEqual(row.best.board,rows[0].board)
  assert.deepEqual(row.worst.board,rows[1].board)
  near(row.below[0].lower,25)
  near(row.below[0].estimate,25)
  near(row.below[0].upper,100)
  assert.deepEqual(multi.summarize([],100,[5]),[])
})

test('reuses one WASM baseline per flop and matches independent single-flop solves by IP action history',async()=>{
  const oneRunout=core.makeGame({...config,flopTurnSamples:1,flopRiverSamples:1},{preview:true})
  const ip=oneRunout.nodes[oneRunout.nodes[0].actions[1].child]
  const selection=single.decisionDescriptor(ip),candidates=[control,{name:'Only fold',rules:[],default:'Fold'},
    {name:'Only call',rules:[],default:'Call 50'}]
  const compiled=[]
  const study=await multi.evaluate({...defaults,selection,candidates},{compile:(game,limit)=>{
    compiled.push({board:multi.boardText(game.board),locks:game.nodeLocks.length})
    const kernel=compile(game,limit,'auto');assert.ok(kernel?.sourceBacked);return kernel
  }})
  assert.equal(study.completed.length,3)
  assert.equal(study.failed.length,0)
  assert.equal(study.evaluationGame,'fixed-sampled-flop')
  assert.equal(compiled.filter(row=>!row.locks).length,3)
  assert.equal(compiled.filter(row=>row.locks===1).length,6)
  assert.equal(study.resumed,0)
  assert.ok(study.peakSolverBytes>0)
  for(const row of study.completed){
    const result=await single.evaluateStudy({config:{...config,board:row.board},selection,candidates,scope:'fixed',
      maxIterations:16,targetWidthPercent:0})
    assert.notEqual(result.decision.nodeId,selection.nodeId)
    near(row.baseline.heroBounds.lower,result.baseline.heroBounds.lower,1e-8)
    for(const [i,candidate] of row.results.entries()){
      near(candidate.loss.chips.lower,result.results[i].loss.chips.lower,1e-8)
      near(candidate.loss.chips.upper,result.results[i].loss.chips.upper,1e-8)
    }
  }
})

test('cancellation exports only completed boards and resume validates settings before skipping them',async()=>{
  let cancelled=false,snapshot,inProgress
  const partial=await multi.evaluate(defaults,{shouldCancel:()=>cancelled,onSnapshot:report=>{snapshot=report},onProgress:event=>{
    if(event.type==='multi-solving'&&event.index===2&&event.solve.type==='baseline'){
      inProgress=snapshot();cancelled=true
    }
  }})
  assert.equal(partial.cancelled,true)
  assert.equal(partial.completed.length,1)
  assert.equal(partial.failed.length,0)
  assert.equal(partial.completedCoverage,partial.completed[0].probability)
  assert.ok(partial.completedCoverage<partial.plan.probabilityCoverage)
  assert.equal(inProgress.inProgress,true)
  assert.equal(inProgress.completed.length,1)
  assert.equal(inProgress.completedCoverage,partial.completedCoverage)
  const resume=JSON.parse(JSON.stringify(inProgress))
  resume.completed[0].results[1].loss.chips.estimate=999 // Derived data is recalculated on import.
  let baselines=0
  const done=await multi.evaluate({...defaults,resume,thresholds:[3]},{compile:game=>{
    if(!game.nodeLocks.length)baselines++
    return null
  }})
  assert.equal(done.resumed,1)
  assert.equal(done.completed.length,3)
  assert.equal(baselines,2)
  assert.notEqual(done.completed[0].results[1].loss.chips.estimate,999)
  assert.equal(done.aggregate[0].below[0].threshold,3)
  near(done.completedCoverage,done.plan.probabilityCoverage,1e-14)
  await assert.rejects(multi.evaluate({...defaults,resume,maxIterations:24}),/config fingerprint/)
  await assert.rejects(multi.evaluate({...defaults,resume,candidates:[control,check]}),/candidates fingerprint/)
  const changed={...resume,config:{...resume.config,pot:123}}
  await assert.rejects(multi.evaluate({...defaults,resume:changed}),/config fingerprint/)
  const duplicate={...resume,completed:[resume.completed[0],resume.completed[0]]}
  await assert.rejects(multi.evaluate({...defaults,resume:duplicate}),/unique, completed flops/)
  assert.match(multi.toCsv(done),/"aggregate","fixed-sampled-flop"/)
  assert.match(multi.toCsv(done),/"completed"/)
})

test('invalid boards, missing original combos and zero-probability flops are accounted for explicitly',async()=>{
  assert.throws(()=>multi.readBoards(['As Kd 2s','2s As Kd']),/Duplicate flop/)
  assert.throws(()=>multi.readBoards('As As 2h'),/distinct/)
  assert.throws(()=>multi.flopProbabilities(range({AsKd:1}),range({AsQc:1})),/no compatible/)
  const narrow={...config,weights0:range({AsKd:1}),weights1:range({QhJc:1})}
  const plan=await multi.prepare({...defaults,config:narrow,collection:{mode:'selected',boards:['As 9d 7s','Ts 8c 3h']}})
  assert.equal(plan.meta.plan.zeroBoards,1)
  assert.equal(plan.meta.plan.unplayable.length,1)
  assert.equal(plan.units.length,1)
  await assert.rejects(multi.prepare({...defaults,config:narrow,collection:{mode:'selected',boards:['As 9d 7s']}}),/no compatible matchup/)
  const missing={name:'Missing exact',rules:[{match:{type:'combo',values:['AsKc']},mix:'Bet 50%'}],default:'Check'}
  await assert.rejects(multi.prepare({...defaults,candidates:[missing],exactComboPolicy:'skip-blocked'}),/absent from Hero/)
  await assert.rejects(multi.prepare({...defaults,selection:{...root,actions:['Check','Bet 66%']}}),/Choose a flop decision/)
})

test('blocked exact rules fail only the affected flop or skip with explicit per-board warnings',async()=>{
  const candidates=[{name:'=Exact override',rules:[{match:{type:'combo',values:['AsKs']},mix:'Bet 50%'}],default:'Check'}]
  const request={...defaults,candidates,collection:{mode:'selected',boards:['As 8h 3d','Kh Qh 7c']}}
  const strict=await multi.evaluate(request)
  assert.equal(strict.failed.length,1)
  assert.equal(strict.completed.length,1)
  assert.ok(strict.completedCoverage<strict.plan.probabilityCoverage)
  assert.match(strict.failed[0].message,/requires AsKs/)
  assert.match(multi.toCsv(strict),/"'=Exact override"/)
  const skip=await multi.evaluate({...request,exactComboPolicy:'skip-blocked'})
  assert.equal(skip.failed.length,0)
  const blocked=skip.completed.find(row=>row.board.includes(card('As')))
  assert.deepEqual(blocked.skippedCombos,[{candidate:'=Exact override',rule:1,combo:'AsKs'}])
  assert.equal(skip.completed.length,2)
})
