/* Range-conditioned flop collections and sequential heuristic studies. This
   factory also runs in the Solver's Blob worker. */
function createMultiFlopTester(core,single) {
  'use strict';
  const format='PokerTools-heuristic-multi-results-v1';
  const runoutsAfterHands=48*47*46/6;
  const representativeFlops=['As 8h 3d','Kh Qh 7c','Jc Td 9s','8c 8d 3s','7s 5s 2s'];
  const now=()=>performance.now();
  const key=([a,b,c])=>(a*52+b)*52+c;
  const cardOrder=(a,b)=>a-b;
  const boardText=board=>board.slice().reverse().map(core.cardText).join(' ');

  function readBoard(input) {
    if(typeof input==='string'){
      const cards=input.replace(/[\s,]+/g,'');
      if(!/^(?:[2-9TJQKA][SHDC]){3}$/i.test(cards))throw Error(`“${input}” must contain three flop cards.`);
      input=cards.match(/../g);
    }
    return core.flopMask(input).sort(cardOrder);
  }
  function readBoards(input) {
    const list=typeof input==='string'?input.split(/\r?\n/).map(line=>line.trim()).filter(Boolean):input;
    if(!Array.isArray(list)||!list.length)throw Error('Enter one or more flops, one per line.');
    const seen=new Set();
    return list.map(value=>{
      const board=readBoard(value),id=key(board);
      if(seen.has(id))throw Error(`Duplicate flop ${boardText(board)}.`);
      seen.add(id);
      return board;
    }).sort((a,b)=>key(a)-key(b));
  }
  function* allBoards() {
    for(let a=0;a<50;a++)for(let b=a+1;b<51;b++)for(let c=b+1;c<52;c++)yield [a,b,c];
  }

  function weightedRange(input) {
    if(input?.length!==1326)throw Error('Both preflop ranges must contain 1,326 combination weights.');
    const raw=Array.from(input);
    if(raw.some(w=>!Number.isFinite(w)||w<0||w>1))throw Error('Preflop range weights must be between 0 and 1.');
    const total=raw.reduce((sum,w)=>sum+w,0);
    if(!total)throw Error('Both preflop ranges need at least one positive weight.');
    const priors=Float64Array.from(raw,w=>w/total);
    const entries=[];
    priors.forEach((w,id)=>{if(w>0)entries.push([id,...core.ALL_COMBOS[id],w]);});
    return {raw,priors,entries};
  }
  function flopProbabilities(weights0,weights1) {
    const ranges=[weightedRange(weights0),weightedRange(weights1)];
    const blocked=new Uint8Array(52),cardMass=new Float64Array(52),active=[];
    function compatibleMass(board) {
      blocked.fill(0);cardMass.fill(0);active.length=0;
      for(const card of board)blocked[card]=1;
      let total=0,mass=0;
      const [own,opp]=ranges;
      for(const hand of opp.entries){
        const [,a,b,w]=hand;
        if(blocked[a]||blocked[b])continue;
        active.push(hand);total+=w;cardMass[a]+=w;cardMass[b]+=w;
      }
      if(!total)return 0;
      for(const [id,a,b,w] of own.entries){
        if(blocked[a]||blocked[b])continue;
        // Same inclusion-exclusion as jointZ in makeGame. A rare near-zero
        // complement gets a direct sum so cancellation cannot invent mass.
        let eligible=total-cardMass[a]-cardMass[b]+opp.priors[id];
        if(eligible<=total*1e-10){
          eligible=0;
          for(const [,c,d,weight] of active)if(a!==c&&a!==d&&b!==c&&b!==d)eligible+=weight;
        }
        mass+=w*eligible;
      }
      return mass;
    }
    const jointZ=compatibleMass([]);
    if(!(jointZ>0))throw Error('The original weighted ranges have no compatible private-hand matchup.');
    const probability=board=>compatibleMass(board)/jointZ/runoutsAfterHands;
    return {ranges,jointZ,probability};
  }

  function exactRules(candidates,heroWeights) {
    if(!Array.isArray(candidates)||!candidates.length)throw Error('Provide at least one heuristic candidate.');
    return candidates.flatMap(candidate=>Array.isArray(candidate?.rules)?candidate.rules.flatMap((rule,index)=>{
      if(rule?.match?.type!=='combo')return [];
      const {values}=rule.match;
      if(!Array.isArray(values)||!values.length)throw Error('Each exact-combo rule needs one or more combos.');
      const ids=values.map(combo=>{
        const id=single.exactComboId(combo);
        if(!heroWeights[id])throw Error(`${candidate.name}. Exact combo “${combo}” is absent from Hero’s original range.`);
        return id;
      });
      return [{candidate:candidate.name?.trim(),rule:index+1,values,ids:new Set(ids)}];
    }):[]);
  }
  const swapCard=(card,suits)=>(card&~3)+suits[card&3];
  function symmetryGroup(ranges,rules,enabled) {
    if(!enabled)return [[0,1,2,3]];
    return core.suitPermutations().filter(suits=>{
      const mapping=core.ALL_COMBOS.map(([a,b])=>core.comboId(swapCard(a,suits),swapCard(b,suits)));
      return ranges.every(({raw})=>raw.every((w,id)=>w===raw[mapping[id]]))&&
        rules.every(({ids})=>Array.from(ids).every(id=>ids.has(mapping[id])));
    });
  }
  function orbit(board,group) {
    const members=new Map();
    for(const suits of group){
      const mapped=board.map(card=>swapCard(card,suits)).sort(cardOrder);
      members.set(key(mapped),mapped);
    }
    return [...members.values()].sort((a,b)=>key(a)-key(b));
  }
  function blockedRules(rules,board) {
    const blocked=new Set(board);
    return rules.flatMap(({candidate,rule,values})=>values.flatMap(combo=>
      core.ALL_COMBOS[single.exactComboId(combo)].some(card=>blocked.has(card))?[{candidate,rule,combo}]:[]));
  }

  function canonical(value) {
    if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    return value;
  }
  const encode=value=>JSON.stringify(canonical(value));
  function fingerprint(text) {
    // The opaque Solver iframe does not expose WebCrypto. Like solver
    // checkpoints, these fingerprints detect changes, not authenticity.
    let a=2166136261,b=0x9e3779b9;
    for(let i=0;i<text.length;i++){
      const code=text.charCodeAt(i);
      a=Math.imul(a^code,16777619)>>>0;
      b=(Math.imul((b+code)>>>0,2246822519)^(b>>>13))>>>0;
    }
    return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
  }
  function fingerprintInputs({config,selection,scope,maxIterations,targetWidthPercent,candidates,exactComboPolicy,collection,collapse}) {
    return {config:encode({format,config,selection,scope,maxIterations,targetWidthPercent}),
      candidates:encode({candidates,exactComboPolicy}),collection:encode({collection,collapse})};
  }
  function lossThresholds(input) {
    if(!Array.isArray(input)||input.some(x=>!Number.isFinite(x)||x<0))throw Error('Loss thresholds must be nonnegative percentages of the pot.');
    return [...new Set(input)].sort(cardOrder);
  }

  async function prepare({config:setup,selection,candidates,collection,scope='full',collapse=true,
    exactComboPolicy='strict',maxIterations,targetWidthPercent,thresholds=[.1,.5,1]},hooks={}) {
    const {yieldControl,shouldCancel=()=>false,onProgress=()=>{}}=hooks;
    if(![0,1].includes(selection?.player)||!Array.isArray(selection.history)||!Array.isArray(selection.actions)||!Array.isArray(selection.actionTotals))
      throw Error('Choose a Hero decision by betting history, player, and legal actions.');
    if(!['selected','all'].includes(collection?.mode))throw Error('Choose a flop list or all valid classes.');
    if(!['strict','skip-blocked'].includes(exactComboPolicy))throw Error('Choose how to handle blocked exact combos.');
    if(!Number.isSafeInteger(maxIterations)||maxIterations<1||maxIterations>10000000)
      throw Error('Set the Solver iteration limit to a whole number from 1 to 10,000,000.');
    if(!Number.isFinite(targetWidthPercent)||targetWidthPercent<0)throw Error('Enter a nonnegative loss interval target.');
    thresholds=lossThresholds(thresholds);
    const model=flopProbabilities(setup.weights0,setup.weights1);
    const definitions=structuredClone(candidates),rules=exactRules(definitions,model.ranges[selection.player].raw);
    const mode=collection.mode,boards=mode==='selected'?readBoards(collection.boards):null;
    let first;
    for(const board of boards??allBoards())if(model.probability(board)>0){first=board;break;}
    if(!first)throw Error('The selected flops have no compatible matchup in the original ranges.');
    const {board:_,...config}=single.referenceConfig({...setup,board:first,
      weights0:model.ranges[0].raw,weights1:model.ranges[1].raw},scope);
    if(!Number.isFinite(config.pot*(targetWidthPercent/200)))throw Error('Loss interval target is too large.');
    // A flop history and its legal decisions precede public chance. The
    // smallest chance tree lets us validate that history and all rule syntax.
    const game=core.makeGame({...config,board:first,flopTurnSamples:1,flopRiverSamples:1},{preview:true});
    const {decision,compiled}=single.compileCandidates(game,selection,definitions,{skipBlockedCombos:true});
    const {nodeId,...decisionKey}=decision;
    const full=(config.flopTurnSamples??8)===49&&(config.flopRiverSamples??6)===48;
    const group=symmetryGroup(model.ranges,rules,collapse&&full);
    const meta={format,config,selection:decisionKey,scope,candidates:definitions,exactComboPolicy,thresholds,
      collection:{mode,...(boards?{boards}:{})},collapse,maxIterations,targetWidthPercent,
      evaluationGame:full?'full-flop':'fixed-sampled-flop'};
    meta.fingerprints=Object.fromEntries(Object.entries(fingerprintInputs(meta)).map(([field,input])=>[field,fingerprint(input)]));
    const units=[],unplayable=[];
    let coverage=0,physicalBoards=0,zeroBoards=0;
    function consider(members) {
      const board=members[0],probability=model.probability(board)*members.length;
      if(probability===0){
        zeroBoards+=members.length;
        if(boards)unplayable.push(...members);
        return;
      }
      coverage+=probability;physicalBoards+=members.length;
      units.push({board,probability,multiplicity:members.length});
    }
    async function progress(scanned) {
      onProgress({type:'multi-planning',scanned,total:boards?.length??22100});
      if(yieldControl)await yieldControl();
      return shouldCancel();
    }
    if(boards){
      const selectedOrbits=new Map();
      for(const [i,board] of boards.entries()){
        const orbitKey=key(orbit(board,group)[0]);
        if(!selectedOrbits.has(orbitKey))selectedOrbits.set(orbitKey,[]);
        selectedOrbits.get(orbitKey).push(board);
        if((i+1)%256===0&&await progress(i+1))return null;
      }
      for(const members of selectedOrbits.values())consider(members);
    }else{
      const visited=new Set();
      let scanned=0;
      for(const board of allBoards()){
        if(!visited.has(key(board))){
          const members=orbit(board,group);
          for(const member of members)visited.add(key(member));
          consider(members);
        }
        if(++scanned%256===0&&await progress(scanned))return null;
      }
    }
    if(shouldCancel())return null;
    meta.plan={population:mode==='all'?'complete-population':'selected-flops',solveCount:units.length,physicalBoards,
      zeroBoards,unplayable,suitPermutations:group.length,probabilityCoverage:Math.min(1,coverage)};
    return {meta,units,rules,names:compiled.map(({name,lock})=>({name,restricted:!!lock}))};
  }

  function median(items,weight) {
    const half=items.reduce((sum,item)=>sum+weight(item),0)/2;
    let sum=0;
    for(const [i,item] of items.entries()){
      sum+=weight(item);
      if(sum>half)return item.loss.chips.estimate;
      if(sum===half)return (item.loss.chips.estimate+(items[i+1]?.loss.chips.estimate??item.loss.chips.estimate))/2;
    }
    return items.at(-1).loss.chips.estimate;
  }
  function summarize(completed,pot,thresholds) {
    if(!completed.length)return [];
    const coverage=completed.reduce((sum,row)=>sum+row.probability,0);
    return completed[0].results.map(({name},index)=>{
      const boards=completed.map(row=>({board:row.board,multiplicity:row.multiplicity,probability:row.probability,
        loss:row.results[index].loss})).sort((a,b)=>a.loss.chips.estimate-b.loss.chips.estimate);
      const mean=Object.fromEntries(['lower','upper','estimate'].map(bound=>[bound,
        boards.reduce((sum,row)=>sum+row.probability*row.loss.chips[bound],0)/coverage]));
      const below=thresholds.map(threshold=>{
        const fraction=bound=>100*boards.reduce((sum,row)=>sum+
          (row.loss.potPercent[bound]<threshold?row.probability:0),0)/coverage;
        return {threshold,estimate:fraction('estimate'),lower:fraction('upper'),upper:fraction('lower')};
      });
      return {name,loss:{chips:mean,potPercent:Object.fromEntries(Object.entries(mean).map(([k,v])=>[k,100*v/pot]))},
        medianChips:median(boards,row=>row.multiplicity),weightedMedianChips:median(boards,row=>row.probability),
        best:boards[0],worst:boards.at(-1),below};
    }).sort((a,b)=>a.loss.chips.estimate-b.loss.chips.estimate);
  }

  function cleanEquilibrium(value,meta) {
    if(!value||!Number.isSafeInteger(value.iterations)||value.iterations<1||value.iterations>meta.maxIterations||
       !Number.isFinite(value.elapsedMs)||value.elapsedMs<0||!Number.isFinite(value.memoryBytes)||value.memoryBytes<0||
       typeof value.backend!=='string'||typeof value.reached!=='boolean'||
       ![value.exploitability,value.unrestrictedExploitability].every(x=>Number.isFinite(x)&&x>=0))
      throw Error('Saved flop results contain an invalid equilibrium report.');
    const oopBounds=single.heroBounds(value.oopBounds??{},0,meta.config.pot);
    return {oopBounds,heroBounds:single.heroBounds(oopBounds,meta.selection.player,meta.config.pot),
      iterations:value.iterations,elapsedMs:value.elapsedMs,memoryBytes:value.memoryBytes,backend:value.backend,
      reached:value.reached,exploitability:value.exploitability,unrestrictedExploitability:value.unrestrictedExploitability};
  }
  function resumeRows(saved,plan) {
    if(!saved)return new Map();
    if(saved.format!==format||!Array.isArray(saved.completed))throw Error('Choose a Heuristic Tester multi-flop results JSON file.');
    const {meta,units,rules,names}=plan;
    const prior=fingerprintInputs(saved),current=fingerprintInputs(meta);
    for(const field of ['config','candidates','collection']){
      if(saved.fingerprints?.[field]!==meta.fingerprints[field]||prior[field]!==current[field])
        throw Error(`Resume ${field} fingerprint does not match. Restore the same settings or start a new comparison.`);
    }
    const byBoard=new Map(units.map(unit=>[key(unit.board),unit])),rows=new Map();
    for(const previous of saved.completed){
      const id=key(readBoard(previous.board)),unit=byBoard.get(id);
      if(!unit||rows.has(id)||previous.results?.length!==names.length||!Array.isArray(previous.results))
        throw Error('Saved results must contain unique, completed flops from this collection.');
      const skippedCombos=blockedRules(rules,unit.board);
      if(skippedCombos.length&&meta.exactComboPolicy==='strict')throw Error('A saved flop violates the exact-combo policy.');
      const baseline=cleanEquilibrium(previous.baseline,meta),{pot}=meta.config;
      const results=previous.results.map((row,i)=>{
        const {name,restricted}=names[i];
        if(row.name!==name||!Number.isSafeInteger(row.lockedCombos)||row.lockedCombos<0||row.lockedCombos>1176||
           restricted!==(row.lockedCombos>0))throw Error('Saved candidate rows do not match the current rules.');
        const equilibrium=restricted?cleanEquilibrium(row.equilibrium,meta):{...baseline,elapsedMs:0};
        const loss=restricted?single.evLoss(baseline.oopBounds,equilibrium.oopBounds,meta.selection.player,pot):
          {chips:{lower:0,upper:0,estimate:0},potPercent:{lower:0,upper:0,estimate:0}};
        return {name,lockedCombos:row.lockedCombos,equilibrium,loss};
      });
      rows.set(id,{...unit,baseline,results,skippedCombos});
    }
    return rows;
  }

  async function evaluate(request,hooks={}) {
    const started=now(),{onProgress=()=>{},shouldCancel=()=>false,yieldControl,onSnapshot}=hooks;
    const plan=await prepare(request,hooks);
    if(!plan)return {format,cancelled:true,completed:[],failed:[],elapsedMs:now()-started};
    const {meta,units,rules}=plan;
    if(meta.collection.mode==='all'&&Object.keys(meta.fingerprints).some(field=>
      request.confirmedFingerprints?.[field]!==meta.fingerprints[field]))
      throw Error('Preview the all-flop collection and explicitly run the shown number of solves first.');
    const saved=resumeRows(request.resume,plan),completed=[...saved.values()],failed=[];
    let completedCoverage=completed.reduce((sum,row)=>sum+row.probability,0);
    let peakSolverBytes=0,cancelled=false;
    for(const row of completed)for(const report of [row.baseline,...row.results.map(r=>r.equilibrium)])
      peakSolverBytes=Math.max(peakSolverBytes,report.memoryBytes);
    function report(inProgress=false) {
      const records=completed.slice().sort((a,b)=>key(a.board)-key(b.board));
      return {...meta,completed:records,failed:failed.slice(),resumed:saved.size,cancelled,inProgress,
        elapsedMs:now()-started,peakSolverBytes,completedCoverage:Math.min(1,completedCoverage),
        completedPhysicalBoards:records.reduce((sum,row)=>sum+row.multiplicity,0),
        aggregate:summarize(records,meta.config.pot,meta.thresholds)};
    }
    onSnapshot?.(()=>report(true));
    const progress=event=>onProgress({...event,total:units.length,completed:completed.length,failed:failed.length,
      completedCoverage:Math.min(1,completedCoverage),elapsedMs:now()-started});
    progress({type:'multi-ready',plan:meta.plan,resumed:saved.size});
    for(const [i,unit] of units.entries()){
      if(saved.has(key(unit.board)))continue;
      if(yieldControl)await yieldControl();
      if(shouldCancel()){cancelled=true;break;}
      const {board}=unit,index=i+1;
      progress({type:'multi-board',board,index});
      try{
        if(meta.exactComboPolicy==='strict'){
          const [first]=blockedRules(rules,board);
          if(first)throw Error(`${first.candidate}. Rule ${first.rule} requires ${first.combo}, which is blocked.`);
        }
        const study=await single.evaluateStudy({config:{...meta.config,board},selection:meta.selection,candidates:meta.candidates,
          scope:meta.scope,maxIterations:meta.maxIterations,targetWidthPercent:meta.targetWidthPercent,
          skipBlockedCombos:meta.exactComboPolicy==='skip-blocked'},
        {...hooks,onProgress:event=>progress({type:'multi-solving',board,index,solve:event})});
        peakSolverBytes=Math.max(peakSolverBytes,study.peakSolverBytes);
        if(study.results.length!==meta.candidates.length){cancelled=true;break;}
        completed.push({...unit,baseline:study.baseline,results:study.results,skippedCombos:study.skippedCombos});
        completedCoverage+=unit.probability;
        progress({type:'multi-board-completed',board,index});
      }catch(error){
        failed.push({...unit,message:error.message||String(error)});
        progress({type:'multi-board-failed',board,index,message:failed.at(-1).message});
      }
    }
    return report();
  }

  function toCsv(study) {
    const headers=['status','scope','flop','candidate','physical_boards','population_probability','loss_chips','loss_chips_lower',
      'loss_chips_upper','loss_percent_pot','loss_percent_pot_lower','loss_percent_pot_upper','message'];
    const rows=[headers];
    function add(status,board,name,count,probability,loss,message=''){
      const values=loss?[loss.chips,loss.potPercent].flatMap(({estimate,lower,upper})=>[estimate,lower,upper]):Array(6).fill('');
      rows.push([status,study.evaluationGame,board,name,count,probability,...values,message]);
    }
    for(const row of study.aggregate)add('aggregate','',row.name,study.completedPhysicalBoards,study.completedCoverage,row.loss);
    for(const board of study.completed)for(const row of board.results)
      add('completed',boardText(board.board),row.name,board.multiplicity,board.probability,row.loss);
    for(const board of study.failed)add('failed',boardText(board.board),'',board.multiplicity,board.probability,null,board.message);
    const field=value=>{
      if(typeof value==='number')return String(value);
      const safe=/^\s*[=+@-]/.test(value)?"'"+value:value;
      return '"'+safe.replaceAll('"','""')+'"';
    };
    return rows.map(row=>row.map(field).join(',')).join('\r\n')+'\r\n';
  }

  return {format,representativeFlops,readBoards,boardText,flopProbabilities,prepare,evaluate,summarize,toCsv};
}
