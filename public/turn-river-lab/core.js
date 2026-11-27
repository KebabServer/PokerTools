/* RiverLab — pure vanilla JS engine. Factory is self-contained so it can be
   embedded verbatim in a Blob Worker on file:// pages. No network or libraries. */
function createSolverCore() {
  'use strict';
  const RANKS = '23456789TJQKA', SUITS = 'shdc';
  const CATEGORY_RANKS = 'AKQJT98765432';
  const frequencyStreets = ['flop', 'turn', 'river'];
  const ALL_COMBOS = [], COMBO_LOOKUP = new Int16Array(52 * 52).fill(-1);
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
    const id = ALL_COMBOS.length;
    ALL_COMBOS.push([a, b]);
    COMBO_LOOKUP[a * 52 + b] = COMBO_LOOKUP[b * 52 + a] = id;
  }
  function cardId(token) {
    if (typeof token === 'number') return Number.isInteger(token) && token >= 0 && token < 52 ? token : -1;
    if (typeof token !== 'string' || token.length !== 2) return -1;
    const r = RANKS.indexOf(token[0].toUpperCase());
    const s = SUITS.indexOf(token[1].toLowerCase());
    return r < 0 || s < 0 ? -1 : r * 4 + s;
  }
  function cardText(id) { return id >= 0 && id < 52 ? RANKS[id >> 2] + SUITS[id & 3] : '?'; }
  function rank(id) { return (id >> 2) + 2; }
  function comboId(a, b) { return a === b ? -1 : COMBO_LOOKUP[a * 52 + b]; }
  function comboCategory(a, b) {
    const x = rank(a), y = rank(b);
    const hi = RANKS[Math.max(x,y)-2], lo = RANKS[Math.min(x,y)-2];
    return hi + lo + (x === y ? '' : ((a & 3) === (b & 3) ? 's' : 'o'));
  }
  const CATEGORY_IDS = {};
  for (let i = 0; i < ALL_COMBOS.length; i++) {
    const [a,b] = ALL_COMBOS[i], c = comboCategory(a,b);
    (CATEGORY_IDS[c] ||= []).push(i);
  }
  function flopMask(board) {
    if(!Array.isArray(board)||board.length!==3) throw Error('The flop board must contain exactly three cards.');
    const parsed=board.map(cardId);
    if(parsed.some(c=>c<0)||new Set(parsed).size!==3) throw Error('The three flop cards must be distinct and valid.');
    return parsed;
  }
  function turnMask(board) {
    if(!Array.isArray(board)||board.length!==4) throw Error('The turn board must contain exactly four cards.');
    const parsed=board.map(cardId);
    if(parsed.some(c=>c<0)||new Set(parsed).size!==4) throw Error('The four turn board cards must be distinct and valid.');
    return parsed;
  }
  function boardMask(board) {
    if (!Array.isArray(board) || board.length !== 5) throw Error('The board must contain exactly five cards.');
    const parsed = board.map(cardId);
    if (parsed.some(c => c < 0) || new Set(parsed).size !== 5) throw Error('The five board cards must be distinct and valid.');
    return parsed;
  }
  function compatible(a, b) { return a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]; }
  function boardCombos(board) {
    const blocked = new Uint8Array(52);
    (board.length===3 ? flopMask(board) : board.length===4 ? turnMask(board) : boardMask(board)).forEach(c => blocked[c] = 1);
    const ids = [];
    for(let i=0;i<ALL_COMBOS.length;i++) {
      const [a,b] = ALL_COMBOS[i];
      if(!blocked[a] && !blocked[b]) ids.push(i);
    }
    return ids;
  }
  function encodeScore(category, kickers) {
    // 15^5 base encoding leaves all categories strictly separated.
    let value = category;
    for (let i=0;i<5;i++) value = 15*value + (kickers[i] || 0);
    return value;
  }
  function straightHigh(mask) {
    for(let high=14; high>=5; high--) {
      let ok = true;
      for(let d=0;d<5;d++) {
        const r = high-d === 1 ? 14 : high-d;
        if(!(mask & (1 << r))) { ok=false; break; }
      }
      if(ok) return high;
    }
    return 0;
  }
  function evaluate7(cards) {
    if(cards.length!==7||new Set(cards).size!==7||cards.some(c=>!Number.isInteger(c)||c<0||c>=52))
      throw Error('Hand evaluator requires seven distinct cards.');
    return evaluate7Unchecked(cards);
  }
  function evaluate7Unchecked(cards) {
    const count = new Uint8Array(15), suitCount = new Uint8Array(4);
    const suitMasks = new Int32Array(4);
    let mask=0;
    for (const c of cards) {
      const r=rank(c), s=c&3;
      count[r]++; suitCount[s]++; mask |= 1<<r; suitMasks[s] |= 1<<r;
    }
    for(let s=0;s<4;s++) if(suitCount[s]>=5) {
      const sf = straightHigh(suitMasks[s]);
      if(sf) return encodeScore(8,[sf]);
    }
    for(let r=14;r>=2;r--) if(count[r]===4) {
      for(let k=14;k>=2;k--) if(k!==r && count[k]) return encodeScore(7,[r,k]);
    }
    let trips=0;
    for(let r=14;r>=2;r--) if(count[r]>=3) { trips=r; break; }
    if(trips) for(let r=14;r>=2;r--) if(r!==trips && count[r]>=2) return encodeScore(6,[trips,r]);
    for(let s=0;s<4;s++) if(suitCount[s]>=5) {
      const ks=[];
      for(let r=14;r>=2 && ks.length<5;r--) if(suitMasks[s] & (1<<r)) ks.push(r);
      return encodeScore(5,ks);
    }
    const st=straightHigh(mask);
    if(st) return encodeScore(4,[st]);
    if(trips) {
      const ks=[trips];
      for(let r=14;r>=2 && ks.length<3;r--) if(r!==trips && count[r]) ks.push(r);
      return encodeScore(3,ks);
    }
    const pairs=[];
    for(let r=14;r>=2;r--) if(count[r]>=2) pairs.push(r);
    if(pairs.length>=2) {
      const ks=[pairs[0],pairs[1]];
      for(let r=14;r>=2;r--) if(r!==ks[0] && r!==ks[1] && count[r]) { ks.push(r); break; }
      return encodeScore(2,ks);
    }
    if(pairs.length) {
      const ks=[pairs[0]];
      for(let r=14;r>=2 && ks.length<4;r--) if(r!==pairs[0] && count[r]) ks.push(r);
      return encodeScore(1,ks);
    }
    const ks=[];
    for(let r=14;r>=2 && ks.length<5;r--) if(count[r]) ks.push(r);
    return encodeScore(0,ks);
  }
  function showdownScores(board) {
    const b = boardMask(board), score = new Int32Array(1326).fill(-1), usable=boardCombos(b);
    for(const id of usable) {
      const [a,c] = ALL_COMBOS[id];
      score[id] = evaluate7Unchecked([b[0],b[1],b[2],b[3],b[4],a,c]);
    }
    return score;
  }
  function parseSizes(arr) {
    if(!Array.isArray(arr)) throw Error('Bet/raise sizes must be an array of percentages.');
    const sizes = [...new Set(arr.map(x=>Number(x)).filter(x=>Number.isFinite(x) && x>0 && x<=1000))].sort((a,b)=>a-b);
    // An empty array means no percentage-based actions of this type.
    if(sizes.length>8) throw Error('Specify at most eight positive sizes per bet/raise list.');
    return sizes;
  }
  function buildTree(pot,stack,sizes,maxRaises,allIn,maxNodes=1800,raiseSizes=sizes,riverDonkSizes0=null,riverEntryMode="normal") {
    if(!Number.isSafeInteger(pot) || pot<1 || !Number.isSafeInteger(stack) || stack<1) throw Error('Pot and effective stack must be positive whole chips.');
    if(!Number.isInteger(maxRaises) || maxRaises<0 || maxRaises>4) throw Error('Maximum raises must be 0–4.');
    const nodes=[];
    function terminal(type,c,winner,history) {
      if(nodes.length>=maxNodes) throw Error('Betting tree too large. Reduce bet sizes or maximum raises.');
      const id=nodes.length;
      nodes.push({id,terminal:true,type,winner,c:[...c],pot:pot+c[0]+c[1],history});
      return id;
    }
    function decision(p,c,checks,lastRaise,raises,history) {
      if(nodes.length>=maxNodes) throw Error('Betting tree too large. Reduce bet sizes or maximum raises.');
      const id=nodes.length, toCall=c[1-p]-c[p], potNow=pot+c[0]+c[1];
      const donkOpportunity=p===0&&checks===0&&toCall===0&&riverEntryMode==='ip-aggressor';
      const useDonkSizes=donkOpportunity&&riverDonkSizes0!==null;
      const node={id,terminal:false,p,c:[...c],pot:potNow,toCall,lastRaise,raises,history,donkOpportunity,actions:[]};
      nodes.push(node);
      function add(type,label,total,child) { node.actions.push({type,label,total,increment:total-c[p],child}); }
      if(toCall===0) {
        if(checks===1) add('check','Check',c[p],terminal('showdown',c,null,history.concat('Check')));
        else add('check','Check',c[p],decision(1-p,c,1,lastRaise,raises,history.concat('Check')));
      } else {
        add('fold','Fold',c[p],terminal('fold',c,1-p,history.concat('Fold')));
        const nextC=[...c];nextC[p]+=toCall;
        add('call','Call '+toCall,nextC[p],terminal('showdown',nextC,null,history.concat('Call '+toCall)));
      }
      const canAggress = toCall===0 || (raises<maxRaises && c[p]+toCall<stack && c[1-p]<stack);
      if(canAggress) {
        const used = new Set(), options=[];
        const afterCallPot = potNow+toCall;
        const streetSizes=toCall?raiseSizes:useDonkSizes?[riverDonkSizes0,sizes[1]]:sizes;
        for(const fraction of streetSizes[p]) {
          let total;
          if(toCall===0) total = c[p]+Math.max(1,Math.round(potNow*fraction/100));
          else total = c[1-p]+Math.max(lastRaise, Math.round(afterCallPot*fraction/100));
          total=Math.min(stack,total);
          if(total>c[1-p] && (toCall===0 || total-c[1-p]>=lastRaise || total===stack)) {
            options.push({total,fraction});
          }
        }
        if(allIn) options.push({total:stack,fraction:null});
        options.sort((a,b)=>a.total-b.total);
        for(const option of options) {
          const total=option.total;
          if(total<=c[1-p] || used.has(total)) continue;
          used.add(total);
          const isAllIn=total===stack, type=toCall ? 'raise' : 'bet';
          const label=isAllIn ? 'All-in '+(total-c[p]) : (toCall ? 'Raise ' : useDonkSizes ? 'Donk ' : 'Bet ')+option.fraction+'%';
          const nextC=[...c]; nextC[p]=total;
          const increase=total-c[1-p], nextLast=increase>=lastRaise?increase:lastRaise;
          const child=decision(1-p,nextC,0,nextLast,raises+(toCall>0?1:0),history.concat(label));
          add(type,label,total,child);
        }
      }
      return id;
    }
    const root=decision(0,[0,0],0,1,0,['River']);
    return {nodes,root};
  }
  // Enumerated public chance nodes for turn/river; optionally sampled for flop.
  // Flop chance samples are deterministic given the public cards, reproducible
  // across decision branches, and weighted by the inverse inclusion probability.
  function selectRunouts(board, count, samplingSeed=0) {
    const excluded=new Set(board), available=[];
    for(let c=0;c<52;c++)if(!excluded.has(c))available.push(c);
    if(count>=available.length)return available;
    let seed=2166136261;
    for(const c of board)seed=Math.imul(seed^c,16777619)>>>0;
    if(samplingSeed)seed=Math.imul(seed^(samplingSeed>>>0),16777619)>>>0;
    // Fisher-Yates with deterministic PRNG: samples distinct public cards.
    for(let i=available.length-1;i>0;i--){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const j=seed%(i+1),v=available[i];available[i]=available[j];available[j]=v;
    }
    return available.slice(0,count).sort((x,y)=>x-y);
  }
  const flopFidelities = Object.freeze({
    fast: Object.freeze([8,6]),
    intermediate: Object.freeze([16,12]),
    high: Object.freeze([32,24]),
    exact: Object.freeze([49,48])
  });

  function mapSuit(card,transform){return (card&~3)+transform.suits[card&3];}

  // Seeded, without-replacement sampling. Rejection avoids modulo bias.
  function sampleWithoutReplacement(values,count,board,seed){
    if(count===values.length)return values.slice();
    let state=(seed^0x9e3779b9)>>>0;
    for(const card of board)state=Math.imul(state^card,0x85ebca6b)>>>0;
    const shuffled=values.slice();
    for(let i=0;i<count;i++){
      const size=shuffled.length-i,limit=2**32-(2**32%size);
      let bits;
      do {
        state=(state+0x9e3779b9)>>>0;
        bits=Math.imul(state^(state>>>16),0x21f0aaad);
        bits=Math.imul(bits^(bits>>>15),0x735a2d97);
        bits=(bits^(bits>>>15))>>>0;
      } while(bits>=limit);
      const j=i+(bits%size);
      [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
    return shuffled.slice(0,count);
  }

  // The public chance plan depends on the game and seed, never on betting
  // actions or locks. Orbit sampling draws a fixed number of orbits uniformly.
  // Card counts may vary because different orbits have different sizes.
  function makeFlopRunoutPlan(board,turnSamples,riverSamples,seed,method,group){
    const plans=new Map();
    function sample(publicBoard,count,transforms){
      const available=selectRunouts(publicBoard,52);
      let cards,inclusion;
      if(method==='legacy'||count===available.length){
        cards=selectRunouts(publicBoard,count,seed);
        inclusion=cards.length/available.length;
      }else if(method==='uniform'){
        cards=sampleWithoutReplacement(available,count,publicBoard,seed);
        inclusion=count/available.length;
      }else{
        const orbits=[],seen=new Set();
        for(const card of available){
          if(seen.has(card))continue;
          const orbit=[...new Set(transforms.map(t=>mapSuit(card,t)))];
          for(const member of orbit)seen.add(member);
          orbits.push(orbit);
        }
        const orbitCount=Math.max(1,Math.round(count*orbits.length/available.length));
        cards=sampleWithoutReplacement(orbits,orbitCount,publicBoard,seed).flat();
        inclusion=orbitCount/orbits.length;
      }
      cards.sort((a,b)=>a-b);
      const weight=method==='legacy'
        ? available.length/cards.length/(available.length-4)
        : 1/(inclusion*(available.length-4));
      return {cards,inclusion,weight};
    }
    const turns=sample(board,turnSamples,group);
    plans.set(null,turns);
    for(const turn of turns.cards){
      const representative=method==='suit-orbits'?Math.min(...group.map(t=>mapSuit(turn,t))):turn;
      if(!plans.has(representative))
        plans.set(representative,sample([...board,representative],riverSamples,
          group.filter(t=>mapSuit(representative,t)===representative)));
      if(turn!==representative){
        const transform=group.find(t=>mapSuit(representative,t)===turn);
        const plan=plans.get(representative);
        plans.set(turn,{...plan,cards:plan.cards.map(c=>mapSuit(c,transform)).sort((a,b)=>a-b)});
      }
    }
    return plans;
  }

  function buildMultiStreetTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,startBoard,turnSamples=49,riverSamples=48,raiseSizes={},turnDonkSizes0=null,turnEntryMode="normal",flopDonkSizes0=null,flopEntryMode="normal",riverDonkSizes0=null,flopSamplingSeed=0,runoutPlan=null,options={}) {
    const isFlop=startBoard.length===3;
    const streetStart=isFlop?'flop':'turn';
    const nodes=[];
    let paths;
    const entry=isFlop?'Flop':'Turn';
    const logical={
      get history(){
        const labels=[];
        for(let id=this.id;paths.parents[id]>=0;){
          const parent=nodes[paths.parents[id]];
          labels.push((parent.chance?parent.runouts:parent.actions)[paths.edges[id]].label);
          id=parent.id;
        }
        labels.push(entry);
        return labels.reverse();
      }
    };
    const commitments=new Map(),labels=new Map();
    function committed(c){
      if(!options.lazyHistory)return [...c];
      const key=c[0]+':'+c[1];
      if(!commitments.has(key))commitments.set(key,c.slice());
      return commitments.get(key);
    }
    function labelFor(label){
      if(!options.lazyHistory)return label;
      if(!labels.has(label))labels.set(label,label);
      return labels.get(label);
    }
    function reserve(node,history) {
      if(nodes.length>=maxNodes) throw Error('Multi-street game tree exceeds the node budget. Reduce runouts, sizes or raises, or increase max nodes.');
      if(options.lazyHistory)Object.setPrototypeOf(node,logical);
      else node.history=history;
      node.id=nodes.length;nodes.push(node);return node.id;
    }
    function terminal(type,c,winner,history,turn,river) {
      return reserve({terminal:true,type,winner,c:committed(c),pot:pot+c[0]+c[1],turn,river},history);
    }
    function chance(street,c,history,turn=null,previousAggressor=null) {
      const id=reserve({terminal:false,chance:true,street:'deal-'+street,c:committed(c),pot:pot+c[0]+c[1],turn,river:null,runouts:[]},history);
      const node=nodes[id],publicBoard=turn===null?startBoard:[...startBoard,turn];
      const sample=runoutPlan?.get(turn);
      const selected=sample?.cards??selectRunouts(publicBoard,street==='turn'?turnSamples:riverSamples,isFlop?flopSamplingSeed:0);
      const candidateCount=52-publicBoard.length;
      // 45 turn and 44 river cards remain given both players' private hands.
      const eligiblePerDeal=candidateCount-4;
      const chanceWeight=sample?.weight??candidateCount/selected.length/eligiblePerDeal;
      node.inclusionProbability=sample?.inclusion??selected.length/candidateCount;
      for(const card of selected) {
        const nextTurn=street==='turn'?card:turn;
        const nextRiver=street==='river'?card:null;
        const label=labelFor((street==='turn'?'Turn ':'River ')+cardText(card)),nextHistory=history?.concat(label);
        const child=c[0]===stack && c[1]===stack
          ? street==='turn'?chance('river',c,nextHistory,nextTurn):terminal('showdown',c,null,nextHistory,nextTurn,nextRiver)
          : decision(street,0,c,0,1,0,nextHistory,nextTurn,nextRiver,previousAggressor);
        node.runouts.push({card,turn:nextTurn,river:nextRiver,label,child,weight:chanceWeight});
      }
      return id;
    }
    function closeStreet(street,c,history,turn,river,currentAggressor) {
      if(options.allInRunouts&&options.allInRunouts!=='explicit'&&street!=='river'&&c[0]===stack&&c[1]===stack)
        return terminal('all-in',c,null,history,turn,null);
      if(street==='flop')return chance('turn',c,history,null,currentAggressor);
      if(street==='turn')return chance('river',c,history,turn,currentAggressor);
      return terminal('showdown',c,null,history,turn,river);
    }
    function decision(street,p,c,checks,lastRaise,raises,history,turn,river,previousAggressor=null,currentAggressor=null) {
      const toCall=c[1-p]-c[p],potNow=pot+c[0]+c[1];
      if(toCall===0 && c[p]===stack)return closeStreet(street,c,history,turn,river,currentAggressor);
      const id=reserve({terminal:false,chance:false,street,turn,river,p,c:committed(c),pot:potNow,
        toCall,lastRaise,raises,actions:[]},history);
      const node=nodes[id];
      // A donk is the first OOP lead after IP was the prior street's last aggressor.
      // For a flop start, the prior preflop aggressor is supplied by the user.
      const donkOpportunity=p===0&&checks===0&&toCall===0&&
        (street==='flop'?flopEntryMode==='ip-aggressor':previousAggressor===1);
      node.donkOpportunity=donkOpportunity;
      function add(type,label,total,child){node.actions.push({type,label,total,increment:total-c[p],child});}
      if(toCall===0) {
        const label='Check';
        const child=checks===1?closeStreet(street,c,history?.concat(label),turn,river,currentAggressor)
          :decision(street,1-p,c,1,lastRaise,raises,history?.concat(label),turn,river,previousAggressor,currentAggressor);
        add('check',label,c[p],child);
      }else {
        add('fold','Fold',c[p],terminal('fold',c,1-p,history?.concat('Fold'),turn,river));
        const nextC=[...c];nextC[p]+=toCall;
        const label=labelFor('Call '+toCall);
        add('call',label,nextC[p],closeStreet(street,nextC,history?.concat(label),turn,river,currentAggressor));
      }
      const canBet=toCall===0||(raises<maxRaises&&c[p]+toCall<stack&&c[1-p]<stack);
      if(canBet) {
        const used=new Set(),options=[],afterCallPot=potNow+toCall;
        const betSizes=street==='flop'?flopSizes:street==='turn'?turnSizes:riverSizes;
        // Missing street-specific donk configuration retains historical bet labels/sizes.
        const donkSizes0=street==='flop'?flopDonkSizes0:street==='turn'?turnDonkSizes0:riverDonkSizes0;
        const useDonkSizes=donkOpportunity&&donkSizes0!==null;
        const streetSizes=toCall?(raiseSizes[street]??betSizes)
          :useDonkSizes?[donkSizes0,betSizes[1]]:betSizes;
        for(const fraction of streetSizes[p]) {
          let total=toCall===0?c[p]+Math.max(1,Math.round(potNow*fraction/100))
            :c[1-p]+Math.max(lastRaise,Math.round(afterCallPot*fraction/100));
          total=Math.min(stack,total);
          if(total>c[1-p]&&(toCall===0||total-c[1-p]>=lastRaise||total===stack))options.push({total,fraction});
        }
        if(allIn)options.push({total:stack,fraction:null});
        options.sort((a,b)=>a.total-b.total);
        for(const option of options) {
          const total=option.total;
          if(total<=c[1-p]||used.has(total))continue;
          used.add(total);
          const label=labelFor(total===stack?'All-in '+(total-c[p]):(toCall?'Raise ':useDonkSizes?'Donk ':'Bet ')+option.fraction+'%');
          const next=[...c];next[p]=total;
          const increase=total-c[1-p],newLast=increase>=lastRaise?increase:lastRaise;
          const child=decision(street,1-p,next,0,newLast,raises+(toCall>0?1:0),history?.concat(label),turn,river,
            previousAggressor,p);
          add(toCall?'raise':'bet',label,total,child);
        }
      }
      return id;
    }
    const root=decision(streetStart,0,[0,0],0,1,0,options.lazyHistory?null:[entry],null,null,
      !isFlop&&turnEntryMode==='ip-aggressor'?1:null);
    const tree={nodes,root,rivers:!isFlop?selectRunouts(startBoard,48):null};
    if(options.lazyHistory)tree.paths=paths=parentPaths(tree);
    return tree;
  }
  function buildTurnRiverTree(pot,stack,turnSizes,riverSizes,maxRaises,allIn,maxNodes,turnBoard,raiseSizes={},turnDonkSizes0=null,turnEntryMode='normal',riverDonkSizes0=null,options) {
    return buildMultiStreetTree(pot,stack,null,turnSizes,riverSizes,maxRaises,allIn,maxNodes,turnMask(turnBoard),49,48,raiseSizes,turnDonkSizes0,turnEntryMode,null,'normal',riverDonkSizes0,0,null,options);
  }
  function buildFlopTurnRiverTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,flopBoard,turnSamples=8,riverSamples=6,raiseSizes={},turnDonkSizes0=null,flopDonkSizes0=null,flopEntryMode='normal',riverDonkSizes0=null,flopSamplingSeed=0,runoutPlan=null,options) {
    return buildMultiStreetTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,flopMask(flopBoard),turnSamples,riverSamples,raiseSizes,turnDonkSizes0,'normal',flopDonkSizes0,flopEntryMode,riverDonkSizes0,flopSamplingSeed,runoutPlan,options);
  }
  // Exact public chance orbit reduction. In addition to invariant weighted
  // private ranges, sampled flop trees require the *entire* sampled chance
  // structure to be equivariant. A symmetry of the flop alone is insufficient.
  function suitPermutations(){
    function permutations(a){if(!a.length)return [[]];const out=[];
      for(let k=0;k<a.length;k++)for(const rest of permutations(a.filter((_,i)=>i!==k)))out.push([a[k],...rest]);
      return out;}
    return permutations([0,1,2,3]);
  }
  function exactSuitAutomorphisms(board,players,legacy=false){
    const out=[];
    const flop=board.slice(0,3),later=board.slice(3);
    for(const suits of suitPermutations()){
      const transform={suits};
      // The flop is dealt together. Equal ranks can let a transformation
      // swap two flop cards, while existing turn and river cards stay fixed.
      if((legacy?board.some(c=>mapSuit(c,transform)!==c):
        flop.some(c=>!flop.includes(mapSuit(c,transform)))||later.some(c=>mapSuit(c,transform)!==c)))continue;
      const maps=[];let ok=true;
      for(const player of players){
        const indices=new Uint16Array(player.ids.length),weights=legacy?player.priors:player.rawWeights;
        for(let i=0;i<player.ids.length;i++){
          const [a,b]=ALL_COMBOS[player.ids[i]];
          const mapped=comboId((a&~3)+suits[a&3],(b&~3)+suits[b&3]);
          const j=player.index[mapped];
          if(j<0||weights[j]!==weights[i]){ok=false;break;}
          indices[i]=j;
        }
        if(!ok)break;
        maps.push(indices);
      }
      if(ok){
        const inverses=maps.map(map=>{
          const inverse=new Uint16Array(map.length);
          for(let i=0;i<map.length;i++)inverse[map[i]]=i;
          return inverse;
        });
        out.push({suits,maps,inverses});
      }
    }
    return out;
  }
  function suitGroupKey(group){return group.map(t=>t.suits.join('')).join('/');}

  function chanceAutomorphisms(group,plan){
    if(!plan)return group;
    const sets=new Map(Array.from(plan,([turn,sample])=>[turn,new Set(sample.cards)]));
    return group.filter(transform=>{
      for(const [turn,sample] of plan){
        const image=turn===null?null:mapSuit(turn,transform);
        const dest=sets.get(image);
        if(!dest||dest.size!==sample.cards.length||plan.get(image).weight!==sample.weight||
          sample.cards.some(c=>!dest.has(mapSuit(c,transform))))return false;
      }
      return true;
    });
  }

  function parentPaths(tree){
    const parents=new Int32Array(tree.nodes.length).fill(-1);
    const edges=new Uint8Array(tree.nodes.length);
    for(const node of tree.nodes){
      const children=node.chance?node.runouts:node.actions;
      if(children)for(let k=0;k<children.length;k++){
        const child=children[k].child;
        parents[child]=node.id;
        edges[child]=k;
      }
    }
    return {parents,edges};
  }

  function lockAutomorphisms(tree,group,locks,paths,players){
    if(locks.size===0||group.length<=1)return group;
    const lockedPaths=new Map();
    for(const id of locks.keys()){
      const path=[];
      for(let cursor=id;cursor!==tree.root;cursor=paths.parents[cursor])
        path.push(paths.edges[cursor]);
      path.reverse();
      lockedPaths.set(id,path);
    }
    // Stabilizer of the entire restriction assignment under the already
    // verified game group. This predicate is closed under composition and
    // inverse, including locks at nodes mapped to different public histories.
    return group.filter(transform=>{
      for(const [id,source] of locks){
        let oldId=tree.root,newId=tree.root;
        for(const k of lockedPaths.get(id)){
          const oldNode=tree.nodes[oldId],newNode=tree.nodes[newId];
          if(oldNode.chance){
            const edge=oldNode.runouts[k],card=mapSuit(edge.card,transform);
            const image=newNode.runouts.find(item=>item.card===card&&item.weight===edge.weight);
            if(!image)return false;
            oldId=edge.child;newId=image.child;
          }else{
            const edge=oldNode.actions[k],image=newNode.actions[k];
            if(!image||image.total!==edge.total||image.label!==edge.label)return false;
            oldId=edge.child;newId=image.child;
          }
        }
        const node=tree.nodes[id],image=tree.nodes[newId],dest=locks.get(newId);
        if(!dest||image.p!==node.p||image.actions.length!==node.actions.length)return false;
        const map=transform.maps[node.p],a=node.actions.length,player=players[node.p];
        for(let i=0;i<map.length;i++){
          if(blockedByRunout(player.card0[i],player.card1[i],node))continue;
          const j=map[i];
          if(source.lockedMask[i]!==dest.lockedMask[j])return false;
          if(source.lockedMask[i])for(let k=0;k<a;k++)
            if(lockedProbability(source,i,k,a)!==lockedProbability(dest,j,k,a))return false;
        }
      }
      return true;
    });
  }

  function installSuitIsomorphism(tree,board,transforms,enabled,turnSamples,riverSamples,reason){
    const info={enabled:false,street:board.length===3?'flop':board.length===4?'turn':'river',
      groupSize:transforms.length||1,runouts:board.length===3?turnSamples:48,
      representatives:board.length===3?turnSamples:48,
      turnRepresentatives:null,riverRepresentatives:null,savedRunouts:0,aliasedDecisions:0,
      canonicalNodes:tree.nodes.length,reason};
    if(!enabled||transforms.length<=1)return info;
    const mapCard=mapSuit;
    // The alias tree remains structurally complete. Match chance outcomes by
    // transformed card rather than by runout array index.
    function markPair(masterId,aliasId,t){
      const master=tree.nodes[masterId],alias=tree.nodes[aliasId];
      info.canonicalNodes--;
      if(master.terminal){
        if(!alias.terminal||master.type!==alias.type||master.winner!==alias.winner||
          master.c[0]!==alias.c[0]||master.c[1]!==alias.c[1])throw Error('Isomorphic terminal mismatch');
        return;
      }
      if(master.chance||alias.chance){
        if(!master.chance||!alias.chance||master.street!==alias.street||master.runouts.length!==alias.runouts.length)
          throw Error('Isomorphic chance mismatch');
        const dest=new Map(alias.runouts.map(o=>[o.card,o]));
        for(const item of master.runouts){const edge=dest.get(mapCard(item.card,t));
          if(!edge||edge.weight!==item.weight)throw Error('Isomorphic sampled runout mismatch');
          markPair(item.child,edge.child,t);
        }
        return;
      }
      if(master.actions.length!==alias.actions.length||master.p!==alias.p)throw Error('Isomorphic betting tree mismatch');
      if(alias.isoAlias)throw Error('Duplicate suit alias');
      alias.isoAlias={source:masterId,map:t.maps[alias.p],inverse:t.inverses[alias.p]};info.aliasedDecisions++;
      for(let k=0;k<master.actions.length;k++){
        if(master.actions[k].label!==alias.actions[k].label||master.actions[k].total!==alias.actions[k].total)throw Error('Isomorphic action mismatch');
        markPair(master.actions[k].child,alias.actions[k].child,t);
      }
    }
    const stabilizers=new Map();
    function installNode(id){
      const node=tree.nodes[id];
      if(node.terminal)return;
      if(!node.chance){
        if(node.actions.length>1){
          const key=(node.turn??52)*53+(node.river??52);
          if(!stabilizers.has(key)){
            const stabilizer=transforms.filter(t=>(node.turn==null||mapCard(node.turn,t)===node.turn)&&
              (node.river==null||mapCard(node.river,t)===node.river));
            const maps=stabilizer[0].maps.map((map,p)=>Uint16Array.from(map,(_,i)=>
              Math.min(...stabilizer.map(t=>t.maps[p][i]))));
            stabilizers.set(key,maps.map(map=>map.some((v,i)=>v!==i)?map:null));
          }
          node.suitRows=stabilizers.get(key)[node.p];
        }
        for(const action of node.actions)installNode(action.child);
        return;
      }
      const automorphisms=node.street==='deal-river'&&board.length===3?
        transforms.filter(t=>mapCard(node.turn,t)===node.turn):transforms;
      const outcomes=new Map(node.runouts.map(o=>[o.card,o]));
      const seen=new Set(),groups=[];
      for(const outcome of node.runouts){
        if(seen.has(outcome.card))continue;
        const members=[];
        for(const [c,other] of outcomes){
          if(seen.has(c))continue;
          const t=automorphisms.find(t=>mapCard(outcome.card,t)===c);
          if(t){members.push({outcome:other,maps:t.maps});seen.add(c);
            if(other!==outcome)markPair(outcome.child,other.child,t);}
        }
        groups.push({representative:outcome,members});
      }
      if(groups.length<node.runouts.length){
        node.isoGroups=groups;
        info.savedRunouts+=node.runouts.length-groups.length;
        if(node.street==='deal-turn'&&info.turnRepresentatives===null)info.turnRepresentatives=groups.length;
        if(node.street==='deal-river'&&info.riverRepresentatives===null)info.riverRepresentatives=groups.length;
      }
      // Only canonical subtrees receive numerical state. Unreached aliases
      // are expanded by their exact suit permutation in reports.
      for(const g of groups)installNode(g.representative.child);
    }
    installNode(tree.root);
    info.enabled=info.savedRunouts>0;
    if(board.length===4){
      info.representatives=info.riverRepresentatives??48;
    }else info.representatives=info.turnRepresentatives??turnSamples;
    info.reason=info.enabled?'verified-suit-automorphism':'no-orbit-reduction';
    return info;
  }
  // Fixed river: suit-orbit representatives of private hands. Unlike public
  // chance reduction these save *strategy state* rows, not chance runouts.
  // Use only if both weighted ranges are exactly invariant. This compact
  // reference path deliberately avoids native kernels that assume dense rows.
  function installRiverPrivateSymmetry(board,players,enabled,group){
    const info={enabled:false,groupSize:1,handCounts:players.map(p=>p.ids.length),
      representatives:players.map(p=>p.ids.length),savedRows:0,reason:'not-applicable'};
    if(!enabled){info.reason='disabled';return info;}
    if(board.length!==5)return info;
    info.groupSize=group.length;
    if(group.length<=1){info.reason='no-exact-symmetry';return info;}
    const maps=[];
    for(let p=0;p<2;p++){
      const player=players[p],seen=new Uint8Array(player.ids.length),master=new Uint16Array(player.ids.length),reps=[];
      for(let i=0;i<player.ids.length;i++){
        if(seen[i])continue;
        reps.push(i);
        for(const t of group){const j=t.maps[p][i];seen[j]=1;master[j]=i;}
      }
      // Group orbits are complete under all automorphisms; canonical rep first.
      const ordinals=new Uint16Array(master.length),reverse=new Int16Array(master.length).fill(-1);
      for(let k=0;k<reps.length;k++)reverse[reps[k]]=k;
      for(let i=0;i<master.length;i++)ordinals[i]=reverse[master[i]];
      maps.push({master,reps:Uint16Array.from(reps),ordinals});
      info.savedRows+=player.ids.length-reps.length;
      info.representatives[p]=reps.length;
    }
    info.enabled=info.savedRows>0;
    info.reason=info.enabled?'verified-private-hand-automorphism':'no-orbit-reduction';
    if(info.enabled)info.maps=maps;
    return info;
  }
  // Immutable river payoff program for a fixed public five-card board. Each
  // program partitions the hero hands into equal-strength buckets and stores
  // the opponent's exact lower/tied bucket boundaries. This means the CFR
  // kernel never re-sorts hands or compares showdown ranks in its hot loops.
  // It only reads current Float64 reach weights; no reach-dependent result is
  // ever precomputed or shared across policy updates.
  function compileRiverPayoffLayout(mine,opp,scores,mineSorted,oppSorted) {
    const mineOrder=Uint16Array.from(mineSorted),oppOrder=Uint16Array.from(oppSorted);
    const start=[],weakEnd=[],tieEnd=[];
    let pos=0,j=0;
    while(pos<mineOrder.length){
      const score=scores[mine.ids[mineOrder[pos]]];
      while(j<oppOrder.length&&scores[opp.ids[oppOrder[j]]]<score)j++;
      const weak=j;
      while(j<oppOrder.length&&scores[opp.ids[oppOrder[j]]]===score)j++;
      let end=pos+1;
      while(end<mineOrder.length&&scores[mine.ids[mineOrder[end]]]===score)end++;
      start.push(pos);weakEnd.push(weak);tieEnd.push(j);
      pos=end;
    }
    start.push(pos);
    return {mineOrder,oppOrder,groupStart:Uint16Array.from(start),
      weakEnd:Uint16Array.from(weakEnd),tieEnd:Uint16Array.from(tieEnd)};
  }
  function riverLayoutBytes(layout){
    return layout.mineOrder.byteLength+layout.oppOrder.byteLength+
      layout.groupStart.byteLength+layout.weakEnd.byteLength+layout.tieEnd.byteLength;
  }
  function parseFrequencyIncrements(increments={}) {
    if(!increments||typeof increments!=='object'||Array.isArray(increments))throw Error('Invalid frequency increment settings.');
    return Object.fromEntries(frequencyStreets.map(street=>{
      const pair=increments[street]??[0,0];
      if(!Array.isArray(pair)||pair.length!==2)throw Error('Provide OOP and IP frequency increments for the '+street+'.');
      for(let p=0;p<2;p++){
        const step=pair[p];
        if(step===0)continue;
        const hundredths=typeof step==='number'?Math.round(step*100):NaN;
        if(!Number.isFinite(hundredths)||hundredths<1||hundredths>10000||Math.abs(step*100-hundredths)>1e-8||10000%hundredths!==0)
          throw Error(`${street[0].toUpperCase()+street.slice(1)} ${p===0?'OOP':'IP'} frequency increment must divide 100% evenly (0 for unrestricted, up to two decimal places).`);
      }
      return [street,pair.slice()];
    }));
  }

  function parseNodeLocks(game,requestedLocks){
    const {nodes,board,pot,stack,players,frequencyIncrements,equilibrium}=game;
    if(!Array.isArray(requestedLocks)||requestedLocks.length>game.maxNodeLocks)
      throw Error('Node locks must be an array of at most '+game.maxNodeLocks+' decisions.');
    if(requestedLocks.length&&equilibrium!=='gto')throw Error('Node locking currently supports GTO only, not entropy-regularized QRE.');
    const nodeLocks=[];
    const locks=new Map();
    for(const entry of requestedLocks){
      if(!entry||!Number.isSafeInteger(entry.nodeId)||locks.has(entry.nodeId))
        throw Error('Node locks must have unique decision-node IDs.');
      const node=nodes[entry.nodeId];
      if(!node||node.terminal||node.chance)throw Error('Node lock refers to a non-decision node. Recreate the lock after editing the betting tree.');
      if(!Array.isArray(entry.history)||JSON.stringify(entry.history)!==JSON.stringify(node.history)||
         entry.player!==node.p||
         (entry.board!==undefined&&JSON.stringify(entry.board)!==JSON.stringify(board))||
         (entry.pot!==undefined&&entry.pot!==pot)||(entry.stack!==undefined&&entry.stack!==stack)||
         (entry.actionTotals!==undefined&&JSON.stringify(entry.actionTotals)!==JSON.stringify(node.actions.map(a=>a.total)))||
         !Array.isArray(entry.actions)||
         JSON.stringify(entry.actions)!==JSON.stringify(node.actions.map(a=>a.label)))
        throw Error('Node lock no longer matches its betting history or legal actions. Clear or recreate it.');
      const whole=entry.percentages!==undefined;
      const partial=entry.comboPercentages!==undefined;
      if(whole===partial)throw Error('A node lock must provide either whole-node percentages or exact combo percentages.');
      const player=players[node.p],n=player.ids.length,a=node.actions.length;
      const legal=i=>!blockedByRunout(player.card0[i],player.card1[i],node);
      const probabilityRow=values=>{
        if(!Array.isArray(values)||values.length!==a||
           values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100))
          throw Error('Every locked action must have a percentage between 0 and 100.');
        const total=values.reduce((sum,v)=>sum+v,0);
        if(Math.abs(total-100)>1e-7)
          throw Error('Locked action percentages must total exactly 100%.');
        if(node.frequencyUnits&&values.some(v=>{
          const units=v*node.frequencyUnits/100;
          return Math.abs(units-Math.round(units))>1e-8;
        }))throw Error(`Node ${node.id} lock percentages must match the ${frequencyIncrements[node.street??'river'][node.p]}% frequency increment.`);
        return node.frequencyUnits?values.map(v=>Math.round(v*node.frequencyUnits/100)/node.frequencyUnits):
          values.map(v=>v/total);
      };
      const mask=new Uint8Array(n),combos={};
      let rows;
      const lockOrdinals=whole?null:new Int16Array(n).fill(-1);
      if(whole){
        rows=Float64Array.from(probabilityRow(entry.percentages));
        for(let i=0;i<n;i++)if(legal(i))mask[i]=1;
      }else{
        if(!entry.comboPercentages||typeof entry.comboPercentages!=='object'||Array.isArray(entry.comboPercentages))
          throw Error('Combo locks must be an object keyed by exact combination ID.');
        const ids=Object.keys(entry.comboPercentages);
        if(!ids.length||ids.length>n)throw Error('A combo lock must specify 1 to '+n+' available combinations.');
        rows=new Float64Array(ids.length*a);
        for(const [row,idText] of ids.entries()){
          if(!/^(0|[1-9][0-9]*)$/.test(idText))throw Error('Combo lock ID must be a canonical integer combination ID.');
          const id=Number(idText),index=players[node.p].index[id];
          if(!Number.isSafeInteger(id)||id<0||id>=1326||index<0)
            throw Error('Combo lock references a hand outside this player’s available range.');
          const [c0,c1]=ALL_COMBOS[id];
          if((node.turn!=null&&(c0===node.turn||c1===node.turn))||
             (node.river!=null&&(c0===node.river||c1===node.river)))
            throw Error('Combo lock references a hand blocked by this decision’s public cards.');
          const values=entry.comboPercentages[idText],mix=probabilityRow(values);
          mask[index]=1;combos[idText]=values.slice();
          lockOrdinals[index]=row;
          rows.set(mix,row*a);
        }
      }
      const allLocked=whole||player.ids.every((_,i)=>!legal(i)||mask[i]);
      const lockedActions=allLocked?new Uint8Array(a):null;
      if(lockedActions)for(let i=0;i<rows.length;i++)if(rows[i]>0)lockedActions[i%a]=1;
      locks.set(node.id,{locked:true,lockedMask:mask,lockedRows:rows,lockOrdinals,allLocked,lockedActions});
      nodeLocks.push({nodeId:entry.nodeId,history:node.history.slice(),player:node.p,board:board.slice(),pot,stack,
        actions:node.actions.map(a=>a.label),actionTotals:node.actions.map(a=>a.total),
        ...(whole?{percentages:entry.percentages.slice()}:{comboPercentages:Object.fromEntries(Object.entries(combos).sort((x,y)=>Number(x[0])-Number(y[0])))} )});
    }
    return {nodeLocks,locks};
  }

  function lockedProbability(node,hand,action,actions){
    return node.lockedRows[(node.lockOrdinals?.[hand]??0)*actions+action];
  }

  function applyNodeLocks(game,{nodeLocks,locks}){
    for(const entry of game.nodeLocks??[]){
      const node=game.nodes[entry.nodeId];
      node.locked=false;
      node.lockedMask=node.lockedRows=node.lockOrdinals=node.lockedActions=null;
      node.allLocked=false;
    }
    for(const [id,lock] of locks)Object.assign(game.nodes[id],lock);
    game.nodeLocks=nodeLocks;
  }

  function prepareGame(config, options={}) {
    // Preview mode never allocates regrets, strategies, showdown programs, or
    // cached public-board matrices. It is safe for the UI to keep on phones.
    const preview=!!options.preview;
    const length=Array.isArray(config.board)?config.board.length:0;
    const isFlop=length===3,isTurn=length===4;
    const board=isFlop?flopMask(config.board):isTurn?turnMask(config.board):boardMask(config.board);
    const pot=Number(config.pot),stack=Number(config.stack);
    const equilibrium=config.equilibrium??'gto';
    if(equilibrium!=='gto'&&equilibrium!=='qre')throw Error('Equilibrium must be gto or qre.');
    const frequencyIncrements=parseFrequencyIncrements(config.frequencyIncrements);
    const hasFrequencyIncrements=frequencyStreets.slice(length-3).some(street=>frequencyIncrements[street].some(Boolean));
    if(hasFrequencyIncrements&&equilibrium==='qre')throw Error('Frequency increments are available for Nash / GTO solves.');
    const requestedAlgorithm=config.gtoAlgorithm||'dcfr';
    if(!['cfrplus','dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','optimistic','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(requestedAlgorithm))throw Error('Unknown GTO convergence algorithm.');
    const gtoAlgorithm=equilibrium==='gto'?requestedAlgorithm:'cfrplus';
    const strategyStorage=config.strategyStorage??'dense';
    const strategyPrecision=config.strategyPrecision??'f64';
    const deriveCurrent=config.currentPolicyStorage==='derived';
    const allInRunouts=config.allInRunouts??(strategyStorage==='compact'?'implicit':'explicit');
    const pairEquityMaxWork=config.pairEquityMaxWork??20_000_000;
    if(!['dense','compact'].includes(strategyStorage))throw Error('Strategy storage must be dense or compact.');
    if(!['f64','f32-regret','f32-average','f32','scaled'].includes(strategyPrecision)||
       (strategyStorage==='dense'&&strategyPrecision!=='f64')||
       (strategyPrecision==='scaled'&&gtoAlgorithm!=='dcfr'))throw Error('Unsupported strategy precision for this layout or algorithm.');
    if(strategyStorage==='compact'&&(equilibrium!=='gto'||config.useActionFrequencyPruning||config.useRegretPruning))
      throw Error('Compact strategy storage supports GTO without experimental action or regret pruning.');
    if(!['stored','derived'].includes(config.currentPolicyStorage??'stored')||
      deriveCurrent&&(strategyStorage!=='compact'||strategyPrecision!=='f64'||gtoAlgorithm!=='dcfr'||hasFrequencyIncrements))
      throw Error('Derived current policy requires compact Float64 DCFR without frequency increments.');
    if(!['explicit','implicit','pair-equity'].includes(allInRunouts)||allInRunouts!=='explicit'&&strategyStorage!=='compact')
      throw Error('Implicit all-in runouts require compact strategy storage.');
    if(!Number.isSafeInteger(pairEquityMaxWork)||pairEquityMaxWork<0)throw Error('Invalid pair-equity work budget.');
    // Hybrid-only tuning; existing DCFR schedules keep their original meaning.
    const hybridSchedule={
      alphaStart:Number(config.scheduledAlphaStart??1),
      alphaGain:Number(config.scheduledAlphaGain??0.5),
      rampLength:Number(config.scheduledRampLength??16),
      averagingPower:Number(config.scheduledAveragingPower??3)};
    if(gtoAlgorithm==='dcfr-scheduled-cubic'&&(
      !Number.isFinite(hybridSchedule.alphaStart)||hybridSchedule.alphaStart<0.5||hybridSchedule.alphaStart>2||
      !Number.isFinite(hybridSchedule.alphaGain)||hybridSchedule.alphaGain<0||hybridSchedule.alphaGain>1||
      !Number.isInteger(hybridSchedule.rampLength)||hybridSchedule.rampLength<2||hybridSchedule.rampLength>256||
      !Number.isFinite(hybridSchedule.averagingPower)||hybridSchedule.averagingPower<1||hybridSchedule.averagingPower>4))
      throw Error('Hybrid schedule requires alpha start 0.5–2, alpha gain 0–1, ramp 2–256 and averaging power 1–4.');
    const qreTemperaturePercent=Number(config.qreTemperaturePercent??0.05);
    if(!Number.isFinite(qreTemperaturePercent)||qreTemperaturePercent<0.005||qreTemperaturePercent>50)
      throw Error('QRE temperature must be between 0.005% and 50% of the initial pot.');
    if(!Number.isSafeInteger(pot)||pot<1||!Number.isSafeInteger(stack)||stack<1)throw Error('Pot and effective stack must be positive whole chips.');
    const sizes=[parseSizes(config.sizes0),parseSizes(config.sizes1)];
    const maxRaises=Number(config.maxRaises),allIn=!!config.allIn;
    if(!Number.isInteger(maxRaises)||maxRaises<0||maxRaises>4)throw Error('Maximum raises must be 0–4.');
    const scores=preview||isFlop||isTurn?null:showdownScores(board),blocked=new Uint8Array(52);
    board.forEach(c=>blocked[c]=1);
    const weights=[config.weights0,config.weights1],players=[];
    for(let p=0;p<2;p++) {
      if(!weights[p]||weights[p].length!==1326)throw Error('Both ranges must contain 1,326 combination weights.');
      const ids=[],raw=[],index=new Int16Array(1326).fill(-1);
      let sum=0;
      for(let id=0;id<1326;id++) {
        const [a,b]=ALL_COMBOS[id],w=Number(weights[p][id]);
        if(!Number.isFinite(w)||w<0||w>1)throw Error('Range weights must be between 0 and 1.');
        if(!blocked[a]&&!blocked[b]&&w>0){index[id]=ids.length;ids.push(id);raw.push(w);sum+=w;}
      }
      if(sum===0)throw Error((p===0?'OOP':'IP')+' range has no available hands.');
      const priors=Float64Array.from(raw,w=>w/sum);
      const sorted=preview||isTurn||isFlop?null:Array.from({length:ids.length},(_,i)=>i).sort((a,b)=>scores[ids[a]]-scores[ids[b]]);
      players.push({ids,priors,index,sorted,sortedByRiver:isTurn?new Array(52):null,rawTotal:sum,rawWeights:Float64Array.from(raw)});
    }
    // Dense hand/card indexing, shared by terminal evaluation and compatibility
    // mass. No card decoding or global combo lookup inside the hot loops.
    for(let playerIndex=0;playerIndex<2;playerIndex++){
      const player=players[playerIndex],opponent=players[1-playerIndex];
      const n=player.ids.length;
      player.card0=new Uint8Array(n);
      player.card1=new Uint8Array(n);
      player.opponentIndex=new Int16Array(n);
      for(let i=0;i<n;i++){
        const [a,b]=ALL_COMBOS[player.ids[i]];
        player.card0[i]=a;player.card1[i]=b;
        player.opponentIndex[i]=opponent.index[player.ids[i]];
      }
    }
    // Reused private-hand blocker masks for public chance cards. These are
    // precomputed once and shared by every occurrence of the same runout card.
    for(const player of players){
      player.cardAllowed=new Array(52);
      for(let card=0;card<52;card++){
        const mask=new Uint8Array(player.ids.length);
        for(let i=0;i<player.ids.length;i++){
          mask[i]=Number(player.card0[i]!==card&&player.card1[i]!==card);
        }
        player.cardAllowed[card]=mask;
      }
    }
    const rootCompatible=compatibilityMass({players,equilibrium},0,players[1].priors,null);
    const jointZ=players[0].priors.reduce((sum,weight,i)=>
      sum+weight*rootCompatible[i],0);
    if(!(jointZ>0))throw Error('No mutually compatible OOP and IP hands exist.');
    const turnSizes=isTurn||isFlop?[parseSizes(config.turnSizes0??config.sizes0),parseSizes(config.turnSizes1??config.sizes1)]:null;
    // null means an older configuration: preserve its one-list turn action tree.
    // [] is an explicit 'no donk bet sizes' choice.
    const turnDonkSizes0=turnSizes&&config.turnDonkSizes0!=null?parseSizes(config.turnDonkSizes0):null;
    const turnEntryMode=config.turnEntryMode??(turnDonkSizes0!==null?'ip-aggressor':'normal');
    if(!['normal','ip-aggressor'].includes(turnEntryMode))throw Error('Invalid prior-flop action for turn-only solving.');
    const flopEntryMode=config.flopEntryMode??'normal';
    const riverEntryMode=config.riverEntryMode??'normal';
    if(!['normal','ip-aggressor'].includes(flopEntryMode))throw Error('Invalid preflop aggressor for flop-only solving.');
    if(!['normal','ip-aggressor'].includes(riverEntryMode))throw Error('Invalid prior-turn action for river-only solving.');
    const riverDonkSizes0=config.riverDonkSizes0!=null?parseSizes(config.riverDonkSizes0):null;
    const flopDonkSizes0=isFlop&&config.flopDonkSizes0!=null?parseSizes(config.flopDonkSizes0):null;
    const flopSizes=isFlop?[parseSizes(config.flopSizes0??config.turnSizes0??config.sizes0),parseSizes(config.flopSizes1??config.turnSizes1??config.sizes1)]:null;
    // Missing lists preserve the legacy shared sizing; explicit [] disables that type.
    const raisesByStreet={river:[parseSizes(config.raiseSizes0??sizes[0]),parseSizes(config.raiseSizes1??sizes[1])]};
    if(turnSizes)raisesByStreet.turn=[parseSizes(config.turnRaiseSizes0??turnSizes[0]),parseSizes(config.turnRaiseSizes1??turnSizes[1])];
    if(flopSizes)raisesByStreet.flop=[parseSizes(config.flopRaiseSizes0??flopSizes[0]),parseSizes(config.flopRaiseSizes1??flopSizes[1])];
    const maxNodeLocks=Number(config.maxNodeLocks??256);
    if(!Number.isSafeInteger(maxNodeLocks)||maxNodeLocks<1||maxNodeLocks>250000)
      throw Error('Invalid node lock budget.');
    const maxNodes=config.maxNodes==null?(isFlop?18000:isTurn?25000:1800):Number(config.maxNodes);
    const memoryLimitBytes=Number(config.memoryLimitBytes??0);
    if(!Number.isSafeInteger(memoryLimitBytes)||memoryLimitBytes<0)throw Error('Invalid memory limit.');
    const maxTreeNodes=strategyStorage==='compact'?1_000_000:250_000;
    if(!Number.isSafeInteger(maxNodes)||maxNodes<20||maxNodes>maxTreeNodes)
      throw Error('Maximum tree nodes must be a whole number between 20 and '+maxTreeNodes+'.');
    const fidelity=config.flopFidelity??'fast';
    if(isFlop&&!Object.hasOwn(flopFidelities,fidelity))throw Error('Unknown flop fidelity.');
    const turnSamples=isFlop?Number(config.flopTurnSamples??flopFidelities[fidelity][0]):null;
    const riverSamples=isFlop?Number(config.flopRiverSamples??flopFidelities[fidelity][1]):null;
    const samplingMethod=config.flopSamplingMethod??'legacy';
    if(isFlop&&!['legacy','uniform','suit-orbits'].includes(samplingMethod))throw Error('Unknown flop sampling method.');
    if(isFlop&&(!Number.isInteger(turnSamples)||turnSamples<1||turnSamples>49||!Number.isInteger(riverSamples)||riverSamples<1||riverSamples>48))
      throw Error('Flop runouts must specify 1–49 turn cards and 1–48 river cards.');
    const flopSamplingSeed=Number(config.flopSamplingSeed??0);
    if(!Number.isSafeInteger(flopSamplingSeed)||flopSamplingSeed<0||flopSamplingSeed>2147483647)
      throw Error('Flop sampling seed must be a whole number from 0 to 2,147,483,647.');
    const usePublicSymmetry=config.useSuitIsomorphism!==false&&(isTurn||isFlop);
    const usePrivateSymmetry=!!config.useRiverHandSymmetry&&!isTurn&&!isFlop;
    const suitGroup=usePublicSymmetry||usePrivateSymmetry||(isFlop&&samplingMethod==='suit-orbits')
      ?exactSuitAutomorphisms(board,players):null;
    const runoutPlan=isFlop?makeFlopRunoutPlan(board,turnSamples,riverSamples,flopSamplingSeed,samplingMethod,suitGroup):null;
    const treeOptions={lazyHistory:strategyStorage==='compact',allInRunouts};
    const tree=isFlop?buildFlopTurnRiverTree(pot,stack,flopSizes,turnSizes,sizes,maxRaises,allIn,maxNodes,board,turnSamples,riverSamples,raisesByStreet,turnDonkSizes0,flopDonkSizes0,flopEntryMode,riverDonkSizes0,flopSamplingSeed,runoutPlan,treeOptions)
      :isTurn?buildTurnRiverTree(pot,stack,turnSizes,sizes,maxRaises,allIn,maxNodes,board,raisesByStreet,turnDonkSizes0,turnEntryMode,riverDonkSizes0,treeOptions)
      :buildTree(pot,stack,sizes,maxRaises,allIn,maxNodes,raisesByStreet.river,riverDonkSizes0,riverEntryMode);
    if(hasFrequencyIncrements)for(const node of tree.nodes)if(!node.terminal&&!node.chance){
      const step=frequencyIncrements[node.street??'river'][node.p];
      if(step)node.frequencyUnits=Math.round(100/step);
    }
    // Adaptive exact sparse traversal: its additional live-index bookkeeping is
    // worthwhile on rivers and extremely narrow turn/flop ranges, but can
    // slow larger turn trees. Explicit useSparseTraversal overrides this.
    const pruningEnabled=!!config.useActionFrequencyPruning;
    const pruningThreshold=Number(config.actionPruneThresholdPercent??1);
    const pruningWarmup=Number(config.actionPruneWarmupIterations??200);
    const pruningRecheck=Number(config.actionPruneRecheckIterations??100);
    const pruningPlanned=Number(config.actionPrunePlannedIterations??1000);
    if(pruningEnabled){
      if(equilibrium!=='gto')throw Error('Frequency pruning is available for GTO only; QRE requires every action.');
      if(!Number.isFinite(pruningThreshold)||pruningThreshold<0.5||pruningThreshold>5)
        throw Error('Action-pruning cutoff must be 0.5–5%.');
      if(!Number.isSafeInteger(pruningWarmup)||pruningWarmup<1||
         !Number.isSafeInteger(pruningRecheck)||pruningRecheck<1||
         !Number.isSafeInteger(pruningPlanned)||pruningPlanned<1)
        throw Error('Action-pruning schedule must contain positive whole iterations.');
    }
    const actionPruning={enabled:pruningEnabled,thresholdPercent:pruningThreshold,
      warmupIterations:pruningWarmup,recheckIterations:pruningRecheck,
      plannedIterations:pruningPlanned,prunedActions:0,fullProbeIterations:0};
    const sparseTraversal=config.useSparseTraversal===undefined
      ? ((!isTurn&&!isFlop)||Math.max(players[0].ids.length,players[1].ids.length)<=64)
      : !!config.useSparseTraversal;
    const chanceGroup=usePublicSymmetry?chanceAutomorphisms(suitGroup,runoutPlan):null;
    const paths=tree.paths??parentPaths(tree);
    const sampledChance=isFlop&&(turnSamples<49||riverSamples<48);
    const base={board,isFlop,isTurn,pot,stack,equilibrium,qreTemperaturePercent,gtoAlgorithm,hybridSchedule,
      zeroReachPruning:!!config.useZeroReachPruning,regretPruning:!!config.useRegretPruning,sparseTraversal,
      qreTargetTemperature:pot*qreTemperaturePercent/100,qreTemperature:pot*qreTemperaturePercent/100,qreWarmupIterations:0,
      sizes,turnSizes,turnDonkSizes0,turnEntryMode,flopSizes,flopDonkSizes0,flopEntryMode,riverDonkSizes0,riverEntryMode,
      raisesByStreet,turnSamples,riverSamples,sampledChance,samplingMethod,flopSamplingSeed,maxRaises,allIn,
      players,...tree,jointZ,paths,actionPruning,frequencyIncrements,hasFrequencyIncrements,memoryLimitBytes,maxNodeLocks,
      strategyStorage,strategyPrecision,deriveCurrent,allInRunouts,compactState:config.compactState!==false&&equilibrium==='gto'};
    const defaultLocks=structuredClone(config.nodeLocks??[]);
    parseNodeLocks(base,defaultLocks);
    const layouts=new Map();
    function selectLayout(parsed){
      const group=lockAutomorphisms(tree,chanceGroup??(usePrivateSymmetry?suitGroup:[]),parsed.locks,paths,players);
      const key=suitGroupKey(group);
      if(layouts.has(key))return layouts.get(key);
      const nodes=tree.nodes.map(node=>!usePublicSymmetry||group.length<=1||node.terminal?node:cloneNode(node));
      const reason=!usePublicSymmetry?'disabled':group.length<chanceGroup.length?'locks-break-suit-symmetry':
        chanceGroup.length<suitGroup.length?'sampled-runouts-break-symmetry':'no-exact-symmetry';
      const suitIsomorphism=installSuitIsomorphism({nodes,root:tree.root},board,
        usePublicSymmetry?group:[],usePublicSymmetry,runoutPlan?.get(null).cards.length??49,riverSamples,reason);
      const riverPrivateSymmetry=installRiverPrivateSymmetry(board,players,usePrivateSymmetry,group);
      const layout={key,nodes,suitIsomorphism,riverPrivateSymmetry,rowLayouts:new Map()};
      // Retain recently used symmetry layouts without retaining one copy of
      // the structural overlays for every lock assignment during a batch.
      if(layouts.size===3)layouts.delete(layouts.keys().next().value);
      layouts.set(key,layout);
      return layout;
    }
    const prepareLockLayout=requested=>{
      const parsed=parseNodeLocks(base,requested);
      return {parsed,layout:selectLayout(parsed)};
    };
    if(preview){
      const {parsed,layout}=prepareLockLayout(defaultLocks);
      const game={...base,...layout,nodes:sessionNodes(layout),suitIsomorphism:{...layout.suitIsomorphism},preview:true};
      applyNodeLocks(game,parsed);
      const stateBytes=planState(game,layout);
      const boards=isFlop?new Set(tree.nodes.filter(n=>n.terminal&&n.type==='showdown')
        .map(n=>unorderedRunoutKey(n.turn,n.river))).size:isTurn?tree.rivers.length:1;
      game.memory=stateBytes+boards*(1326*4+(players[0].ids.length+players[1].ids.length)*12+3000);
      return {createGame:()=>game};
    }
    // Account for the structural objects, edges and betting history references
    // as well as typed numerical metadata. The JS-engine cost is an estimate.
    const structuralBytes=tree.nodes.reduce((bytes,node)=>bytes+160+(tree.paths?0:node.history.length*8)+
      (node.actions?.length??node.runouts?.length??0)*64,paths.parents.byteLength+paths.edges.byteLength);
    if(memoryLimitBytes&&structuralBytes>memoryLimitBytes)throw Error('Tree exceeds the preparation memory budget.');
    const scoresByRiver=isTurn?new Array(52).fill(null):null;
    const scoresByRunout=isFlop?new Map():null;
    const union=Array.from(new Set(players.flatMap(p=>p.ids)));
    const riverPayoffLayouts=new Map(),unordered=new Map();
    function showdownData(cards,sc=null){
      const available=new Uint8Array(52).fill(1);
      for(const card of cards)available[card]=0;
      if(!sc){
        sc=new Int32Array(1326).fill(-1);
        const hand=cards.concat(0,0);
        for(const id of union){
          const [a,b]=ALL_COMBOS[id];
          if(available[a]&&available[b]){
            hand[5]=a;hand[6]=b;
            sc[id]=evaluate7Unchecked(hand);
          }
        }
      }
      const sorted=players.map(player=>Uint16Array.from(player.ids.map((_,i)=>i)
        .filter(i=>sc[player.ids[i]]>=0).sort((a,b)=>sc[player.ids[a]]-sc[player.ids[b]])));
      return {scores:sc,sorted,payoff:players.map((player,p)=>
        compileRiverPayoffLayout(player,players[1-p],sc,sorted[p],sorted[1-p]))};
    }
    const fixedRiver=isTurn||isFlop?null:showdownData(board,scores);
    if(fixedRiver)unordered.set(0,fixedRiver);
    if(isTurn)for(const river of tree.rivers){
      const data=showdownData([...board,river]);
      scoresByRiver[river]=data.scores;
      for(let p=0;p<2;p++)players[p].sortedByRiver[river]=data.sorted[p];
      riverPayoffLayouts.set(52*53+river,data.payoff);
      unordered.set(river,data);
    }
    // Swapping the last two cards preserves showdown strength and blockers.
    // Share the immutable layout even though the betting histories differ.
    function attachShowdown(node){
      const key=(node.turn??52)*53+(node.river??52);
      let data=fixedRiver;
      if(isFlop){
        const unorderedKey=unorderedRunoutKey(node.turn,node.river);
        data=unordered.get(unorderedKey);
        if(!data){data=showdownData([...board,node.turn,node.river]);unordered.set(unorderedKey,data);}
        scoresByRunout.set(node.turn*52+node.river,data);
      }
      if(isTurn){
        node.riverPayoff=riverPayoffLayouts.get(key);
        node.riverScores=scoresByRiver[node.river];
      }else {
        riverPayoffLayouts.set(key,data.payoff);
        node.riverPayoff=data.payoff;
        node.riverScores=data.scores;
      }
    }
    for(const node of tree.nodes)if(node.terminal&&node.type==='showdown')attachShowdown(node);
    // Cache exact hand/runout legality once per public board instead of
    // repeatedly checking the same two card blockers at each terminal visit.
    // All 48 legal rivers are still enumerated for turn solves.
    const legalRunouts=new Map(),legalRunoutIndices=new Map();
    const fullHandIndices=players.map(player=>Uint16Array.from(player.ids,(_,i)=>i));
    function attachLegality(node){
      if(node.chance||node.turn==null&&node.river==null)return;
      const key=unorderedRunoutKey(node.turn??52,node.river??52);
      let valid=legalRunouts.get(key);
      if(!valid){
        valid=players.map(player=>{
          const flags=new Uint8Array(player.ids.length),turn=node.turn,river=node.river;
          for(let i=0;i<player.ids.length;i++){
            const a=player.card0[i],b=player.card1[i];
            flags[i]=Number((turn===null||turn===undefined||(a!==turn&&b!==turn))&&
              (river===null||river===undefined||(a!==river&&b!==river)));
          }
          return flags;
        });
        legalRunouts.set(key,valid);
        legalRunoutIndices.set(key,valid.map(flags=>{
          const indices=[];
          for(let i=0;i<flags.length;i++)if(flags[i])indices.push(i);
          return Uint16Array.from(indices);
        }));
      }
      node.valid=valid;
      node.validIndices=legalRunoutIndices.get(key);
    }
    for(const node of tree.nodes)attachLegality(node);
    const allInPrograms=new Map(),allInLeaves=new Map();
    const allInCommitted=[stack,stack];
    let allInBytes=0;
    function allInProgram(turn){
      if(allInPrograms.has(turn))return allInPrograms.get(turn);
      const dealTurn=isFlop&&turn===null;
      const sample=runoutPlan?.get(turn),cards=sample?.cards??tree.rivers;
      const weight=sample?.weight??1/44;
      const runouts=cards.map(card=>{
        if(dealTurn)return {card,weight,child:allInProgram(card)};
        const key=(turn??52)*53+card;
        if(!allInLeaves.has(key)){
          const leaf={terminal:true,type:'showdown',turn,river:card,c:allInCommitted};
          attachShowdown(leaf);
          attachLegality(leaf);
          allInLeaves.set(key,leaf);
          allInBytes+=128;
        }
        return {card,weight,child:allInLeaves.get(key)};
      });
      const program={chance:true,runouts,c:allInCommitted,turn};
      allInPrograms.set(turn,program);
      allInBytes+=128+48*runouts.length;
      return program;
    }
    for(const node of tree.nodes)if(node.type==='all-in')node.allInProgram=allInProgram(node.turn??null);
    let pairEquityBytes=0,pairEquityCount=0;
    if(allInRunouts==='pair-equity'&&!sampledChance){
      let remaining=pairEquityMaxWork;
      const [oop,ip]=players,n=oop.ids.length,m=ip.ids.length;
      for(const [turn,program] of Array.from(allInPrograms).reverse()){
        const leaves=program.runouts.flatMap(({child})=>child.terminal?[child]:child.runouts.map(r=>r.child));
        const work=n*m*leaves.length;
        if(work>remaining)continue;
        const counts=new Int16Array(n*m);
        for(const leaf of leaves){
          const sc=leaf.riverScores,index=leaf.validIndices??fullHandIndices;
          for(const i of index[0]){
            const a=oop.card0[i],b=oop.card1[i],value=sc[oop.ids[i]],row=i*m;
            for(const j of index[1]){
              const c=ip.card0[j],d=ip.card1[j];
              if(a===c||a===d||b===c||b===d)continue;
              const other=sc[ip.ids[j]];
              counts[row+j]+=value>other?1:value<other?-1:0;
            }
          }
        }
        program.pairEquity=counts;
        program.pairDenominator=isFlop&&turn===null?45*44:44;
        remaining-=work;
        pairEquityBytes+=counts.byteLength;
        pairEquityCount++;
      }
    }
    // A fully specified river has no extra runout blockers. Every combo in
    // its already board-filtered range is legal, in its original index order.
    if(!isFlop&&!isTurn)for(const node of tree.nodes)if(node.terminal)
      node.validIndices=fullHandIndices;
    let immutableBytes=structuralBytes+allInBytes+pairEquityBytes+52*16+players.reduce((sum,p)=>sum+52*p.ids.length+22*p.ids.length+2*1326,0);
    for(const data of unordered.values()){
      immutableBytes+=data.scores.byteLength+data.sorted.reduce((sum,ids)=>sum+ids.byteLength,0);
      for(const layout of data.payoff)immutableBytes+=riverLayoutBytes(layout);
    }
    for(const valid of legalRunouts.values())immutableBytes+=valid[0].byteLength+valid[1].byteLength;
    for(const indices of legalRunoutIndices.values())immutableBytes+=indices[0].byteLength+indices[1].byteLength;
    immutableBytes+=fullHandIndices[0].byteLength+fullHandIndices[1].byteLength;
    const rulesFingerprint=gameSignature(base,{rulesOnly:true});
    Object.assign(base,{scores,scoresByRiver,scoresByRunout,riverPayoffLayouts,rulesFingerprint,immutableBytes,
      structuralBytes,allInProgramCount:allInPrograms.size,pairEquityCount,pairEquityBytes});
    function legacyLayoutMatches(game){
      if(!game.suitIsomorphism.enabled&&!game.riverPrivateSymmetry.enabled)return true;
      const legacyGroup=exactSuitAutomorphisms(board,players,true);
      if(game.riverPrivateSymmetry.enabled)
        return suitGroupKey(legacyGroup)===contexts.get(game)?.key;
      if(game.nodeLocks.length||samplingMethod!=='legacy')return false;
      const oldPlan=isFlop?makeFlopRunoutPlan(board,turnSamples,riverSamples,0,'legacy',legacyGroup):null;
      return suitGroupKey(chanceAutomorphisms(legacyGroup,oldPlan))===contexts.get(game)?.key;
    }
    const prepared={
      rulesFingerprint,immutableBytes,legacyLayoutMatches,
      createGame(requestedLocks=defaultLocks,{deferState=false}={}){
        const {parsed,layout}=prepareLockLayout(requestedLocks);
        const game={...base,nodes:sessionNodes(layout),suitIsomorphism:{...layout.suitIsomorphism},
          riverPrivateSymmetry:layout.riverPrivateSymmetry,actionPruning:{...actionPruning}};
        applyNodeLocks(game,parsed);
        const stateBytes=planState(game,layout);
        game.memory=immutableBytes+stateBytes+(game.rowMetadataBytes??0);
        if(memoryLimitBytes&&game.memory>memoryLimitBytes)
          throw Error('Estimated numerical state exceeds the memory budget. Reduce runouts, ranges, bet sizes or raises.');
        game.allocateState=allocateGameState;
        if(!deferState)game.allocateState();
        contexts.set(game,{prepared,key:layout.key,deferState});
        return game;
      },
      replaceLocks(game,requestedLocks){
        const context=contexts.get(game);
        if(context?.prepared!==prepared)throw Error('Session does not belong to this prepared game.');
        const {parsed,layout}=prepareLockLayout(requestedLocks);
        if(layout.key!==context.key||game.strategyStorage==='compact'&&
          (game.nodeLocks.length!==parsed.nodeLocks.length||game.nodeLocks.some(({nodeId})=>{
            const current=game.nodes[nodeId],next=parsed.locks.get(nodeId);
            return !next||!!current.lockOrdinals!==!!next.lockOrdinals||
              current.lockedMask.some((bit,i)=>bit!==next.lockedMask[i])||
              current.lockOrdinals?.some((row,i)=>row!==next.lockOrdinals[i]);
          })))return prepared.createGame(requestedLocks,{deferState:context.deferState});
        applyNodeLocks(game,parsed);
        game.compiled?.refreshLocks?.();
        return game;
      }
    };
    return prepared;
  }

  const contexts=new WeakMap();

  function makeGame(config,options){
    return prepareGame(config,options).createGame(undefined,options);
  }

  function unorderedRunoutKey(a,b){return Math.min(a,b)*53+Math.max(a,b);}

  function sessionNodes(layout){
    return layout.nodes.map(node=>node.terminal||node.chance?node:cloneNode(node));
  }

  function cloneNode(node){return Object.assign(Object.create(Object.getPrototypeOf(node)),node);}

  function planState(game,layout){
    if(game.strategyStorage==='dense'){
      game.stateLength=stateSlots(game);
      return game.stateBytes=game.stateLength*8;
    }
    const predictive=['optimistic','dcfr-predictive'].includes(game.gtoAlgorithm);
    const scaled=game.strategyPrecision==='scaled';
    const BankTypes=scaled?[Int16Array,Int16Array,Float32Array,Float64Array,Float32Array,Float32Array]:[
      game.strategyPrecision==='f64'?Float64Array:Float32Array,
      ['f32-average','f32'].includes(game.strategyPrecision)?Float32Array:Float64Array,
      game.strategyPrecision==='f32'?Float32Array:Float64Array,Float64Array];
    let count=0,metadataBytes=0,rows=0,decisions=0;
    const shared=new Set();
    for(const node of game.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias&&node.actions.length>1){
      const p=node.p,n=game.players[p].ids.length;
      const key=(node.turn??52)*106+(node.river??52)*2+p;
      // The key identifies the ordered public board within the lock stabilizer.
      // Rule out only hands for which no legal opponent combination exists.
      let shape=layout.rowLayouts.get(key);
      if(!shape||node.locked){
        const valid=node.valid?.[p],otherValid=node.valid?.[1-p];
        const player=game.players[p],other=game.players[1-p],cards=new Uint16Array(52);
        const suit=node.suitRows??game.riverPrivateSymmetry.maps?.[p].master;
        let opponents=0;
        for(let j=0;j<other.ids.length;j++)if(otherValid?otherValid[j]:!blockedByRunout(other.card0[j],other.card1[j],node)){
          opponents++;cards[other.card0[j]]++;cards[other.card1[j]]++;
        }
        const map=new Int16Array(n).fill(-1),representatives=[];
        for(let i=0;i<n;i++){
          if(valid?!valid[i]:blockedByRunout(player.card0[i],player.card1[i],node))continue;
          if(node.lockedMask?.[i]){
            map[i]=-2-(node.lockOrdinals?.[i]??0);
            continue;
          }
          const same=player.opponentIndex[i];
          if(opponents-cards[player.card0[i]]-cards[player.card1[i]]+(same>=0?1:0)===0)continue;
          const rep=suit?.[i]??i;
          if(rep===i){map[i]=representatives.length;representatives.push(i);}
          else map[i]=map[rep];
        }
        const reps=Uint16Array.from(representatives);
        shape={map,reps};
        if(!node.locked)layout.rowLayouts.set(key,shape);
      }
      if(!shared.has(shape)){
        shared.add(shape);
        metadataBytes+=shape.map.byteLength+shape.reps.byteLength;
      }
      if(node.locked)metadataBytes+=node.lockedMask.byteLength+node.lockedRows.byteLength+(node.lockOrdinals?.byteLength??0);
      node.rowShape=shape;
      node.rowOffset=count;
      if(scaled)node.scaleOffset=rows;
      rows+=shape.reps.length;
      count+=shape.reps.length*node.actions.length;
      decisions++;
    }
    const sizes=[count,count,game.deriveCurrent?0:count,predictive?count:0,...(scaled?[rows,rows]:[])];
    let bytes=0;
    game.banks=BankTypes.map((Type,i)=>{
      const offset=Math.ceil(bytes/Type.BYTES_PER_ELEMENT)*Type.BYTES_PER_ELEMENT;
      bytes=offset+sizes[i]*Type.BYTES_PER_ELEMENT;
      return {Type,offset,length:sizes[i]};
    });
    game.stateLength=sizes.reduce((a,b)=>a+b,0);
    game.rowMetadataBytes=metadataBytes;
    game.strategyRows=rows;
    game.strategyDecisions=decisions;
    return game.stateBytes=bytes;
  }

  function stateSlots(game){
    let slots=0,saved=0;
    const unit=[false,false];
    const predictive=game.gtoAlgorithm==='optimistic'||game.gtoAlgorithm==='dcfr-predictive';
    for(const node of game.nodes)if(!node.terminal&&!node.chance){
      const n=game.players[node.p].ids.length,a=node.actions.length;
      const m=game.riverPrivateSymmetry.enabled?game.riverPrivateSymmetry.representatives[node.p]:n;
      const size=(m*2+n)*a+(game.equilibrium==='qre'?n*a+n:0)+(predictive?m*a:0);
      if(node.isoAlias)saved+=size;
      else if(game.compactState&&a===1)unit[node.p]=true;
      else slots+=size;
    }
    for(let p=0;p<2;p++)if(unit[p])slots+=3*game.players[p].ids.length;
    game.suitIsomorphism.stateBytesSaved=saved*8;
    return slots;
  }

  function allocateGameState(storage){
    if(this.stateStorage)return;
    if(this.banks){
      this.stateStorage=storage??new Uint8Array(this.stateBytes);
      const banks=this.banks.map(({Type,offset,length})=>
        new Type(this.stateStorage.buffer,this.stateStorage.byteOffset+offset,length));
      this.stateBanks=banks;
      this.decisions=this.nodes.filter(n=>n.rowShape);
      for(const node of this.decisions){
        const from=node.rowOffset,to=from+node.rowShape.reps.length*node.actions.length;
        [node.regret,node.averageSum,node.current]=banks.slice(0,3).map(bank=>bank.subarray(from,to));
        if(banks[3].length)node.previousDelta=banks[3].subarray(from,to);
        if(banks[4]){
          const from=node.scaleOffset,to=from+node.rowShape.reps.length;
          node.regretScale=banks[4].subarray(from,to);
          node.averageScale=banks[5].subarray(from,to);
        }
      }
      this.forcedPolicies=[];
    }else{
      this.stateStorage=storage??new Float64Array(this.stateLength);
      bindState(this);
    }
    initializeState(this);
  }

  function bindState(game){
    let next=0;
    const unit=[null,null],predictive=game.gtoAlgorithm==='optimistic'||game.gtoAlgorithm==='dcfr-predictive';
    function take(count){
      const view=game.stateStorage.subarray(next,next+count);
      next+=count;
      return view;
    }
    // Keep the shared forced-action views separate from learnable rows.
    for(const node of game.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias){
      const p=node.p,n=game.players[p].ids.length,a=node.actions.length;
      const m=game.riverPrivateSymmetry.enabled?game.riverPrivateSymmetry.representatives[p]:n;
      if(game.riverPrivateSymmetry.enabled)node.symmetry=game.riverPrivateSymmetry.maps[p];
      if(game.compactState&&a===1){
        if(!unit[p])unit[p]={regret:take(n),averageSum:take(n),current:take(n).fill(1)};
        Object.assign(node,unit[p],{forced:true});
        continue;
      }
      node.regret=take(m*a);node.averageSum=take(m*a);node.current=take(n*a);
      if(predictive)node.previousDelta=take(m*a);
      if(game.equilibrium==='qre'){node.qreLog=take(n*a);node.qreEntropy=take(n);}
    }
    game.decisions=game.nodes.filter(n=>n.current&&!n.forced);
    game.forcedPolicies=unit.filter(Boolean).map(entry=>entry.current);
  }

  function initializeState(game){
    for(const policy of game.forcedPolicies)policy.fill(1);
    for(const node of game.decisions??game.nodes)if(node.current&&!node.forced){
      const a=node.actions.length;
      node.current.fill(1/a);
      if(node.rowShape){projectFrequencyRows(node,node.current,true);continue;}
      if(node.locked)copyLockedRows(node,node.current);
      projectFrequencyRows(node,node.current);
      enforceSuitRows(node,node.current);
      if(game.equilibrium==='qre')refreshQreNodeCache(node,game.players[node.p].ids.length);
    }
  }

  function copyLockedRows(node,policy){
    if(!node.lockedMask)return;
    const a=node.actions.length;
    for(let h=0;h<node.lockedMask.length;h++)if(node.lockedMask[h])
      for(let k=0;k<a;k++)policy[h*a+k]=lockedProbability(node,h,k,a);
  }

  function enforceSuitRows(node,policy){
    const rows=node.suitRows,a=node.actions.length;
    if(!rows)return;
    for(let h=0;h<rows.length;h++){
      const src=rows[h];
      if(h!==src)for(let k=0;k<a;k++)policy[h*a+k]=policy[src*a+k];
    }
  }

  // Convert each hand's normalized action mix to integer units. Whole units
  // are assigned first, then the largest remainders get the remaining units.
  // Equal remainders use action order, so equivalent suit rows stay identical.
  let frequencyRemainders=new Float64Array(0);
  function projectFrequencyRows(node,policy,compact=false){
    const units=node.frequencyUnits,a=node.actions.length;
    if(!units||a===1||node.allLocked)return;
    if(frequencyRemainders.length<a)frequencyRemainders=new Float64Array(a);
    for(let h=0,off=0;off<policy.length;h++,off+=a){
      if(!compact&&node.lockedMask?.[h])continue;
      let remaining=units;
      for(let k=0;k<a;k++){
        const target=policy[off+k]*units,whole=Math.floor(target);
        policy[off+k]=whole;
        frequencyRemainders[k]=target-whole;
        remaining-=whole;
      }
      for(let i=0;i<remaining;i++){
        let best=0;
        for(let k=1;k<a;k++)if(frequencyRemainders[k]>frequencyRemainders[best])best=k;
        policy[off+best]++;
        frequencyRemainders[best]=-1;
      }
      for(let k=0;k<a;k++)policy[off+k]/=units;
    }
  }
  // Near-Nash QRE: entropy-regularized zero-sum extensive-form game.
  // Payoff = chips + T * (expected own decision entropy - opponent entropy).
  // This is a regularized equilibrium, not the old unregularized agent-logit
  // fixed point. CFR+ uses the gradient of the local entropy term and includes
  // future entropy in continuation values. The reported policy is averaged in
  // realization space. A tiny fixed tremble keeps rare lines reachable.
  const QRE_PROBABILITY_FLOOR=1e-6;
  function entropyAt(s,off,a){let h=0;for(let k=0;k<a;k++){const p=s[off+k];if(p>0)h-=p*Math.log(p);}return h;}
  // Store policy-dependent entropy/log values once per policy update. The
  // strategy is immutable during a player's CFR traversal, so opponents and
  // owners can reuse the same exact Float64 Math.log results. Refreshing after
  // currentPolicy preserves the sequential (OOP, then IP) update schedule.
  function refreshQreNodeCache(node,n){
    const s=node.current,logs=node.qreLog,entropies=node.qreEntropy,a=node.actions.length;
    for(let i=0;i<n;i++){
      const off=i*a;let h=0;
      for(let k=0;k<a;k++){
        const p=s[off+k],l=Math.log(p);
        logs[off+k]=l;
        if(p>0)h-=p*l;
      }
      entropies[i]=h;
    }
  }
  // Exact maximizer of sum(p*v)+T*H(p), subject to p>=floor and sum(p)=1.
  function logitResponse(values,temperature,floor=QRE_PROBABILITY_FLOOR) {
    if(!(temperature>0)||!Number.isFinite(temperature))throw Error('Positive QRE temperature required.');
    const n=values.length,max=Math.max(...values),out=new Float64Array(n),weights=values.map(v=>Math.exp(Math.max(-745,(v-max)/temperature))),fixed=new Uint8Array(n);
    let left=1;
    for(let pass=0;pass<n;pass++){
      let z=0;for(let k=0;k<n;k++)if(!fixed[k])z+=weights[k];
      let changed=false;
      for(let k=0;k<n;k++)if(!fixed[k]&&left*weights[k]/z<floor){fixed[k]=1;out[k]=floor;changed=true;}
      if(!changed){for(let k=0;k<n;k++)if(!fixed[k])out[k]=left*weights[k]/z;break;}
      left=1;for(let k=0;k<n;k++)if(fixed[k])left-=floor;
    }
    return out;
  }
  // Allocation-free form of logitResponse for the exact regularized
  // best-response traversal. Reuses scratch across hands instead of allocating
  // four tiny vectors for every hand at every decision node. The probability
  // floor, exponent clipping, and summation order match logitResponse.
  function logitResponseActionsInto(acts,hand,mass,temperature,count,scratch) {
    const values=scratch.values,weights=scratch.weights,fixed=scratch.fixed,out=scratch.out;
    let max=-Infinity;
    for(let k=0;k<count;k++){
      const v=acts[k][hand]/mass;
      values[k]=v;
      if(v>max)max=v;
    }
    for(let k=0;k<count;k++)weights[k]=Math.exp(Math.max(-745,(values[k]-max)/temperature));
    out.fill(0,0,count);fixed.fill(0,0,count);
    let left=1;
    for(let pass=0;pass<count;pass++){
      let z=0;for(let k=0;k<count;k++)if(!fixed[k])z+=weights[k];
      let changed=false;
      for(let k=0;k<count;k++)if(!fixed[k]&&left*weights[k]/z<QRE_PROBABILITY_FLOOR){
        fixed[k]=1;out[k]=QRE_PROBABILITY_FLOOR;changed=true;
      }
      if(!changed){for(let k=0;k<count;k++)if(!fixed[k])out[k]=left*weights[k]/z;break;}
      left=1;for(let k=0;k<count;k++)if(fixed[k])left-=QRE_PROBABILITY_FLOOR;
    }
    return out;
  }
  // Range-wide conditional action frequency, matching the range-weighted
  // "of reaching range" frequencies shown in the strategy explorer. Unlike
  // max-over-hands filtering, one rare hand cannot keep an otherwise unused
  // bet size alive. Both players' reach distributions and hand blockers count.
  // Only call on warm-up or full-probe iterations (not on every CFR step).
  function rangeWideActionFrequencies(game) {
    const frequencies=new Array(game.nodes.length);
    const p0=game.players[0],p1=game.players[1];
    const scratch=[{mass:new Float64Array(p0.ids.length),cards:new Float64Array(52)},
      {mass:new Float64Array(p1.ids.length),cards:new Float64Array(52)}];
    function visit(id,reach0,reach1){
      const node=game.nodes[id];
      if(node.terminal||node.isoAlias)return;
      if(node.chance){
        for(const outcome of node.runouts){
          const card=outcome.card??outcome.river,weight=outcome.weight??1/44;
          const allowed0=p0.cardAllowed[card],allowed1=p1.cardAllowed[card];
          const next0=new Float64Array(reach0.length),next1=new Float64Array(reach1.length);
          for(let i=0;i<next0.length;i++)if(allowed0[i])next0[i]=reach0[i]*weight;
          for(let i=0;i<next1.length;i++)if(allowed1[i])next1[i]=reach1[i];
          visit(outcome.child,next0,next1);
        }
        return;
      }
      if(node.actions.length===1){visit(node.actions[0].child,reach0,reach1);return;}
      const a=node.actions.length,p=node.p,own=p===0?reach0:reach1,
        opp=p===0?reach1:reach0,n=own.length,policy=node.current;
      let hasCandidate=false;
      for(let k=0;k<a;k++)if(['bet','raise'].includes(node.actions[k].type)&&
        !node.actions[k].label.startsWith('All-in')){hasCandidate=true;break;}
      if(hasCandidate){
        const {mass,cards}=scratch[p];
        compatibilityMassInto(game,p,opp,node,mass,cards);
        const sums=new Float64Array(a);let denom=0;
        for(let i=0;i<n;i++){
          const w=own[i]*mass[i];if(!(w>0))continue;
          denom+=w;const off=i*a;
          for(let k=0;k<a;k++)sums[k]+=w*policy[off+k];
        }
        // Unreached nodes cannot provide evidence that an action is rare.
        if(denom>1e-14)frequencies[id]=Array.from(sums,x=>x/denom);
      }
      for(let k=0;k<a;k++){
        if(node.allLocked&&!node.lockedActions[k])continue;
        const next=new Float64Array(n);
        for(let i=0;i<n;i++)next[i]=own[i]*policy[i*a+k];
        if(p===0)visit(node.actions[k].child,next,reach1);
        else visit(node.actions[k].child,reach0,next);
      }
    }
    visit(game.root,p0.priors,p1.priors);
    return frequencies;
  }
  // A culled size is disabled for EVERY private hand at this decision. Keep
  // the original tree intact for full-tree best responses and checkpoints.
  function maskRangeWidePolicy(node,policy,handCount){
    if(!node.pruned||!node.pruned.some(x=>x))return;
    const a=node.actions.length;
    for(let i=0;i<handCount;i++){
      if(node.lockedMask?.[i])continue;
      const off=i*a;let sum=0,remaining=0;
      for(let k=0;k<a;k++){
        if(node.pruned[k])policy[off+k]=0;
        else {sum+=policy[off+k];remaining++;}
      }
      if(sum>0){for(let k=0;k<a;k++)if(!node.pruned[k])policy[off+k]/=sum;}
      else {for(let k=0;k<a;k++)policy[off+k]=node.pruned[k]?0:1/remaining;}
    }
  }
  function enforceActionMask(node,handCount){
    maskRangeWidePolicy(node,node.current,handCount);
    projectFrequencyRows(node,node.current);
  }
  function enforceSuitPolicies(game,p){
    if(game.banks||game.suitIsomorphism.groupSize<=1)return;
    for(const node of game.decisions)if(node.p===p)enforceSuitRows(node,node.current);
  }

  const maxFloat32=3.4028234663852886e38;
  function accumulator(values,scales,index,actions){
    return scales?values[index]*scales[Math.floor(index/actions)]/32767:values[index];
  }
  function setScaledRow(values,scales,row,actions,updates){
    let peak=0;
    for(let k=0;k<actions;k++)peak=Math.max(peak,Math.abs(updates[k]));
    const scale=Math.fround(Math.min(peak,maxFloat32));
    scales[row]=scale;
    for(let k=0;k<actions;k++){
      const ratio=scale?updates[k]*32767/scale:0;
      values[row*actions+k]=Math.max(-32767,Math.min(32767,Math.trunc(ratio+(ratio<0?-.5:.5))));
    }
  }
  function addScaledAverage(node,current,reach,weight,updates){
    const a=node.actions.length,avg=node.averageSum,scale=node.averageScale;
    for(const [row,i] of node.rowShape.reps.entries()){
      for(let k=0;k<a;k++)updates[k]=accumulator(avg,scale,row*a+k,a)+weight*reach[i]*current[i*a+k];
      setScaledRow(avg,scale,row,a,updates);
    }
  }
  function currentPolicy(game,p) {
    if(game.banks){
      if(game.deriveCurrent)return;
      const tieFloor=16*Number.EPSILON*Math.max(1,game.pot+game.stack);
      for(const node of game.decisions)if(node.p===p){
        const a=node.actions.length,r=node.regret,s=node.current,delta=node.previousDelta,scale=node.regretScale;
        for(let off=0;off<r.length;off+=a){
          let sum=0;
          for(let k=0;k<a;k++)sum+=Math.max(0,accumulator(r,scale,off+k,a)+(delta?.[off+k]??0));
          for(let k=0;k<a;k++)s[off+k]=sum>tieFloor?
            Math.max(0,accumulator(r,scale,off+k,a)+(delta?.[off+k]??0))/sum:1/a;
        }
        projectFrequencyRows(node,s,true);
      }
      return;
    }
    if(game.compiled&&!game.nodeLocks.length){
      const nativeRefreshed=game.compiled.updatePolicy(p,game.equilibrium==='qre');
      if(game.hasFrequencyIncrements)for(const node of game.decisions)
        if(node.frequencyUnits&&node.p===p)enforceActionMask(node,game.players[p].ids.length);
      enforceSuitPolicies(game,p);
      if(game.equilibrium==='qre'&&!nativeRefreshed)for(const node of game.decisions)
        if(node.p===p)refreshQreNodeCache(node,game.players[p].ids.length);
      return;
    }
    for(const node of game.decisions) if(node.p===p&&!node.allLocked) {
      const a=node.actions.length, n=game.players[p].ids.length, r=node.regret, s=node.current;
      const floor=game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:0,scale=1-a*floor;
      const tieFloor=game.equilibrium==='qre'?0:16*Number.EPSILON*Math.max(1,game.pot+game.stack);
      // Deterministic regret matching at Float64 noise scale, not a relaxed stopping criterion.
      const variant=game.gtoAlgorithm,predictive=variant==='optimistic'||variant==='dcfr-predictive';
      for(let h=0;h<n;h++) {
        if(node.lockedMask?.[h]||(node.suitRows&&node.suitRows[h]!==h))continue;
        let sum=0, off=(node.symmetry?node.symmetry.ordinals[h]:h)*a,so=h*a;
        for(let k=0;k<a;k++){
          const v=predictive?r[off+k]+node.previousDelta[off+k]:r[off+k];
          sum+=v>0?v:0;
        }
        for(let k=0;k<a;k++){
          const v=predictive?r[off+k]+node.previousDelta[off+k]:r[off+k];
          s[so+k]=floor+scale*(sum>tieFloor?(v>0?v:0)/sum:1/a);
        }
      }
      enforceActionMask(node,n);
      enforceSuitRows(node,s);
      if(game.equilibrium==='qre')refreshQreNodeCache(node,n);
    }
  }
  function blockedByRunout(a,b,node) {
    if(!node)return false;
    return (node.turn!==null&&node.turn!==undefined&&(a===node.turn||b===node.turn))||
      (node.river!==null&&node.river!==undefined&&(a===node.river||b===node.river));
  }
  function compatibilityMass(game,target,oppReach,node) {
    return compatibilityMassInto(game,target,oppReach,node,
      new Float64Array(game.players[target].ids.length),new Float64Array(52));
  }
  // Allocation-free exact compatibility masses for CFR and best-response
  // traversals. Summation and blocker subtraction retain the reference order;
  // the rare QRE cancellation fallback remains the full compatible-hand scan.
  function compatibilityMassInto(game,target,oppReach,node,masses,cards) {
    const mine=game.players[target],opp=game.players[1-target];
    const oppLegal=node&&node.valid?node.valid[1-target]:null;
    const mineLegal=node&&node.valid?node.valid[target]:null;
    cards.fill(0);masses.fill(0);
    let total=0;
    for(let i=0;i<opp.ids.length;i++){
      const w=oppReach[i];if(!w||(oppLegal&&!oppLegal[i]))continue;
      const a=opp.card0[i],b=opp.card1[i];
      if(!oppLegal&&blockedByRunout(a,b,node))continue;
      total+=w;cards[a]+=w;cards[b]+=w;
    }
    for(let i=0;i<mine.ids.length;i++){
      const a=mine.card0[i],b=mine.card1[i],oi=mine.opponentIndex[i];
      if((mineLegal&&!mineLegal[i])||(!mineLegal&&blockedByRunout(a,b,node)))continue;
      let m=total-cards[a]-cards[b]+(oi>=0?oppReach[oi]:0);
      if(total>0&&m<total*(game.equilibrium==='qre'?1e-8:1e-12)){
        m=0;
        for(let j=0;j<opp.ids.length;j++){
          const x=opp.card0[j],y=opp.card1[j];
          if(x!==a&&x!==b&&y!==a&&y!==b&&
            ((oppLegal&&oppLegal[j])||(!oppLegal&&!blockedByRunout(x,y,node))))m+=oppReach[j];
        }
      }
      masses[i]=Math.max(0,m);
    }
    return masses;
  }
  // Exact QRE reuse: a leaf's showdown basis often already contains the
  // compatible opponent mass for this SAME reach-vector object and board.
  // Reusing it avoids a redundant O(range) blocker aggregation at the parent
  // decision. The tiny-mass cancellation fallback is computed identically to
  // compatibilityMassInto rather than approximated.
  function cachedCompatibilityMass(game,target,reach,node,kernel){
    const boards=kernel.cache.get(reach),key=(node.turn??52)*53+(node.river??52);
    const basis=boards&&boards.get(key);
    if(!basis)return compatibilityMassInto(game,target,reach,node,kernel.mass,kernel.massCards);
    const mine=game.players[target],opp=game.players[1-target],masses=kernel.mass,
      oppLegal=node.valid?node.valid[1-target]:null,mineLegal=node.valid?node.valid[target]:null;
    const total=basis.total;
    for(let i=0;i<mine.ids.length;i++){
      const a=mine.card0[i],b=mine.card1[i];
      if((mineLegal&&!mineLegal[i])||(!mineLegal&&blockedByRunout(a,b,node))){masses[i]=0;continue;}
      let m=basis.compat[i];
      if(total>0&&m<total*(game.equilibrium==='qre'?1e-8:1e-12)){
        m=0;
        for(let j=0;j<opp.ids.length;j++){
          const x=opp.card0[j],y=opp.card1[j];
          if(x!==a&&x!==b&&y!==a&&y!==b&&
            ((oppLegal&&oppLegal[j])||(!oppLegal&&!blockedByRunout(x,y,node))))m+=reach[j];
        }
      }
      masses[i]=Math.max(0,m);
    }
    return masses;
  }
  // Cache *payoff-independent* showdown masses for repeated visits with the
  // identical opponent reach vector and public cards. The caller owns the
  // cache for a single traversal; pooled reach buffers invalidate their entry
  // on release. No result survives a policy/iteration update.
  function terminalCfvCached(game,node,target,oppReach,output,kernel) {
    const mine=game.players[target],opp=game.players[1-target];
    const key=(node.turn??52)*53+(node.river??52);
    let boards=kernel.cache.get(oppReach);
    if(!boards){boards=new Map();kernel.cache.set(oppReach,boards);}
    let basis=boards.get(key);
    if(!basis){
      const cards=kernel.cards;cards.fill(0);
      const oppLegal=node.valid?node.valid[1-target]:null;
      const mineLegal=node.valid?node.valid[target]:null;
      const uncachedRunout=!node.valid&&(node.turn!==null&&node.turn!==undefined||node.river!==null&&node.river!==undefined);
      let total=0;
      const oppIndices=node.validIndices&&node.validIndices[1-target].length*4<opp.ids.length*3?
        node.validIndices[1-target]:null;
      if(oppIndices){
        for(let k=0;k<oppIndices.length;k++){
          const i=oppIndices[k],w=oppReach[i];if(!w)continue;
          const a=opp.card0[i],b=opp.card1[i];
          total+=w;cards[a]+=w;cards[b]+=w;
        }
      }else for(let i=0;i<opp.ids.length;i++){
        const w=oppReach[i];if(!w||(oppLegal&&!oppLegal[i]))continue;
        const a=opp.card0[i],b=opp.card1[i];
        if(uncachedRunout&&blockedByRunout(a,b,node))continue;
        total+=w;cards[a]+=w;cards[b]+=w;
      }
      const compat=new Float64Array(mine.ids.length);
      const mineIndices=node.validIndices&&node.validIndices[target].length*4<mine.ids.length*3?
        node.validIndices[target]:null;
      if(mineIndices){
        for(let k=0;k<mineIndices.length;k++){
          const i=mineIndices[k],a=mine.card0[i],b=mine.card1[i],oi=mine.opponentIndex[i];
          compat[i]=total-cards[a]-cards[b]+(oi>=0?oppReach[oi]:0);
        }
      }else for(let i=0;i<mine.ids.length;i++){
        const a=mine.card0[i],b=mine.card1[i],oi=mine.opponentIndex[i];
        if((mineLegal&&!mineLegal[i])||(uncachedRunout&&blockedByRunout(a,b,node)))continue;
        compat[i]=total-cards[a]-cards[b]+(oi>=0?oppReach[oi]:0);
      }
      basis={total,compat};boards.set(key,basis);
    }
    const {total,compat}=basis;
    if(total===0){output.fill(0);return output;}
    const win=game.pot/2+node.c[1-target],loss=-game.pot/2-node.c[target];
    const mineLegal=node.valid?node.valid[target]:null;
    const oppLegal=node.valid?node.valid[1-target]:null;
    const uncachedRunout=!node.valid&&(node.turn!==null&&node.turn!==undefined||node.river!==null&&node.river!==undefined);
    if(node.type==='fold'){
      const payoff=node.winner===target?win:loss;
      const mineIndices=node.validIndices&&node.validIndices[target].length*4<mine.ids.length*3?
        node.validIndices[target]:null;
      const count=mineIndices?mineIndices.length:mine.ids.length;
      for(let k=0;k<count;k++){
        const i=mineIndices?mineIndices[k]:k,a=mine.card0[i],b=mine.card1[i];
        if(!mineIndices&&((mineLegal&&!mineLegal[i])||(uncachedRunout&&blockedByRunout(a,b,node))))continue;
        let m=compat[i];
        if(total>0&&m<total*(game.equilibrium==='qre'?1e-8:1e-12)){
          m=0;for(let k=0;k<opp.ids.length;k++){
            const x=opp.card0[k],y=opp.card1[k];
            if(x!==a&&x!==b&&y!==a&&y!==b&&(!oppLegal?!blockedByRunout(x,y,node):oppLegal[k]))m+=oppReach[k];
          }
        }
        output[i]=payoff*m;
      }
      return output;
    }
    const data=game.isFlop?game.scoresByRunout.get(node.turn*52+node.river):null;
    const scores=node.riverScores||(data?data.scores:node.river!==null&&node.river!==undefined?game.scoresByRiver[node.river]:game.scores);
    if(!basis.weaker){
      // We use one contiguous allocation for the two board-specific payoff
      // vectors. Their contents still depend on the CURRENT opponent reach.
      const masses=new Float64Array(mine.ids.length*2);
      const weaker=masses.subarray(0,mine.ids.length);
      const equal=masses.subarray(mine.ids.length);
      const weakCards=kernel.weakerCards,eqCards=kernel.equalCards;
      weakCards.fill(0);eqCards.fill(0);
      const layoutPair=node.riverPayoff||game.riverPayoffLayouts.get(key);
      const layout=layoutPair&&layoutPair[target];
      const sorted=layout?layout.mineOrder:data?data.sorted[target]:node.river!==null&&node.river!==undefined?mine.sortedByRiver[node.river]:mine.sorted;
      const oSorted=layout?layout.oppOrder:data?data.sorted[1-target]:node.river!==null&&node.river!==undefined?opp.sortedByRiver[node.river]:opp.sorted;
      let j=0,weakerTotal=0;
      if(layout){
        // Precompiled exact rank boundaries. Clear only cards that appeared in
        // the previous tied group, not all 52 cards for every distinct rank.
        const {groupStart,weakEnd,tieEnd}=layout;
        for(let g=0;g<weakEnd.length;g++){
          while(j<weakEnd[g]){
            const oi=oSorted[j++],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            weakerTotal+=w;weakCards[a]+=w;weakCards[b]+=w;
          }
          let equalTotal=0;
          const end=tieEnd[g];
          for(let k=j;k<end;k++){
            const oi=oSorted[k],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            equalTotal+=w;eqCards[a]+=w;eqCards[b]+=w;
          }
          for(let pos=groupStart[g];pos<groupStart[g+1];pos++){
            const mi=sorted[pos],a=mine.card0[mi],b=mine.card1[mi],oi=mine.opponentIndex[mi];
            const self=oi>=0?oppReach[oi]:0;
            weaker[mi]=weakerTotal-weakCards[a]-weakCards[b];
            equal[mi]=equalTotal-eqCards[a]-eqCards[b]+self;
          }
          for(let k=j;k<end;k++){
            const oi=oSorted[k],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            weakerTotal+=w;weakCards[a]+=w;weakCards[b]+=w;
            eqCards[a]=0;eqCards[b]=0;
          }
          j=end;
        }
      }else{
        // Defensive fallback for games built outside makeGame().
        for(let pos=0;pos<sorted.length;){
          const score=scores[mine.ids[sorted[pos]]];
          while(j<oSorted.length&&scores[opp.ids[oSorted[j]]]<score){
            const oi=oSorted[j++],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            weakerTotal+=w;weakCards[a]+=w;weakCards[b]+=w;
          }
          eqCards.fill(0);let equalTotal=0,end=j;
          while(end<oSorted.length&&scores[opp.ids[oSorted[end]]]===score){
            const oi=oSorted[end++],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            equalTotal+=w;eqCards[a]+=w;eqCards[b]+=w;
          }
          while(pos<sorted.length&&scores[mine.ids[sorted[pos]]]===score){
            const mi=sorted[pos++],a=mine.card0[mi],b=mine.card1[mi],oi=mine.opponentIndex[mi];
            const self=oi>=0?oppReach[oi]:0;
            weaker[mi]=weakerTotal-weakCards[a]-weakCards[b];
            equal[mi]=equalTotal-eqCards[a]-eqCards[b]+self;
          }
          for(let k=j;k<end;k++){
            const oi=oSorted[k],w=oppReach[oi],a=opp.card0[oi],b=opp.card1[oi];
            weakerTotal+=w;weakCards[a]+=w;weakCards[b]+=w;
          }
          j=end;
        }
      }
      basis.weaker=weaker;basis.equal=equal;
    }
    const tie=(node.c[1-target]-node.c[target])/2;
    const layoutPair=node.riverPayoff||game.riverPayoffLayouts.get(key);
    const layout=layoutPair&&layoutPair[target];
    const sorted=layout?layout.mineOrder:data?data.sorted[target]:node.river!==null&&node.river!==undefined?mine.sortedByRiver[node.river]:mine.sorted;
    for(let pos=0;pos<sorted.length;pos++){
      const mi=sorted[pos],a=mine.card0[mi],b=mine.card1[mi];
      const comp=compat[mi],weak=basis.weaker[mi],eq=basis.equal[mi];
      const strong=comp-weak-eq;
      if(total>0&&comp<total*(game.equilibrium==='qre'?1e-8:1e-12)){
        const score=scores[mine.ids[mi]];
        let v=0;
        const oSorted=layout?layout.oppOrder:data?data.sorted[1-target]:node.river!==null&&node.river!==undefined?opp.sortedByRiver[node.river]:opp.sorted;
        for(const k of oSorted){const other=opp.ids[k],x=opp.card0[k],y=opp.card1[k];
          if(x!==a&&x!==b&&y!==a&&y!==b)v+=oppReach[k]*(scores[other]<score?win:scores[other]===score?tie:loss);}
        output[mi]=v;
      }else output[mi]=weak*win+eq*tie+strong*loss;
    }
    return output;
  }
  // O(n) terminal aggregation per call using showdown order and card exclusion.
  // Both opponents and own hand are private; no approximation of blockers.
  function terminalCfv(game,node,target,oppReach,outputBuffer=null,kernel=null) {
    if(node.type==='all-in'){
      const n=game.players[target].ids.length,opp=game.players[1-target];
      const out=outputBuffer??new Float64Array(n);
      const createWork=()=>[0,1].map(()=>[new Float64Array(oppReach.length),new Float64Array(n)]);
      const work=kernel?(kernel.allInWork??=createWork()):createWork();
      function evaluate(program,reach,result,depth){
        result.fill(0);
        if(program.pairEquity){
          const counts=program.pairEquity,scale=(game.pot/2+game.stack)/program.pairDenominator;
          const m=game.players[1].ids.length;
          if(target===0){
            for(let i=0;i<n;i++){
              let sum=0;
              for(let j=0;j<m;j++)sum+=counts[i*m+j]*reach[j];
              result[i]=sum*scale;
            }
          }else{
            for(let j=0;j<reach.length;j++)for(let i=0;i<n;i++)result[i]-=counts[j*m+i]*reach[j];
            for(let i=0;i<n;i++)result[i]*=scale;
          }
          return;
        }
        const [next,value]=work[depth];
        for(const {card,weight,child} of program.runouts){
          const allowed=opp.cardAllowed[card];
          let any=false;
          for(let i=0;i<next.length;i++){next[i]=allowed[i]?reach[i]*weight:0;any||=next[i]!==0;}
          if(!any)continue;
          if(child.chance)evaluate(child,next,value,depth+1);
          else{
            value.fill(0);
            kernel?.cache.delete(next);
            terminalCfv(game,child,target,next,value,kernel);
          }
          for(let i=0;i<n;i++)result[i]+=value[i];
        }
      }
      evaluate(node.allInProgram,oppReach,out,0);
      return out;
    }
    if(kernel)return terminalCfvCached(game,node,target,oppReach,
      outputBuffer||new Float64Array(game.players[target].ids.length),kernel);
    const mine=game.players[target],opp=game.players[1-target];
    const data=game.isFlop&&node.type==='showdown'?game.scoresByRunout.get(node.turn*52+node.river):null;
    const output=outputBuffer||new Float64Array(mine.ids.length),cards=new Float64Array(52);
    const oppLegal=node.valid?node.valid[1-target]:null;
    const mineLegal=node.valid?node.valid[target]:null;
    const uncachedRunout=!node.valid&&(node.turn!==null&&node.turn!==undefined||node.river!==null&&node.river!==undefined);
    let total=0;
    for(let i=0;i<opp.ids.length;i++){
      const w=oppReach[i];if(!w||(oppLegal&&!oppLegal[i]))continue;
      const [a,b]=ALL_COMBOS[opp.ids[i]];
      if(uncachedRunout&&blockedByRunout(a,b,node))continue;
      total+=w;cards[a]+=w;cards[b]+=w;
    }
    const win=game.pot/2+node.c[1-target],loss=-game.pot/2-node.c[target];
    if(node.type==='fold'){
      const payoff=node.winner===target?win:loss;
      for(let i=0;i<mine.ids.length;i++){
        const id=mine.ids[i],[a,b]=ALL_COMBOS[id],j=opp.index[id];
        if((mineLegal&&!mineLegal[i])||(uncachedRunout&&blockedByRunout(a,b,node)))continue;
        let m=total-cards[a]-cards[b]+(j>=0?oppReach[j]:0);
        if(total>0&&m<total*(game.equilibrium==='qre'?1e-8:1e-12)){m=0;for(let k=0;k<opp.ids.length;k++){const [x,y]=ALL_COMBOS[opp.ids[k]];
          if(x!==a&&x!==b&&y!==a&&y!==b&&(!oppLegal?!blockedByRunout(x,y,node):oppLegal[k]))m+=oppReach[k];}}
        output[i]=payoff*m;
      }
      return output;
    }
    const scores=data?data.scores:node.river!==null&&node.river!==undefined?game.scoresByRiver[node.river]:game.scores;
    const tie=(node.c[1-target]-node.c[target])/2;
    let j=0,weakerTotal=0;
    const weakerCards=new Float64Array(52),equalCards=new Float64Array(52);
    const sorted=data?data.sorted[target]:node.river!==null&&node.river!==undefined?mine.sortedByRiver[node.river]:mine.sorted;
    const oSorted=data?data.sorted[1-target]:node.river!==null&&node.river!==undefined?opp.sortedByRiver[node.river]:opp.sorted;
    for(let pos=0;pos<sorted.length;){
      const score=scores[mine.ids[sorted[pos]]];
      while(j<oSorted.length&&scores[opp.ids[oSorted[j]]]<score){
        const oi=oSorted[j++],w=oppReach[oi],[a,b]=ALL_COMBOS[opp.ids[oi]];
        weakerTotal+=w;weakerCards[a]+=w;weakerCards[b]+=w;
      }
      equalCards.fill(0);let equalTotal=0,end=j;
      while(end<oSorted.length&&scores[opp.ids[oSorted[end]]]===score){
        const oi=oSorted[end++],w=oppReach[oi],[a,b]=ALL_COMBOS[opp.ids[oi]];
        equalTotal+=w;equalCards[a]+=w;equalCards[b]+=w;
      }
      while(pos<sorted.length&&scores[mine.ids[sorted[pos]]]===score){
        const mi=sorted[pos++],id=mine.ids[mi],[a,b]=ALL_COMBOS[id],oi=opp.index[id];
        const self=oi>=0?oppReach[oi]:0;
        const comp=total-cards[a]-cards[b]+self;
        const weaker=weakerTotal-weakerCards[a]-weakerCards[b];
        const equal=equalTotal-equalCards[a]-equalCards[b]+self;
        const stronger=comp-weaker-equal;
        if(total>0&&comp<total*(game.equilibrium==='qre'?1e-8:1e-12)){
          let v=0;for(const k of oSorted){const other=opp.ids[k],[x,y]=ALL_COMBOS[other];
            if(x!==a&&x!==b&&y!==a&&y!==b)v+=oppReach[k]*(scores[other]<score?win:scores[other]===score?tie:loss);}
          output[mi]=v;
        }else output[mi]=weaker*win+equal*tie+stronger*loss;
      }
      for(let k=j;k<end;k++){
        const oi=oSorted[k],w=oppReach[oi],[a,b]=ALL_COMBOS[opp.ids[oi]];
        weakerTotal+=w;weakerCards[a]+=w;weakerCards[b]+=w;
      }
      j=end;
    }
    return output;
  }
  function chanceOpponentReach(game,opp,reach,outcome) {
    const result=new Float64Array(reach.length),card=outcome.card??outcome.river;
    const weight=outcome.weight??(1/44);
    const allowed=game.players[opp].cardAllowed[card];
    for(let i=0;i<reach.length;i++)if(allowed[i])result[i]=reach[i]*weight;
    return result;
  }
  function accumulate(game,weight) {
    for(let p=0;p<2;p++) {
      const own=game.players[p], initial=new Float64Array(own.ids.length).fill(1);
      function visit(id,reach) {
        const node=game.nodes[id];if(node.terminal||node.isoAlias)return;
        if(node.chance){
          for(const outcome of node.runouts){
            const {child}=outcome,card=outcome.card??outcome.river,weight=outcome.weight??(1/44);
            const next=new Float64Array(reach.length);
            const allowed=own.cardAllowed[card];
            for(let i=0;i<reach.length;i++)if(allowed[i])next[i]=reach[i]*weight;
            visit(child,next);
          }
          return;
        }
        if(node.p!==p) { for(const act of node.actions) visit(act.child,reach);return; }
        const n=own.ids.length,a=node.actions.length,s=currentNodePolicy(game,node),avg=node.averageSum;
        if(node.averageScale)addScaledAverage(node,s,reach,weight,new Float64Array(a));
        else for(let i=0;i<n;i++){
          const row=learnableRow(node,i);
          if(node.forced||a===1&&game.banks||row<0)continue;
          for(let j=0;j<a;j++)avg[row*a+j]+=weight*reach[i]*s[i*a+j];
        }
        for(let j=0;j<a;j++) {
          const next=new Float64Array(n);
          for(let i=0;i<n;i++) next[i]=reach[i]*s[i*a+j];
          visit(node.actions[j].child,next);
        }
      }
      visit(game.root,initial);
    }
  }

  function learnableRow(node,i){
    if(node.rowShape){
      const row=node.rowShape.map[i];
      return row>=0&&node.rowShape.reps[row]===i?row:-1;
    }
    if(node.lockedMask?.[i]||(node.symmetry&&node.symmetry.master[i]!==i))return -1;
    return node.symmetry?.ordinals[i]??i;
  }

  function currentNodePolicy(game,node,output){
    if(!game.banks)return node.current;
    const a=node.actions.length,n=game.players[node.p].ids.length;
    const values=output??new Float64Array(n*a);
    if(a===1)return values.fill(1);
    const {map}=node.rowShape,s=node.current,normalize=s instanceof Float32Array;
    const tieFloor=16*Number.EPSILON*Math.max(1,game.pot+game.stack);
    for(let i=0;i<n;i++){
      const row=map[i],off=i*a;
      if(row===-1){values.fill(1/a,off,off+a);continue;}
      if(row<0){
        for(let k=0;k<a;k++)values[off+k]=node.lockedRows[(-row-2)*a+k];
        continue;
      }
      let sum=0;
      if(game.deriveCurrent){
        const r=node.regret;
        for(let k=0;k<a;k++)sum+=Math.max(0,r[row*a+k]);
        for(let k=0;k<a;k++)values[off+k]=sum>tieFloor?Math.max(0,r[row*a+k])/sum:1/a;
        continue;
      }
      if(normalize)for(let k=0;k<a;k++)sum+=s[row*a+k];
      for(let k=0;k<a;k++)values[off+k]=normalize?(sum>0?s[row*a+k]/sum:1/a):s[row*a+k];
    }
    return values;
  }
  // Recycle traversal work buffers instead of allocating fresh hand vectors at
  // every CFR branch. The exact chance tree, regrets, update order and terminal
  // arithmetic remain unchanged; buffers are local to a traversal call.
  const traversalWorkspaces=new WeakMap();
  function traverseCfr(game,id,target,oppReach,averageWeight=0,returnVector=true) {
    if(game.compiled?.fullTraversal&&(!game.nodeLocks.length||game.compiled.handlesLocks))
      return game.compiled.traverse(id,target,oppReach,averageWeight,returnVector);
    const myN=game.players[target].ids.length;
    const oppN=game.players[1-target].ids.length;
    // Retain scratch buffers across iterations, but discard reach-dependent
    // showdown cache entries at the start of every traversal.
    let pools=traversalWorkspaces.get(game);
    if(!pools){pools=[null,null];traversalWorkspaces.set(game,pools);}
    let kernel=pools[target];
    if(!kernel){
      kernel={free:new Map(),cache:new WeakMap(),cards:new Float64Array(52),
        massCards:new Float64Array(52),mass:game.compiled?game.compiled.allocateVector(myN):new Float64Array(myN),
        entropyReach:new Float64Array(oppN),scaledUpdates:new Float64Array(12),
        weakerCards:new Float64Array(52),equalCards:new Float64Array(52)};
      pools[target]=kernel;
    }
    kernel.cache=new WeakMap();
    const free=kernel.free;
    function acquire(n){
      const pool=free.get(n);
      const arr=pool&&pool.length?pool.pop():game.compiled?game.compiled.allocateVector(n):new Float64Array(n);
      arr.fill(0);
      return arr;
    }
    function release(arr){
      kernel.cache.delete(arr); // this pooled storage can hold new weights next time
      let pool=free.get(arr.length);
      if(!pool){pool=[];free.set(arr.length,pool);}
      pool.push(arr);
    }
    function visit(nodeId,reach,output,ownReach){
      const node=game.nodes[nodeId];
      if(node.terminal){terminalCfv(game,node,target,reach,output,kernel);return;}
      if(node.chance){
        const value=acquire(myN);
        const groups=node.isoGroups;
        // Exact orbit reduction: calculate a representative river once and
        // relabel its entire CFV vector to each suit-equivalent river. Regrets
        // and averaging on the representative stay conditional on that one
        // river; slave strategy rows are relabeled only for reports.
        const outcomes=groups||node.runouts.map(o=>({representative:o,members:[{outcome:o,maps:null}]}));
        for(const group of outcomes){
          const outcome=group.representative;
          const next=acquire(oppN),card=outcome.card??outcome.river;
          const weight=outcome.weight??(1/44);
          const allowed=game.players[1-target].cardAllowed[card];
          for(let i=0;i<oppN;i++)if(allowed[i])next[i]=reach[i]*weight;
          let ownNext=null;
          if(ownReach){
            ownNext=acquire(myN);
            const ownAllowed=game.players[target].cardAllowed[card];
            for(let i=0;i<myN;i++)if(ownAllowed[i])ownNext[i]=ownReach[i]*weight;
          }
          visit(outcome.child,next,value,ownNext);
          if(ownNext)release(ownNext);
          if(groups){
            for(const member of group.members){
              const map=member.maps[target];
              for(let i=0;i<myN;i++)output[map[i]]+=value[i];
            }
          }else for(let i=0;i<myN;i++)output[i]+=value[i];
          value.fill(0);
          release(next);
        }
        release(value);
        return;
      }
      const nActions=node.actions.length;
      // Algebraic identity: a one-action information set has probability 1,
      // zero entropy, and zero regret. Its reach/CFV need no new branch arrays.
      if(nActions===1){
        if(node.p===target && ownReach && !game.banks && !node.forced && !node.allLocked){
          const avg=node.averageSum,cur=node.current;
          for(let i=0;i<myN;i++)if(!node.symmetry||node.symmetry.master[i]===i)
            avg[node.symmetry?node.symmetry.ordinals[i]:i]+=averageWeight*ownReach[i]*cur[i];
        }
        visit(node.actions[0].child,reach,output,ownReach);
        return;
      }
      const current=game.banks?currentNodePolicy(game,node,acquire(game.players[node.p].ids.length*nActions)):node.current;
      if(node.p!==target){
        const value=acquire(myN);
        for(let a=0;a<nActions;a++){
          if(node.pruned?.[a]||(node.allLocked&&!node.lockedActions[a]))continue;
          const branch=acquire(oppN);
          for(let i=0;i<oppN;i++)branch[i]=reach[i]*current[i*nActions+a];
          visit(node.actions[a].child,branch,value,ownReach);
          for(let i=0;i<myN;i++){output[i]+=value[i];value[i]=0;}
          release(branch);
        }
        release(value);
        if(game.banks)release(current);
        if(game.equilibrium==='qre'){
          const weighted=kernel.entropyReach,entropy=node.qreEntropy;
          for(let i=0;i<oppN;i++)weighted[i]=reach[i]*entropy[i];
          const mass=compatibilityMassInto(game,target,weighted,node,kernel.mass,kernel.massCards);
          for(let i=0;i<myN;i++)output[i]-=game.qreTemperature*mass[i];
        }
        return;
      }
      if(node.allLocked){
        const values=acquire(myN);
        for(let a=0;a<nActions;a++)if(node.lockedActions[a]){
          const ownNext=ownReach?acquire(myN):null;
          if(ownNext)for(let i=0;i<myN;i++)ownNext[i]=ownReach[i]*current[i*nActions+a];
          visit(node.actions[a].child,reach,values,ownNext);
          if(ownNext)release(ownNext);
          for(let i=0;i<myN;i++)output[i]+=current[i*nActions+a]*values[i];
          values.fill(0);
        }
        release(values);
        if(game.banks)release(current);
        return;
      }
      const actionVals=new Array(nActions);
      if(ownReach&&node.averageScale)addScaledAverage(node,current,ownReach,averageWeight,kernel.scaledUpdates);
      for(let a=0;a<nActions;a++){
        const values=acquire(myN);
        if(node.pruned?.[a]){actionVals[a]=values;continue;}
        let ownNext=null;
        if(ownReach){
          ownNext=acquire(myN);
          const avg=node.averageSum;
          for(let i=0;i<myN;i++){
            const off=i*nActions+a;
            const row=learnableRow(node,i);
            if(row>=0&&!node.averageScale)avg[row*nActions+a]+=averageWeight*ownReach[i]*current[off];
            ownNext[i]=ownReach[i]*current[off];
          }
        }
        visit(node.actions[a].child,reach,values,ownNext);
        if(ownNext)release(ownNext);
        actionVals[a]=values;
      }
      const r=node.regret,strat=current,isQre=game.equilibrium==='qre';
      const mass=isQre?cachedCompatibilityMass(game,target,reach,node,kernel):null;
      // Fused compiled Float64 regret/CFV update. All live vectors and node
      // state reside in WASM memory; fall back without changing the algorithm
      // whenever a scratch buffer is outside the fixed mobile-sized arena.
      const done=!!(game.compiled&&!node.locked&&game.compiled.regret(node,actionVals,output,mass,game.qreTemperature));
      if(!done)for(let i=0;i<myN;i++){
        const off=i*nActions;
        let v=0;
        for(let a=0;a<nActions;a++)v+=strat[off+a]*actionVals[a][i];
        output[i]=v;
        const row=learnableRow(node,i),ro=row*nActions;
        if(row<0||!game.banks&&node.suitRows&&node.suitRows[i]!==i)continue;
        if(isQre){
          const t=game.qreTemperature*mass[i],floor=QRE_PROBABILITY_FLOOR,scale=1-nActions*floor;
          output[i]+=t*node.qreEntropy[i];
          let mean=0;
          const logs=node.qreLog;
          for(let a=0;a<nActions;a++)mean+=(strat[off+a]-floor)/scale*(actionVals[a][i]-t*logs[off+a]);
          for(let a=0;a<nActions;a++)r[ro+a]=Math.max(0,r[ro+a]+scale*(actionVals[a][i]-t*logs[off+a]-mean));
        }else if(node.regretScale){
          const updates=kernel.scaledUpdates;
          for(let a=0;a<nActions;a++){
            const x=accumulator(r,node.regretScale,ro+a,nActions)+(actionVals[a][i]-v);
            updates[a]=x*(x>0?game._positiveDiscount:game._negativeDiscount);
          }
          setScaledRow(r,node.regretScale,row,nActions,updates);
        }else for(let a=0;a<nActions;a++){
          if(node.pruned?.[a])continue;
          const delta=actionVals[a][i]-v,x=r[ro+a]+delta;
          if(['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(game.gtoAlgorithm)){
            r[ro+a]=x*(x>0?game._positiveDiscount:game._negativeDiscount);
            if(game.gtoAlgorithm==='dcfr-predictive')node.previousDelta[ro+a]=delta;
          }
          else {
            r[ro+a]=Math.max(0,x);
            if(game.gtoAlgorithm==='optimistic')node.previousDelta[ro+a]=delta;
          }
        }
      }
      for(const arr of actionVals)release(arr);
      if(game.banks)release(current);
    }
    const result=game.compiled?acquire(myN):new Float64Array(myN);
    const ownReach=averageWeight?new Float64Array(myN).fill(1):null;
    visit(id,oppReach,result,ownReach);
    if(game.compiled){
      const value=returnVector?Float64Array.from(result):undefined;
      release(result);
      return value;
    }
    return returnVector?result:undefined;
  }
  function averageNodePolicy(game,node){
    if(game.banks){
      const policy=currentNodePolicy(game,node);
      if(!node.rowShape)return policy;
      const {map}=node.rowShape,a=node.actions.length;
      const {averageSum,averageScale}=node;
      for(let i=0;i<map.length;i++)if(map[i]>=0){
        const off=map[i]*a;
        let sum=0;
        for(let k=0;k<a;k++)sum+=accumulator(averageSum,averageScale,off+k,a);
        if(sum>0)for(let k=0;k<a;k++)policy[i*a+k]=accumulator(averageSum,averageScale,off+k,a)/sum;
      }
      projectFrequencyRows(node,policy);
      return policy;
    }
    if(node.actions.length===1||node.allLocked)return node.current;
    const n=game.players[node.p].ids.length,a=node.actions.length,arr=new Float64Array(n*a);
    for(let i=0;i<n;i++){
      let sum=0;
      const off=i*a,ro=(node.symmetry?node.symmetry.ordinals[i]:i)*a;
      if(!node.lockedMask?.[i])
        for(let k=0;k<a;k++)if(!node.pruned?.[k])sum+=node.averageSum[ro+k];
      for(let k=0;k<a;k++)if(!node.pruned?.[k])
        arr[off+k]=sum>0?node.averageSum[ro+k]/sum:node.current[off+k];
    }
    projectFrequencyRows(node,arr);
    enforceSuitRows(node,arr);
    return arr;
  }
  function averagePolicy(game,includeAliases=true) {
    const result=new Array(game.nodes.length);
    result.suitIsomorphic=!!game.suitIsomorphism?.enabled;
    // Canonical strategies are stored once logically; give report/UI consumers
    // a complete strategy array for every original river decision node.
    for(const node of game.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias)
      result[node.id]=averageNodePolicy(game,node);
    if(includeAliases)for(const node of game.nodes)if(node.isoAlias){
      const src=result[node.isoAlias.source],map=node.isoAlias.map,a=node.actions.length;
      if(!src)throw Error('Missing canonical suit-isomorphic strategy');
      const arr=new Float64Array(src.length);
      for(let i=0;i<map.length;i++)for(let k=0;k<a;k++)arr[map[i]*a+k]=src[i*a+k];
      result[node.id]=arr;
    }
    return result;
  }
  function lazyAveragePolicy(game,cache=true){
    const policies=cache?new Map():null;
    function get(id){
      if(policies?.has(id))return policies.get(id);
      const node=game.nodes[id];
      let policy;
      if(node.isoAlias){
        const {source,map}=node.isoAlias,original=get(source),a=node.actions.length;
        policy=new Float64Array(original.length);
        for(let i=0;i<map.length;i++)for(let k=0;k<a;k++)policy[map[i]*a+k]=original[i*a+k];
      }else policy=averageNodePolicy(game,node);
      policies?.set(id,policy);
      return policy;
    }
    get.suitIsomorphic=game.suitIsomorphism.enabled;
    return get;
  }

  function evaluatePolicy(game,policy,target,mode='profile',records=null,selectedNodeId=null,start=null) {
    const mine=game.players[target],opp=game.players[1-target],n=mine.ids.length;
    const policyAt=typeof policy==='function'?policy:id=>policy[id];
    const propagateOwn=records&&(!start||selectedNodeId===null);
    const evCutoff=game.equilibrium==='qre'?1e-200:1e-14;
    const kernel={cache:new WeakMap(),cards:new Float64Array(52),weakerCards:new Float64Array(52),equalCards:new Float64Array(52)};
    let maxActions=1;
    for(const nd of game.nodes)if(!nd.terminal&&!nd.chance&&nd.actions.length>maxActions)
      maxActions=nd.actions.length;
    const qreScratch={values:new Float64Array(maxActions),weights:new Float64Array(maxActions),
      fixed:new Uint8Array(maxActions),out:new Float64Array(maxActions)};
    const massScratch=new Float64Array(n),massCards=new Float64Array(52),weightedScratch=new Float64Array(opp.ids.length);
    function visit(id,oppReach,ownReach) {
      const node=game.nodes[id];
      if(node.terminal) return terminalCfv(game,node,target,oppReach,null,kernel);
      if(node.chance){
        const out=new Float64Array(n);
        const groups=(!records||start)&&policy.suitIsomorphic?node.isoGroups:null;
        for(const item of groups||node.runouts){
          const outcome=groups?item.representative:item;
          const card=outcome.card??outcome.river;
          const nextOpp=chanceOpponentReach(game,1-target,oppReach,outcome);
          let nextOwn=null;
          if(propagateOwn){nextOwn=new Float64Array(n);const allowed=mine.cardAllowed[card];
            for(let i=0;i<n;i++)if(allowed[i])nextOwn[i]=ownReach[i];
          }
          const v=visit(outcome.child,nextOpp,nextOwn);
          if(groups){
            for(const member of item.members){
              const map=member.maps[target];
              for(let i=0;i<n;i++)out[map[i]]+=v[i];
            }
          }else for(let i=0;i<n;i++)out[i]+=v[i];
        }
        return out;
      }
      const a=node.actions.length,regularized=mode==='regularizedBest';
      const capture=!!records&&(selectedNodeId===null||selectedNodeId===id);
      const captureCounterfactual=!!start?.counterfactual&&selectedNodeId===id;
      const needsPolicy=node.p!==target||propagateOwn||capture||captureCounterfactual||
        regularized||mode==='profile'||mode==='constrainedBest'&&node.locked;
      const strat=needsPolicy?policyAt(id):null;
      if(node.p!==target) {
        const out=new Float64Array(n), on=opp.ids.length;
        for(let k=0;k<a;k++) {
          const next=new Float64Array(on);
          let any=false;
          for(let j=0;j<on;j++){next[j]=oppReach[j]*strat[j*a+k];any||=next[j]!==0;}
          if(!any&&!propagateOwn)continue;
          const v=visit(node.actions[k].child,next,ownReach);
          for(let i=0;i<n;i++)out[i]+=v[i];
        }
        if(regularized){
          for(let i=0;i<opp.ids.length;i++)weightedScratch[i]=oppReach[i]*entropyAt(strat,i*a,a);
          const m=compatibilityMassInto(game,target,weightedScratch,node,massScratch,massCards);
          for(let i=0;i<n;i++)out[i]-=game.qreTargetTemperature*m[i];
        }
        return out;
      }
      const acts=[];
      for(let k=0;k<a;k++) {
        let nextOwn=null;
        if(propagateOwn) {
          nextOwn=new Float64Array(n);
          for(let i=0;i<n;i++) nextOwn[i]=ownReach[i]*strat[i*a+k];
        }
        acts.push(visit(node.actions[k].child,oppReach,nextOwn));
      }
      const out=new Float64Array(n),mass=(capture||captureCounterfactual||regularized)?
        compatibilityMassInto(game,target,oppReach,node,massScratch,massCards):null;
      let numerator=0,denom=0;
      const handEntries=capture?[]:null,agg=capture?new Float64Array(a):null;
      for(let i=0;i<n;i++) {
        const freeToDeviate=mode==='best'||(mode==='constrainedBest'&&!node.lockedMask?.[i]);
        let val=freeToDeviate ? -Infinity : 0;
        for(let k=0;k<a;k++) {
          if(freeToDeviate) val=Math.max(val,acts[k][i]);
          else val+=strat[i*a+k]*acts[k][i];
        }
        if(regularized&&mass[i]>0){
          const m=mass[i],p=logitResponseActionsInto(acts,i,m,game.qreTargetTemperature,a,qreScratch);
          val=game.qreTargetTemperature*m*entropyAt(p,0,a);
          for(let k=0;k<a;k++)val+=p[k]*acts[k][i];
        }
        out[i]=val;
        if(capture) {
          const m=mass[i], w=mine.priors[i]*ownReach[i]*m;
          numerator+=mine.priors[i]*ownReach[i]*val;
          denom+=w;
          for(let k=0;k<a;k++)agg[k]+=w*strat[i*a+k];
          handEntries.push([mine.ids[i],w,m>evCutoff?val/m:null,
            Array.from({length:a},(_,k)=>strat[i*a+k]),
            Array.from({length:a},(_,k)=>m>evCutoff?acts[k][i]/m:null)]);
        }
      }
      if(captureCounterfactual){
        const requested=start.comboIds;
        const hands=[];
        for(const [i,comboId] of mine.ids.entries()){
          if(requested&&!requested.has(comboId))continue;
          const values=acts.map(action=>action[i]),compatibleOpponentMass=mass[i];
          const probabilities=Array.from(strat.subarray(i*a,(i+1)*a));
          hands.push({comboId,opponentReach:compatibleOpponentMass,compatibleOpponentMass,values,
            conditionalActionEVs:values.map(value=>compatibleOpponentMass>0?value/compatibleOpponentMass:null),
            probabilities,lockedActionProbabilities:node.lockedMask?.[i]?probabilities.slice():null,
            ownReach:ownReach[i],reachMass:mine.priors[i]*ownReach[i]*compatibleOpponentMass/game.jointZ});
        }
        start.counterfactual.hands=hands;
      }
      if(capture) records[id]={id,player:target,rangeEV:denom>evCutoff?numerator/denom:null,
        reachMass:denom/game.jointZ,actions:denom>evCutoff?Array.from(agg,v=>v/denom):Array(a).fill(0),
        hands:handEntries.map(v=>{v[1]=denom>evCutoff?v[1]/denom:0;return v;})};
      return out;
    }
    if(start)return visit(start.id,start.oppReach,start.ownReach);
    return visit(game.root,opp.priors,records?new Float64Array(n).fill(1):null);
  }
  // Evaluate the average-policy profile and its exact best response together.
  // The two traversals share identical opponent reaches and terminal outcomes;
  // combining them eliminates one full public-chance/showdown tree walk per
  // player without approximating either quantity or the reported hand EVs.
  function evaluatePolicyWithBest(game,policy,target,records) {
    const mine=game.players[target],opp=game.players[1-target],n=mine.ids.length;
    const evCutoff=game.equilibrium==='qre'?1e-200:1e-14;
    const kernel={cache:new WeakMap(),cards:new Float64Array(52),weakerCards:new Float64Array(52),equalCards:new Float64Array(52)};
    function visit(id,oppReach,ownReach) {
      const node=game.nodes[id];
      if(node.terminal){
        const val=terminalCfv(game,node,target,oppReach,null,kernel);
        return {profile:val,best:val};
      }
      if(node.chance){
        const out=new Float64Array(n),best=new Float64Array(n);
        for(const outcome of node.runouts){
          const card=outcome.card??outcome.river;
          const nextOpp=chanceOpponentReach(game,1-target,oppReach,outcome);
          const nextOwn=new Float64Array(n),allowed=mine.cardAllowed[card];
          for(let i=0;i<n;i++)if(allowed[i])nextOwn[i]=ownReach[i];
          const v=visit(outcome.child,nextOpp,nextOwn);
          for(let i=0;i<n;i++){out[i]+=v.profile[i];best[i]+=v.best[i];}
        }
        return {profile:out,best};
      }
      const a=node.actions.length,strat=policy[id];
      if(node.p!==target){
        const out=new Float64Array(n),best=new Float64Array(n),on=opp.ids.length;
        for(let k=0;k<a;k++){
          const next=new Float64Array(on);
          for(let j=0;j<on;j++)next[j]=oppReach[j]*strat[j*a+k];
          const v=visit(node.actions[k].child,next,ownReach);
          for(let i=0;i<n;i++){out[i]+=v.profile[i];best[i]+=v.best[i];}
        }
        return {profile:out,best};
      }
      const acts=new Array(a),bestActs=new Array(a);
      for(let k=0;k<a;k++){
        const nextOwn=new Float64Array(n);
        for(let i=0;i<n;i++)nextOwn[i]=ownReach[i]*strat[i*a+k];
        const v=visit(node.actions[k].child,oppReach,nextOwn);
        acts[k]=v.profile;bestActs[k]=v.best;
      }
      const out=new Float64Array(n),best=new Float64Array(n);
      const mass=compatibilityMass(game,target,oppReach,node);
      let numerator=0,denom=0;
      const handEntries=[],agg=new Float64Array(a);
      for(let i=0;i<n;i++){
        const fixed=!!node.lockedMask?.[i];
        let val=0,br=fixed?0:-Infinity;
        for(let k=0;k<a;k++){
          val+=strat[i*a+k]*acts[k][i];
          if(fixed)br+=strat[i*a+k]*bestActs[k][i];
          else br=Math.max(br,bestActs[k][i]);
        }
        out[i]=val;best[i]=br;
        const m=mass[i],w=mine.priors[i]*ownReach[i]*m;
        numerator+=mine.priors[i]*ownReach[i]*val;
        denom+=w;
        for(let k=0;k<a;k++)agg[k]+=w*strat[i*a+k];
        handEntries.push([mine.ids[i],w,m>evCutoff?val/m:null,
          Array.from({length:a},(_,k)=>strat[i*a+k]),
          Array.from({length:a},(_,k)=>m>evCutoff?acts[k][i]/m:null)]);
      }
      records[id]={id,player:target,rangeEV:denom>evCutoff?numerator/denom:null,
        reachMass:denom/game.jointZ,actions:denom>evCutoff?Array.from(agg,v=>v/denom):Array(a).fill(0),
        hands:handEntries.map(v=>{v[1]=denom>evCutoff?v[1]/denom:0;return v;})};
      return {profile:out,best};
    }
    return visit(game.root,opp.priors,new Float64Array(n).fill(1));
  }
  function rangeValue(game,target,cfv) {
    const p=game.players[target];let result=0;
    for(let i=0;i<p.ids.length;i++) result+=p.priors[i]*cfv[i];
    return result/game.jointZ;
  }
  const algorithmVersion='turnriver-f64-v2';

  function equilibriumMetrics(game,constrained,profile,unrestricted){
    const halfPot=game.pot/2;
    const present=pair=>pair?{centered:pair,foldZero:pair.map(v=>v+halfPot)}:null;
    const lower=-constrained[1],upper=constrained[0],nashConv=Math.max(0,upper-lower);
    // At equality the two Float64 endpoints can be reversed by roundoff.
    const centered0={lower:Math.min(lower,upper),upper:Math.max(lower,upper)};
    const centered=[centered0,{lower:-centered0.upper,upper:-centered0.lower}];
    const foldZero=centered.map(({lower,upper})=>({lower:lower+halfPot,upper:upper+halfPot}));
    const width=centered0.upper-centered0.lower;
    const lockPlayers=[...new Set(game.nodeLocks.map(lock=>lock.player))].sort();
    return {
      algorithmVersion,rulesFingerprint:game.rulesFingerprint,startingPot:game.pot,
      chanceMode:game.sampledChance?'sampled-weighted':'exact',
      sampling:game.isFlop?{method:game.samplingMethod,seed:game.flopSamplingSeed,requestedTurns:game.turnSamples,
        requestedRivers:game.riverSamples}:null,
      frequencyProjected:game.hasFrequencyIncrements,
      equilibriumBounds:{centered,foldZero,width,percentOfPot:100*width/game.pot,
        scope:game.hasFrequencyIncrements?'continuous-lock-game':game.equilibrium==='qre'?'chip-minimax':'configured-game'},
      profileEV:present(profile),constrainedBestResponseEV:present(constrained),
      unrestrictedBestResponseEV:present(unrestricted),
      nashConv,constrainedNashConv:nashConv,exploitability:nashConv/2,constrainedExploitability:nashConv/2,
      unrestrictedExploitability:unrestricted?Math.max(0,unrestricted[0]+unrestricted[1])/2:null,
      lockedNodes:game.nodeLocks.length,lockPlayers,convergenceMetric:lockPlayers.length?'locked-game':'unrestricted-nash',
      br0:constrained[0]+halfPot,br1:constrained[1]+halfPot,
      value0:profile?profile[0]+halfPot:null,value1:profile?profile[1]+halfPot:null,
      zeroSumError:profile?Math.abs(profile[0]+profile[1]):null,
      evBasis:'fold-zero',
    };
  }

  function requireComparableBounds(a,b){
    if(!a?.rulesFingerprint||a.rulesFingerprint!==b?.rulesFingerprint||a.startingPot!==b.startingPot||
        a.equilibrium!=='gto'||b.equilibrium!=='gto'||a.frequencyProjected||b.frequencyProjected)
      throw Error('EV comparison requires matching rules, weighted ranges, actual chance trees and continuous GTO strategies.');
    for(const result of [a,b]){
      const bounds=result.equilibriumBounds?.centered;
      if(!Array.isArray(result.lockPlayers)||!Array.isArray(bounds)||bounds.length!==2||
        !bounds.every(({lower,upper})=>Number.isFinite(lower)&&Number.isFinite(upper)&&lower<=upper))
        throw Error('EV comparison requires finite equilibrium bounds.');
    }
  }

  function candidateIsWorse(candidate,incumbent,hero=0){
    if(hero!==0&&hero!==1)throw Error('Hero must be player 0 or 1.');
    requireComparableBounds(candidate,incumbent);
    if([candidate,incumbent].some(result=>result.lockPlayers.some(p=>p!==hero)))
      throw Error('Candidate elimination requires an unrestricted opponent for both strategies.');
    const upper=candidate.equilibriumBounds.centered[hero].upper;
    const lower=incumbent.equilibriumBounds.centered[hero].lower;
    const tolerance=64*Number.EPSILON*Math.max(candidate.startingPot,Math.abs(upper),Math.abs(lower));
    return upper+tolerance<lower;
  }

  function compareEvLoss(baseline,candidate,hero=0){
    if(hero!==0&&hero!==1)throw Error('Hero must be player 0 or 1.');
    requireComparableBounds(baseline,candidate);
    if(baseline.lockPlayers.length)throw Error('EV loss requires an unrestricted baseline.');
    const base=baseline.equilibriumBounds.centered[hero],current=candidate.equilibriumBounds.centered[hero];
    let lower=base.lower-current.upper,upper=base.upper-current.lower;
    const monotone=candidate.lockPlayers.every(p=>p===hero);
    if(candidate.lockPlayers.length===0){lower=upper=0;}
    else if(monotone){
      if(upper<0&&upper<-(baseline.startingPot*1e-10))throw Error('Comparable bounds contradict the restriction relationship.');
      lower=Math.max(0,lower);upper=Math.max(0,upper);
    }
    return {hero,minimum:lower,maximum:upper,width:upper-lower,heroOnlyRestriction:monotone,
      percentOfPot:{minimum:100*lower/baseline.startingPot,maximum:100*upper/baseline.startingPot}};
  }

  function makeReport(game,iteration,elapsedMs,history) {
    const policy=averagePolicy(game),records=new Array(game.nodes.length);
    const both0=evaluatePolicyWithBest(game,policy,0,records);
    const both1=evaluatePolicyWithBest(game,policy,1,records);
    const value0=rangeValue(game,0,both0.profile),value1=rangeValue(game,1,both1.profile);
    const br0=rangeValue(game,0,both0.best),br1=rangeValue(game,1,both1.best);
    const constrained=[br0,br1];
    const unrestricted=constrained.map((v,p)=>game.nodeLocks.some(lock=>lock.player===p)
      ?rangeValue(game,p,evaluatePolicy(game,policy,p,'best')):v);
    const metrics=equilibriumMetrics(game,constrained,[value0,value1],unrestricted);
    // CFR operates on zero-sum payoffs centered at half the starting pot.
    // Present EVs relative to folding at the CURRENT decision instead:
    // a fold's centered payoff is -pot/2 - chips already put in by this player.
    // Shifting all actions at an information set by the same constant preserves
    // optimal strategies, regrets, NashConv, and exploitability.
    for (const node of game.nodes) {
      const record=records[node.id];
      if (!record || node.terminal || node.chance) continue;
      const offset=game.pot/2+node.c[record.player];
      const showEV=value=>value===null?null:(Math.abs(value+offset)<1e-9?0:value+offset);
      record.rangeEV=showEV(record.rangeEV);
      for (const hand of record.hands) {
        hand[2]=showEV(hand[2]);
        for (let a=0;a<node.actions.length;a++)
          if (hand[4][a]!==null)
            hand[4][a]=node.actions[a].type==='fold'?0:showEV(hand[4][a]);
      }
    }
    let qreResidual=null, qreCompared=0;
    if(game.equilibrium==='qre'){
      // Exact regularized saddle gap on the configured tree, in chips/player.
      const r0=rangeValue(game,0,evaluatePolicy(game,policy,0,'regularizedBest'));
      const r1=rangeValue(game,1,evaluatePolicy(game,policy,1,'regularizedBest'));
      qreResidual=Math.max(0,r0+r1)/2;
      for(const record of records)if(record)for(const hand of record.hands)if(hand[2]!==null)qreCompared++;
    }
    // TPWL: equal-weighted mean of node-wise (best action - played EV) / node pot.
    // Unlike root NashConv, this observes rare decisions when conditional
    // action values remain numerically resolvable. In sampled flop mode this
    // applies to the sampled tree only; the metric is not a Nash certificate.
    let tpwlSum=0,tpwlNodes=0;
    for(const node of game.nodes){
      const record=records[node.id];if(!record||node.terminal||node.chance)continue;
      let nodeLoss=0,hands=0;
      for(const hand of record.hands){
        if(hand[2]===null||hand[4].some(v=>v===null))continue;
        const best=Math.max(...hand[4]);
        nodeLoss+=Math.max(0,best-hand[2])/node.pot;
        hands++;
      }
      if(hands){tpwlSum+=nodeLoss/hands;tpwlNodes++;}
    }
    const tpwl=tpwlNodes?tpwlSum/tpwlNodes:null;
    return {iteration,elapsedMs,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
      equilibrium:game.equilibrium,gtoAlgorithm:game.gtoAlgorithm,qreTemperaturePercent:game.equilibrium==='qre'?game.qreTemperaturePercent:null,
      qreActiveTemperaturePercent:game.equilibrium==='qre'?100*game.qreTemperature/game.pot:null,
      qreWarmupComplete:game.equilibrium==='qre'?(iteration>=game.qreWarmupIterations):null,
      qreWarmupIterations:game.equilibrium==='qre'?game.qreWarmupIterations:null,
      qreProbabilityFloor:game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:null,
      qreModel:game.equilibrium==='qre'?'entropy-regularized-zero-sum':null,
      qreResidualUnits:game.equilibrium==='qre'?'chips-per-player':null,
      qreResidual,qreCompared,tpwl,tpwlNodes,
      ...metrics,jointZ:game.jointZ,memoryBytes:game.memory,
      history:history||[],nodes:records};
  }
  // A single decision's report, without allocating hand/action records for
  // every other node in the tree.  This is also the correctness fallback when
  // native selected-node continuation EVs cannot be compiled on a device.
  function selectedReaches(game,id,policy){
    const target=game.nodes[id].p,mine=game.players[target],opp=game.players[1-target];
    let oppReach=opp.priors;
    const ownReach=new Float64Array(mine.ids.length).fill(1),path=[];
    for(let cur=id;cur!==game.root;cur=game.paths.parents[cur])path.push(cur);
    for(let i=path.length-1;i>=0;i--){
      const child=path[i],parentId=game.paths.parents[child],k=game.paths.edges[child];
      const node=game.nodes[parentId];
      if(node.chance){
        const outcome=node.runouts[k];
        oppReach=chanceOpponentReach(game,1-target,oppReach,outcome);
        const allowed=mine.cardAllowed[outcome.card];
        for(let h=0;h<ownReach.length;h++)if(!allowed[h])ownReach[h]=0;
      }else if(node.actions.length>1){
        const a=node.actions.length,strat=policy(parentId);
        if(node.p===target){
          for(let h=0;h<ownReach.length;h++)ownReach[h]*=strat[h*a+k];
        }else{
          const branch=new Float64Array(oppReach.length);
          for(let h=0;h<branch.length;h++)branch[h]=oppReach[h]*strat[h*a+k];
          oppReach=branch;
        }
      }
    }
    return {id,oppReach,ownReach};
  }

  function counterfactualActionValues(game,id,mode='profile',{comboIds,groups}={}){
    const node=game.nodes[id];
    if(!node||node.terminal||node.chance)return null;
    if(!['profile','constrainedBest','best'].includes(mode))throw Error('Unknown action-value continuation.');
    const policy=lazyAveragePolicy(game,false),start=selectedReaches(game,id,policy);
    if(comboIds!==undefined&&!Array.isArray(comboIds))throw Error('comboIds must be an array.');
    if(groups!==undefined&&(!groups||typeof groups!=='object'||Array.isArray(groups)||
      Object.values(groups).some(ids=>!Array.isArray(ids))))throw Error('Groups must map names to combo ID arrays.');
    const groupIds=groups?Object.values(groups).flat():[];
    const requested=[...(comboIds??[]),...groupIds];
    if(requested.some(id=>!Number.isInteger(id)||id<0||id>=1326||game.players[node.p].index[id]<0))
      throw Error('Action values require combo IDs in the acting player’s range.');
    if(comboIds)start.comboIds=new Set(requested);
    start.counterfactual={id,player:node.p,evBasis:'centered-counterfactual',continuation:mode,
      evaluation:'fixed-continuation',localSensitivity:mode==='profile',
      actions:node.actions.map(action=>action.label)};
    evaluatePolicy(game,policy,node.p,mode,null,id,start);
    if(groups){
      const hands=new Map(start.counterfactual.hands.map(hand=>[hand.comboId,hand]));
      start.counterfactual.groups=Object.fromEntries(Object.entries(groups).map(([name,ids])=>{
        const actionEVs=new Float64Array(node.actions.length);
        let total=0;
        for(const comboId of new Set(ids)){
          const hand=hands.get(comboId);
          if(!hand.reachMass||hand.conditionalActionEVs[0]===null)continue;
          total+=hand.reachMass;
          for(let k=0;k<actionEVs.length;k++)actionEVs[k]+=hand.reachMass*hand.conditionalActionEVs[k];
        }
        return [name,{reachMass:total,actionEVs:Array.from(actionEVs,v=>total>0?v/total:null),
          deltasFromFirstAction:Array.from(actionEVs,v=>total>0?(v-actionEVs[0])/total:null)}];
      }));
    }
    if(comboIds){
      const visible=new Set(comboIds);
      start.counterfactual.hands=start.counterfactual.hands.filter(hand=>visible.has(hand.comboId));
    }
    return start.counterfactual;
  }

  function makeNodeReport(game,id){
    const node=game.nodes[id];if(!node||node.terminal||node.chance)return null;
    const records=[],policy=lazyAveragePolicy(game);
    evaluatePolicy(game,policy,node.p,'profile',records,id,selectedReaches(game,id,policy));
    const record=records[id];if(!record)return null;
    const offset=game.pot/2+node.c[node.p];
    const shifted=value=>value===null?null:(Math.abs(value+offset)<1e-9?0:value+offset);
    record.rangeEV=shifted(record.rangeEV);
    for(const hand of record.hands){
      hand[2]=shifted(hand[2]);
      for(let k=0;k<node.actions.length;k++)if(hand[4][k]!==null)
        hand[4][k]=node.actions[k].type==='fold'?0:shifted(hand[4][k]);
    }
    return record;
  }
  function makeSummary(game,iteration,elapsedMs,history,options){
    const check=makeConvergenceCheck(game,iteration,elapsedMs,history,null,{...options,includeProfile:true});
    return {...check,
      qreTemperaturePercent:game.equilibrium==='qre'?game.qreTemperaturePercent:null,
      qreActiveTemperaturePercent:game.equilibrium==='qre'?100*game.qreTemperature/game.pot:null,
      qreWarmupComplete:game.equilibrium==='qre'?(iteration>=game.qreWarmupIterations):null,
      qreWarmupIterations:game.equilibrium==='qre'?game.qreWarmupIterations:null,
      qreProbabilityFloor:game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:null,
      qreModel:game.equilibrium==='qre'?'entropy-regularized-zero-sum':null,
      qreResidualUnits:game.equilibrium==='qre'?'chips-per-player':null,
      qreCompared:0,tpwl:null,tpwlNodes:0,jointZ:game.jointZ,memoryBytes:game.memory,
      reportLevel:'summary',nodes:[]};
  }

  // EV-only evaluation never constructs hand-level reports. Native locked
  // evaluation shares terminal work between the requested response modes.
  function makeConvergenceCheck(game,iteration,elapsedMs,history,policy=null,
      {includeProfile=false,includeUnrestricted=true,independent=false}={}) {
    const compiled=independent?null:game.compiled,locked=game.nodeLocks.length>0;
    const reference=(p,mode)=>rangeValue(game,p,evaluatePolicy(game,policy??=lazyAveragePolicy(game,false),p,mode));
    const legacyBest=!locked&&!game.hasFrequencyIncrements?compiled?.exactBest:null;
    let backend='javascript';
    let qreResidual=null;
    const evaluate=p=>{
      if(compiled?.evaluateValues&&(locked||game.hasFrequencyIncrements||game.actionPruning.enabled||game.regretPruning||
        game.zeroReachPruning||!legacyBest||game.jointZ<1e-10))try{
        const result=compiled.evaluateValues(p,includeProfile,includeUnrestricted);
        backend=compiled.sourceOnly?compiled.mode:'wasm-lock-aware';
        return result;
      }catch(_){compiled.evaluateValues=null;}
      if(legacyBest&&game.jointZ>=1e-10)try{
        const constrained=legacyBest(p,false);
        const profile=includeProfile?(compiled.profileEV?.(p)??reference(p,'profile')):null;
        backend='wasm';
        return {constrained,profile,unrestricted:includeUnrestricted?constrained:null};
      }catch(_){compiled.exactBest=null;}
      const constrained=reference(p,locked?'constrainedBest':'best');
      return {constrained,profile:includeProfile?reference(p,'profile'):null,
        unrestricted:includeUnrestricted?(game.nodeLocks.some(lock=>lock.player===p)?reference(p,'best'):constrained):null};
    };
    const values=[evaluate(0),evaluate(1)];
    if(game.equilibrium==='qre'){
      let regularized;
      if(compiled?.exactBest)try{regularized=[compiled.exactBest(0,true),compiled.exactBest(1,true)];}catch(_){}
      regularized??=[reference(0,'regularizedBest'),reference(1,'regularizedBest')];
      qreResidual=Math.max(0,regularized[0]+regularized[1])/2;
    }
    const metrics=equilibriumMetrics(game,values.map(v=>v.constrained),
      includeProfile?values.map(v=>v.profile):null,includeUnrestricted?values.map(v=>v.unrestricted):null);
    return {iteration,elapsedMs,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
      equilibrium:game.equilibrium,gtoAlgorithm:game.gtoAlgorithm,qreResidual,evaluationBackend:backend,
      ...metrics,history:history||[]};
  }
  function appendConvergenceHistory(history,iteration,exploitability){
    if(iteration<=0)return;
    if(history.length&&history[history.length-1][0]===iteration)
      history[history.length-1][1]=exploitability;
    else history.push([iteration,exploitability]);
    if(history.length>180)history.shift();
  }
  // v12: deterministic, device-neutral checkpoint signature of the *complete*
  // configured game, including exact priors, chance structure and algorithm.
  // A pair of independent 32-bit hashes is a corruption/mismatch guard, not a
  // security or authentication primitive. Never load checkpoints from strangers.
  function gameSignature(game,{rulesOnly=false,legacy=false,stateLength=game.stateLength??game.stateStorage?.length}={}){
    let h1=2166136261>>>0,h2=0x9e3779b9>>>0;
    function feed(x){x=x>>>0;h1=Math.imul(h1^x,16777619)>>>0;h2=(Math.imul((h2+x)>>>0,2246822519)^h2>>>13)>>>0;}
    const dv=new DataView(new ArrayBuffer(8));
    function number(x){dv.setFloat64(0,x,true);feed(dv.getUint32(0,true));feed(dv.getUint32(4,true));}
    function str(s){s=String(s);feed(s.length);for(let i=0;i<s.length;i++)feed(s.charCodeAt(i));}
    str(rulesOnly?'TurnRiverLab-rules-v1':'TurnRiverLab-v12-checkpoint-v1');
    number(game.pot);number(game.stack);
    if(!rulesOnly){
    str(game.equilibrium);str(game.gtoAlgorithm);
    // Reject pre-v16.2 checkpoints for this one variant: their saved averageSum
    // used linear rather than the advertised quadratic weighting. All other
    // algorithm signatures remain unchanged for checkpoint compatibility.
    if(game.gtoAlgorithm==='dcfr-2-0.5-2')str('quadratic-average-v2');
    if(game.gtoAlgorithm==='dcfr-scheduled-cubic'){
      str('scheduled-cubic-schedule-v1');
      number(game.hybridSchedule.alphaStart);number(game.hybridSchedule.alphaGain);
      number(game.hybridSchedule.rampLength);number(game.hybridSchedule.averagingPower);
    }
    number(game.qreTemperaturePercent);feed(game.zeroReachPruning?1:0);feed(game.regretPruning?1:0);
    if(game.hasFrequencyIncrements){
      str('action-frequency-increments-v1');
      for(const street of frequencyStreets.slice(game.board.length-3))
        for(const step of game.frequencyIncrements[street])number(step);
    }
    if(game.riverPrivateSymmetry?.enabled){str('river-private-orbits-v1');feed(game.riverPrivateSymmetry.groupSize);}
    if(game.nodeLocks?.length){
      const legacy=game.nodeLocks.every(lock=>lock.percentages);
      str(legacy?'fixed-node-action-mixtures-v1':'fixed-combo-action-mixtures-v2');feed(game.nodeLocks.length);
      for(const lock of game.nodeLocks){
        feed(lock.nodeId);
        if(lock.percentages){if(!legacy)str('whole');for(const pct of lock.percentages)number(pct);}
        else {str('combos');const entries=Object.entries(lock.comboPercentages).sort((a,b)=>Number(a[0])-Number(b[0]));
          feed(entries.length);for(const [id,mix] of entries){feed(Number(id));for(const pct of mix)number(pct);}}
      }
    }
    if(game.actionPruning?.enabled){str('range-wide-action-culling-v2');
      number(game.actionPruning.thresholdPercent);feed(game.actionPruning.warmupIterations);
      feed(game.actionPruning.recheckIterations);feed(game.actionPruning.plannedIterations);}
    }
    feed(game.board.length);for(const id of game.board)feed(id);
    feed(game.nodes.length);feed(game.root);
    for(const node of game.nodes){
      feed(node.id);feed(node.terminal?1:node.chance?2:3);
      if(node.terminal){
        str(node.type);feed((node.winner??-1)+2);
        if(rulesOnly){number(node.c[0]);number(node.c[1]);}
      }
      else if(node.chance){feed(node.runouts.length);for(const r of node.runouts){feed(r.child);feed((r.card??r.river??-1)+1);number(r.weight??1/44);}}
      else {feed(node.p);feed(node.actions.length);for(const action of node.actions){feed(action.child);str(action.type);number(action.total??0);}}
    }
    for(const player of game.players){
      feed(player.ids.length);
      for(let i=0;i<player.ids.length;i++){
        feed(player.ids[i]);
        number(rulesOnly?player.rawWeights[i]:player.priors[i]);
      }
    }
    if(!rulesOnly){
      feed(stateLength);
      if(!legacy){
        str('strategy-layout-v2');feed(game.compactState?1:0);
        if(game.banks){
          str('compact-private-rows-v1');str(game.strategyPrecision);
          if(game.deriveCurrent)str('derived-current-policy');
        }
        str(game.rulesFingerprint??'');
        if(game.riverPrivateSymmetry.enabled)
          for(const map of game.riverPrivateSymmetry.maps)for(const i of map.master)feed(i);
        for(const node of game.nodes)if(node.isoAlias){
          feed(node.id);feed(node.isoAlias.source);
          for(const index of node.isoAlias.map)feed(index);
        }
      }
    }
    return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
  }
  function resetGameState(game){
    game.stateStorage.fill(0);
    for(const node of game.decisions)node.pruned?.fill(0);
    game.actionPruning.prunedActions=0;
    game.actionPruning.fullProbeIterations=0;
    game.currentIteration=game.prunedTerminalHands=0;
    game._positiveDiscount=game._negativeDiscount=undefined;
    const kernels=traversalWorkspaces.get(game);
    if(kernels)for(const kernel of kernels)if(kernel)kernel.cache=new WeakMap();
    initializeState(game);
  }

  function enforceRestoredLocks(game){
    for(const {nodeId} of game.nodeLocks){
      const node=game.nodes[nodeId];
      if(node.isoAlias||node.forced)continue;
      const a=node.actions.length;
      copyLockedRows(node,node.current);
      for(let i=0;i<node.lockedMask.length;i++)if(node.lockedMask[i]){
        const offset=(node.symmetry?.ordinals[i]??i)*a;
        node.regret.fill(0,offset,offset+a);
        node.averageSum.fill(0,offset,offset+a);
        node.previousDelta?.fill(0,offset,offset+a);
      }
    }
  }

  function restoreState(game,checkpoint){
    const values=checkpoint.storage;
    if(game.banks){
      if(checkpoint.format!=='TurnRiverLab-checkpoint-v2'||!(values instanceof Uint8Array)||
        values.byteLength!==game.stateBytes||checkpoint.fingerprint!==gameSignature(game))
        throw Error('Checkpoint does not match this compact game, ranges, tree or algorithm');
      for(const [i,{Type,offset,length}] of game.banks.entries()){
        const view=new Type(values.buffer,values.byteOffset+offset,length);
        for(const x of view)if(!Number.isFinite(x)||i>=4&&x<0||Type===Int16Array&&x===-32768)
          throw Error('Invalid compact checkpoint numerical state');
      }
    }else if(!(values instanceof Float64Array))throw Error('Checkpoint state must be Float64.');
    const sameLayout=checkpoint.fingerprint===gameSignature(game)&&values.length===game.stateLength;
    const legacy=!game.banks&&!sameLayout&&checkpoint.fingerprint===gameSignature(game,{legacy:true,stateLength:values.length})&&
      contexts.get(game)?.prepared.legacyLayoutMatches(game);
    if(!game.banks&&!sameLayout&&!legacy)throw Error('Checkpoint does not match this game, ranges, tree or algorithm');
    if(!Number.isSafeInteger(checkpoint.iteration)||checkpoint.iteration<0||
      !Number.isFinite(checkpoint.elapsedMs)||checkpoint.elapsedMs<0)throw Error('Invalid checkpoint iteration or elapsed time');
    if(!Array.isArray(checkpoint.history)||checkpoint.history.some(p=>!Array.isArray(p)||p.length!==2||
      !Number.isFinite(p[0])||!Number.isFinite(p[1])))throw Error('Invalid checkpoint convergence history');
    if(game.banks){game.stateStorage.set(values);return;}
    for(const x of values)if(!Number.isFinite(x))throw Error('Checkpoint has non-finite solver state');
    const masks=checkpoint.prunedMasks;
    if(game.actionPruning.enabled){
      if(!Array.isArray(masks)||masks.length!==game.nodes.length)
        throw Error('Checkpoint is missing frequency-pruning action masks');
      for(let i=0;i<masks.length;i++){
        const mask=masks[i],node=game.nodes[i];
        if(mask!==null&&(!node.current||!Array.isArray(mask)||mask.length!==node.actions.length||
           mask.some((x,k)=>x!==0&&(x!==1||node.locked||!['bet','raise'].includes(node.actions[k].type)||
             node.actions[k].label.startsWith('All-in')))))
          throw Error('Invalid frequency-pruning checkpoint mask');
      }
    }
    if(sameLayout)game.stateStorage.set(values);
    else{
      const nodes=game.nodes.filter(n=>n.current);
      const slots=node=>node.forced?node.current.length+game.riverPrivateSymmetry.representatives[node.p]*
        (game.gtoAlgorithm==='optimistic'||game.gtoAlgorithm==='dcfr-predictive'?3:2):
        node.regret.length+node.averageSum.length+node.current.length+(node.previousDelta?.length??0)+
        (node.qreLog?.length??0)+(node.qreEntropy?.length??0);
      if(values.length!==nodes.reduce((sum,node)=>sum+slots(node),0))throw Error('Checkpoint state size mismatch');
      let at=0;
      for(const node of nodes){
        if(node.forced){at+=slots(node);node.current.fill(1);continue;}
        for(const target of [node.regret,node.averageSum,node.current,node.previousDelta,node.qreLog,node.qreEntropy]){
          if(target){target.set(values.subarray(at,at+target.length));at+=target.length;}
        }
      }
    }
    if(game.actionPruning.enabled){
      let count=0;
      for(let i=0;i<masks.length;i++){
        const node=game.nodes[i],mask=masks[i];
        if(mask&&!node.forced){
          node.pruned??=new Uint8Array(mask.length);
          node.pruned.set(mask);
          for(const bit of mask)count+=bit;
        }else node.pruned?.fill(0);
      }
      game.actionPruning.prunedActions=count;
    }
    enforceRestoredLocks(game);
    if(legacy)for(const node of game.decisions)if(node.suitRows){
      enforceSuitRows(node,node.current);
      enforceSuitRows(node,node.averageSum);
    }
  }

  function affectedRegrets(source,destination){
    const changed=new Uint8Array(destination.nodes.length),affected=new Uint8Array(changed.length);
    const ids=new Set([...source.nodeLocks,...destination.nodeLocks].map(lock=>lock.nodeId));
    for(const id of ids){
      const a=source.nodes[id],b=destination.nodes[id];
      const same=a.locked&&b.locked&&a.lockedMask.every((bit,i)=>bit===b.lockedMask[i])&&
        a.lockedMask.every((bit,i)=>!bit||a.actions.every((_,k)=>
          lockedProbability(a,i,k,a.actions.length)===lockedProbability(b,i,k,a.actions.length)));
      if(!same)changed[id]=1;
    }
    const {parents}=destination.paths;
    // Regret at ancestors observes changed continuations. Descendants can
    // observe changed opponent reach. Other branches still receive a discount.
    for(let i=changed.length-1;i>=0;i--)if(changed[i]){
      for(let at=i;at>=0&&!affected[at];at=parents[at])affected[at]=1;
    }
    for(let i=0;i<changed.length;i++)if(changed[parents[i]]){changed[i]=1;affected[i]=1;}
    return affected;
  }

  function transferWarmState(source,destination,{mode='combined',regretDiscount=0.25}={}){
    const streets=frequencyStreets.slice(destination.board.length-3);
    if(source===destination||source.rulesFingerprint!==destination.rulesFingerprint||
      source.equilibrium!=='gto'||destination.equilibrium!=='gto'||
      streets.some(street=>source.frequencyIncrements[street].some((step,p)=>step!==destination.frequencyIncrements[street][p])))
      throw Error('Warm starts require separate structurally compatible GTO sessions.');
    if(!['strategy','regret','combined'].includes(mode)||!Number.isFinite(regretDiscount)||
      regretDiscount<0||regretDiscount>1)throw Error('Invalid warm-start mode or regret discount.');
    const keepRegret=mode!=='strategy',keepStrategy=mode!=='regret';
    if(keepStrategy&&destination.deriveCurrent)throw Error('Derived current policy supports regret-only warm starts.');
    if(keepRegret&&(source.gtoAlgorithm!==destination.gtoAlgorithm||
       JSON.stringify(source.hybridSchedule)!==JSON.stringify(destination.hybridSchedule)))
      throw Error('Regret transfer requires the same algorithm and schedule.');
    const affected=keepRegret?affectedRegrets(source,destination):null;
    const updates=new Float64Array(12);
    resetGameState(destination);
    for(const node of destination.decisions){
      if(node.actions.length===1||node.allLocked)continue;
      let original=source.nodes[node.id];
      const inverses=[];
      while(original.isoAlias){
        inverses.push(original.isoAlias.inverse);
        original=source.nodes[original.isoAlias.source];
      }
      const a=node.actions.length,n=destination.players[node.p].ids.length;
      const strategy=keepStrategy?averageNodePolicy(source,original):null;
      for(let i=0;i<n;i++){
        if(node.lockedMask?.[i])continue;
        const row=node.rowShape?learnableRow(node,i):i;
        if(row<0)continue;
        let j=i;
        for(const map of inverses)j=map[j];
        if(strategy)for(let k=0;k<a;k++)node.current[row*a+k]=strategy[j*a+k];
        if(keepRegret&&!affected[node.id]&&!original.lockedMask?.[j]){
          const sourceRow=original.rowShape?.map[j]??original.symmetry?.ordinals[j]??original.suitRows?.[j]??j;
          if(sourceRow<0)continue;
          const from=sourceRow*a,to=(node.symmetry?.ordinals[i]??row)*a;
          if(node.symmetry&&node.symmetry.master[i]!==i)continue;
          for(let k=0;k<a;k++)updates[k]=accumulator(original.regret,original.regretScale,from+k,a)*regretDiscount;
          if(node.regretScale)setScaledRow(node.regret,node.regretScale,row,a,updates);
          else for(let k=0;k<a;k++)node.regret[to+k]=updates[k];
        }
      }
      if(!node.rowShape)enforceSuitRows(node,node.current);
    }
    if(!keepStrategy){currentPolicy(destination,0);currentPolicy(destination,1);}
  }

  class CFRSolver {
    constructor(game) {
      this.attach(game);
      this.resetCounters();
    }
    attach(game){
      game.allocateState?.();
      this.game=game;
      game.coreCompatibilityMass=(target,reach,node)=>compatibilityMass(game,target,reach,node);
      this.profileEnabled=!!game.profileEnabled;
    }
    resetCounters(){
      this.iteration=0;this.startTime=Date.now();this.history=[];
      this.timings={steps:0,policy0Ms:0,policy1Ms:0,traversal0Ms:0,traversal1Ms:0,checks:0,checkMs:0,summaries:0,summaryMs:0};
    }
    resetSolverState(){
      resetGameState(this.game);
      this.resetCounters();
    }
    setNodeLocks(locks,initializeBackend){
      const previous=this.game,prepared=contexts.get(previous)?.prepared;
      if(!prepared)throw Error('Game was not built by this solver core.');
      const game=prepared.replaceLocks(previous,locks);
      if(game!==previous){
        initializeBackend?.(game);
        this.attach(game);
      }
      this.resetSolverState();
    }
    warmStartFrom(source,options){
      transferWarmState(source.game,this.game,options);
      this.resetCounters();
    }
    step() {
      const t=++this.iteration;
      this.game.currentIteration=t;
      const pruning=this.game.actionPruning;
      const probe=pruning?.enabled&&(t<=pruning.warmupIterations||
        (t-pruning.warmupIterations)%pruning.recheckIterations===0);
      if(probe){
        if(t>pruning.warmupIterations)pruning.fullProbeIterations++;
        let hadCulled=false;
        for(const node of this.game.nodes)if(node.pruned?.some(x=>x)){
          node.pruned.fill(0);hadCulled=true;
        }
        // Recover unmasked policies from regret on every full reevaluation.
        if(hadCulled){currentPolicy(this.game,0);currentPolicy(this.game,1);}
      }
      if(['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(this.game.gtoAlgorithm)){
        const alpha=this.game.gtoAlgorithm==='dcfr-scheduled-cubic'?
          this.game.hybridSchedule.alphaStart+this.game.hybridSchedule.alphaGain*t/(t+this.game.hybridSchedule.rampLength):
          this.game.gtoAlgorithm==='dcfr-scheduled'?1.0+0.5*t/(t+16):
          this.game.gtoAlgorithm==='dcfr-adaptive'?0.9+0.6*t/(t+48):1.5;
        const v=Math.pow(t,this.game.gtoAlgorithm==='dcfr-2-0.5-2'?2:alpha);
        this.game._positiveDiscount=this.game.gtoAlgorithm==='lcfr'?t/(t+1):v/(v+1);
        this.game._negativeDiscount=this.game.gtoAlgorithm==='lcfr'?t/(t+1):
          this.game.gtoAlgorithm==='dcfr-2-0.5-2'?Math.sqrt(t)/(Math.sqrt(t)+1):0.5;
      }
      // In the explicit (alpha=2, beta=0.5, gamma=2) variant,
      // gamma=2 means quadratic strategy averaging, not linear CFR+ averaging.
      // Keep this expression on the JS side: both scalar and SIMD WASM
      // receive the same weight through traverseCfr().
      const averagingWeight=this.game.gtoAlgorithm==='dcfr-scheduled-cubic'?
        Math.pow(t,this.game.hybridSchedule.averagingPower):
        this.game.gtoAlgorithm==='dcfr-cubic'?t*t*t:
        (['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','dcfr-2-0.5-2'].includes(this.game.gtoAlgorithm))?t*t:t;
      const p=this.profileEnabled?()=>typeof performance!=='undefined'?performance.now():Date.now():null;
      let mark=p?p():0;
      traverseCfr(this.game,this.game.root,0,this.game.players[1].priors,averagingWeight,false);
      if(p){const now=p();this.timings.traversal0Ms+=now-mark;mark=now;}
      if(this.game.compiled?.fusesPolicy)enforceSuitPolicies(this.game,0);
      else currentPolicy(this.game,0);
      if(p){const now=p();this.timings.policy0Ms+=now-mark;mark=now;}
      traverseCfr(this.game,this.game.root,1,this.game.players[0].priors,averagingWeight,false);
      if(p){const now=p();this.timings.traversal1Ms+=now-mark;mark=now;}
      if(this.game.compiled?.fusesPolicy)enforceSuitPolicies(this.game,1);
      else currentPolicy(this.game,1);
      if(p)this.timings.policy1Ms+=p()-mark;
      if(pruning?.enabled&&t>=pruning.warmupIterations&&probe){
        // Entire bet/raise SIZE at a decision node is culled if its
        // blocker-adjusted, reach-weighted frequency across the full player
        // range falls below the cutoff. There are NO per-hand cutoffs.
        const frequencies=rangeWideActionFrequencies(this.game);
        let total=0;
        for(const node of this.game.nodes){
          if(node.terminal||node.chance||node.isoAlias||node.locked||node.actions.length<=1)continue;
          const a=node.actions.length,n=this.game.players[node.p].ids.length;
          if(!node.pruned)node.pruned=new Uint8Array(a);
          const next=new Uint8Array(a),freq=frequencies[node.id];
          if(freq)for(let k=0;k<a;k++){
            const action=node.actions[k];
            if(!['bet','raise'].includes(action.type)||action.label.startsWith('All-in'))continue;
            if(freq[k]<pruning.thresholdPercent/100)next[k]=1;
          }
          node.pruned.set(next);
          if(next.some(x=>x))enforceActionMask(node,n);
          for(const bit of next)total+=bit;
        }
        pruning.prunedActions=total;
      }
      this.timings.steps++;
    }
    getProfile(){return {...this.timings,iterations:this.iteration,elapsedMs:Date.now()-this.startTime,
      memoryBytes:this.game.memory,compiled:this.game.compiled?.mode||'javascript',
      fusedPolicy:!!this.game.compiled?.fusesPolicy,
      nodes:this.game.nodes.length,equilibrium:this.game.equilibrium,algorithm:this.game.gtoAlgorithm};}
    saveCheckpoint(copy=true){
      if(!this.game.stateStorage)throw Error('Checkpoint requires a complete numerical game');
      const storage=copy?this.game.stateStorage.slice():this.game.stateStorage;
      return {format:this.game.banks?'TurnRiverLab-checkpoint-v2':'TurnRiverLab-checkpoint-v1',
        fingerprint:gameSignature(this.game),iteration:this.iteration,
        elapsedMs:Math.max(0,Date.now()-this.startTime),history:this.history.map(pair=>pair.slice()),
        prunedMasks:this.game.actionPruning?.enabled?this.game.nodes.map(n=>n.pruned?Array.from(n.pruned):null):null,
        storage};
    }
    static resume(game,checkpoint){
      if(!checkpoint||checkpoint.format!==(game.banks?'TurnRiverLab-checkpoint-v2':'TurnRiverLab-checkpoint-v1'))
        throw Error('Unsupported checkpoint format for this strategy layout');
      game.allocateState?.();
      restoreState(game,checkpoint);
      const solver=new CFRSolver(game);solver.iteration=checkpoint.iteration;game.currentIteration=solver.iteration;
      solver.startTime=Date.now()-checkpoint.elapsedMs;solver.history=checkpoint.history.map(p=>p.slice());return solver;
    }
    checkConvergence(options) {
      const start=this.profileEnabled?(typeof performance!=='undefined'?performance.now():Date.now()):0;
      const r=makeConvergenceCheck(this.game,this.iteration,Date.now()-this.startTime,this.history,null,options);
      if(this.profileEnabled){this.timings.checks++;this.timings.checkMs+=(typeof performance!=='undefined'?performance.now():Date.now())-start;}
      appendConvergenceHistory(this.history,this.iteration,r.exploitability);
      if(this.game.actionPruning?.enabled)r.actionPruning={...this.game.actionPruning,culledNodes:this.game.nodes.filter(n=>n.pruned?.some(x=>x)).map(n=>[n.id,Array.from(n.pruned)])};
      r.history=this.history.map(pair=>pair.slice());return r;
    }
    summary(options) {
      const start=this.profileEnabled?(typeof performance!=='undefined'?performance.now():Date.now()):0;
      const r=makeSummary(this.game,this.iteration,Date.now()-this.startTime,this.history,options);
      if(this.profileEnabled){this.timings.summaries++;this.timings.summaryMs+=(typeof performance!=='undefined'?performance.now():Date.now())-start;}
      appendConvergenceHistory(this.history,this.iteration,r.exploitability);
      if(this.game.actionPruning?.enabled)r.actionPruning={...this.game.actionPruning,culledNodes:this.game.nodes.filter(n=>n.pruned?.some(x=>x)).map(n=>[n.id,Array.from(n.pruned)])};
      r.history=this.history.map(pair=>pair.slice());return r;
    }
    counterfactualActionValues(id,continuation,options){
      return counterfactualActionValues(this.game,id,continuation,options);
    }
    nodeReport(id) {
      if(!this.game.nodeLocks?.length&&this.game.compiled?.nodeDetail)try{return this.game.compiled.nodeDetail(id);}catch(_){}
      return makeNodeReport(this.game,id);
    }
    report() {
      const r=makeReport(this.game,this.iteration,Date.now()-this.startTime,this.history);
      appendConvergenceHistory(this.history,this.iteration,r.exploitability);
      if(this.game.actionPruning?.enabled)r.actionPruning={...this.game.actionPruning,culledNodes:this.game.nodes.filter(n=>n.pruned?.some(x=>x)).map(n=>[n.id,Array.from(n.pruned)])};
      r.history=this.history.map(pair=>pair.slice());return r;
    }
  }
  return {RANKS,SUITS,CATEGORY_RANKS,ALL_COMBOS,CATEGORY_IDS,cardId,cardText,rank,comboId,comboCategory,
    boardMask,turnMask,flopMask,boardCombos,compatible,straightHigh,evaluate7,showdownScores,buildTree,buildTurnRiverTree,buildFlopTurnRiverTree,makeGame,prepareGame,flopFidelities,frequencyStreets,parseFrequencyIncrements,
    terminalCfv,compatibilityMass,rangeValue,averagePolicy,evaluatePolicy,makeReport,makeNodeReport,counterfactualActionValues,makeSummary,makeConvergenceCheck,compareEvLoss,candidateIsWorse,gameSignature,algorithmVersion,CFRSolver,
    currentPolicy,rangeWideActionFrequencies,accumulate,traverseCfr,logitResponse,QRE_PROBABILITY_FLOOR};
}
if(typeof window!=='undefined') window.createSolverCore=createSolverCore;
