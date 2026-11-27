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
    if(cards.length !== 7) throw Error('Hand evaluator requires seven distinct cards.');
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
      score[id] = evaluate7([b[0],b[1],b[2],b[3],b[4],a,c]);
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
    if(!Number.isInteger(pot) || pot<1 || !Number.isInteger(stack) || stack<1) throw Error('Pot and effective stack must be positive whole chips.');
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
  function buildMultiStreetTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,startBoard,turnSamples=49,riverSamples=48,raiseSizes={},turnDonkSizes0=null,turnEntryMode="normal",flopDonkSizes0=null,flopEntryMode="normal",riverDonkSizes0=null,flopSamplingSeed=0) {
    const isFlop=startBoard.length===3;
    const streetStart=isFlop?'flop':'turn';
    const nodes=[];
    function reserve(node) {
      if(nodes.length>=maxNodes) throw Error('Multi-street game tree exceeds the node budget. Reduce runouts, sizes or raises, or increase max nodes.');
      node.id=nodes.length;nodes.push(node);return node.id;
    }
    function terminal(type,c,winner,history,turn,river) {
      return reserve({terminal:true,type,winner,c:[...c],pot:pot+c[0]+c[1],history,turn,river});
    }
    function chance(street,c,history,turn=null,previousAggressor=null) {
      const id=reserve({terminal:false,chance:true,street:'deal-'+street,c:[...c],pot:pot+c[0]+c[1],history,turn,river:null,runouts:[]});
      const node=nodes[id],publicBoard=turn===null?startBoard:[...startBoard,turn];
      const selected=selectRunouts(publicBoard,street==='turn'?turnSamples:riverSamples,isFlop?flopSamplingSeed:0);
      const candidateCount=52-publicBoard.length;
      // 45 turn and 44 river cards remain given both players' private hands.
      const eligiblePerDeal=candidateCount-4;
      const chanceWeight=candidateCount/selected.length/eligiblePerDeal;
      for(const card of selected) {
        const nextTurn=street==='turn'?card:turn;
        const nextRiver=street==='river'?card:null;
        const label=(street==='turn'?'Turn ':'River ')+cardText(card),nextHistory=history.concat(label);
        const child=c[0]===stack && c[1]===stack
          ? street==='turn'?chance('river',c,nextHistory,nextTurn):terminal('showdown',c,null,nextHistory,nextTurn,nextRiver)
          : decision(street,0,c,0,1,0,nextHistory,nextTurn,nextRiver,previousAggressor);
        node.runouts.push({card,turn:nextTurn,river:nextRiver,label,child,weight:chanceWeight});
      }
      return id;
    }
    function closeStreet(street,c,history,turn,river,currentAggressor) {
      if(street==='flop')return chance('turn',c,history,null,currentAggressor);
      if(street==='turn')return chance('river',c,history,turn,currentAggressor);
      return terminal('showdown',c,null,history,turn,river);
    }
    function decision(street,p,c,checks,lastRaise,raises,history,turn,river,previousAggressor=null,currentAggressor=null) {
      const toCall=c[1-p]-c[p],potNow=pot+c[0]+c[1];
      if(toCall===0 && c[p]===stack)return closeStreet(street,c,history,turn,river,currentAggressor);
      const id=reserve({terminal:false,chance:false,street,turn,river,p,c:[...c],pot:potNow,
        toCall,lastRaise,raises,history,actions:[]});
      const node=nodes[id];
      // A donk is the first OOP lead after IP was the prior street's last aggressor.
      // For a flop start, the prior preflop aggressor is supplied by the user.
      const donkOpportunity=p===0&&checks===0&&toCall===0&&
        (street==='flop'?flopEntryMode==='ip-aggressor':previousAggressor===1);
      node.donkOpportunity=donkOpportunity;
      function add(type,label,total,child){node.actions.push({type,label,total,increment:total-c[p],child});}
      if(toCall===0) {
        const label='Check';
        const child=checks===1?closeStreet(street,c,history.concat(label),turn,river,currentAggressor)
          :decision(street,1-p,c,1,lastRaise,raises,history.concat(label),turn,river,previousAggressor,currentAggressor);
        add('check',label,c[p],child);
      }else {
        add('fold','Fold',c[p],terminal('fold',c,1-p,history.concat('Fold'),turn,river));
        const nextC=[...c];nextC[p]+=toCall;
        add('call','Call '+toCall,nextC[p],closeStreet(street,nextC,history.concat('Call '+toCall),turn,river,currentAggressor));
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
          const label=total===stack?'All-in '+(total-c[p]):(toCall?'Raise ':useDonkSizes?'Donk ':'Bet ')+option.fraction+'%';
          const next=[...c];next[p]=total;
          const increase=total-c[1-p],newLast=increase>=lastRaise?increase:lastRaise;
          const child=decision(street,1-p,next,0,newLast,raises+(toCall>0?1:0),history.concat(label),turn,river,
            previousAggressor,p);
          add(toCall?'raise':'bet',label,total,child);
        }
      }
      return id;
    }
    const root=decision(streetStart,0,[0,0],0,1,0,[streetStart==='flop'?'Flop':'Turn'],null,null,
      !isFlop&&turnEntryMode==='ip-aggressor'?1:null);
    return {nodes,root,rivers:!isFlop?selectRunouts(startBoard,48):null};
  }
  function buildTurnRiverTree(pot,stack,turnSizes,riverSizes,maxRaises,allIn,maxNodes,turnBoard,raiseSizes={},turnDonkSizes0=null,turnEntryMode='normal',riverDonkSizes0=null) {
    return buildMultiStreetTree(pot,stack,null,turnSizes,riverSizes,maxRaises,allIn,maxNodes,turnMask(turnBoard),49,48,raiseSizes,turnDonkSizes0,turnEntryMode,null,'normal',riverDonkSizes0);
  }
  function buildFlopTurnRiverTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,flopBoard,turnSamples=8,riverSamples=6,raiseSizes={},turnDonkSizes0=null,flopDonkSizes0=null,flopEntryMode='normal',riverDonkSizes0=null,flopSamplingSeed=0) {
    return buildMultiStreetTree(pot,stack,flopSizes,turnSizes,riverSizes,maxRaises,allIn,maxNodes,flopMask(flopBoard),turnSamples,riverSamples,raiseSizes,turnDonkSizes0,'normal',flopDonkSizes0,flopEntryMode,riverDonkSizes0,flopSamplingSeed);
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
  const SUIT_PERMUTATIONS=suitPermutations();
  function exactSuitAutomorphisms(board,players,setwise=false){
    const out=[],flop=board.slice(0,3),later=board.slice(3);
    for(const suits of SUIT_PERMUTATIONS){
      const mapCard=c=>(c&~3)+suits[c&3];
      if(setwise){
        if(flop.some(c=>!flop.includes(mapCard(c)))||later.some(c=>mapCard(c)!==c))continue;
      }else if(board.some(c=>mapCard(c)!==c))continue;
      const maps=[];let ok=true;
      for(const player of players){
        const indices=new Uint16Array(player.ids.length);
        for(let i=0;i<player.ids.length;i++){
          const [a,b]=ALL_COMBOS[player.ids[i]];
          const mapped=comboId((a&~3)+suits[a&3],(b&~3)+suits[b&3]);
          const j=player.index[mapped];
          if(j<0 || player.priors[j]!==player.priors[i]){ok=false;break;}
          indices[i]=j;
        }
        if(!ok)break;
        maps.push(indices);
      }
      if(ok)out.push({suits,maps});
    }
    return out;
  }
  // A transform must preserve every physical restriction, including exact
  // locked mixes at the transformed betting/chance history.
  function lockPreservingTransforms(tree,transforms){
    const locked=tree.nodes.filter(node=>node.locked);
    if(!locked.length||transforms.length<2)return transforms;
    const parents=new Array(tree.nodes.length);
    for(const node of tree.nodes)if(!node.terminal){
      if(node.chance)for(const outcome of node.runouts)parents[outcome.child]=[node.id,outcome.card];
      else node.actions.forEach((action,k)=>{parents[action.child]=[node.id,k];});
    }
    const paths=locked.map(node=>{
      const path=[];
      for(let id=node.id;id!==tree.root;){const [parent,edge]=parents[id];path.push(edge);id=parent;}
      return path.reverse();
    });
    return transforms.filter(t=>locked.every((node,i)=>{
      let destination=tree.nodes[tree.root];
      for(const edge of paths[i]){
        const child=destination.chance?destination.runouts.find(o=>o.card===((edge&~3)+t.suits[edge&3]))?.child:
          destination.actions?.[edge]?.child;
        if(child===undefined)return false;
        destination=tree.nodes[child];
      }
      if(!destination.locked)return false;
      const a=node.actions.length,map=t.maps[node.p];
      if(node.p!==destination.p||a!==destination.actions.length)return false;
      for(let h=0;h<map.length;h++){
        if(!!node.lockedMask[h]!==!!destination.lockedMask[map[h]])return false;
        if(node.lockedMask[h])for(let k=0;k<a;k++)
          if(lockedProbability(node,h,k)!==lockedProbability(destination,map[h],k))return false;
      }
      return true;
    }));
  }

  function installSuitIsomorphism(tree,board,players,enabled,turnSamples=49,riverSamples=48,seed=0,automorphisms=null){
    const info={enabled:false,street:board.length===3?'flop':board.length===4?'turn':'river',
      groupSize:1,runouts:board.length===3?49:48,representatives:board.length===3?49:48,
      turnRepresentatives:null,riverRepresentatives:null,savedRunouts:0,aliasedDecisions:0,reason:'not-applicable'};
    if(!enabled){info.reason='disabled';return info;}
    if(board.length!==3&&board.length!==4)return info;
    const base=automorphisms??exactSuitAutomorphisms(board,players);
    const mapCard=(c,t)=>(c&~3)+t.suits[c&3];
    const selected=board.length===3?selectRunouts(board,turnSamples,seed):[];
    const selectedSet=new Set(selected),riverSets=new Map();
    if(board.length===3)for(const t of selected)riverSets.set(t,new Set(selectRunouts([...board,t],riverSamples,seed)));
    const transforms=board.length===3?base.filter(t=>{
      // Sampling is only exact under permutations of the complete chance tree,
      // including every conditional river sample for every sampled turn.
      if(selected.some(c=>!selectedSet.has(mapCard(c,t))))return false;
      for(const c of selected){
        const source=riverSets.get(c),destination=riverSets.get(mapCard(c,t));
        if(!destination||source.size!==destination.size)return false;
        for(const r of source)if(!destination.has(mapCard(r,t)))return false;
      }
      return true;
    }):base;
    info.groupSize=transforms.length;
    if(automorphisms)Object.defineProperty(info,'transforms',{value:transforms});
    if(transforms.length<=1){info.reason=board.length===3&&base.length>1?'sampled-runouts-break-symmetry':'no-exact-symmetry';return info;}
    // The alias tree remains structurally complete. Match chance outcomes by
    // transformed card rather than by runout array index.
    function markPair(masterId,aliasId,t){
      const master=tree.nodes[masterId],alias=tree.nodes[aliasId];
      if(master.terminal){if(!alias.terminal||master.type!==alias.type||master.winner!==alias.winner)throw Error('Isomorphic terminal mismatch');return;}
      if(master.chance||alias.chance){
        if(!master.chance||!alias.chance||master.street!==alias.street||master.runouts.length!==alias.runouts.length)
          throw Error('Isomorphic chance mismatch');
        const dest=new Map(alias.runouts.map(o=>[o.card,o]));
        for(const item of master.runouts){const other=dest.get(mapCard(item.card,t));
          if(!other||other.weight!==item.weight)throw Error('Isomorphic chance weight or runout mismatch');
          markPair(item.child,other.child,t);
        }
        return;
      }
      if(master.actions.length!==alias.actions.length||master.p!==alias.p)throw Error('Isomorphic betting tree mismatch');
      if(alias.isoAlias)throw Error('Duplicate suit alias');
      alias.isoAlias={source:masterId,map:t.maps[alias.p]};info.aliasedDecisions++;
      for(let k=0;k<master.actions.length;k++){
        if(master.actions[k].label!==alias.actions[k].label)throw Error('Isomorphic action mismatch');
        markPair(master.actions[k].child,alias.actions[k].child,t);
      }
    }
    function installNode(id){
      const node=tree.nodes[id];
      if(node.terminal)return;
      if(!node.chance){for(const action of node.actions)installNode(action.child);return;}
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
    info.enabled=info.aliasedDecisions>0;
    if(board.length===4){
      info.representatives=info.riverRepresentatives??48;
      info.savedRunouts=48-info.representatives;
    }else info.representatives=info.turnRepresentatives??turnSamples;
    info.reason=info.enabled?'verified-suit-automorphism':'no-orbit-reduction';
    return info;
  }
  // Fixed river: suit-orbit representatives of private hands. Unlike public
  // chance reduction these save *strategy state* rows, not chance runouts.
  // Use only if both weighted ranges are exactly invariant. This compact
  // reference path deliberately avoids native kernels that assume dense rows.
  function installRiverPrivateSymmetry(board,players,enabled){
    const info={enabled:false,groupSize:1,handCounts:players.map(p=>p.ids.length),
      representatives:players.map(p=>p.ids.length),savedRows:0,reason:'not-applicable'};
    if(!enabled){info.reason='disabled';return info;}
    if(board.length!==5)return info;
    const group=exactSuitAutomorphisms(board,players);info.groupSize=group.length;
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

  function lockedProbability(node,hand,action){
    const a=node.actions.length;
    return node.lockedRows[(node.sharedLock?0:node.lockOffsets?node.lockOffsets[hand]:hand)*a+action];
  }

  function storagePlan(tree,players,config,equilibrium,gtoAlgorithm,transforms){
    const requested=config.storageLayout??'auto';
    if(!['auto','dense','compact'].includes(requested))throw Error('Unknown numerical storage layout.');
    const qre=equilibrium==='qre',predictive=['optimistic','dcfr-predictive'].includes(gtoAlgorithm);
    const decisions=tree.nodes.filter(node=>!node.terminal&&!node.chance&&!node.isoAlias);
    const dense=(node,n=players[node.p].ids.length)=>n*node.actions.length*(3+Number(predictive)+(qre?1:0))+(qre?n:0);
    const denseSlots=decisions.reduce((sum,node)=>sum+dense(node),0);
    // Auto starts with the fast dense layout. Only build compact row maps
    // after the memory check selects Compact or the caller requests it.
    if(requested!=='compact')return {mode:'dense',denseBytes:denseSlots*8};
    const supports=new Map(),orbits=new Map(),sharedRows=new Map();
    function boardSupport(turn,river){
      const key=(turn??52)*53+(river??52);
      if(supports.has(key))return supports.get(key);
      const publicLegal=players.map(p=>Uint8Array.from(p.card0,(_,h)=>Number((turn==null||p.cardAllowed[turn][h])&&(river==null||p.cardAllowed[river][h]))));
      const available=players.map((p,i)=>{
        const counts=new Uint16Array(52);let total=0;
        for(let h=0;h<p.ids.length;h++)if(publicLegal[i][h]){total++;counts[p.card0[h]]++;counts[p.card1[h]]++;}
        return {counts,total};
      });
      const support=players.map((p,i)=>publicLegal[i].map((legal,h)=>{
        if(!legal)return 0;
        const {counts,total}=available[1-i],other=p.opponentIndex[h];
        return Number(total-counts[p.card0[h]]-counts[p.card1[h]]+(other>=0?publicLegal[1-i][other]:0)>0);
      }));
      supports.set(key,support);return support;
    }
    function stabilizer(turn,river){
      const key=(turn??52)*53+(river??52);
      if(!orbits.has(key))orbits.set(key,transforms.filter(t=>
        (turn==null||t.suits[turn&3]===(turn&3))&&(river==null||t.suits[river&3]===(river&3))));
      return orbits.get(key);
    }
    let slots=0,metadata=0,omittedRows=0,orbitRows=0;
    const layouts=[],noRows={map:null,reps:new Uint16Array(0)};
    for(const node of decisions){
      const p=node.p,n=players[p].ids.length,a=node.actions.length;
      const turn=node.turn,river=node.river,cacheKey=[p,turn??52,river??52].join(':');
      let layout=!node.locked&&a>1?sharedRows.get(cacheKey):null;
      if(!layout){
        if(a===1||node.allLocked)layout=noRows;
        else{
          const map=new Int16Array(n).fill(-1),reps=[];
          const group=stabilizer(turn,river),support=boardSupport(turn,river)[p];
          for(let h=0;h<n;h++){
            if(map[h]>=0||!support[h]||node.lockedMask?.[h])continue;
            const row=reps.length;reps.push(h);map[h]=row;
            for(const t of group)map[t.maps[p][h]]=row;
          }
          layout={map,reps:Uint16Array.from(reps)};
          metadata+=map.byteLength+layout.reps.byteLength;
          if(!node.locked)sharedRows.set(cacheKey,layout);
        }
      }
      if(!layout.map)omittedRows+=n;
      else for(const row of layout.map)if(row<0)omittedRows++;
      if(layout.map)orbitRows+=n-layout.reps.length-layout.map.reduce((sum,row)=>sum+Number(row<0),0);
      slots+=dense(node,layout.reps.length);
      layouts.push(layout);
    }
    const implicitShapes=new Set();
    for(let i=0;i<decisions.length;i++){
      const node=decisions[i],a=node.actions.length,key=a+':'+(node.frequencyUnits??0);
      node.compact=layouts[i];
      if(config.useActionFrequencyPruning||!implicitShapes.has(key))metadata+=a*8;
      implicitShapes.add(key);
    }
    for(const node of tree.nodes)if(node.locked)metadata+=node.lockedRows.byteLength+
      (node.lockOffsets?.byteLength??0)+node.lockedMask.byteLength;
    return {mode:'compact',denseBytes:denseSlots*8,slots,metadata,omittedRows,orbitRows};
  }

  function learnedRow(node,h){
    if(node.compact)return node.compact.map?.[h]??-1;
    return node.symmetry?node.symmetry.ordinals[h]:h;
  }
  function currentProbability(node,h,k){
    if(!node.compact)return node.current[h*node.actions.length+k];
    if(node.lockedMask?.[h])return lockedProbability(node,h,k);
    const row=learnedRow(node,h);
    return row<0?node.implicitPolicy[k]:node.current[row*node.actions.length+k];
  }
  function learnRepresentative(node,h,row){
    return node.compact?row>=0&&node.compact.reps[row]===h:!node.symmetry||node.symmetry.master[h]===h;
  }

  function makeGame(config, options={}) {
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
    if(!Number.isInteger(pot)||pot<1||!Number.isInteger(stack)||stack<1)throw Error('Pot and effective stack must be positive whole chips.');
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
      players.push({ids,priors,index,sorted,sortedByRiver:isTurn?new Array(52):null,rawTotal:sum});
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
    let jointZ=0;
    const opp=players[1],cardMass=new Float64Array(52);
    for(let j=0;j<opp.ids.length;j++){
      const [a,b]=ALL_COMBOS[opp.ids[j]];cardMass[a]+=opp.priors[j];cardMass[b]+=opp.priors[j];
    }
    for(let i=0;i<players[0].ids.length;i++){
      const id=players[0].ids[i],[a,b]=ALL_COMBOS[id],oj=opp.index[id];
      jointZ+=players[0].priors[i]*(1-cardMass[a]-cardMass[b]+(oj>=0?opp.priors[oj]:0));
    }
    if(jointZ<=1e-12)throw Error('No mutually compatible OOP and IP hands exist.');
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
    const maxNodes=config.maxNodes==null?(isFlop?18000:isTurn?25000:1800):Number(config.maxNodes);
    if(!Number.isSafeInteger(maxNodes)||maxNodes<20||maxNodes>100000)
      throw Error('Maximum tree nodes must be a whole number between 20 and 100,000.');
    const turnSamples=isFlop?(config.flopTurnSamples===undefined?8:Number(config.flopTurnSamples)):null;
    const riverSamples=isFlop?(config.flopRiverSamples===undefined?6:Number(config.flopRiverSamples)):null;
    if(isFlop&&(!Number.isInteger(turnSamples)||turnSamples<1||turnSamples>49||!Number.isInteger(riverSamples)||riverSamples<1||riverSamples>48))
      throw Error('Flop runouts must specify 1–49 turn cards and 1–48 river cards.');
    const flopSamplingSeed=Number(config.flopSamplingSeed??0);
    if(!Number.isSafeInteger(flopSamplingSeed)||flopSamplingSeed<0||flopSamplingSeed>2147483647)
      throw Error('Flop sampling seed must be a whole number from 0 to 2,147,483,647.');
    // A node lock fixes either a full-node strategy or selected exact private
    // combinations. Unspecified combinations remain learnable at that same
    // information set; unrestricted best responses retain every legal action.
    const requestedLocks=config.nodeLocks??[];
    if(!Array.isArray(requestedLocks)||requestedLocks.length>256)throw Error('Node locks must be an array of at most 256 decisions.');
    if(requestedLocks.length&&equilibrium!=='gto')throw Error('Node locking currently supports GTO only, not entropy-regularized QRE.');
    const tree=isFlop?buildFlopTurnRiverTree(pot,stack,flopSizes,turnSizes,sizes,maxRaises,allIn,maxNodes,board,turnSamples,riverSamples,raisesByStreet,turnDonkSizes0,flopDonkSizes0,flopEntryMode,riverDonkSizes0,flopSamplingSeed)
      :isTurn?buildTurnRiverTree(pot,stack,turnSizes,sizes,maxRaises,allIn,maxNodes,board,raisesByStreet,turnDonkSizes0,turnEntryMode,riverDonkSizes0)
      :buildTree(pot,stack,sizes,maxRaises,allIn,maxNodes,raisesByStreet.river,riverDonkSizes0,riverEntryMode);
    if(hasFrequencyIncrements)for(const node of tree.nodes)if(!node.terminal&&!node.chance){
      const step=frequencyIncrements[node.street??'river'][node.p];
      if(step)node.frequencyUnits=Math.round(100/step);
    }
    const nodeLocks=[];
    const seenLocks=new Set();
    for(const entry of requestedLocks){
      if(!entry||!Number.isSafeInteger(entry.nodeId)||seenLocks.has(entry.nodeId))
        throw Error('Node locks must have unique decision-node IDs.');
      const node=tree.nodes[entry.nodeId];
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
      const n=players[node.p].ids.length,a=node.actions.length;
      const validateMix=(values)=>{
        if(!Array.isArray(values)||values.length!==a||
           values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100))
          throw Error('Every locked action must have a percentage between 0 and 100.');
        if(Math.abs(values.reduce((sum,v)=>sum+v,0)-100)>1e-7)
          throw Error('Locked action percentages must total exactly 100%.');
        if(node.frequencyUnits&&values.some(v=>{
          const units=v*node.frequencyUnits/100;
          return Math.abs(units-Math.round(units))>1e-8;
        }))throw Error(`Node ${node.id} lock percentages must match the ${frequencyIncrements[node.street??'river'][node.p]}% frequency increment.`);
      };
      const compact=config.storageLayout==='compact',mask=new Uint8Array(n),combos={};
      let rows;
      if(whole){
        validateMix(entry.percentages);
        mask.fill(1);
        const count=compact?1:n;
        rows=new Float64Array(count*a);
        for(let i=0;i<count;i++)for(let k=0;k<a;k++)rows[i*a+k]=entry.percentages[k]/100;
        if(compact)node.sharedLock=true;
      }else{
        if(!entry.comboPercentages||typeof entry.comboPercentages!=='object'||Array.isArray(entry.comboPercentages))
          throw Error('Combo locks must be an object keyed by exact combination ID.');
        const ids=Object.keys(entry.comboPercentages);
        if(!ids.length||ids.length>n)throw Error('A combo lock must specify 1 to '+n+' available combinations.');
        rows=new Float64Array((compact?ids.length:n)*a);
        if(compact)node.lockOffsets=new Int16Array(n).fill(-1);
        let nextRow=0;
        for(const idText of ids){
          if(!/^(0|[1-9][0-9]*)$/.test(idText))throw Error('Combo lock ID must be a canonical integer combination ID.');
          const id=Number(idText),index=players[node.p].index[id];
          if(!Number.isSafeInteger(id)||id<0||id>=1326||index<0)
            throw Error('Combo lock references a hand outside this player’s available range.');
          const [c0,c1]=ALL_COMBOS[id];
          if((node.turn!=null&&(c0===node.turn||c1===node.turn))||
             (node.river!=null&&(c0===node.river||c1===node.river)))
            throw Error('Combo lock references a hand blocked by this decision’s public cards.');
          const values=entry.comboPercentages[idText];validateMix(values);
          mask[index]=1;combos[idText]=values.slice();
          const row=compact?nextRow++:index;
          if(compact)node.lockOffsets[index]=row;
          for(let k=0;k<a;k++)rows[row*a+k]=values[k]/100;
        }
      }
      seenLocks.add(entry.nodeId);
      node.locked=true;node.lockedMask=mask;node.lockedRows=rows;
      node.allLocked=whole;
      nodeLocks.push({nodeId:entry.nodeId,history:node.history.slice(),player:node.p,board:board.slice(),pot,stack,
        actions:node.actions.map(a=>a.label),actionTotals:node.actions.map(a=>a.total),
        ...(whole?{percentages:entry.percentages.slice()}:{comboPercentages:Object.fromEntries(Object.entries(combos).sort((x,y)=>Number(x[0])-Number(y[0])))} )});
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
    const explicitCompact=config.storageLayout==='compact';
    const allowPublic=config.useSuitIsomorphism!==false&&(isTurn||isFlop);
    const allowPrivate=isTurn||isFlop?allowPublic:config.useRiverHandSymmetry!==false;
    const group=allowPrivate&&explicitCompact?
      lockPreservingTransforms(tree,exactSuitAutomorphisms(board,players,true)):[];
    // Compact uses the same chance-tree automorphisms for public and private rows.
    const suitIsomorphism=installSuitIsomorphism(tree,board,players,
      allowPublic&&(explicitCompact||!nodeLocks.length),turnSamples??49,riverSamples??48,flopSamplingSeed,
      explicitCompact?group:null);
    const numericStorage=storagePlan(tree,players,config,equilibrium,gtoAlgorithm,suitIsomorphism.transforms??group);
    const riverPrivateSymmetry=installRiverPrivateSymmetry(board,players,
      numericStorage.mode==='dense'&&!!config.useRiverHandSymmetry&&!isTurn&&!isFlop);
    if(riverPrivateSymmetry.enabled&&nodeLocks.length){
      const invariant=tree.nodes.every(node=>{
        if(!node.locked||node.terminal||node.chance)return true;
        const map=riverPrivateSymmetry.maps[node.p],a=node.actions.length;
        for(let h=0;h<map.master.length;h++){
          const m=map.master[h];
          if(node.lockedMask[h]!==node.lockedMask[m])return false;
          if(node.lockedMask[h])for(let k=0;k<a;k++)
            if(lockedProbability(node,h,k)!==lockedProbability(node,m,k))return false;
        }
        return true;
      });
      if(!invariant){riverPrivateSymmetry.enabled=false;riverPrivateSymmetry.reason='locks-break-suit-symmetry';}
    }
    const autoLayout=(config.storageLayout??'auto')==='auto';
    const memoryLimit=Number(config.memoryLimitBytes);
    if(autoLayout&&memoryLimit>0&&!riverPrivateSymmetry.enabled&&numericStorage.denseBytes>memoryLimit)
      return makeGame({...config,storageLayout:'compact'},options);
    if(preview){
      // Accurate strategy-buffer estimate, plus a conservative allowance for
      // the board-specific numerical tables allocated by the solving worker.
      let stateBytes=0;
      for(const node of tree.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias){
        const n=players[node.p].ids.length,a=node.actions.length;
        const m=riverPrivateSymmetry.enabled?riverPrivateSymmetry.representatives[node.p]:n;
        stateBytes+=(m*2+n)*a*8+(equilibrium==='qre'?(n*a+n)*8:0)+(['optimistic','dcfr-predictive'].includes(gtoAlgorithm)?m*a*8:0);
      }
      if(numericStorage.mode==='compact')stateBytes=numericStorage.slots*8+numericStorage.metadata;
      const distinctBoards=isFlop?new Set(tree.nodes.filter(n=>n.terminal&&n.type==='showdown')
        .map(n=>n.turn*52+n.river)).size:isTurn?tree.rivers.length:1;
      const approxBoardBytes=distinctBoards*(1326*4+(players[0].ids.length+players[1].ids.length)*12+3000);
      const memory=stateBytes+approxBoardBytes+players.reduce((t,p)=>t+p.ids.length*66,0);
      return {board,isFlop,isTurn,pot,stack,equilibrium,qreTemperaturePercent,gtoAlgorithm,hybridSchedule,zeroReachPruning:!!config.useZeroReachPruning,regretPruning:!!config.useRegretPruning,sparseTraversal,
        sampledChance:isFlop&&(turnSamples<49||riverSamples<48),numericStorage,
        players,...tree,memory,suitIsomorphism,riverPrivateSymmetry,actionPruning,nodeLocks,frequencyIncrements,hasFrequencyIncrements,preview:true};
    }
    const scoresByRiver=isTurn?new Array(52).fill(null):null;
    const scoresByRunout=isFlop?new Map():null;
    if(isTurn)for(const river of tree.rivers){
      const rs=showdownScores([...board,river]);scoresByRiver[river]=rs;
      for(const player of players)player.sortedByRiver[river]=Array.from({length:player.ids.length},(_,i)=>i)
        .filter(i=>rs[player.ids[i]]>=0).sort((a,b)=>rs[player.ids[a]]-rs[player.ids[b]]);
    }
    if(isFlop){
      const pairs=new Set();
      for(const node of tree.nodes)if(node.terminal&&node.type==='showdown')pairs.add(node.turn*52+node.river);
      for(const key of pairs){
        const turn=Math.floor(key/52),river=key%52,rs=showdownScores([...board,turn,river]);
        const sorted=players.map(player=>Array.from({length:player.ids.length},(_,i)=>i)
          .filter(i=>rs[player.ids[i]]>=0).sort((a,b)=>rs[player.ids[a]]-rs[player.ids[b]]));
        scoresByRunout.set(key,{scores:rs,sorted});
      }
    }
    // Compile the river payoff program once per actual five-card board.
    // Fold terminals share card-legality masks but need no hand-rank program.
    // The same immutable programs are used in GTO and entropy-regularized QRE.
    const riverPayoffLayouts=new Map();
    function installRiverLayout(key,sc,orders){
      riverPayoffLayouts.set(key,[
        compileRiverPayoffLayout(players[0],players[1],sc,orders[0],orders[1]),
        compileRiverPayoffLayout(players[1],players[0],sc,orders[1],orders[0])
      ]);
    }
    if(!isTurn&&!isFlop)installRiverLayout(52*53+52,scores,players.map(p=>p.sorted));
    if(isTurn)for(const river of tree.rivers)installRiverLayout(52*53+river,scoresByRiver[river],
      players.map(p=>p.sortedByRiver[river]));
    if(isFlop)for(const [key,data] of scoresByRunout) {
      const turn=Math.floor(key/52),river=key%52;
      installRiverLayout(turn*53+river,data.scores,data.sorted);
    }
    // Resolve immutable payoff layouts and board scores at game construction.
    // Hot terminal visits never need a Map lookup or an extra score-table walk.
    for(const node of tree.nodes)if(node.terminal&&node.type==='showdown'){
      const key=(node.turn??52)*53+(node.river??52);
      node.riverPayoff=riverPayoffLayouts.get(key);
      node.riverScores=isFlop?scoresByRunout.get(node.turn*52+node.river).scores:
        isTurn?scoresByRiver[node.river]:scores;
    }
    // Cache exact hand/runout legality once per public board instead of
    // repeatedly checking the same two card blockers at each terminal visit.
    // All 48 legal rivers are still enumerated for turn solves.
    const legalRunouts=new Map(),legalRunoutIndices=new Map();
    const fullHandIndices=players.map(player=>Uint16Array.from(player.ids,(_,i)=>i));
    for(const node of tree.nodes)if(!node.chance && (node.turn!==null&&node.turn!==undefined || node.river!==null&&node.river!==undefined)){
      const key=(node.turn??52)*53+(node.river??52);
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
    // A fully specified river has no extra runout blockers. Every combo in
    // its already board-filtered range is legal, in its original index order.
    if(!isFlop&&!isTurn)for(const node of tree.nodes)if(node.terminal)
      node.validIndices=fullHandIndices;
    let memory=1326*4+52*16+players.reduce((sum,p)=>sum+52*p.ids.length+4*p.ids.length,0);
    for(const pair of riverPayoffLayouts.values())for(const layout of pair)memory+=riverLayoutBytes(layout);
    for(const valid of legalRunouts.values())memory+=valid[0].byteLength+valid[1].byteLength;
    for(const indices of legalRunoutIndices.values())memory+=indices[0].byteLength+indices[1].byteLength;
    memory+=fullHandIndices[0].byteLength+fullHandIndices[1].byteLength;
    if(isFlop)for(const v of scoresByRunout.values())memory+=v.scores.byteLength+v.sorted.reduce((sum,ids)=>sum+ids.length*8,0);
    // One contiguous Float64 arena instead of thousands of independently
    // allocated backing stores. Every node receives a stable view; neither
    // the game's indexing nor the order of arithmetic changes.
    let slots=0;
    for(const node of tree.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias){
      const n=players[node.p].ids.length,a=node.actions.length;
      const m=riverPrivateSymmetry.enabled?riverPrivateSymmetry.representatives[node.p]:n;
      slots+=m*a*2+n*a+(equilibrium==='qre'?n*a+n:0)+(['optimistic','dcfr-predictive'].includes(gtoAlgorithm)?m*a:0);
    }
    if(numericStorage.mode==='compact'){slots=numericStorage.slots;memory+=numericStorage.metadata;}
    else memory+=tree.nodes.reduce((sum,node)=>sum+(node.lockedRows?.byteLength??0)+(node.lockedMask?.byteLength??0),0);
    const projectedMemory=memory+slots*8;
    if(memoryLimit>0&&projectedMemory>memoryLimit){
      if(autoLayout)return makeGame({...config,storageLayout:'compact'},options);
      throw Error('Estimated strategy state exceeds the memory budget. Reduce runouts, ranges, bet sizes or raises.');
    }
    const stateStorage=new Float64Array(slots);
    let nextSlot=0;
    const implicitRows=new Map();
    function take(count){const view=stateStorage.subarray(nextSlot,nextSlot+count);nextSlot+=count;return view;}
    for(const node of tree.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias){
      const n=players[node.p].ids.length,a=node.actions.length;
      const m=node.compact?node.compact.reps.length:riverPrivateSymmetry.enabled?riverPrivateSymmetry.representatives[node.p]:n;
      const currentRows=node.compact?m:n;
      if(riverPrivateSymmetry.enabled)node.symmetry=riverPrivateSymmetry.maps[node.p];
      node.regret=take(m*a);
      node.averageSum=take(m*a);
      node.current=take(currentRows*a);
      if(['optimistic','dcfr-predictive'].includes(gtoAlgorithm))node.previousDelta=take(m*a);
      if(node.compact){
        const key=a+':'+(node.frequencyUnits??0);
        if(actionPruning.enabled||!implicitRows.has(key)){
          const row=new Float64Array(a).fill(1/a);
          projectFrequencyRows(node,row,false);
          implicitRows.set(key,row);
        }
        node.implicitPolicy=implicitRows.get(key);
        if(currentRows)node.current.set(node.implicitPolicy,0);
        for(let off=a;off<node.current.length;off+=a)node.current.copyWithin(off,0,a);
      }else{
        for(let h=0;h<n;h++)for(let k=0;k<a;k++)node.current[h*a+k]=
          node.lockedMask?.[h]?lockedProbability(node,h,k):1/a;
        projectFrequencyRows(node,node.current);
      }
      if(equilibrium==='qre'){
        node.qreLog=take(currentRows*a);
        node.qreEntropy=take(currentRows);
        refreshQreNodeCache(node,currentRows);
      }
    }
    // Aliased river nodes have no independent numerical state: the report
    // expands canonical policies through the exact suit-index permutation.
    // Keeping their structural nodes preserves every original runout/history.
    suitIsomorphism.stateBytesSaved=tree.nodes.reduce((sum,node)=>{
      if(!node.isoAlias)return sum;
      const n=players[node.p].ids.length,a=node.actions.length;
      return sum+8*(n*a*3+(equilibrium==='qre'?n*a+n:0)+(['optimistic','dcfr-predictive'].includes(gtoAlgorithm)?n*a:0));
    },0);
    memory=projectedMemory;
    return {board,isFlop,isTurn,pot,stack,equilibrium,qreTemperaturePercent,gtoAlgorithm,hybridSchedule,zeroReachPruning:!!config.useZeroReachPruning,regretPruning:!!config.useRegretPruning,sparseTraversal,
      qreTargetTemperature:pot*qreTemperaturePercent/100,
      qreTemperature:pot*qreTemperaturePercent/100,
      qreWarmupIterations:0,
      sizes,turnSizes,turnDonkSizes0,turnEntryMode,flopSizes,flopDonkSizes0,flopEntryMode,riverDonkSizes0,riverEntryMode,raisesByStreet,turnSamples,riverSamples,
      sampledChance:isFlop&&(turnSamples<49||riverSamples<48),maxRaises,allIn,scores,scoresByRiver,scoresByRunout,riverPayoffLayouts,
      players,...tree,jointZ,memory,stateStorage,numericStorage,suitIsomorphism,riverPrivateSymmetry,actionPruning,nodeLocks,frequencyIncrements,hasFrequencyIncrements};
  }

  // Convert each hand's normalized action mix to integer units. Whole units
  // are assigned first, then the largest remainders get the remaining units.
  // Equal remainders use action order, so equivalent suit rows stay identical.
  let frequencyRemainders=new Float64Array(0);
  function projectFrequencyRows(node,policy,physical=true){
    const units=node.frequencyUnits,a=node.actions.length;
    if(!units||a===1||(physical&&node.allLocked))return;
    if(frequencyRemainders.length<a)frequencyRemainders=new Float64Array(a);
    for(let h=0,off=0;off<policy.length;h++,off+=a){
      if(physical&&node.lockedMask?.[h])continue;
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
          for(let i=0;i<next1.length;i++)if(allowed1[i])next1[i]=reach1[i]*weight;
          visit(outcome.child,next0,next1);
        }
        return;
      }
      const a=node.actions.length,p=node.p,own=p===0?reach0:reach1,
        opp=p===0?reach1:reach0,n=own.length;
      let hasCandidate=false;
      for(let k=0;k<a;k++)if(['bet','raise'].includes(node.actions[k].type)&&
        !node.actions[k].label.startsWith('All-in')){hasCandidate=true;break;}
      if(hasCandidate){
        const {mass,cards}=scratch[p];
        compatibilityMassInto(game,p,opp,node,mass,cards);
        const sums=new Float64Array(a);let denom=0;
        for(let i=0;i<n;i++){
          const w=own[i]*mass[i];if(!(w>0))continue;
          denom+=w;
          for(let k=0;k<a;k++)sums[k]+=w*currentProbability(node,i,k);
        }
        // Unreached nodes cannot provide evidence that an action is rare.
        if(denom>1e-14)frequencies[id]=Array.from(sums,x=>x/denom);
      }
      for(let k=0;k<a;k++){
        const next=new Float64Array(n);
        for(let i=0;i<n;i++)next[i]=own[i]*currentProbability(node,i,k);
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
    if(node.compact){
      maskRangeWidePolicy(node,node.current,node.compact.reps.length);
      projectFrequencyRows(node,node.current,false);
      if(node.pruned){
        node.implicitPolicy.fill(1/node.actions.length);
        maskRangeWidePolicy(node,node.implicitPolicy,1);
        projectFrequencyRows(node,node.implicitPolicy,false);
      }
    }else{
      maskRangeWidePolicy(node,node.current,handCount);
      projectFrequencyRows(node,node.current);
    }
  }
  function restoreLockedPolicy(game,p) {
    for(const node of game.nodes)if(node.locked&&!node.compact&&!node.isoAlias&&node.p===p){
      const a=node.actions.length,s=node.current,mask=node.lockedMask,rows=node.lockedRows;
      for(let h=0;h<mask.length;h++)if(mask[h])
        for(let k=0;k<a;k++)s[h*a+k]=rows[h*a+k];
    }
  }
  function currentPolicy(game,p) {
    if(game.compiled&&!game.compiled.compact){
      const nativeRefreshed=game.compiled.updatePolicy(p,game.equilibrium==='qre');
      if(game.hasFrequencyIncrements)for(const node of game.nodes)
        if(node.frequencyUnits&&!node.isoAlias&&node.p===p)enforceActionMask(node,game.players[p].ids.length);
      // Native policy refresh can touch locked rows. Restore only the hands
      // actually locked, leaving every other hand free to learn normally.
      restoreLockedPolicy(game,p);
      if(game.equilibrium==='qre'&&!nativeRefreshed)for(const node of game.nodes)
        if(!node.terminal&&!node.chance&&!node.isoAlias&&node.p===p)
          refreshQreNodeCache(node,game.players[p].ids.length);
      return;
    }
    for(const node of game.nodes) if(!node.terminal && !node.chance && !node.isoAlias && node.p===p) {
      if(node.allLocked)continue;
      const a=node.actions.length, n=node.compact?node.compact.reps.length:game.players[p].ids.length, r=node.regret, s=node.current;
      const floor=game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:0,scale=1-a*floor;
      const tieFloor=game.equilibrium==='qre'?0:16*Number.EPSILON*Math.max(1,game.pot+game.stack);
      // Deterministic regret matching at Float64 noise scale, not a relaxed stopping criterion.
      for(let h=0;h<n;h++) {
        let sum=0, off=(node.symmetry?node.symmetry.ordinals[h]:h)*a,so=h*a;
        const variant=game.gtoAlgorithm;
        for(let k=0;k<a;k++){
          const v=['optimistic','dcfr-predictive'].includes(variant)?r[off+k]+node.previousDelta[off+k]:r[off+k];
          sum+=v>0?v:0;
        }
        for(let k=0;k<a;k++){
          const v=['optimistic','dcfr-predictive'].includes(variant)?r[off+k]+node.previousDelta[off+k]:r[off+k];
          s[so+k]=floor+scale*(sum>tieFloor?(v>0?v:0)/sum:1/a);
        }
      }
      enforceActionMask(node,n);
      if(node.locked&&!node.compact){for(let h=0;h<n;h++)if(node.lockedMask[h])
        for(let k=0;k<a;k++)s[h*a+k]=lockedProbability(node,h,k);}
      if(game.equilibrium==='qre')refreshQreNodeCache(node,n);
    }
  }
  function blockedByRunout(a,b,node) {
    if(!node)return false;
    return (node.turn!==null&&node.turn!==undefined&&(a===node.turn||b===node.turn))||
      (node.river!==null&&node.river!==undefined&&(a===node.river||b===node.river));
  }
  function compatibilityMass(game,target,oppReach,node) {
    const mine=game.players[target],opp=game.players[1-target],cards=new Float64Array(52);
    const oppLegal=node&&node.valid?node.valid[1-target]:null;
    const mineLegal=node&&node.valid?node.valid[target]:null;
    let total=0;
    for(let i=0;i<opp.ids.length;i++){
      const w=oppReach[i];if(!w||(oppLegal&&!oppLegal[i]))continue;
      const [a,b]=ALL_COMBOS[opp.ids[i]];
      if(!oppLegal&&blockedByRunout(a,b,node))continue;
      total+=w;cards[a]+=w;cards[b]+=w;
    }
    const masses=new Float64Array(mine.ids.length);
    for(let i=0;i<mine.ids.length;i++){
      const id=mine.ids[i],[a,b]=ALL_COMBOS[id],oi=opp.index[id];
      if((mineLegal&&!mineLegal[i])||(!mineLegal&&blockedByRunout(a,b,node)))continue;
      let m=total-cards[a]-cards[b]+(oi>=0?oppReach[oi]:0);
      if(game.equilibrium==='qre'&&total>0&&m<total*1e-8){
        m=0;for(let j=0;j<opp.ids.length;j++){const [x,y]=ALL_COMBOS[opp.ids[j]];
          if(x!==a&&x!==b&&y!==a&&y!==b&&((oppLegal&&oppLegal[j])||(!oppLegal&&!blockedByRunout(x,y,node))))m+=oppReach[j];}
      }
      masses[i]=Math.max(0,m);
    }
    return masses;
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
      if(game.equilibrium==='qre'&&total>0&&m<total*1e-8){
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
      if(game.equilibrium==='qre'&&total>0&&m<total*1e-8){
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
        if(game.equilibrium==='qre'&&total>0&&m<total*1e-8){
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
      if(game.equilibrium==='qre'&&total>0&&comp<total*1e-8){
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
        if(game.equilibrium==='qre'&&total>0&&m<total*1e-8){m=0;for(let k=0;k<opp.ids.length;k++){const [x,y]=ALL_COMBOS[opp.ids[k]];
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
        if(game.equilibrium==='qre'&&total>0&&comp<total*1e-8){
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
        const n=own.ids.length,a=node.actions.length,avg=node.averageSum;
        for(let i=0;i<n;i++){
          const row=learnedRow(node,i);
          if(!learnRepresentative(node,i,row))continue;
          for(let j=0;j<a;j++)avg[row*a+j]+=weight*reach[i]*currentProbability(node,i,j);
        }
        for(let j=0;j<a;j++) {
          const next=new Float64Array(n);
          for(let i=0;i<n;i++) next[i]=reach[i]*currentProbability(node,i,j);
          visit(node.actions[j].child,next);
        }
      }
      visit(game.root,initial);
    }
  }
  // Recycle traversal work buffers instead of allocating fresh hand vectors at
  // every CFR branch. The exact chance tree, regrets, update order and terminal
  // arithmetic remain unchanged; buffers are local to a traversal call.
  const traversalWorkspaces=new WeakMap();
  function traverseCfr(game,id,target,oppReach,averageWeight=0) {
    if(game.compiled?.fullTraversal)return game.compiled.traverse(id,target,oppReach,averageWeight);
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
        entropyReach:new Float64Array(oppN),
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
        if(!node.compact&&node.p===target && ownReach){
          const avg=node.averageSum,cur=node.current;
          for(let i=0;i<myN;i++)if(!node.symmetry||node.symmetry.master[i]===i)
            avg[node.symmetry?node.symmetry.ordinals[i]:i]+=averageWeight*ownReach[i]*cur[i];
        }
        visit(node.actions[0].child,reach,output,ownReach);
        return;
      }
      if(node.p!==target){
        const value=acquire(myN);
        for(let a=0;a<nActions;a++){
          if(node.pruned?.[a])continue;
          const branch=acquire(oppN);
          for(let i=0;i<oppN;i++)branch[i]=reach[i]*currentProbability(node,i,a);
          visit(node.actions[a].child,branch,value,ownReach);
          for(let i=0;i<myN;i++){output[i]+=value[i];value[i]=0;}
          release(branch);
        }
        release(value);
        if(game.equilibrium==='qre'){
          const weighted=kernel.entropyReach,entropy=node.qreEntropy;
          for(let i=0;i<oppN;i++){
            const row=node.compact?learnedRow(node,i):i;
            weighted[i]=row<0?0:reach[i]*entropy[row];
          }
          const mass=compatibilityMassInto(game,target,weighted,node,kernel.mass,kernel.massCards);
          for(let i=0;i<myN;i++)output[i]-=game.qreTemperature*mass[i];
        }
        return;
      }
      const actionVals=new Array(nActions);

      for(let a=0;a<nActions;a++){
        const values=acquire(myN);
        if(node.pruned?.[a]){actionVals[a]=values;continue;}
        let ownNext=null;
        if(ownReach){
          ownNext=acquire(myN);
          const avg=node.averageSum;
          for(let i=0;i<myN;i++){
            const row=learnedRow(node,i),probability=currentProbability(node,i,a);
            if(learnRepresentative(node,i,row))avg[row*nActions+a]+=averageWeight*ownReach[i]*probability;
            ownNext[i]=ownReach[i]*probability;
          }
        }
        visit(node.actions[a].child,reach,values,ownNext);
        if(ownNext)release(ownNext);
        actionVals[a]=values;
      }
      if(nActions===1){
        output.set(actionVals[0]);
        release(actionVals[0]);
        return;
      }
      // Full-node locks can skip regret updates entirely; mixed nodes update
      // only unlocked hands, preserving fixed combos in the same decision.
      if(node.allLocked){
        for(let i=0;i<myN;i++)for(let a=0;a<nActions;a++)
          output[i]+=currentProbability(node,i,a)*actionVals[a][i];
        for(const arr of actionVals)release(arr);
        return;
      }
      const r=node.regret,isQre=game.equilibrium==='qre';
      const mass=isQre?cachedCompatibilityMass(game,target,reach,node,kernel):null;
      // Fused compiled Float64 regret/CFV update. All live vectors and node
      // state reside in WASM memory; fall back without changing the algorithm
      // whenever a scratch buffer is outside the fixed mobile-sized arena.
      const done=!!(game.compiled&&game.compiled.regret(node,actionVals,output,mass,game.qreTemperature));
      if(!done)for(let i=0;i<myN;i++){
        const row=learnedRow(node,i),ro=row*nActions;
        let v=0;
        for(let a=0;a<nActions;a++)v+=currentProbability(node,i,a)*actionVals[a][i];
        output[i]=v;
        if(node.lockedMask?.[i])continue;
        if(isQre&&node.compact&&row>=0)output[i]+=game.qreTemperature*mass[i]*node.qreEntropy[row];
        if(!learnRepresentative(node,i,row))continue;
        if(isQre){
          const t=game.qreTemperature*mass[i],floor=QRE_PROBABILITY_FLOOR,scale=1-nActions*floor;
          const off=(node.compact?row:i)*nActions;
          if(!node.compact)output[i]+=t*node.qreEntropy[i];
          let mean=0;
          const logs=node.qreLog;
          for(let a=0;a<nActions;a++)mean+=(node.current[off+a]-floor)/scale*(actionVals[a][i]-t*logs[off+a]);
          for(let a=0;a<nActions;a++)r[ro+a]=Math.max(0,r[ro+a]+scale*(actionVals[a][i]-t*logs[off+a]-mean));
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
    }
    const result=game.compiled?acquire(myN):new Float64Array(myN);
    const ownReach=averageWeight?new Float64Array(myN).fill(1):null;
    visit(id,oppReach,result,ownReach);
    if(game.compiled){const value=Float64Array.from(result);release(result);return value;}
    return result;
  }
  function averagePolicy(game,includeAliases=true) {
    const result=new Array(game.nodes.length);
    result.suitIsomorphic=!!game.suitIsomorphism?.enabled;
    // Canonical strategies are stored once logically; give report/UI consumers
    // a complete strategy array for every original river decision node.
    for(const node of game.nodes) if(!node.terminal && !node.chance && !node.isoAlias) {
      const n=game.players[node.p].ids.length,a=node.actions.length,arr=new Float64Array(n*a);
      for(let i=0;i<n;i++) {
        let sum=0,off=i*a;
        const ro=learnedRow(node,i)*a;
        if(ro>=0)for(let j=0;j<a;j++)sum+=node.averageSum[ro+j];
        for(let j=0;j<a;j++)arr[off+j]=sum>0?node.averageSum[ro+j]/sum:currentProbability(node,i,j);
      }
      maskRangeWidePolicy(node,arr,n);
      projectFrequencyRows(node,arr);
      if(node.locked){for(let i=0;i<n;i++)if(node.lockedMask[i])
        for(let k=0;k<a;k++)arr[i*a+k]=lockedProbability(node,i,k);}
      result[node.id]=arr;
    }
    if(includeAliases){
      function expand(id){
        if(result[id])return result[id];
        const node=game.nodes[id],{source,map}=node.isoAlias,a=node.actions.length;
        const src=expand(source),arr=new Float64Array(src.length);
        for(let i=0;i<map.length;i++)for(let k=0;k<a;k++)arr[map[i]*a+k]=src[i*a+k];
        return result[id]=arr;
      }
      for(const node of game.nodes)if(node.isoAlias)expand(node.id);
    }
    return result;
  }
  // Summary and stopping checks read compact average rows directly. Physical
  // policy tables are only built for consumers requesting detailed reports.
  function evaluationPolicy(game){
    if(game.numericStorage.mode!=='compact')return averagePolicy(game,false);
    const policy=new Array(game.nodes.length);
    policy.compact=true;policy.suitIsomorphic=!!game.suitIsomorphism.enabled;
    for(const node of game.nodes)if(node.compact){
      const a=node.actions.length,n=node.compact.reps.length,rows=new Float64Array(n*a);
      for(let r=0;r<n;r++){
        const off=r*a;let sum=0;
        for(let k=0;k<a;k++)sum+=node.averageSum[off+k];
        for(let k=0;k<a;k++)rows[off+k]=sum>0?node.averageSum[off+k]/sum:node.current[off+k];
      }
      maskRangeWidePolicy(node,rows,n);
      projectFrequencyRows(node,rows,false);
      policy[node.id]=rows;
    }
    return policy;
  }

  const inverseSuitMaps=new WeakMap();
  function policyAccessor(game,policy,node){
    const a=node.actions.length;
    if(!policy.compact){
      const strat=policy[node.id];
      return (hand,k)=>strat[hand*a+k];
    }
    const inverse=[];
    while(node.isoAlias){
      const map=node.isoAlias.map;
      if(!inverseSuitMaps.has(map)){
        const backward=new Uint16Array(map.length);
        for(let h=0;h<map.length;h++)backward[map[h]]=h;
        inverseSuitMaps.set(map,backward);
      }
      inverse.push(inverseSuitMaps.get(map));
      node=game.nodes[node.isoAlias.source];
    }
    const strat=policy[node.id];
    const read=(hand,k)=>{
      if(node.lockedMask?.[hand])return lockedProbability(node,hand,k);
      const row=learnedRow(node,hand);
      return row<0?node.implicitPolicy[k]:strat[row*a+k];
    };
    return inverse.length?(hand,k)=>{
      for(const map of inverse)hand=map[hand];
      return read(hand,k);
    }:read;
  }

  function evaluatePolicy(game,policy,target,mode='profile',records=null,selectedNodeId=null) {
    const mine=game.players[target],opp=game.players[1-target],n=mine.ids.length;
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
        const groups=!records&&policy.suitIsomorphic?node.isoGroups:null;
        for(const item of groups||node.runouts){
          const outcome=groups?item.representative:item;
          const card=outcome.card??outcome.river;
          const nextOpp=chanceOpponentReach(game,1-target,oppReach,outcome);
          let nextOwn=null;
          if(records){nextOwn=new Float64Array(n);const allowed=mine.cardAllowed[card];
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
      const probability=policyAccessor(game,policy,node);
      const capture=!!records&&(selectedNodeId===null||selectedNodeId===id);
      if(node.p!==target) {
        const out=new Float64Array(n), on=opp.ids.length;
        for(let k=0;k<a;k++) {
          const next=new Float64Array(on);
          for(let j=0;j<on;j++) next[j]=oppReach[j]*probability(j,k);
          const v=visit(node.actions[k].child,next,ownReach);
          for(let i=0;i<n;i++)out[i]+=v[i];
        }
        if(regularized){
          for(let i=0;i<opp.ids.length;i++){
            let entropy=0;
            for(let k=0;k<a;k++){const p=probability(i,k);if(p>0)entropy-=p*Math.log(p);}
            weightedScratch[i]=oppReach[i]*entropy;
          }
          const m=compatibilityMassInto(game,target,weightedScratch,node,massScratch,massCards);
          for(let i=0;i<n;i++)out[i]-=game.qreTargetTemperature*m[i];
        }
        return out;
      }
      const acts=[];
      for(let k=0;k<a;k++) {
        let nextOwn=null;
        if(records) {
          nextOwn=new Float64Array(n);
          for(let i=0;i<n;i++) nextOwn[i]=ownReach[i]*probability(i,k);
        }
        acts.push(visit(node.actions[k].child,oppReach,nextOwn));
      }
      const out=new Float64Array(n),mass=(capture||regularized)?
        compatibilityMassInto(game,target,oppReach,node,massScratch,massCards):null;
      let numerator=0,denom=0;
      const handEntries=capture?[]:null,agg=capture?new Float64Array(a):null;
      for(let i=0;i<n;i++) {
        const freeToDeviate=mode==='best'||(mode==='constrainedBest'&&!node.lockedMask?.[i]);
        let val=freeToDeviate ? -Infinity : 0;
        for(let k=0;k<a;k++) {
          if(freeToDeviate) val=Math.max(val,acts[k][i]);
          else val+=probability(i,k)*acts[k][i];
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
          for(let k=0;k<a;k++)agg[k]+=w*probability(i,k);
          handEntries.push([mine.ids[i],w,m>evCutoff?val/m:null,
            Array.from({length:a},(_,k)=>probability(i,k)),
            Array.from({length:a},(_,k)=>m>evCutoff?acts[k][i]/m:null)]);
        }
      }
      if(capture) records[id]={id,player:target,rangeEV:denom>evCutoff?numerator/denom:null,
        reachMass:denom/game.jointZ,actions:denom>evCutoff?Array.from(agg,v=>v/denom):Array(a).fill(0),
        hands:handEntries.map(v=>{v[1]=denom>evCutoff?v[1]/denom:0;return v;})};
      return out;
    }
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
      const a=node.actions.length,probability=policyAccessor(game,policy,node);
      if(node.p!==target){
        const out=new Float64Array(n),best=new Float64Array(n),on=opp.ids.length;
        for(let k=0;k<a;k++){
          const next=new Float64Array(on);
          for(let j=0;j<on;j++)next[j]=oppReach[j]*probability(j,k);
          const v=visit(node.actions[k].child,next,ownReach);
          for(let i=0;i<n;i++){out[i]+=v.profile[i];best[i]+=v.best[i];}
        }
        return {profile:out,best};
      }
      const acts=new Array(a),bestActs=new Array(a);
      for(let k=0;k<a;k++){
        const nextOwn=new Float64Array(n);
        for(let i=0;i<n;i++)nextOwn[i]=ownReach[i]*probability(i,k);
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
          val+=probability(i,k)*acts[k][i];
          if(fixed)br+=probability(i,k)*bestActs[k][i];
          else br=Math.max(br,bestActs[k][i]);
        }
        out[i]=val;best[i]=br;
        const m=mass[i],w=mine.priors[i]*ownReach[i]*m;
        numerator+=mine.priors[i]*ownReach[i]*val;
        denom+=w;
        for(let k=0;k<a;k++)agg[k]+=w*probability(i,k);
        handEntries.push([mine.ids[i],w,m>evCutoff?val/m:null,
          Array.from({length:a},(_,k)=>probability(i,k)),
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
  function makeReport(game,iteration,elapsedMs,history) {
    const policy=game.numericStorage.mode==='compact'?evaluationPolicy(game):averagePolicy(game),records=new Array(game.nodes.length);
    const both0=evaluatePolicyWithBest(game,policy,0,records);
    const both1=evaluatePolicyWithBest(game,policy,1,records);
    const value0=rangeValue(game,0,both0.profile),value1=rangeValue(game,1,both1.profile);
    const br0=rangeValue(game,0,both0.best),br1=rangeValue(game,1,both1.best);
    const nashConv=Math.max(0,br0+br1);
    const locked=game.nodeLocks?.length>0;
    const unrestrictedNashConv=locked?Math.max(0,
      rangeValue(game,0,evaluatePolicy(game,policy,0,'best'))+
      rangeValue(game,1,evaluatePolicy(game,policy,1,'best'))):nashConv;
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
    // Root EVs (and best responses) count the entire pot as winnings; a
    // root fold would therefore have EV 0 rather than -pot/2.
    const rootOffset=game.pot/2;
    return {iteration,elapsedMs,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
      equilibrium:game.equilibrium,gtoAlgorithm:game.gtoAlgorithm,qreTemperaturePercent:game.equilibrium==='qre'?game.qreTemperaturePercent:null,
      qreActiveTemperaturePercent:game.equilibrium==='qre'?100*game.qreTemperature/game.pot:null,
      qreWarmupComplete:game.equilibrium==='qre'?(iteration>=game.qreWarmupIterations):null,
      qreWarmupIterations:game.equilibrium==='qre'?game.qreWarmupIterations:null,
      qreProbabilityFloor:game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:null,
      qreModel:game.equilibrium==='qre'?'entropy-regularized-zero-sum':null,
      qreResidualUnits:game.equilibrium==='qre'?'chips-per-player':null,
      qreResidual,qreCompared,tpwl,tpwlNodes,
      exploitability:nashConv/2,nashConv,lockedNodes:game.nodeLocks?.length||0,unrestrictedExploitability:unrestrictedNashConv/2,convergenceMetric:locked?'locked-game':'unrestricted-nash',
      br0:br0+rootOffset,br1:br1+rootOffset,
      value0:value0+rootOffset,value1:value1+rootOffset,
      evBasis:'fold-zero',
      // The reported root EVs sum to the starting pot; this measures any
      // violation of that conservation identity (zero-sum centered internally).
      zeroSumError:Math.abs(value0+value1),jointZ:game.jointZ,memoryBytes:game.memory,numericStorage:game.numericStorage,
      history:history||[],nodes:records};
  }
  // A single decision's report, without allocating hand/action records for
  // every other node in the tree.  This is also the correctness fallback when
  // native selected-node continuation EVs cannot be compiled on a device.
  function makeNodeReport(game,id){
    const node=game.nodes[id];if(!node||node.terminal||node.chance)return null;
    const records=[];
    evaluatePolicy(game,game.numericStorage.mode==='compact'?evaluationPolicy(game):averagePolicy(game),node.p,'profile',records,id);
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
  // Summary-only reporting runs the original exact best-response stopping
  // tests, plus a compiled average-policy root value.  No detailed nodes,
  // TPWL computation or full report allocation is required.
  function makeSummary(game,iteration,elapsedMs,history){
    const policy=!game.compiled?.profileEV||game.hasFrequencyIncrements?evaluationPolicy(game):null;
    const check=makeConvergenceCheck(game,iteration,elapsedMs,history,policy);
    const profile=target=>game.compiled?.profileEV?
      game.compiled.profileEV(target):rangeValue(game,target,evaluatePolicy(game,policy??evaluationPolicy(game),target));
    const value0=profile(0),value1=profile(1),rootOffset=game.pot/2;
    // Individual BR values are optional for this compact summary.  Full
    // reports retain the original detailed accounting and TPWL diagnostics.
    return {...check,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
      qreTemperaturePercent:game.equilibrium==='qre'?game.qreTemperaturePercent:null,
      qreActiveTemperaturePercent:game.equilibrium==='qre'?100*game.qreTemperature/game.pot:null,
      qreWarmupComplete:game.equilibrium==='qre'?iteration>=game.qreWarmupIterations:null,
      qreWarmupIterations:game.equilibrium==='qre'?game.qreWarmupIterations:null,
      qreProbabilityFloor:game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:null,
      qreModel:game.equilibrium==='qre'?'entropy-regularized-zero-sum':null,
      qreResidualUnits:game.equilibrium==='qre'?'chips-per-player':null,
      qreCompared:0,tpwl:null,tpwlNodes:0,
      br0:null,br1:null,value0:value0+rootOffset,value1:value1+rootOffset,
      zeroSumError:Math.abs(value0+value1),jointZ:game.jointZ,memoryBytes:game.memory,numericStorage:game.numericStorage,
      evBasis:'fold-zero',reportLevel:'summary',nodes:[]};
  }
  // Exact, allocation-light Nash/QRE stopping diagnostic. This never builds
  // hand-level EV records, normalized action arrays, or TPWL diagnostics.
  // The best response still traverses every branch of the configured game.
  function makeConvergenceCheck(game,iteration,elapsedMs,history,policy=null) {
    // Only canonical strategies are needed for grouped exact best-response checks.
    let nativeBest=game.compiled?.exactBest;
    const locked=game.nodeLocks?.length>0;
    // A native check reads averageSum/current directly and never needs a JS
    // averaged-policy table or hand-level report allocations.
    if(nativeBest&&!locked)try{
      const br0=nativeBest(0,false),br1=nativeBest(1,false);
      const r0=game.equilibrium==='qre'?nativeBest(0,true):null;
      const r1=game.equilibrium==='qre'?nativeBest(1,true):null;
      const nashConv=Math.max(0,br0+br1);
      return {iteration,elapsedMs,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
        equilibrium:game.equilibrium,gtoAlgorithm:game.gtoAlgorithm,nashConv,
        exploitability:nashConv/2,qreResidual:r0===null?null:Math.max(0,r0+r1)/2,
        history:history||[]};
    }catch(_){
      // A constrained mobile scratch arena may reject the native evaluator;
      // retain the mathematically identical JS reference as a safe fallback.
      if(game.compiled)game.compiled.exactBest=null;
      nativeBest=null;
    }
    // Pure actions remain valid on any grid, so an exact best response is
    // still obtained by maximizing over legal actions against this policy.
    policy??=evaluationPolicy(game);
    const br0=rangeValue(game,0,evaluatePolicy(game,policy,0,locked?'constrainedBest':'best'));
    const br1=rangeValue(game,1,evaluatePolicy(game,policy,1,locked?'constrainedBest':'best'));
    const nashConv=Math.max(0,br0+br1);
    const unrestrictedResponse=p=>{
      if(nativeBest)try{return nativeBest(p,false);}catch(_){
        nativeBest=null;if(game.compiled)game.compiled.exactBest=null;
      }
      return rangeValue(game,p,evaluatePolicy(game,policy,p,'best'));
    };
    const unrestrictedNashConv=locked?Math.max(0,unrestrictedResponse(0)+unrestrictedResponse(1)):nashConv;
    let qreResidual=null;
    if(game.equilibrium==='qre'){
      const r0=nativeBest?nativeBest(0,true):rangeValue(game,0,evaluatePolicy(game,policy,0,'regularizedBest'));
      const r1=nativeBest?nativeBest(1,true):rangeValue(game,1,evaluatePolicy(game,policy,1,'regularizedBest'));
      qreResidual=Math.max(0,r0+r1)/2;
    }
    return {iteration,elapsedMs,ips:elapsedMs>0?1000*iteration/elapsedMs:0,
      equilibrium:game.equilibrium,gtoAlgorithm:game.gtoAlgorithm,nashConv,exploitability:nashConv/2,qreResidual,
      lockedNodes:game.nodeLocks?.length||0,unrestrictedExploitability:unrestrictedNashConv/2,
      convergenceMetric:locked?'locked-game':'unrestricted-nash',history:history||[]};
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
  function gameSignature(game,physicalOnly=false){
    let h1=2166136261>>>0,h2=0x9e3779b9>>>0;
    function feed(x){x=x>>>0;h1=Math.imul(h1^x,16777619)>>>0;h2=(Math.imul((h2+x)>>>0,2246822519)^h2>>>13)>>>0;}
    const dv=new DataView(new ArrayBuffer(8));
    function number(x){dv.setFloat64(0,x,true);feed(dv.getUint32(0,true));feed(dv.getUint32(4,true));}
    function str(s){s=String(s);feed(s.length);for(let i=0;i<s.length;i++)feed(s.charCodeAt(i));}
    str('TurnRiverLab-v12-checkpoint-v1');number(game.pot);number(game.stack);
    if(!physicalOnly){
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
      if(node.terminal){str(node.type);feed((node.winner??-1)+2);}
      else if(node.chance){feed(node.runouts.length);for(const r of node.runouts){feed(r.child);feed((r.card??r.river??-1)+1);number(r.weight??1/44);}}
      else {feed(node.p);feed(node.actions.length);for(const action of node.actions){feed(action.child);str(action.type);number(action.total??0);}}
    }
    for(const player of game.players){feed(player.ids.length);for(let i=0;i<player.ids.length;i++){feed(player.ids[i]);number(player.priors[i]);}}
    if(!physicalOnly&&game.numericStorage?.mode==='compact'){
      str('compact-f64-v1');
      for(const node of game.nodes)if(node.isoAlias){
        feed(node.isoAlias.source);for(const hand of node.isoAlias.map)feed(hand);
      }else if(node.compact?.map)for(const row of node.compact.map)feed(row+1);
    }
    if(!physicalOnly)feed(game.stateStorage.length);
    return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
  }
  class CFRSolver {
    constructor(game) {
      this.game=game;game.zeroReachPruning=!!game.zeroReachPruning;game.coreCompatibilityMass=(target,reach,node)=>compatibilityMass(game,target,reach,node);
      this.iteration=0;this.startTime=Date.now();this.history=[];
      this.profileEnabled=!!game.profileEnabled;
      this.timings={steps:0,policy0Ms:0,policy1Ms:0,traversal0Ms:0,traversal1Ms:0,checks:0,checkMs:0,summaries:0,summaryMs:0};
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
      traverseCfr(this.game,this.game.root,0,this.game.players[1].priors,averagingWeight);
      if(p){const now=p();this.timings.traversal0Ms+=now-mark;mark=now;}
      if(this.game.compiled?.fusesPolicy)restoreLockedPolicy(this.game,0);
      else currentPolicy(this.game,0);
      if(p){const now=p();this.timings.policy0Ms+=now-mark;mark=now;}
      traverseCfr(this.game,this.game.root,1,this.game.players[0].priors,averagingWeight);
      if(p){const now=p();this.timings.traversal1Ms+=now-mark;mark=now;}
      if(this.game.compiled?.fusesPolicy)restoreLockedPolicy(this.game,1);
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
      memoryBytes:this.game.memory,numericStorage:this.game.numericStorage,stateBytes:this.game.stateStorage.byteLength,compiled:this.game.compiled?.mode||'javascript',
      fusedPolicy:!!this.game.compiled?.fusesPolicy,
      nodes:this.game.nodes.length,equilibrium:this.game.equilibrium,algorithm:this.game.gtoAlgorithm};}
    saveCheckpoint(){
      if(!this.game.stateStorage)throw Error('Checkpoint requires a complete numerical game');
      return {format:'TurnRiverLab-checkpoint-v1',fingerprint:gameSignature(this.game),iteration:this.iteration,
        storageLayout:this.game.numericStorage.mode,elapsedMs:Math.max(0,Date.now()-this.startTime),history:this.history.map(pair=>pair.slice()),
        prunedMasks:this.game.actionPruning?.enabled?this.game.nodes.map(n=>n.pruned?Array.from(n.pruned):null):null,
        storage:Float64Array.from(this.game.stateStorage)};
    }
    // Seed a fresh session from a solved policy, never from stale offsets or
    // averages. Rebuilding the game first revalidates locks and symmetry.
    static warmStart(game,previous){
      if(!game.stateStorage||!previous?.game?.stateStorage||game===previous.game||
         gameSignature(game,true)!==gameSignature(previous.game,true))
        throw Error('Warm start requires a fresh solver for the same physical tree and weighted ranges.');
      const previousGame=previous.game;
      const policy=previousGame.numericStorage.mode==='compact'?evaluationPolicy(previousGame):averagePolicy(previousGame);
      const solver=new CFRSolver(game);
      game.currentIteration=0;
      for(const node of game.nodes)if(!node.terminal&&!node.chance&&!node.isoAlias){
        node.regret.fill(0);node.averageSum.fill(0);node.previousDelta?.fill(0);
        if(node.pruned)node.pruned.fill(0);
        const seed=policyAccessor(previousGame,policy,previousGame.nodes[node.id]);
        const a=node.actions.length,floor=game.equilibrium==='qre'?QRE_PROBABILITY_FLOOR:0;
        const n=game.players[node.p].ids.length;
        for(let h=0;h<n;h++){
          const row=learnedRow(node,h);
          if(node.lockedMask?.[h]||!learnRepresentative(node,h,row))continue;
          for(let k=0;k<a;k++)node.regret[row*a+k]=Math.max(0,seed(h,k)-floor);
        }
      }
      currentPolicy(game,0);currentPolicy(game,1);
      return solver;
    }
    static resume(game,checkpoint){
      if(!checkpoint||checkpoint.format!=='TurnRiverLab-checkpoint-v1')throw Error('Unsupported checkpoint format');
      if(checkpoint.fingerprint!==gameSignature(game))throw Error('Checkpoint does not match this game, ranges, tree or algorithm');
      if(!Number.isSafeInteger(checkpoint.iteration)||checkpoint.iteration<0||!Number.isFinite(checkpoint.elapsedMs)||checkpoint.elapsedMs<0)
        throw Error('Invalid checkpoint iteration or elapsed time');
      const values=checkpoint.storage;
      if(!ArrayBuffer.isView(values)||values.BYTES_PER_ELEMENT!==8||values.length!==game.stateStorage.length)throw Error('Checkpoint state size mismatch');
      for(const x of values)if(!Number.isFinite(x))throw Error('Checkpoint has non-finite solver state');
      if(!Array.isArray(checkpoint.history)||checkpoint.history.some(p=>!Array.isArray(p)||p.length!==2||!Number.isFinite(p[0])||!Number.isFinite(p[1])))
        throw Error('Invalid checkpoint convergence history');
      game.stateStorage.set(values);
      if(game.actionPruning?.enabled){
        if(!Array.isArray(checkpoint.prunedMasks)||checkpoint.prunedMasks.length!==game.nodes.length)
          throw Error('Checkpoint is missing frequency-pruning action masks');
        for(let i=0;i<game.nodes.length;i++){
          const mask=checkpoint.prunedMasks[i],node=game.nodes[i];
          if(mask!==null){
            if(node.terminal||node.chance||node.isoAlias||!Array.isArray(mask)||
              mask.length!==node.actions.length||mask.some(x=>x!==0&&x!==1))
              throw Error('Invalid frequency-pruning checkpoint mask');
            if(node.pruned&&node.pruned.length===mask.length)node.pruned.set(mask);
            else node.pruned=Uint8Array.from(mask);
          }
        }
        game.actionPruning.prunedActions=game.nodes.reduce((total,n)=>total+(n.pruned?n.pruned.reduce((s,x)=>s+x,0):0),0);
      }
      const solver=new CFRSolver(game);solver.iteration=checkpoint.iteration;game.currentIteration=solver.iteration;
      solver.startTime=Date.now()-checkpoint.elapsedMs;solver.history=checkpoint.history.map(p=>p.slice());return solver;
    }
    checkConvergence() {
      const start=this.profileEnabled?(typeof performance!=='undefined'?performance.now():Date.now()):0;
      const r=makeConvergenceCheck(this.game,this.iteration,Date.now()-this.startTime,this.history);
      if(this.profileEnabled){this.timings.checks++;this.timings.checkMs+=(typeof performance!=='undefined'?performance.now():Date.now())-start;}
      appendConvergenceHistory(this.history,this.iteration,r.exploitability);
      if(this.game.actionPruning?.enabled)r.actionPruning={...this.game.actionPruning,culledNodes:this.game.nodes.filter(n=>n.pruned?.some(x=>x)).map(n=>[n.id,Array.from(n.pruned)])};
      r.history=this.history.map(pair=>pair.slice());return r;
    }
    summary() {
      const start=this.profileEnabled?(typeof performance!=='undefined'?performance.now():Date.now()):0;
      const r=makeSummary(this.game,this.iteration,Date.now()-this.startTime,this.history);
      if(this.profileEnabled){this.timings.summaries++;this.timings.summaryMs+=(typeof performance!=='undefined'?performance.now():Date.now())-start;}
      appendConvergenceHistory(this.history,this.iteration,r.exploitability);
      if(this.game.actionPruning?.enabled)r.actionPruning={...this.game.actionPruning,culledNodes:this.game.nodes.filter(n=>n.pruned?.some(x=>x)).map(n=>[n.id,Array.from(n.pruned)])};
      r.history=this.history.map(pair=>pair.slice());return r;
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
    boardMask,turnMask,flopMask,boardCombos,compatible,straightHigh,evaluate7,showdownScores,buildTree,buildTurnRiverTree,buildFlopTurnRiverTree,makeGame,frequencyStreets,parseFrequencyIncrements,
    terminalCfv,compatibilityMass,rangeValue,averagePolicy,evaluatePolicy,makeReport,makeNodeReport,makeSummary,makeConvergenceCheck,gameSignature,CFRSolver,
    currentPolicy,rangeWideActionFrequencies,accumulate,traverseCfr,logitResponse,QRE_PROBABILITY_FLOOR};
}
if(typeof window!=='undefined') window.createSolverCore=createSolverCore;
