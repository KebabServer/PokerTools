import { performance } from 'node:perf_hooks'
import { compile, core } from './harness.mjs'

const args = new Set(process.argv.slice(2))
const trials = Number(process.env.SOLVER_BENCH_TRIALS ?? 1)
const target = .5 // Chips per player on a 100-chip pot.
const maximum = 120
const weights = (minPair,minHigh,minLow) => Float64Array.from(core.ALL_COMBOS,([a,b])=>{
  const high=Math.max(core.rank(a),core.rank(b)),low=Math.min(core.rank(a),core.rank(b))
  if(high===low)return high>=minPair?1:0
  if(high<minHigh||low<minLow)return 0
  return (a&3)===(b&3)?1:.55
})
const turn = {
  board:['As','Ah','7d','2c'], pot:100, stack:200, maxRaises:0, allIn:false,
  sizes0:[33,75], sizes1:[50], turnSizes0:[50], turnSizes1:[50], gtoAlgorithm:'dcfr',
  weights0:weights(5,10,6), weights1:weights(4,11,5),
}
const root=core.makeGame({...turn,storageLayout:'dense'},{preview:true}).nodes[0]
const locked={...turn,nodeLocks:[{nodeId:root.id,history:root.history,player:root.p,
  actions:root.actions.map(a=>a.label),percentages:[50,50]}]}
const cases=[['paired-turn',turn],['locked-paired-turn',locked]]
const backends=args.has('--javascript-only')?['javascript']:args.has('--wasm-only')?['wasm']:['javascript','wasm']
const mib=bytes=>Number((bytes/1048576).toFixed(3))
function run(config,layout,backend) {
  const started=performance.now()
  const game=core.makeGame({...config,storageLayout:layout})
  if(backend==='wasm'){
    game.compiled=compile(game)
    if(!game.compiled)throw Error('WASM unavailable for '+layout)
  }
  game.profileEnabled=true
  const solver=new core.CFRSolver(game)
  const built=performance.now()
  let check
  while(solver.iteration<maximum){
    for(let i=0;i<5;i++)solver.step()
    check=solver.checkConvergence()
    if(solver.iteration>=20&&check.exploitability<=target)break
  }
  const converged=performance.now()
  const summary=solver.summary(),profile=solver.getProfile()
  return {
    requested:layout, layout:game.numericStorage.mode, backend:profile.compiled, nodes:game.nodes.length,
    ranges:game.players.map(p=>p.ids.length), chanceAliases:game.suitIsomorphism.aliasedDecisions,
    omittedRows:game.numericStorage.omittedRows??0, orbitRows:game.numericStorage.orbitRows??0,
    arenaMiB:mib(game.stateStorage.byteLength), accountedMiB:mib(game.memory), target,
    passed:check.exploitability<=target, iterations:solver.iteration, gap:check.exploitability,
    unrestrictedGap:summary.unrestrictedExploitability, oopEV:summary.value0,
    buildMs:Math.round(built-started), solveMs:Math.round(converged-built),
    policyMs:Math.round(profile.policy0Ms+profile.policy1Ms),
    traversalMs:Math.round(profile.traversal0Ms+profile.traversal1Ms), checkMs:Math.round(profile.checkMs),
  }
}
for(const [name,config] of cases) {
  if(args.has('--unlocked-only')&&name.startsWith('locked'))continue
  for (const backend of backends) for(let trial=1;trial<=trials;trial++){
    for(const layout of trial%2?['dense','compact']:['compact','dense']){
      globalThis.gc?.()
      console.log(JSON.stringify({name,trial,...run(config,layout,backend)}))
    }
  }
  const auto=core.makeGame({...config,storageLayout:'auto'},{preview:true})
  const capped=core.makeGame({...config,storageLayout:'auto',memoryLimitBytes:12*1048576})
  console.log(JSON.stringify({name,autoPreviewLayout:auto.numericStorage.mode,autoPreviewMiB:mib(auto.memory),
    autoAt12MiB:capped.numericStorage.mode,autoAt12MiBAccounted:mib(capped.memory)}))
}
