/* v8 compiled Float64 game-tree traversal and exact best responses. */
function createCompiledTraversal(game, base64, limitBytes, preference) {
  'use strict';
  preference??='auto';
  limitBytes=Number(limitBytes)||0;
  if(typeof WebAssembly==='undefined'||typeof atob!=='function'||!game.stateStorage)return null;

  const modules=createCompiledTraversal._moduleCache??=new Map();
  function compiledModule(source){
    if(typeof source!=='string')return null;
    if(modules.has(source))return modules.get(source);
    const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
    let module=null;
    try{module=new WebAssembly.Module(bytes);}catch(error){
      if(!(error instanceof WebAssembly.CompileError))throw error;
    }
    modules.set(source,module);
    return module;
  }
  const compact=game.numericStorage.mode==='compact',mixed=!(game.stateStorage instanceof Float64Array);
  const publicChance=game.publicChance;
  const supportsSource=preference!=='legacy'&&preference!=='legacy-scalar'&&
    typeof WASM_SOURCE_SCALAR==='string'&&game.equilibrium==='gto'&&game.gtoAlgorithm==='dcfr'&&
    !game.hasFrequencyIncrements&&!game.actionPruning?.enabled&&!game.regretPruning&&!game.zeroReachPruning&&
    !game.riverPrivateSymmetry?.enabled&&game.stack<=0x7fffffff;
  const sourceModule=supportsSource?
    ((preference==='scalar'?null:compiledModule(WASM_SOURCE_SIMD))??compiledModule(WASM_SOURCE_SCALAR)):null;
  if(!sourceModule){
    if(mixed||publicChance)return null;
    if(compact)return compactTraversal();
  }

  function compactTraversal(){
    if(typeof WebAssembly==='undefined'||typeof atob!=='function')return null;
    // Generated from scripts/solver/compact-f64.wat by the documented build command.
    const source='AGFzbQEAAAABFwJgDH9/f39/f39/f398fABgA39/fwF8Ag8BA2VudgZtZW1vcnkCAAEDAwIAAQcKAQZ1cGRhdGUAAAqgAgKGAgIHfwJ8AkADQCAMIABPDQEgAiAMQQF0ai4BACEOIA4gAWxBA3QhESAGIAQgEWogDkEASBshD0QAAAAAAAAAACETQQAhDQNAIBMgDyANQQN0aisDACAHIA0gDBABoqAhEyANQQFqIQ0gDSABSQ0ACyAIIAxBA3RqIBM5AwACQCAOQQBIDQAgDCADIA5BAXRqLwEARw0AIAUgEWohEEEAIQ0DQCAQIA1BA3RqIRIgEisDACAHIA0gDBABIBOhoCEUIBIgCQR8IBQgCiALIBREAAAAAAAAAABkG6IFRAAAAAAAAAAAIBSlCzkDACANQQFqIQ0gDSABSQ0ACwsgDEEBaiEMDAALCwsWACAAIAFBAnRqKAIAIAJBA3RqKwMACw==';
    const module=createCompiledTraversal._compactModule??=
      new WebAssembly.Module(Uint8Array.from(atob(source),c=>c.charCodeAt(0)));
    const supported=game.equilibrium==='gto'&&!['optimistic','dcfr-predictive'].includes(game.gtoAlgorithm);
    if(!supported)return null;
    const decisions=game.decisionNodes.filter(n=>n.compact?.map&&!n.locked);
    const maps=new Map(),implicitRows=new Map();
    let used=65536;
    function reserve(bytes,align){used=Math.ceil(used/align)*align;const offset=used;used+=bytes;return offset;}
    const stateOffset=reserve(game.stateStorage.byteLength,8);
    const maxActions=decisions.reduce((max,n)=>Math.max(max,n.actions.length),1);
    const actionTable=reserve(maxActions*4,4);
    const descriptors=new Map();
    for(const node of decisions){
      const {map,reps}=node.compact;
      if(!maps.has(map))maps.set(map,[reserve(map.byteLength,2),reserve(reps.byteLength,2),reps]);
      if(!implicitRows.has(node.implicitPolicy))implicitRows.set(node.implicitPolicy,reserve(node.implicitPolicy.byteLength,8));
      descriptors.set(node,[...maps.get(map),implicitRows.get(node.implicitPolicy)]);
    }
    const pages=Math.ceil((used+2*1024*1024)/65536);
    const extra=pages*65536-game.stateStorage.byteLength;
    if(!decisions.length||(limitBytes>0&&game.memory+extra>limitBytes))return null;
    const memory=new WebAssembly.Memory({initial:pages,maximum:pages});
    const update=new WebAssembly.Instance(module,{env:{memory}}).exports.update;
    const buffer=memory.buffer;
    for(const [map,[mapPtr,repsPtr,reps]] of maps){
      new Int16Array(buffer,mapPtr,map.length).set(map);
      new Uint16Array(buffer,repsPtr,reps.length).set(reps);
    }
    for(const [row,ptr] of implicitRows)new Float64Array(buffer,ptr,row.length).set(row);
    const storage=new Float64Array(buffer,stateOffset,game.stateStorage.length);
    storage.set(game.stateStorage);
    const migrate=arr=>new Float64Array(buffer,stateOffset+arr.byteOffset,arr.length);
    for(const node of game.decisionNodes)if(node.compact){
      for(const key of ['regret','averageSum','current','previousDelta','qreLog','qreEntropy'])
        if(node[key])node[key]=migrate(node[key]);
    }
    game.stateStorage=storage;
    game.memory+=extra;
    const actionPtrs=new Uint32Array(buffer,actionTable,maxActions);
    const dcfr=['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(game.gtoAlgorithm);
    return {
      memory,compact:true,mode:'wasm-compact-f64',backend:'Scalar WebAssembly row updates + JavaScript traversal',fullTraversal:false,fusesPolicy:false,
      allocateVector(n){
        if(used+n*8+8>buffer.byteLength)return new Float64Array(n);
        return new Float64Array(buffer,reserve(n*8,8),n);
      },
      regret(node,values,output,mass){
        if(mass||(!dcfr&&game.gtoAlgorithm!=='cfrplus')||node.pruned?.some(x=>x)||
           !descriptors.has(node)||output.buffer!==buffer||values.some(v=>v.buffer!==buffer))return false;
        const [map,reps,,implicit]=descriptors.get(node);
        for(let a=0;a<values.length;a++)actionPtrs[a]=values[a].byteOffset;
        update(output.length,values.length,map,reps,node.current.byteOffset,node.regret.byteOffset,
          implicit,actionTable,output.byteOffset,Number(dcfr),game._positiveDiscount??0,game._negativeDiscount??0);
        return true;
      }
    };
  }
  // River-only private-hand orbit compression remains a reference-JS layout.
  // Whole-action culling uses native action masks and can stay compiled.
  if(game.riverPrivateSymmetry?.enabled)return null;
  const stateBytes=game.stateStorage.byteLength;
  // Avoid a large fixed mobile allocation: cover state plus a bounded arena
  // for live reach/CFV vectors. Fall back to JS when the arena is exhausted.
  const n0=game.players[0].ids.length,n1=game.players[1].ids.length,maxN=Math.max(n0,n1);
  // A showdown mass vector can be reused only if two terminals have the
  // same opponent reach. Every opponent action and dealt card changes that
  // reach generation, whereas hero actions do not. Avoid reserving expensive
  // payoff buffers for trees with no repeated (board, reach) terminal pair.
  function hasReusableShowdowns(target){
    const seen=new Set();let generation=0,found=false;
    function visit(id,reachKey){
      if(found)return;
      const node=game.nodeAt?game.nodeAt(id):game.nodes[id];
      if(node.allInSpan)return;
      if(node.terminal){
        if(node.type==='showdown'){
          const key=reachKey+':'+(node.turn??52)+':'+(node.river??52);
          if(seen.has(key))found=true;else seen.add(key);
        }
        return;
      }
      if(node.chance){
        const children=node.isoGroups?node.isoGroups.map(g=>g.representative.child):node.runouts.map(r=>r.child);
        for(const child of children)visit(child,++generation);
      }else for(const action of node.actions)visit(action.child,node.p===target?reachKey:++generation);
    }
    visit(game.root,0);return found;
  }
  const reuseShowdowns=!sourceModule&&(hasReusableShowdowns(0)||hasReusableShowdowns(1));
  // Ordinary turn/river trees have no repeated terminal opponent reach.
  // Keep their proven single-worker cache path instead of forcing extra RAM.
  const extendedCache=!sourceModule&&(game.exactCaches===true||(game.exactCaches!==false&&reuseShowdowns));
  // v16 opts into the exact, active-average/sparse-list kernel. The legacy
  // v14 binary is still selectable for numerical and performance comparisons.
  const modernTraversal=game.v16Traversal===true;
  const explicitScalar=typeof WASM_TRAVERSAL_BYTES_SCALAR==='string'&&
    (base64===WASM_TRAVERSAL_BYTES_SCALAR||preference==='legacy-scalar'||preference==='scalar');
  const legacyBinary=explicitScalar?WASM_TRAVERSAL_BYTES_SCALAR:base64;
  // Preserve explicit scalar selection and mobile no-SIMD fallback even when
  // selecting the v14 classic kernel for a game with no cached showdowns.
  // Validate the originally requested SIMD module before switching kernels.
  let requestedSimdSupported=true;
  if(!sourceModule&&!extendedCache&&!explicitScalar){
    const source=atob(base64),probe=new Uint8Array(source.length);
    for(let i=0;i<source.length;i++)probe[i]=source.charCodeAt(i);
    requestedSimdSupported=WebAssembly.validate(probe);
  }
  const chosenBinary=extendedCache||modernTraversal||typeof WASM_TRAVERSAL_BYTES_CLASSIC!=='string'
    ?legacyBinary:(explicitScalar||!requestedSimdSupported)&&typeof WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR==='string'
      ?WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR:WASM_TRAVERSAL_BYTES_CLASSIC;
  const memo=new Map();
  function maxDepth(id,p){
    const key=id*2+p;if(memo.has(key))return memo.get(key);
    const node=game.nodeAt?game.nodeAt(id):game.nodes[id];
    if(node.terminal)return 0;
    if(node.allInSpan)return (node.street==='deal-turn'?6:3)*maxN*8;
    const children=node.chance?(node.isoGroups?node.isoGroups.map(g=>g.representative.child):node.runouts.map(r=>r.child)):
      node.actions.map(a=>a.child);
    const own=node.chance?3*maxN*8:node.actions.length===1?0:
      node.p===p?(node.actions.length+2)*maxN*8:3*maxN*8;
    let rest=0;for(const child of children)rest=Math.max(rest,maxDepth(child,p));
    const result=own+rest;memo.set(key,result);return result;
  }
  const scratchBudget=Math.max(2*1024*1024,maxDepth(game.root,0)+maxDepth(game.root,1)+1024*1024);
  // Native kernels use compact physical indices. Intern only terminal and
  // chance-only continuations. Every decision keeps a distinct native row.
  const packed=game.treeStorage.mode==='packed';
  const nativeNodes=[],indices=new Map(),terminals=new Map(),terminalIndices=new WeakMap(),allInRiver=new Map();
  let allInFlop;
  function append(node){
    const index=nativeNodes.length;nativeNodes.push(node);return index;
  }
  function terminalIndex(node){
    if(terminalIndices.has(node))return terminalIndices.get(node);
    const key=[node.type,node.winner,node.turn,node.river,...node.c].join('/');
    if(!terminals.has(key))terminals.set(key,append(node));
    const index=terminals.get(key);
    terminalIndices.set(node,index);
    return index;
  }
  function allInRiverIndex(turn,table){
    if(!allInRiver.has(turn)){
      const runouts=Array.from(table.cards,card=>({card,weight:table.weight,child:terminalIndex(game.boardTerminal(turn,card))}));
      allInRiver.set(turn,append({chance:true,runouts,turn,c:[game.stack,game.stack],nativeChildren:true}));
    }
    return allInRiver.get(turn);
  }
  function nativeIndex(id){
    if(!packed)return id;
    const index=indices.get(id);
    if(index!==undefined)return index;
    const node=game.nodeAt(id);
    if(node.terminal){
      return terminalIndex(node.riverPayoff||node.type==='fold'?node:game.boardTerminal(node.turn,node.river));
    }
    if(node.allInSpan){
      const span=node.allInSpan;
      if(node.street==='deal-river')return allInRiverIndex(span.turn,span.table);
      if(allInFlop===undefined){
        const runouts=Array.from(span.table.cards,card=>({card,weight:span.table.weight,
          child:allInRiverIndex(card,span.rivers.get(card))}));
        allInFlop=append({chance:true,runouts,c:span.c,nativeChildren:true});
      }
      return allInFlop;
    }
    // Virtual river chance nodes below a flop all-in can still be addressed
    // for subtree evaluation. They share the matching immutable continuation.
    if(node.chance&&node.treeSlot===undefined)return allInRiverIndex(node.turn,game.riverTables.get(node.turn));
    const next=append(node);indices.set(id,next);return next;
  }
  if(packed){
    for(const node of game.staticNodes)nativeIndex(node.id);
    for(const node of game.terminalRecords)terminalIndex(node);
  }
  const nativeTree=packed?nativeNodes:game.nodes;
  let layouts=0,runouts=0;
  for(const pair of new Set(game.riverPayoffLayouts.values()))for(const l of pair)
    for(const key of ['mineOrder','oppOrder','groupStart','weakEnd','tieEnd'])layouts+=l[key].byteLength+16;
  for(const node of nativeTree)if(node.chance)runouts+=node.chanceChildren?.length??node.runouts.length;
  const sourceCopies=game.numericStorage.metadata??game.nodeLocks.reduce((sum,lock)=>{
    const node=game.nodes[lock.nodeId];
    return sum+node.lockedRows.byteLength+node.lockedMask.byteLength;
  },0);
  const strategyBytes=sourceModule?nativeTree.length*36+sourceCopies:0;
  const publicDrawKeys=new Map();
  function publicDrawKey(node,size){
    const turn=node.turn??52,budget=turn===52?publicChance.turnBudget:publicChance.riverBudget;
    return budget<size?turn*50+size:null;
  }
  if(publicChance)for(const node of nativeTree)if(node.chance){
    const key=publicDrawKey(node,node.isoGroups?.length??node.chanceChildren?.length??node.runouts.length);
    if(key!==null)publicDrawKeys.set(key,0);
  }
  const chanceBytes=publicChance?publicChance.clockBytes+publicDrawKeys.size*104+16:0;
  const staticBudget=1048576+nativeTree.length*160+runouts*64+layouts+maxN*24+strategyBytes+chanceBytes;
  // Bounded v15 caches live in the worker's existing WASM linear memory.
  // No SharedArrayBuffer, threads, dynamic WASM memory growth or backend.
  const cacheBudget=(extendedCache?256*1024:0)+(extendedCache&&reuseShowdowns?16*3*maxN*8:0)+512;
  const bytes=131072+stateBytes+staticBudget+scratchBudget+cacheBudget;
  const pages=Math.ceil(bytes/65536);
  // The worker's memory budget also applies to compiled scratch capacity.
  // Refuse optional compilation instead of exceeding a mobile allocation limit.
  const actualBytes=pages*65536;
  if(limitBytes>0&&game.memory+actualBytes-stateBytes>limitBytes)
    return compatibilityFallback();
  // Reuse compiled modules between solves. Linear memory and caches are
  // per game, including instances of the source-backed kernel.
  let module=sourceModule??compiledModule(chosenBinary);
  if(!module){
    const chosenScalar=extendedCache||modernTraversal||typeof WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR!=='string'
      ?WASM_TRAVERSAL_BYTES_SCALAR:WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR;
    module=compiledModule(chosenScalar);
    if(!module)return null;
  }
  function compatibilityFallback(){
    if(!sourceModule||mixed||publicChance)return null;
    return createCompiledTraversal(game,base64,limitBytes,preference==='scalar'?'legacy-scalar':'legacy');
  }
  const memory=new WebAssembly.Memory({initial:pages,maximum:pages});
  const instance=new WebAssembly.Instance(module,{env:{memory,host_log:Math.log,host_exp:Math.exp}});
  let previous=game.stateStorage;
  const storage=new previous.constructor(memory.buffer,131072,previous.length);
  storage.set(previous);
  const planes=['regret','averageSum','current','qreLog','qreEntropy','previousDelta','averageExponent'];
  function bindArena(from,to){
    for(const node of game.decisionNodes)if(!node.isoAlias)
      for(const field of planes){
        const array=node[field];
        if(array)node[field]=new array.constructor(to.buffer,to.byteOffset+array.byteOffset-from.byteOffset,array.length);
      }
    game.stateStorage=to;
  }
  const start=131072+stateBytes;
  let used=start;
  function allocate(bytes,align){
    used=Math.ceil(used/align)*align;
    if(used+bytes>memory.buffer.byteLength)return null;
    const addr=used;used+=bytes;return addr;
  }
  const decisions=game.decisionNodes.filter(n=>!n.isoAlias);
  const metaAddr=allocate(decisions.length*6*4,4);
  if(metaAddr===null)return compatibilityFallback();
  bindArena(previous,storage);
  const meta=new Int32Array(memory.buffer,metaAddr,decisions.length*6);
  for(let i=0;i<decisions.length;i++){
    const node=decisions[i],o=i*6;
    meta[o]=node.p;meta[o+1]=game.players[node.p].ids.length;
    meta[o+2]=node.actions.length;meta[o+3]=node.regret.byteOffset;
    meta[o+4]=node.current.byteOffset;meta[o+5]=nativeIndex(node.id);
  }
  let maxActions=1;
  for(const node of decisions)if(node.actions.length>maxActions)maxActions=node.actions.length;
  const actionPtr=allocate(maxActions*4,4);
  if(actionPtr===null){bindArena(storage,previous);return compatibilityFallback();}
  const actionOffsets=new Int32Array(memory.buffer,actionPtr,maxActions);
  function allocVector(n){
    const addr=allocate(n*8,8);
    return addr===null?new Float64Array(n):new Float64Array(memory.buffer,addr,n);
  }
  const exports=instance.exports;
  // Opt into native fused policy updates only for established DCFR and trees
  // without private-hand row sharing or heuristic action pruning. Older WASM
  // modules and all other algorithms retain the verified separate pass.
  const fusedPolicy=!!sourceModule||game.equilibrium==='gto'&&game.gtoAlgorithm==='dcfr'&&
    !game.actionPruning?.enabled&&!game.riverPrivateSymmetry?.enabled&&!game.hasFrequencyIncrements&&
    typeof exports.set_fused_dcfr_policy==='function'&&typeof exports.full_traverse==='function';
  let full=null,variantNodePtr=0,statsPtr=null,publicState=null;
  if(typeof exports.full_traverse==='function')try{
    const cache=new WeakMap();
    function copyTyped(array){
      if(!array)return 0;if(cache.has(array))return cache.get(array);
      const offset=allocate(array.byteLength,Math.min(array.BYTES_PER_ELEMENT,8));
      if(offset===null)throw Error('No WASM space for tree metadata');
      new Uint8Array(memory.buffer,offset,array.byteLength).set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
      cache.set(array,offset);return offset;
    }
    function ints(array){return copyTyped(Int32Array.from(array));}
    function double(value){return copyTyped(Float64Array.of(value));}
    const playerMeta=[];
    for(const p of game.players)playerMeta.push(p.ids.length,copyTyped(p.card0),copyTyped(p.card1),copyTyped(p.opponentIndex));
    const playerPtr=ints(playerMeta);
    const layoutCache=new WeakMap();
    function layoutPtr(layout){
      if(!layout)return 0;if(layoutCache.has(layout))return layoutCache.get(layout);
      const o=ints([copyTyped(layout.mineOrder),copyTyped(layout.oppOrder),copyTyped(layout.groupStart),
        copyTyped(layout.weakEnd),copyTyped(layout.tieEnd),layout.weakEnd.length]);
      layoutCache.set(layout,o);return o;
    }
    const maps=new WeakMap();
    function mapPtr(m){if(!m)return 0;if(!maps.has(m))maps.set(m,copyTyped(m));return maps.get(m);}
    const rows=[],strategy=sourceModule?new Int32Array(nativeTree.length*9):null;
    const privateAlias=new WeakMap();
    for(const key of publicDrawKeys.keys()){
      const address=allocate(104,4);
      if(address===null)throw Error('No WASM space for public samples');
      publicDrawKeys.set(key,address);
    }
    for(let i=0;i<nativeTree.length;i++){
      const node=nativeTree[i];
      const kind=node.terminal?0:node.chance?2:1;
      let childPtr=0,ng=0,groupPtr=0,previousPtr=node.previousDelta?.byteOffset??0;
      if(kind===1)childPtr=ints(node.actions.map(a=>nativeIndex(a.child)));
      if(publicChance&&node.chanceClock!==undefined)previousPtr=node.chanceClock+1;
      if(kind===2){
        const groups=node.isoGroups||node.runouts.map(o=>({representative:o,members:[{outcome:o,maps:null}]}));
        const values=[];
        for(const group of groups){
          const members=[];
          for(const m of group.members)members.push(mapPtr(m.maps?.[0]),mapPtr(m.maps?.[1]));
          const rep=group.representative;
          values.push(node.nativeChildren?rep.child:nativeIndex(rep.child),rep.card??rep.river,ints(members),group.members.length,double(rep.weight??1/44));
        }
        ng=groups.length;groupPtr=ints(values);
        if(publicChance)previousPtr=publicDrawKeys.get(publicDrawKey(node,ng))??0;
      }
      if(strategy&&kind===1&&!node.isoAlias){
        const shape=node.compact;
        let flags=Number(!!shape);
        if(node.regret instanceof Float32Array)flags|=2;
        if(node.averageSum instanceof Float32Array)flags|=4;
        if(node.current32)flags|=8;
        if(node.averageExponent)flags|=16;
        if(shape?.map){
          if(!privateAlias.has(shape))privateAlias.set(shape,shape.map.reduce((n,row)=>n+Number(row>=0),0)>shape.reps.length);
          if(privateAlias.get(shape))flags|=32;
        }
        strategy.set([flags,copyTyped(shape?.map),copyTyped(shape?.reps),copyTyped(node.implicitPolicy),
          copyTyped(node.lockedMask),copyTyped(node.lockedRows),copyTyped(node.lockOffsets),
          Number(!!node.sharedLock),node.averageExponent?.byteOffset??0],i*9);
      }
      const payoffs=node.riverPayoff;
      // Native masks are zero-copy views and survive checkpoint restore.
      let prunedPtr=0;
      if(game.actionPruning?.enabled&&kind===1){
        prunedPtr=allocate(node.actions.length,1);
        if(prunedPtr===null)throw Error('No WASM memory for action-culling masks');
        const existing=node.pruned;
        node.pruned=new Uint8Array(memory.buffer,prunedPtr,node.actions.length);
        if(existing)node.pruned.set(existing);
      }
      rows.push(kind,node.p??-1,node.actions?.length??0,childPtr,ng,groupPtr,
        node.current?.byteOffset??0,node.regret?.byteOffset??0,node.averageSum?.byteOffset??0,
        node.qreEntropy?.byteOffset??0,node.qreLog?.byteOffset??0,
        copyTyped(node.valid?.[0]),copyTyped(node.valid?.[1]),
        layoutPtr(payoffs?.[0]),layoutPtr(payoffs?.[1]),
        node.terminal&&node.type==='fold'?node.winner:-1,
        node.c?.[0]??0,node.c?.[1]??0,node.turn??-1,node.river??-1,
        previousPtr,prunedPtr);
    }
    const nodePtr=ints(rows),reachPtrs=[],outPtrs=[],ownPtrs=[];
    const rootReachPtrs=game.players.map((_,p)=>copyTyped(game.players[1-p].priors));
    if(strategy)exports.configure_strategy(copyTyped(strategy),game.regretScale,
      16*Number.EPSILON*Math.max(1,game.pot+game.stack)*game.regretScale);
    if(publicChance){
      const last=copyTyped(publicChance.last),factors=copyTyped(publicChance.factors),counts=allocate(8,4);
      if(counts===null)throw Error('No WASM space for public chance counters');
      exports.configure_public_chance(publicChance.turnBudget,publicChance.riverBudget,
        Number(publicChance.method==='stratified'),publicChance.seed,last,factors,counts);
      publicState={last:new Uint32Array(memory.buffer,last,publicChance.last.length),
        factors:new Float64Array(memory.buffer,factors,publicChance.factors.length),
        counts:new Uint32Array(memory.buffer,counts,2)};
    }
    variantNodePtr=nodePtr;
    for(let p=0;p<2;p++){
      reachPtrs[p]=allocate(game.players[1-p].ids.length*8,8);
      outPtrs[p]=allocate(game.players[p].ids.length*8,8);
      ownPtrs[p]=allocate(game.players[p].ids.length*8,8);
      if(reachPtrs[p]===null||outPtrs[p]===null||ownPtrs[p]===null)throw Error('No WASM traversal space');
    }
    // Parent paths are structural metadata only; no second numerical game.
    // Follow full uncompressed runouts when computing the reach of a selected
    // canonical decision, even if solving used exact suit-isomorphic orbits.
    const parents=[];
    if(!game.parentOf)for(const node of game.staticNodes){
      const edges=node.chance?node.runouts:node.actions;
      for(let k=0;k<edges.length;k++)parents[edges[k].child]=[node.id,k];
    }
    function parentEdge(child){
      if(!game.parentOf)return parents[child];
      const [id]=game.parentOf(child),node=game.nodes[id],edges=node.chance?node.runouts:node.actions;
      return [id,edges.findIndex(e=>e.child===child)];
    }
    const handIndices=game.players.map(p=>new Map(Array.from(p.ids,(id,i)=>[id,i])));
    function averageChancePolicy(node,hand,k){
      const a=node.actions.length,off=hand*a;
      if(node.pruned?.[k])return 0;
      let sum=0;for(let j=0;j<a;j++)if(!node.pruned?.[j])sum+=node.averageSum[off+j];
      return sum>0?node.averageSum[off+k]/sum:node.current[off+k];
    }
    // Larger collision-resistant reach basis table and payout-independent
    // showdown mass vectors. If allocation is unavailable, C keeps the old
    // exact direct-mapped reach table and uncached leaf implementation.
    if(extendedCache&&typeof exports.configure_reach_cache==='function'&&typeof exports.reach_cache_stride==='function'){
      const slots=256,addr=allocate(slots*exports.reach_cache_stride(),8);
      if(addr!==null)exports.configure_reach_cache(addr,slots);
    }
    if(extendedCache&&reuseShowdowns&&typeof exports.configure_showdown_cache==='function'){
      const slots=16,addr=allocate(slots*3*maxN*8,8);
      if(addr!==null)exports.configure_showdown_cache(addr,maxN);
    }
    statsPtr=extendedCache&&typeof exports.cache_statistics==='function'?allocate(4*4,4):null;
    const reachViews=reachPtrs.map((ptr,p)=>new Float64Array(memory.buffer,ptr,game.players[1-p].ids.length));
    const outViews=outPtrs.map((ptr,p)=>new Float64Array(memory.buffer,ptr,game.players[p].ids.length));
    function inputReach(target,reach){
      if(reach===game.players[1-target].priors)return rootReachPtrs[target];
      reachViews[target].set(reach);return reachPtrs[target];
    }
    function rootValue(target){
      const v=outViews[target],priors=game.players[target].priors;
      let sum=0;
      for(let i=0;i<v.length;i++)sum+=priors[i]*v[i];
      return sum/game.jointZ;
    }
    const workspaceStart=Math.ceil(used/8)*8;
    if(memory.buffer.byteLength-workspaceStart<scratchBudget-512*1024)throw Error('WASM workspace too small');
    full={run(id,target,reach,weight,copyResult){
      const pass=publicChance?.pass;
      if(pass)exports.begin_public_pass(pass.iteration,pass.before,pass.after);
      if(typeof exports.set_cache_mode==='function')exports.set_cache_mode(extendedCache?1:0);
      if(typeof exports.set_zero_reach_pruning==='function')exports.set_zero_reach_pruning(game.zeroReachPruning?1:0);
      if(typeof exports.set_sparse_traversal==='function')exports.set_sparse_traversal(game.sparseTraversal!==false?1:0);
      if(typeof exports.set_active_averaging==='function')exports.set_active_averaging(game.activeAverage!==false?1:0);
      if(typeof exports.set_regret_pruning==='function')exports.set_regret_pruning(
        game.regretPruning&&game.equilibrium==='gto'&&!game.isFlop&&!game.nodeLocks?.length&&
        ['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-cubic','dcfr-2-0.5-2'].includes(game.gtoAlgorithm)?1:0,
        game.pot+2*game.stack);
      // Set before each traverse; the module is reused but numerical state is not.
      if(typeof exports.set_fused_dcfr_policy==='function')
        exports.set_fused_dcfr_policy(fusedPolicy&&game.compiled?.fusesPolicy!==false?1:0,
          16*Number.EPSILON*Math.max(1,game.pot+game.stack));
      if(!exports.full_traverse(nodePtr,playerPtr,nativeIndex(id),target,game.equilibrium==='qre'?1:0,
          game.qreTemperature,game.pot,weight,inputReach(target,reach),outPtrs[target],
          weight?ownPtrs[target]:0,workspaceStart,memory.buffer.byteLength,
          (['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(game.gtoAlgorithm))? (game.gtoAlgorithm==='dcfr-predictive'?3:1):game.gtoAlgorithm==='optimistic'?2:0,
          game._positiveDiscount||1,game._negativeDiscount||1))
        throw Error('WASM traversal scratch overflow');
      if(pass?.iteration){pass.nodes+=publicState.counts[0];pass.branches+=publicState.counts[1];}
      if(typeof exports.pruned_terminal_hands==='function')game.prunedTerminalHands=(game.prunedTerminalHands||0)+exports.pruned_terminal_hands();
      if(copyResult)return Float64Array.from(outViews[target]);
    },
    exactBest(target,regularizedBest,constrained=false){
      if(typeof exports.set_cache_mode==='function')exports.set_cache_mode(extendedCache?1:0);
      if(typeof exports.set_zero_reach_pruning==='function')exports.set_zero_reach_pruning(game.zeroReachPruning?1:0);
      if(!exports.exact_best_response(nodePtr,playerPtr,nativeIndex(game.root),target,(sourceModule?constrained:regularizedBest)?1:0,
          game.qreTargetTemperature||0,game.pot,rootReachPtrs[target],outPtrs[target],
          workspaceStart,memory.buffer.byteLength))throw Error('WASM best-response scratch overflow');
      return rootValue(target);
    },
    profileVector(target,id,reach,copyResult=true){
      if(typeof exports.set_cache_mode==='function')exports.set_cache_mode(extendedCache?1:0);
      if(typeof exports.set_zero_reach_pruning==='function')exports.set_zero_reach_pruning(game.zeroReachPruning?1:0);
      if(typeof exports.profile_evaluate!=='function')throw Error('Native profile evaluator unavailable');
      if(!exports.profile_evaluate(nodePtr,playerPtr,nativeIndex(id),target,game.pot,
          inputReach(target,reach),outPtrs[target],workspaceStart,memory.buffer.byteLength))
        throw Error('WASM profile EV scratch overflow');
      if(copyResult)return Float64Array.from(outViews[target]);
    },
    profileEV(target){
      this.profileVector(target,game.root,game.players[1-target].priors,false);
      return rootValue(target);
    },
    nodeDetail(id){
      const node=game.nodes[id];
      if(!node||node.terminal||node.chance)return null;
      const target=node.p,mine=game.players[target],opp=game.players[1-target];
      if(node.isoAlias){
        const source=this.nodeDetail(node.isoAlias.source);
        const map=node.isoAlias.map,idx=handIndices[target];
        return {...source,id,player:target,hands:source.hands.map(h=>{
          const i=idx.get(h[0]);return [mine.ids[map[i]],h[1],h[2],h[3].slice(),h[4].slice()];
        })};
      }
      const path=[];let cursor=id;
      while(cursor!==game.root){
        const item=parentEdge(cursor);if(!item)throw Error('Selected node has no root path');
        path.push(item);cursor=item[0];
      }
      let oppReach=Float64Array.from(opp.priors),ownReach=new Float64Array(mine.ids.length).fill(1);
      for(let t=path.length-1;t>=0;t--){
        const [parentId,k]=path[t],parent=game.nodes[parentId];
        if(parent.chance){
          const outcome=parent.runouts[k],card=outcome.card??outcome.river;
          const weight=outcome.weight??(1/44),allowedOpp=opp.cardAllowed[card],allowedOwn=mine.cardAllowed[card];
          for(let i=0;i<oppReach.length;i++)oppReach[i]=allowedOpp[i]?oppReach[i]*weight:0;
          for(let i=0;i<ownReach.length;i++)if(!allowedOwn[i])ownReach[i]=0;
        }else if(parent.p===target){
          for(let i=0;i<ownReach.length;i++)ownReach[i]*=averageChancePolicy(parent,i,k);
        }else{
          for(let i=0;i<oppReach.length;i++)oppReach[i]*=averageChancePolicy(parent,i,k);
        }
      }
      const a=node.actions.length;
      const acts=node.actions.map(edge=>this.profileVector(target,edge.child,oppReach));
      // Keep the exact blocker-mass implementation and numerical cutoff used
      // by full JavaScript reports; the expensive continuation EVs above are
      // evaluated wholly inside the compiled native tree engine.
      const mass=game.coreCompatibilityMass(target,oppReach,node);
      let numerator=0,denom=0;const agg=new Float64Array(a),hands=[];
      const cutoff=game.equilibrium==='qre'?1e-200:1e-14;
      const offset=game.pot/2+node.c[target];
      const shifted=v=>Math.abs(v+offset)<1e-9?0:v+offset;
      for(let i=0;i<mine.ids.length;i++){
        let value=0;const probabilities=[],actionEV=[];
        for(let k=0;k<a;k++){
          const p=averageChancePolicy(node,i,k);
          probabilities.push(p);value+=p*acts[k][i];
        }
        const m=mass[i],weight=mine.priors[i]*ownReach[i]*m;
        numerator+=mine.priors[i]*ownReach[i]*value;denom+=weight;
        for(let k=0;k<a;k++){
          agg[k]+=weight*probabilities[k];
          actionEV.push(m>cutoff?(node.actions[k].type==='fold'?0:shifted(acts[k][i]/m)):null);
        }
        hands.push([mine.ids[i],weight,m>cutoff?shifted(value/m):null,probabilities,actionEV]);
      }
      for(const h of hands)h[1]=denom>cutoff?h[1]/denom:0;
      return {id,player:target,rangeEV:denom>cutoff?shifted(numerator/denom):null,
        reachMass:denom/game.jointZ,actions:denom>cutoff?Array.from(agg,v=>v/denom):Array(a).fill(0),hands};
    }};
  }catch(_){full=null;}
  if(sourceModule&&!full){bindArena(storage,previous);return compatibilityFallback();}
  previous=null;
  if(publicState){publicChance.last=publicState.last;publicChance.factors=publicState.factors;}
  game.memory+=actualBytes-stateBytes-(publicChance?.clockBytes??0);
  // Culling requires a native full-tree skip mask. A partial native bridge
  // must not refresh unmasked policies or silently accept a slow alternate.
  if(game.actionPruning?.enabled&&!full)return null;
  // The native evaluators read the unprojected average sums. The JS
  // evaluators use the same increment-constrained policy as the reports.
  const evaluateNative=full&&!game.hasFrequencyIncrements;
  const simd=exports.kernel_features?.()===1,backend=simd?'WebAssembly SIMD128':'Scalar WebAssembly';
  return {
    memory,treeRecords:nativeTree.length,fusesPolicy:!!(full&&fusedPolicy),handlesLocks:!!sourceModule,
    mode:sourceModule?(simd?'wasm-simd128':'wasm-scalar'):full?'wasm-full-tree-f64':'wasm-f64',
    backend:full?backend:backend+' row updates + JavaScript traversal',
    simd,sourceBacked:!!sourceModule,fullTraversal:!!full,
    traverse:full?(id,target,reach,weight,copyResult=true)=>full.run(id,target,reach,weight,copyResult):null,
    profileEV:evaluateNative&&typeof exports.profile_evaluate==='function'?(target)=>full.profileEV(target):null,
    nodeDetail:evaluateNative&&!compact&&!mixed&&typeof exports.profile_evaluate==='function'?(id)=>full.nodeDetail(id):null,
    exactBest:evaluateNative&&typeof exports.exact_best_response==='function'?(target,regularized)=>full.exactBest(target,regularized):null,
    constrainedBest:full&&sourceModule?target=>full.exactBest(target,false,true):null,
    scratchBytes:memory.buffer.byteLength-start,
    cacheStats:full&&statsPtr!==null?()=>{
      exports.cache_statistics(statsPtr);
      const stats=new Uint32Array(memory.buffer,statsPtr,4);
      return {reachHits:stats[0],reachBuilds:stats[1],showdownHits:stats[2],showdownBuilds:stats[3]};
    }:null,
    allocateVector:allocVector,
    updatePolicy:sourceModule?null:function(player,qre){
      const variant=(['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','dcfr-predictive','lcfr','dcfr-cubic','dcfr-2-0.5-2'].includes(game.gtoAlgorithm))? (game.gtoAlgorithm==='dcfr-predictive'?3:1):game.gtoAlgorithm==='optimistic'?2:0;
      const tieFloor=qre?0:16*Number.EPSILON*Math.max(1,game.pot+game.stack);
      if(!qre&&variant&&full)exports.policy_variant(variantNodePtr,metaAddr,decisions.length,player,variant,tieFloor);
      else if(!qre&&variant){
        for(const n of decisions)if(n.p===player){
          const a=n.actions.length,r=n.regret,s=n.current,prev=n.previousDelta;
          for(let i=0;i<s.length;i+=a){
            let sum=0;
            for(let k=0;k<a;k++){const x=r[i+k]+(prev?prev[i+k]:0);if(x>0)sum+=x;}
            for(let k=0;k<a;k++){const x=r[i+k]+(prev?prev[i+k]:0);s[i+k]=sum>tieFloor?(x>0?x:0)/sum:1/a;}
          }
        }
      }else exports.policy_batch(variantNodePtr,metaAddr,decisions.length,player,qre?1e-6:0,tieFloor);
      // v9: eliminate JS entropy/log-cache loops after QRE policy updates.
      // true means the cache is fully refreshed; if unavailable, use JS.
      if(qre&&full&&typeof exports.qre_refresh==='function'){
        exports.qre_refresh(variantNodePtr,metaAddr,decisions.length,player);
        return true;
      }
      return false;
    },
    regret(node,actionVals,output,mass,temperature){
      if(game.gtoAlgorithm!=='cfrplus')return false; // Reference JS fallback for experimental algorithms.
      if(output.buffer!==memory.buffer||actionVals.some(v=>v.buffer!==memory.buffer)||
         (mass&&mass.buffer!==memory.buffer))return false;
      for(let k=0;k<actionVals.length;k++)actionOffsets[k]=actionVals[k].byteOffset;
      if(mass){exports.regret_qre(game.players[node.p].ids.length,actionVals.length,
        node.regret.byteOffset,node.current.byteOffset,output.byteOffset,actionPtr,mass.byteOffset,
        node.qreEntropy.byteOffset,node.qreLog.byteOffset,temperature,1e-6);}
      else exports.regret_gto(game.players[node.p].ids.length,actionVals.length,
        node.regret.byteOffset,node.current.byteOffset,output.byteOffset,actionPtr);
      return true;
    }
  };
}
