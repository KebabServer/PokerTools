/* Reusable flop rule compiler and sequential DCFR comparison. This factory
   is also embedded in the Solver's Blob worker. */
function createHeuristicTester(core) {
  'use strict';
  const madeHands=['high-card','pair','two-pair','trips','straight','flush','full-house','quads','straight-flush'];
  const pairs=['top-pair','middle-pair','bottom-pair','overpair','underpair'];
  const draws=['flush-draw','open-ended','gutshot'];
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const same=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((value,i)=>value===b[i]);
  const now=()=>performance.now();

  function referenceConfig(config,scope='full') {
    const board=core.flopMask(config.board);
    if(!['full','fixed'].includes(scope))throw Error('Choose a full game or a fixed runout tree.');
    if(scope==='fixed'&&config.flopChanceMode==='dynamic')
      throw Error('Set Setup’s flop chance training to Fixed runout tree to reuse those runouts.');
    return {...structuredClone(config),board,equilibrium:'gto',gtoAlgorithm:'dcfr',storagePrecision:'float64',
      frequencyIncrements:undefined,nodeLocks:[],useActionFrequencyPruning:false,useZeroReachPruning:false,
      useRegretPruning:false,profileEnabled:false,flopChanceMode:'fixed',
      ...(scope==='full'?{flopTurnSamples:49,flopRiverSamples:48,flopSamplingSeed:0}:{})};
  }

  function flopDecisions(game) {
    return game?.isFlop?game.decisionNodes.filter(node=>node.street==='flop'&&node.actionCount>1):[];
  }
  function decisionDescriptor(node) {
    return {nodeId:node.id,player:node.p,history:node.history.slice(),actions:node.actions.map(a=>a.label),
      actionTotals:node.actions.map(a=>a.total)};
  }
  function selectDecision(game,selection) {
    const node=flopDecisions(game).find(n=>typeof selection==='number'?n.id===selection:
      selection?.player===n.p&&same(selection.history,n.history)&&
      same(selection.actions,n.actions.map(a=>a.label))&&same(selection.actionTotals,n.actions.map(a=>a.total)));
    if(!node)throw Error('Choose a flop decision with at least two legal actions in this game.');
    return node;
  }

  function handTraits(board,boardRanks,[a,b]) {
    const cards=[...board,a,b],made=madeHands[core.fiveCardCategory(cards)];
    const x=core.rank(a),y=core.rank(b),high=boardRanks[0],low=boardRanks[2];
    let pair=null;
    // Positional labels refer to a single pair made with a private card.
    if(made==='pair'&&new Set(boardRanks).size===3){
      if(x===y)pair=x>high?'overpair':x<low?'underpair':null;
      else {
        const index=boardRanks.findIndex(rank=>rank===x||rank===y);
        pair=pairs[index]??null;
      }
    }
    const suits=[0,0,0,0],handDraws=[];
    let ranks=0;
    for(const card of cards){suits[card&3]++;ranks|=1<<core.rank(card);}
    if(suits.includes(4))handDraws.push('flush-draw');
    if(!core.straightHigh(ranks)){
      // Four consecutive ranks from 2345 through TJQK have two live ends.
      // A234 and JQKA have one end and are picked up by the general out test.
      let open=false;
      for(let low=2;low<=10;low++)if((ranks&(15<<low))===(15<<low)){open=true;break;}
      if(open)handDraws.push('open-ended');
      else for(let out=2;out<=14;out++)if(!(ranks&(1<<out))&&core.straightHigh(ranks|(1<<out))){
        handDraws.push('gutshot');break;
      }
    }
    return {made,pair,draws:handDraws};
  }

  function actionMix(input,actions) {
    const settings=typeof input==='string'?{[input]:100}:input;
    if(!object(settings))throw Error('Provide an action label or a map of action labels to percentages.');
    const mix=Array(actions.length).fill(0);
    for(const [action,percentage] of Object.entries(settings)){
      const index=actions.indexOf(action);
      if(index<0)throw Error(`Action “${action}” is unavailable. Choose ${actions.join(', ')}.`);
      if(typeof percentage!=='number'||!Number.isFinite(percentage)||percentage<0||percentage>100)
        throw Error(`The percentage for “${action}” must be a number from 0 to 100.`);
      mix[index]=percentage;
    }
    const total=mix.reduce((sum,percentage)=>sum+percentage,0);
    if(Math.abs(total-100)>1e-7)throw Error('Action percentages must total 100.');
    return mix.map(percentage=>percentage/total*100);
  }

  function exactComboId(value) {
    const a=typeof value==='string'?core.cardId(value.slice(0,2)):-1;
    const b=typeof value==='string'?core.cardId(value.slice(2)):-1;
    if(a<0||b<0||a===b)throw Error(`“${value}” must name two distinct cards, for example AsKd.`);
    return core.comboId(a,b);
  }

  function matcher(match,context) {
    if(!object(match))throw Error('Each rule needs a match object.');
    if(match.type==='all')return ()=>true;
    if(!Array.isArray(match.values)||!match.values.length||match.values.some(value=>typeof value!=='string'))
      throw Error('Provide a nonempty array of match values.');
    const {game,player,blocked,skipBlocked}=context;
    switch(match.type){
      case 'combo': {
        const ids=new Set();
        for(const value of match.values){
          const id=exactComboId(value),[a,b]=core.ALL_COMBOS[id];
          if(blocked.has(a)||blocked.has(b)){
            if(!skipBlocked)throw Error(`Combo “${value}” is blocked by the flop.`);
            skipBlocked(value);continue;
          }
          if(game.players[player].index[id]<0)throw Error(`Combo “${value}” is outside Hero’s range.`);
          ids.add(id);
        }
        return id=>ids.has(id);
      }
      case 'class': {
        const classes=new Set(match.values.map(value=>{
          const label=value.slice(0,2).toUpperCase()+value.slice(2).toLowerCase();
          if(!Object.hasOwn(core.CATEGORY_IDS,label))throw Error(`Unknown starting-hand class “${value}”.`);
          return label;
        }));
        return id=>classes.has(core.comboCategory(...core.ALL_COMBOS[id]));
      }
      case 'made':
      case 'pair':
      case 'draw': {
        const allowed=match.type==='made'?madeHands:match.type==='pair'?pairs:draws;
        const values=new Set(match.values);
        for(const value of values)if(!allowed.includes(value))throw Error(`Unknown ${match.type} “${value}”. Choose ${allowed.join(', ')}.`);
        if(match.type==='draw')return (_,traits)=>traits.draws.some(value=>values.has(value));
        return (_,traits)=>values.has(traits[match.type]);
      }
      default:throw Error('Unknown match type. Choose all, combo, class, made, pair, or draw.');
    }
  }

  function compileCandidates(game,selection,candidates,{skipBlockedCombos=false}={}) {
    if(!Array.isArray(candidates)||!candidates.length)throw Error('Provide a JSON array with at least one heuristic candidate.');
    const node=selectDecision(game,selection),decision=decisionDescriptor(node),player=node.p,board=game.board;
    const names=new Set(),blocked=new Set(board),boardRanks=board.map(core.rank).sort((a,b)=>b-a),skippedCombos=[];
    const ids=game.players[player].ids;
    const traits=ids.map(id=>handTraits(board,boardRanks,core.ALL_COMBOS[id]));
    const compiled=candidates.map((candidate,i)=>{
      if(!object(candidate)||typeof candidate.name!=='string'||!candidate.name.trim())
        throw Error(`Candidate ${i+1} needs a name.`);
      const name=candidate.name.trim();
      if(names.has(name))throw Error(`Candidate name “${name}” is repeated.`);
      names.add(name);
      try{
        if(candidate.unrestricted===true){
          if(Object.hasOwn(candidate,'rules')||Object.hasOwn(candidate,'default'))
            throw Error('An unrestricted control cannot also specify rules or a default.');
          return {name,lock:null,rows:[]};
        }
        if(Object.hasOwn(candidate,'unrestricted')&&candidate.unrestricted!==false)
          throw Error('Set unrestricted to true or false.');
        if(!Array.isArray(candidate.rules))throw Error('Provide an ordered rules array.');
        if(!Object.hasOwn(candidate,'default'))throw Error('Provide an explicit default action or mix for the remaining combos.');
        const fallback=actionMix(candidate.default,decision.actions),comboPercentages={};
        const rules=candidate.rules.map((rule,k)=>{
          try {
            if(!object(rule))throw Error('Provide a match and a mix.');
            const skipBlocked=skipBlockedCombos?combo=>skippedCombos.push({candidate:name,rule:k+1,combo}):null;
            return {test:matcher(rule.match,{game,player,blocked,skipBlocked}),mix:actionMix(rule.mix,decision.actions)};
          }catch(error){throw Error(`Rule ${k+1}. ${error.message}`);}
        });
        const rows=ids.map((id,k)=>{
          const index=rules.findIndex(rule=>rule.test(id,traits[k]));
          const mix=index<0?fallback:rules[index].mix;
          comboPercentages[id]=mix;
          return {id,combo:core.ALL_COMBOS[id].slice().reverse().map(core.cardText).join(''),mix,rule:index<0?null:index+1};
        });
        return {name,rows,lock:{...decision,board:board.slice(),pot:game.pot,stack:game.stack,comboPercentages}};
      }catch(error){throw Error(`${name}. ${error.message}`);}
    });
    return {decision,compiled,skippedCombos};
  }

  function gameKey(game) {
    // The physical signature covers normalized priors, exact chance and the
    // physical betting tree. Include the original range mass as well.
    return [core.gameSignature(game,true),game.sampledChance,...game.players.map(player=>player.rawTotal)].join('/');
  }
  function assertCandidateGame(game,reference,decision) {
    if(!game.isFlop||game.equilibrium!=='gto'||game.gtoAlgorithm!=='dcfr'||game.publicChance||
       game.hasFrequencyIncrements||game.actionPruning?.enabled||gameKey(game)!==reference)
      throw Error('Comparison requires the same weighted ranges, chance runouts, betting tree, and payoffs.');
    const [lock]=game.nodeLocks;
    if(game.nodeLocks.length!==1||lock.nodeId!==decision.nodeId||lock.player!==decision.player||
       !same(lock.history,decision.history))throw Error('A candidate may restrict only the selected Hero decision.');
  }

  function intervalEpsilon(...values) {return 64*Number.EPSILON*Math.max(1,...values.map(Math.abs));}
  function heroBounds(oop,player,pot) {
    const {lower,upper}=oop;
    if(![0,1].includes(player)||!Number.isFinite(pot)||pot<=0||![lower,upper].every(Number.isFinite)||
       lower-upper>intervalEpsilon(lower,upper,pot))throw Error('Invalid equilibrium EV bounds.');
    // Solver EV includes half the starting pot on each side. IP and OOP
    // therefore sum to the starting pot, including at the interval endpoints.
    const lo=Math.min(lower,upper),hi=Math.max(lower,upper);
    return player===0?{lower:lo,upper:hi}:{lower:pot-hi,upper:pot-lo};
  }
  function evLoss(baseline,constrained,player,pot) {
    const base=heroBounds(baseline,player,pot),candidate=heroBounds(constrained,player,pot);
    const lower=base.lower-candidate.upper,upper=base.upper-candidate.lower;
    if(upper < -intervalEpsilon(base.upper,candidate.lower,pot))
      throw Error('Equilibrium bounds are inconsistent with a Hero-only restriction.');
    return lossUnits(Math.max(0,lower),Math.max(0,upper),pot);
  }
  function lossUnits(lower,upper,pot) {
    const chips={lower,upper,estimate:(lower+upper)/2};
    return {chips,potPercent:Object.fromEntries(Object.entries(chips).map(([key,value])=>[key,100*value/pot]))};
  }

  async function evaluateStudy({config,selection,candidates,scope='full',maxIterations,targetWidthPercent,
    initialization='cold',skipBlockedCombos=false},hooks={}) {
    if(!Number.isSafeInteger(maxIterations)||maxIterations<1||maxIterations>10000000)
      throw Error('Set the Solver iteration limit to a whole number from 1 to 10,000,000.');
    if(!Number.isFinite(targetWidthPercent)||targetWidthPercent<0)throw Error('Enter a nonnegative loss interval target.');
    if(!['cold','warm'].includes(initialization))throw Error('Unknown candidate initialization method.');
    const started=now(),cfg=referenceConfig(config,scope),definitions=structuredClone(candidates);
    const solveWidth=cfg.pot*(targetWidthPercent/200);
    if(!Number.isFinite(solveWidth))throw Error('Loss interval target is too large.');
    const {compile,onProgress=()=>{},yieldControl,shouldCancel=()=>false}=hooks;
    let game=core.makeGame(cfg);
    const {decision,compiled,skippedCombos}=compileCandidates(game,selection,definitions,{skipBlockedCombos}),reference=gameKey(game);
    const result={format:'PokerTools-heuristic-results-v1',evaluationGame:game.sampledChance?'fixed-sampled-flop':'full-flop',
      config:{...cfg,weights0:Array.from(cfg.weights0),weights1:Array.from(cfg.weights1)},decision,candidates:definitions,
      gameKey:reference,maxIterations,targetWidthPercent,initialization,baseline:null,results:[],elapsedMs:0,cancelled:false,
      skippedCombos,peakSolverBytes:0};

    async function solve(solver,index,name,begin) {
      onProgress({type:'solving',name,index,total:compiled.length,iteration:0,maxIterations});
      let lastProgress=now();
      while(!shouldCancel()){
        const nextCheck=Math.min(solver.iteration+8,maxIterations);
        while(solver.iteration<nextCheck){
          const batchStart=now();
          do {solver.step();}while(solver.iteration<nextCheck&&now()-batchStart<12);
          if(now()-lastProgress>=150){
            onProgress({type:'solving',name,index,total:compiled.length,iteration:solver.iteration,maxIterations});
            lastProgress=now();
          }
          if(yieldControl)await yieldControl();
          if(shouldCancel())return null;
        }
        const check=solver.checkConvergence(),bounds=heroBounds(check.oopEvBounds,decision.player,cfg.pot);
        const reached=bounds.upper-bounds.lower<=solveWidth+intervalEpsilon(bounds.lower,bounds.upper,cfg.pot);
        if(reached||solver.iteration===maxIterations)return {
          oopBounds:check.oopEvBounds,heroBounds:bounds,exploitability:check.exploitability,
          unrestrictedExploitability:check.unrestrictedExploitability,iterations:solver.iteration,reached,
          backend:check.backend,memoryBytes:solver.game.memory,elapsedMs:now()-begin};
      }
      return null;
    }
    function bind(game) {
      if(compile)game.compiled=compile(game,cfg.memoryLimitBytes);
      result.peakSolverBytes=Math.max(result.peakSolverBytes,game.memory);
    }

    function finalize(cancelled) {
      result.cancelled=cancelled;result.elapsedMs=now()-started;
      return result;
    }
    bind(game);
    let baselineSolver=new core.CFRSolver(game);
    result.baseline=await solve(baselineSolver,0,'Unrestricted baseline',started);
    if(!result.baseline)return finalize(true);
    game=null;
    if(initialization==='cold')baselineSolver=null;
    onProgress({type:'baseline',baseline:result.baseline,evaluationGame:result.evaluationGame});
    for(const [i,candidate] of compiled.entries()){
      if(yieldControl)await yieldControl();
      if(shouldCancel())return finalize(true);
      const begin=now(),index=i+1;
      let equilibrium,loss;
      if(candidate.lock){
        onProgress({type:'preparing',name:candidate.name,index,total:compiled.length});
        const game=core.makeGame({...cfg,nodeLocks:[candidate.lock]});
        assertCandidateGame(game,reference,decision);
        bind(game);
        const solver=baselineSolver?core.CFRSolver.warmStart(game,baselineSolver):new core.CFRSolver(game);
        equilibrium=await solve(solver,index,candidate.name,begin);
        if(!equilibrium)return finalize(true);
        loss=evLoss(result.baseline.oopBounds,equilibrium.oopBounds,decision.player,cfg.pot);
      }else{
        // Identical equilibrium value from the same solve, so its loss is
        // known exactly and its two uncertainties are fully correlated.
        equilibrium={...result.baseline,elapsedMs:0};
        loss=lossUnits(0,0,cfg.pot);
      }
      const row={name:candidate.name,lockedCombos:candidate.rows.length,equilibrium,loss,elapsedMs:now()-begin};
      result.results.push(row);
      onProgress({type:'candidate',row,index});
    }
    return finalize(false);
  }

  return {referenceConfig,flopDecisions,decisionDescriptor,compileCandidates,exactComboId,gameKey,assertCandidateGame,
    heroBounds,evLoss,evaluateStudy};
}
