/* Compiled game-tree traversal and exact best responses. */
function createCompiledTraversal(game, base64, limitBytes, options) {
  'use strict';
  options??={};
  limitBytes=Number(limitBytes)||0;
  if(game.banks)return sourceTraversal();
  // River-only private-hand orbit compression remains a reference-JS layout.
  // Whole-action culling uses native action masks and can stay compiled.
  if(game.riverPrivateSymmetry?.enabled||game.stack>0x7fffffff)return null;
  if(typeof WebAssembly==='undefined'||typeof atob!=='function'||game.stateLength===undefined)return null;
  const stateSize=game.stateLength;
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
      const node=game.nodes[id];
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
  const reuseShowdowns=hasReusableShowdowns(0)||hasReusableShowdowns(1);
  // Ordinary turn/river trees have no repeated terminal opponent reach.
  // Keep their proven single-worker cache path instead of forcing extra RAM.
  const extendedCache=game.exactCaches===true||(game.exactCaches!==false&&reuseShowdowns);
  // v16 opts into the exact, active-average/sparse-list kernel. The legacy
  // v14 binary is still selectable for numerical and performance comparisons.
  const modernTraversal=game.v16Traversal===true;
  const explicitScalar=typeof WASM_TRAVERSAL_BYTES_SCALAR==='string'&&
    base64===WASM_TRAVERSAL_BYTES_SCALAR;
  // Preserve explicit scalar selection and mobile no-SIMD fallback even when
  // selecting the v14 classic kernel for a game with no cached showdowns.
  // Validate the originally requested SIMD module before switching kernels.
  let requestedSimdSupported=true;
  if(!extendedCache&&!explicitScalar){
    const validation=createCompiledTraversal._simdValidation||(createCompiledTraversal._simdValidation=new Map());
    if(!validation.has(base64)){
      const source=atob(base64),probe=new Uint8Array(source.length);
      for(let i=0;i<source.length;i++)probe[i]=source.charCodeAt(i);
      validation.set(base64,WebAssembly.validate(probe));
    }
    requestedSimdSupported=validation.get(base64);
  }
  const chosenBinary=extendedCache||modernTraversal||typeof WASM_TRAVERSAL_BYTES_CLASSIC!=='string'
    ?base64:(explicitScalar||!requestedSimdSupported)&&typeof WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR==='string'
      ?WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR:WASM_TRAVERSAL_BYTES_CLASSIC;
  const memo=new Map();
  function maxDepth(id,p){
    const key=id*2+p;if(memo.has(key))return memo.get(key);
    const node=game.nodes[id];if(node.terminal)return 0;
    const children=node.chance?(node.isoGroups?node.isoGroups.map(g=>g.representative.child):node.runouts.map(r=>r.child)):
      node.actions.map(a=>a.child);
    const own=node.chance?3*maxN*8:node.actions.length===1?0:
      node.p===p?(node.actions.length+2)*maxN*8:3*maxN*8;
    let rest=0;for(const child of children)rest=Math.max(rest,maxDepth(child,p));
    const result=own+rest;memo.set(key,result);return result;
  }
  const scratchBudget=Math.max(2*1024*1024,maxDepth(game.root,0)+maxDepth(game.root,1)+1024*1024);
  const sourceBacked=game.equilibrium==='gto'&&typeof WASM_LOCK_KERNEL_BYTES==='string';
  const nativeStackBytes=sourceBacked?128*1024:0;
  const learnable=game.nodes.filter(n=>!n.terminal&&!n.chance&&!n.isoAlias&&(!game.compactState||n.actions.length>1));
  const lockCapacity=sourceBacked?Math.min(game.maxNodeLocks,learnable.length):0;
  let layouts=0,runouts=0;
  for(const pair of new Set(game.riverPayoffLayouts.values()))for(const l of pair)
    for(const key of ['mineOrder','oppOrder','groupStart','weakEnd','tieEnd'])layouts+=l[key].byteLength+16;
  const valid=new Set();
  for(const node of game.nodes){
    if(node.chance)runouts+=node.runouts.length;
    if(node.valid)valid.add(node.valid);
  }
  for(const pair of valid)layouts+=pair[0].byteLength+pair[1].byteLength;
  const staticBudget=1048576+game.nodes.length*(sourceBacked?176:160)+runouts*64+
    layouts+maxN*(24+lockCapacity);
  // Bounded v15 caches live in the worker's existing WASM linear memory.
  // No SharedArrayBuffer, threads, dynamic WASM memory growth or backend.
  const cacheBudget=(extendedCache?256*1024:0)+(extendedCache&&reuseShowdowns?16*3*maxN*8:0)+512;
  const bytes=131072+stateSize*8+staticBudget+scratchBudget+cacheBudget+nativeStackBytes;
  const pages=Math.ceil(bytes/65536);
  // The worker's memory budget also applies to compiled scratch capacity.
  // Refuse optional compilation instead of exceeding a mobile allocation limit.
  const actualBytes=pages*65536;
  if(limitBytes>0&&game.memory+actualBytes-stateSize*8>limitBytes)return null;
  // A Worker can solve several situations in its lifetime. Compile a WASM
  // binary once per Worker and instantiate it with fresh private linear
  // memory for each game. No solver state or data is shared between games.
  const modules=createCompiledTraversal._moduleCache||
    (createCompiledTraversal._moduleCache=new Map());
  function compiledModule(source){
    if(modules.has(source))return modules.get(source);
    const decoded=atob(source),bytes=new Uint8Array(decoded.length);
    for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
    const m=WebAssembly.validate(bytes)?new WebAssembly.Module(bytes):null;
    if(modules.size>=8)modules.clear();
    modules.set(source,m);
    return m;
  }
  let module=compiledModule(chosenBinary);
  let simdEnabled=module!==null;
  if(!module){
    const chosenScalar=extendedCache||modernTraversal||typeof WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR!=='string'
      ?WASM_TRAVERSAL_BYTES_SCALAR:WASM_TRAVERSAL_BYTES_CLASSIC_SCALAR;
    if(typeof chosenScalar!=='string')return null;
    module=compiledModule(chosenScalar);
    if(!module)return null;
    simdEnabled=false;
  }
  const memory=new WebAssembly.Memory({initial:pages,maximum:pages});
  const instance=new WebAssembly.Instance(module,{env:{memory,host_log:Math.log,host_exp:Math.exp}});
  const storage=new Float64Array(memory.buffer,131072,stateSize);
  if(!game.stateStorage)game.allocateState(storage);
  else{
    storage.set(game.stateStorage);
    const migrated=new WeakMap();
    function migrate(arr){
      if(!migrated.has(arr))migrated.set(arr,new Float64Array(memory.buffer,131072+arr.byteOffset-game.stateStorage.byteOffset,arr.length));
      return migrated.get(arr);
    }
    for(const node of game.nodes)if(node.current){
      node.regret=migrate(node.regret);node.averageSum=migrate(node.averageSum);
      node.current=migrate(node.current);
      if(node.qreLog){node.qreLog=migrate(node.qreLog);node.qreEntropy=migrate(node.qreEntropy);}
      if(node.previousDelta)node.previousDelta=migrate(node.previousDelta);
    }
    game.forcedPolicies=game.forcedPolicies.map(migrate);
    game.stateStorage=storage;
  }
  game.memory+=actualBytes-stateSize*8;
  const start=131072+stateSize*8;
  let used=start;
  function allocate(bytes,align){
    used=Math.ceil(used/align)*align;
    if(used+bytes>memory.buffer.byteLength)return null;
    const addr=used;used+=bytes;return addr;
  }
  const decisions=learnable;
  const metaAddr=allocate(decisions.length*6*4,4);
  if(metaAddr===null)return null;
  const meta=new Int32Array(memory.buffer,metaAddr,decisions.length*6);
  for(let i=0;i<decisions.length;i++){
    const node=decisions[i],o=i*6;
    meta[o]=node.p;meta[o+1]=game.players[node.p].ids.length;
    meta[o+2]=node.actions.length;meta[o+3]=node.regret.byteOffset;
    meta[o+4]=node.current.byteOffset;meta[o+5]=node.id;
  }
  let maxActions=1;
  for(const node of decisions)if(node.actions.length>maxActions)maxActions=node.actions.length;
  const actionPtr=allocate(maxActions*4,4);
  if(actionPtr===null)return null;
  const actionOffsets=new Int32Array(memory.buffer,actionPtr,maxActions);
  function allocVector(n){
    const addr=allocate(n*8,8);
    return addr===null?new Float64Array(n):new Float64Array(memory.buffer,addr,n);
  }
  function variantFor(game){
    if(game.gtoAlgorithm==='dcfr-predictive')return 3;
    if(game.gtoAlgorithm==='optimistic')return 2;
    return ['dcfr','dcfr-scheduled','dcfr-scheduled-cubic','dcfr-adaptive','lcfr','dcfr-cubic','dcfr-2-0.5-2']
      .includes(game.gtoAlgorithm)?1:0;
  }
  const exports=instance.exports;
  // Opt into native fused policy updates only for established DCFR and trees
  // without private-hand row sharing or heuristic action pruning. Older WASM
  // modules and all other algorithms retain the verified separate pass.
  const fusedPolicy=game.equilibrium==='gto'&&game.gtoAlgorithm==='dcfr'&&
    !game.actionPruning?.enabled&&!game.riverPrivateSymmetry?.enabled&&!game.hasFrequencyIncrements&&
    typeof exports.set_fused_dcfr_policy==='function'&&typeof exports.full_traverse==='function';
  let full=null,native=null,variantNodePtr=0,statsPtr=null;
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
    const nodePtr=allocate(game.nodes.length*22*4,4);
    if(nodePtr===null)throw Error('No WASM space for node metadata');
    const rows=new Int32Array(memory.buffer,nodePtr,game.nodes.length*22);
    for(const node of game.nodes){
      const kind=node.terminal?0:node.chance?2:1;
      let childPtr=0,ng=0,groupPtr=0;
      if(kind===1)childPtr=ints(node.actions.map(a=>a.child));
      if(kind===2){
        const groups=node.isoGroups||node.runouts.map(o=>({representative:o,members:[{outcome:o,maps:null}]}));
        const values=[];
        for(const group of groups){
          const members=[];
          for(const m of group.members)members.push(mapPtr(m.maps?.[0]),mapPtr(m.maps?.[1]));
          const rep=group.representative;
          values.push(rep.child,rep.card??rep.river,ints(members),group.members.length,double(rep.weight??1/44));
        }
        ng=groups.length;groupPtr=ints(values);
      }
      const payoffs=node.riverPayoff;
      // Native masks are zero-copy views and survive checkpoint restore.
      let prunedPtr=0;
      if(game.actionPruning?.enabled&&kind===1&&!node.isoAlias&&node.actions.length>1){
        prunedPtr=allocate(node.actions.length,1);
        if(prunedPtr===null)throw Error('No WASM memory for action-culling masks');
        const existing=node.pruned;
        node.pruned=new Uint8Array(memory.buffer,prunedPtr,node.actions.length);
        if(existing)node.pruned.set(existing);
      }
      rows.set([kind,node.p??-1,node.actions?.length??0,childPtr,ng,groupPtr,
        node.current?.byteOffset??0,node.regret?.byteOffset??0,node.averageSum?.byteOffset??0,
        node.qreEntropy?.byteOffset??0,node.qreLog?.byteOffset??0,
        copyTyped(node.valid?.[0]),copyTyped(node.valid?.[1]),
        layoutPtr(payoffs?.[0]),layoutPtr(payoffs?.[1]),
        node.terminal&&node.type==='fold'?node.winner:-1,
        node.c?.[0]??0,node.c?.[1]??0,node.turn??-1,node.river??-1,
        node.previousDelta?.byteOffset??0,prunedPtr],node.id*22);
    }
    const reachPtrs=[],outPtrs=[],ownPtrs=[];
    variantNodePtr=nodePtr;
    for(let p=0;p<2;p++){
      reachPtrs[p]=allocate(game.players[1-p].ids.length*8,8);
      outPtrs[p]=allocate(game.players[p].ids.length*(sourceBacked?24:8),8);
      ownPtrs[p]=allocate(game.players[p].ids.length*8,8);
      if(reachPtrs[p]===null||outPtrs[p]===null||ownPtrs[p]===null)throw Error('No WASM traversal space');
    }
    const parents=game.paths??null;
    const handIndices=game.players.map(p=>p.index);
    function averageChancePolicy(node,hand,k){
      const a=node.actions.length,off=hand*a;
      if(a===1)return 1;
      if(node.lockedMask?.[hand])return node.current[off+k];
      if(node.pruned?.[k])return 0;
      const mapped=(node.suitRows?.[hand]??hand)*a;
      let sum=0;for(let j=0;j<a;j++)if(!node.pruned?.[j])sum+=node.averageSum[mapped+j];
      return sum>0?node.averageSum[mapped+k]/sum:node.current[mapped+k];
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
    if(sourceBacked)try{
      const nativeModule=compiledModule(WASM_LOCK_KERNEL_BYTES);
      if(nativeModule){
        const addon=new WebAssembly.Instance(nativeModule,{env:{memory}}).exports;
        const decisionPtr=allocate(game.nodes.length*32,4);
        const masks=allocate(lockCapacity*maxN,1);
        if(decisionPtr===null||masks===null)throw Error('No WASM memory for lock metadata');
        const metadata=new Int32Array(memory.buffer,decisionPtr,game.nodes.length*8);
        for(const node of game.nodes)if(node.current){
          const off=node.id*8;
          metadata[off+1]=mapPtr(node.suitRows);
          metadata[off+2]=-1;
          metadata[off+3]=node.frequencyUnits??0;
        }
        const workspaceEnd=memory.buffer.byteLength-nativeStackBytes;
        const workspaceStart=Math.ceil(used/8)*8;
        const evaluated=[null,null];
        let lockedIds=[];
        native={
          refreshLocks(){
            for(const id of lockedIds){metadata[8*id]=0;metadata[8*id+2]=-1;}
            lockedIds=[];
            let slot=0;
            for(const entry of game.nodeLocks){
              const node=game.nodes[entry.nodeId];
              if(node.isoAlias||node.actions.length===1)continue;
              const offset=masks+slot++*maxN,index=node.id*8,mask=node.lockedMask;
              new Uint8Array(memory.buffer,offset,mask.length).set(mask);
              metadata[index]=offset;
              metadata[index+2]=node.allLocked?node.lockedActions.reduce((bits,on,k)=>bits|(on<<k),0):-1;
              lockedIds.push(node.id);
            }
          },
          train(id,target,reach,weight,returnVector){
            addon.__stack_pointer.value=memory.buffer.byteLength;
            new Float64Array(memory.buffer,reachPtrs[target],reach.length).set(reach);
            if(!addon.train_locked(nodePtr,decisionPtr,playerPtr,id,target,game.pot,reachPtrs[target],outPtrs[target],
                weight?ownPtrs[target]:0,workspaceStart,workspaceEnd,weight,variantFor(game),
                game._positiveDiscount??1,game._negativeDiscount??1,
                fusedPolicy&&game.compiled?.fusesPolicy!==false?1:0,
                16*Number.EPSILON*Math.max(1,game.pot+game.stack),0))
              throw Error('WASM locked traversal scratch overflow');
            if(returnVector)return Float64Array.from(new Float64Array(memory.buffer,outPtrs[target],game.players[target].ids.length));
          },
          evaluate(target,includeProfile,includeUnrestricted){
            addon.__stack_pointer.value=memory.buffer.byteLength;
            const reach=game.players[1-target].priors,priors=game.players[target].priors,n=priors.length;
            new Float64Array(memory.buffer,reachPtrs[target],reach.length).set(reach);
            const trackUnrestricted=includeUnrestricted&&game.nodeLocks.some(lock=>lock.player===target);
            if(!addon.evaluate_gto(nodePtr,decisionPtr,playerPtr,game.root,target,game.pot,
                reachPtrs[target],outPtrs[target],workspaceStart,workspaceEnd,+includeProfile,+trackUnrestricted,0,0))
              throw Error('WASM best-response scratch overflow');
            const size=1+Number(includeProfile)+Number(trackUnrestricted);
            const values=evaluated[target]??=new Float64Array(memory.buffer,outPtrs[target],n*3);
            const totals=new Float64Array(size);
            for(let v=0;v<size;v++)for(let i=0;i<n;i++)totals[v]+=priors[i]*values[v*n+i];
            const constrained=totals[0]/game.jointZ;
            return {constrained,profile:includeProfile?totals[1]/game.jointZ:null,
              unrestricted:includeUnrestricted?(trackUnrestricted?totals[size-1]/game.jointZ:constrained):null};
          }
        };
        native.refreshLocks();
      }
    }catch(_){native=null;}
    const workspaceStart=Math.ceil(used/8)*8;
    if(memory.buffer.byteLength-workspaceStart<scratchBudget-512*1024)throw Error('WASM workspace too small');
    full={run(id,target,reach,weight,returnVector=true){
      if(game.nodeLocks.length&&native)return native.train(id,target,reach,weight,returnVector);
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
      new Float64Array(memory.buffer,reachPtrs[target],reach.length).set(reach);
      if(!exports.full_traverse(nodePtr,playerPtr,id,target,game.equilibrium==='qre'?1:0,
          game.qreTemperature,game.pot,weight,reachPtrs[target],outPtrs[target],
          weight?ownPtrs[target]:0,workspaceStart,memory.buffer.byteLength,
          variantFor(game),
          game._positiveDiscount||1,game._negativeDiscount||1))
        throw Error('WASM traversal scratch overflow');
      if(typeof exports.pruned_terminal_hands==='function')game.prunedTerminalHands=(game.prunedTerminalHands||0)+exports.pruned_terminal_hands();
      if(returnVector)return Float64Array.from(new Float64Array(memory.buffer,outPtrs[target],game.players[target].ids.length));
    },
    exactBest(target,regularizedBest){
      exports.set_regret_pruning?.(0,0);
      if(typeof exports.set_cache_mode==='function')exports.set_cache_mode(extendedCache?1:0);
      if(typeof exports.set_zero_reach_pruning==='function')exports.set_zero_reach_pruning(game.zeroReachPruning?1:0);
      const reach=game.players[1-target].priors;
      new Float64Array(memory.buffer,reachPtrs[target],reach.length).set(reach);
      if(!exports.exact_best_response(nodePtr,playerPtr,game.root,target,regularizedBest?1:0,
          game.qreTargetTemperature||0,game.pot,reachPtrs[target],outPtrs[target],
          workspaceStart,memory.buffer.byteLength))throw Error('WASM best-response scratch overflow');
      const v=new Float64Array(memory.buffer,outPtrs[target],game.players[target].ids.length);
      let total=0,priors=game.players[target].priors;
      for(let i=0;i<v.length;i++)total+=priors[i]*v[i];
      return total/game.jointZ;
    },
    profileVector(target,id,reach){
      exports.set_regret_pruning?.(0,0);
      if(typeof exports.set_cache_mode==='function')exports.set_cache_mode(extendedCache?1:0);
      if(typeof exports.set_zero_reach_pruning==='function')exports.set_zero_reach_pruning(game.zeroReachPruning?1:0);
      if(typeof exports.profile_evaluate!=='function')throw Error('Native profile evaluator unavailable');
      new Float64Array(memory.buffer,reachPtrs[target],reach.length).set(reach);
      if(!exports.profile_evaluate(nodePtr,playerPtr,id,target,game.pot,
          reachPtrs[target],outPtrs[target],workspaceStart,memory.buffer.byteLength))
        throw Error('WASM profile EV scratch overflow');
      return Float64Array.from(new Float64Array(memory.buffer,outPtrs[target],game.players[target].ids.length));
    },
    profileEV(target){
      const v=this.profileVector(target,game.root,game.players[1-target].priors);
      const priors=game.players[target].priors;let value=0;
      for(let i=0;i<v.length;i++)value+=priors[i]*v[i];
      return value/game.jointZ;
    },
    nodeDetail(id){
      if(!parents)throw Error('Prepared path metadata unavailable');
      const node=game.nodes[id];
      if(!node||node.terminal||node.chance)return null;
      const target=node.p,mine=game.players[target],opp=game.players[1-target];
      if(node.isoAlias){
        const source=this.nodeDetail(node.isoAlias.source);
        const map=node.isoAlias.map,idx=handIndices[target];
        return {...source,id,player:target,hands:source.hands.map(h=>{
          const i=idx[h[0]];return [mine.ids[map[i]],h[1],h[2],h[3].slice(),h[4].slice()];
        }).sort((a,b)=>a[0]-b[0])};
      }
      const path=[];let cursor=id;
      while(cursor!==game.root){
        const parent=parents.parents[cursor];
        if(parent<0)throw Error('Selected node has no root path');
        path.push([parent,parents.edges[cursor]]);cursor=parent;
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
  }catch(_){full=null;native=null;}
  // Culling requires a native full-tree skip mask. A partial native bridge
  // must not refresh unmasked policies or silently accept a slow alternate.
  if(game.actionPruning?.enabled&&!full)return null;
  // The native evaluators read the unprojected average sums. The JS
  // evaluators use the same increment-constrained policy as the reports.
  const evaluateNative=full&&!game.hasFrequencyIncrements;
  return {
    memory,
    get fusesPolicy(){return !!(full&&fusedPolicy&&(!game.nodeLocks.length||native));},
    get mode(){return game.nodeLocks.length?(native?'wasm-locked-tree-f64':'javascript-locks'):full?'wasm-full-tree-f64':'wasm-f64';},
    simd:simdEnabled&&typeof exports.kernel_features==='function'&&exports.kernel_features()===1,fullTraversal:!!full,
    handlesLocks:!!native,
    refreshLocks:native?.refreshLocks??null,
    evaluateValues:native?.evaluate??null,
    traverse:full?(id,target,reach,weight,returnVector)=>full.run(id,target,reach,weight,returnVector):null,
    profileEV:evaluateNative&&typeof exports.profile_evaluate==='function'?(target)=>full.profileEV(target):null,
    nodeDetail:evaluateNative&&typeof exports.profile_evaluate==='function'?(id)=>full.nodeDetail(id):null,
    exactBest:evaluateNative&&typeof exports.exact_best_response==='function'?(target,regularized)=>full.exactBest(target,regularized):null,
    scratchBytes:memory.buffer.byteLength-start,
    cacheStats:full&&statsPtr!==null?()=>{
      exports.cache_statistics(statsPtr);
      const stats=new Uint32Array(memory.buffer,statsPtr,4);
      return {reachHits:stats[0],reachBuilds:stats[1],showdownHits:stats[2],showdownBuilds:stats[3]};
    }:null,
    allocateVector:allocVector,
    updatePolicy(player,qre){
      const variant=variantFor(game);
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

  function sourceTraversal(){
    const native=options.native;
    if(!native&&(typeof WebAssembly==='undefined'||typeof WASM_LOCK_KERNEL_BYTES!=='string'))return null;
    if(game.stack>0x7fffffff)return null;
    const source=options.simd&&typeof WASM_SOURCE_SIMD_BYTES==='string'?WASM_SOURCE_SIMD_BYTES:WASM_LOCK_KERNEL_BYTES;
    let module;
    if(!native){
      const modules=createCompiledTraversal._sourceModules??=new Map();
      if(!modules.has(source)){
        const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
        modules.set(source,WebAssembly.validate(bytes)?new WebAssembly.Module(bytes):null);
      }
      module=modules.get(source);
      if(!module)return options.simd?createCompiledTraversal(game,base64,limitBytes):null;
    }
    const physical=game.nodes,physicalToPacked=new Int32Array(physical.length).fill(-1),nodes=[],virtual=new WeakMap();
    let maxDepth=0,maxActions=2;
    function packProgram(program){
      if(virtual.has(program))return virtual.get(program);
      const id=nodes.length;
      nodes.push(program);virtual.set(program,id);
      if(!program.pairEquity)for(const edge of program.runouts??[])packProgram(edge.child);
      return id;
    }
    function visit(id,depth){
      let node=physical[id];
      while(node.actions?.length===1)node=physical[node.actions[0].child];
      if(node.type==='all-in'){
        maxDepth=Math.max(maxDepth,depth+2);
        physicalToPacked[id]=physicalToPacked[node.id]=packProgram(node.allInProgram);
        return;
      }
      if(physicalToPacked[node.id]===-1){
        physicalToPacked[node.id]=nodes.length;
        nodes.push(node);
        maxDepth=Math.max(maxDepth,depth);
        maxActions=Math.max(maxActions,node.actions?.length??0);
        for(const edge of node.actions??[])visit(edge.child,depth+1);
        if(node.chance){
          if(node.isoGroups)for(const group of node.isoGroups)visit(group.representative.child,depth+1);
          else for(const edge of node.runouts)visit(edge.child,depth+1);
        }
      }
      physicalToPacked[id]=physicalToPacked[node.id];
    }
    visit(game.root,1);
    const maxN=Math.max(...game.players.map(p=>p.ids.length));
    // Training holds all action CFVs, the decoded policy and the next own
    // reach at an own node. Evaluation can track three output vectors.
    const scratch=Math.ceil(maxDepth*(2*maxActions+5)*maxN*8/64)*64;
    const stack=native?0:Math.max(65536,Math.ceil(maxDepth*4096/65536)*65536);
    const stateOffset=64;
    const stateAligned=Math.ceil((stateOffset+game.stateBytes)/8)*8;
    const lockPointers=new Map();
    function pack(buffer){
      let used=stateAligned;
      const copied=new WeakMap(),payoffs=new WeakMap(),weights=new Map();
      const bytes=buffer?new Uint8Array(buffer):null;
      const view=buffer?new DataView(buffer):null;
      function reserve(size,align=4){
        const at=Math.ceil(used/align)*align;
        used=at+size;
        return at;
      }
      function integers(values){
        const at=reserve(values.length*4);
        if(view)for(let i=0;i<values.length;i++)view.setInt32(at+i*4,values[i],true);
        return at;
      }
      function copy(array){
        if(!array)return 0;
        if(!copied.has(array)){
          const at=reserve(array.byteLength,array.BYTES_PER_ELEMENT);
          if(bytes)bytes.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),at);
          copied.set(array,at);
        }
        return copied.get(array);
      }
      function payoff(layout){
        if(!layout)return 0;
        if(!payoffs.has(layout))payoffs.set(layout,integers([copy(layout.mineOrder),copy(layout.oppOrder),
          copy(layout.groupStart),copy(layout.weakEnd),copy(layout.tieEnd),layout.weakEnd.length]));
        return payoffs.get(layout);
      }
      function weight(value){
        if(!weights.has(value)){
          const at=reserve(8,8);
          view?.setFloat64(at,value,true);
          weights.set(value,at);
        }
        return weights.get(value);
      }
      const playerPtr=integers(game.players.flatMap(p=>[p.ids.length,copy(p.card0),copy(p.card1),copy(p.opponentIndex)]));
      const nodePtr=reserve(nodes.length*22*4);
      const decisionPtr=reserve(nodes.length*8*4);
      const nodeRows=buffer?new Int32Array(buffer,nodePtr,nodes.length*22):null;
      const decisions=buffer?new Int32Array(buffer,decisionPtr,nodes.length*8):null;
      for(const [id,node] of nodes.entries()){
        const kind=node.pairEquity?3:node.terminal?0:node.chance?2:1;
        let childPtr=0,groupCount=0,groupPtr=0;
        if(kind===1)childPtr=integers(node.actions.map(a=>physicalToPacked[a.child]));
        if(kind===2){
          const data=[];
          if(node.isoGroups)for(const group of node.isoGroups){
            const edge=group.representative;
            data.push(physicalToPacked[edge.child],edge.card,integers(group.members.flatMap((member,i)=>
              i===0&&member.outcome===edge?[0,0]:member.maps.map(copy))),group.members.length,weight(edge.weight??1/44));
          }else{
            const identity=integers([0,0]);
            for(const edge of node.runouts)data.push(
              typeof edge.child==='number'?physicalToPacked[edge.child]:virtual.get(edge.child),
              edge.card,identity,1,weight(edge.weight??1/44));
          }
          groupCount=data.length/5;groupPtr=integers(data);
        }
        const valid0=copy(node.valid?.[0]),valid1=copy(node.valid?.[1]);
        const payoff0=node.pairEquity?copy(node.pairEquity):payoff(node.riverPayoff?.[0]);
        const payoff1=payoff(node.riverPayoff?.[1]);
        if(kind===3)groupCount=node.pairDenominator;
        if(nodeRows){
          const offsets=game.banks.map(({Type,offset,length},bank)=>kind===1&&length?
            stateOffset+offset+(bank<4?node.rowOffset:node.scaleOffset)*Type.BYTES_PER_ELEMENT:0);
          nodeRows.set([kind,node.p??-1,node.actions?.length??0,childPtr,groupCount,groupPtr,
            offsets[2],offsets[0],offsets[1],offsets[4]??0,offsets[5]??0,valid0,valid1,payoff0,payoff1,
            node.type==='fold'?node.winner:-1,node.c[0],node.c[1],node.turn??-1,node.river??-1,offsets[3],0],id*22);
        }
        if(kind===1){
          const {map,reps}=node.rowShape;
          const mask=copy(node.lockedMask),rows=copy(map),representatives=copy(reps),fixed=copy(node.lockedRows);
          if(decisions){
            decisions.set([mask,0,-1,node.frequencyUnits??0,rows,representatives,reps.length,fixed],id*8);
            if(mask)lockPointers.set(node.id,{fixed,id});
          }
        }
      }
      const reach=[],own=[],out=[];
      for(let p=0;p<2;p++){
        reach.push(reserve(game.players[1-p].ids.length*8,8));
        own.push(reserve(game.players[p].ids.length*8,8));
        out.push(reserve(game.players[p].ids.length*24,8));
      }
      const workspaceStart=reserve(scratch,8);
      return {nodePtr,decisionPtr,playerPtr,decisions,reach,own,out,workspaceStart,workspaceEnd:used};
    }
    const required=pack().workspaceEnd+stack;
    const pages=Math.ceil(required/65536),capacity=native?required:pages*65536;
    if(capacity>0x7fffffff||limitBytes&&game.memory+capacity-game.stateBytes>limitBytes)return null;
    const memory=native?{buffer:new ArrayBuffer(capacity)}:new WebAssembly.Memory({initial:pages,maximum:pages});
    const buffer=memory.buffer;
    const kernel=native?{
      train_locked:(...args)=>native.train(buffer,...args),
      evaluate_gto:(...args)=>native.evaluate(buffer,...args),
    }:new WebAssembly.Instance(module,{env:{memory}}).exports;
    if(!native)kernel.__stack_pointer.value=capacity;
    if(game.stateStorage)throw Error('Compact compiled state must be allocated by the backend.');
    game.allocateState(new Uint8Array(buffer,stateOffset,game.stateBytes));
    const {nodePtr,decisionPtr,playerPtr,decisions,reach,own,out,workspaceStart,workspaceEnd}=pack(buffer);
    const reachVectors=reach.map((at,p)=>new Float64Array(buffer,at,game.players[1-p].ids.length));
    const outVectors=out.map((at,p)=>new Float64Array(buffer,at,game.players[p].ids.length*3));
    const fused=game.gtoAlgorithm==='dcfr'&&!game.hasFrequencyIncrements;
    const variant=['cfrplus','optimistic'].includes(game.gtoAlgorithm)?0:1;
    const precision=game.deriveCurrent?16:{f64:0,'f32-regret':1,'f32-average':3,f32:7,scaled:12}[game.strategyPrecision];
    const tieFloor=16*Number.EPSILON*Math.max(1,game.pot+game.stack);
    const root=physicalToPacked[game.root];
    const simd=options.simd&&source!==WASM_LOCK_KERNEL_BYTES;
    game.memory+=capacity-game.stateBytes;
    game.packedNodes=nodes.length;
    const bridge={
      memory,fullTraversal:true,handlesLocks:true,sourceOnly:true,fusesPolicy:fused,simd:!!simd,
      mode:(native?'native':simd?'wasm-source-simd':'wasm-source')+'-compact-'+game.strategyPrecision+
        (game.deriveCurrent?'-derived':''),
      scratchBytes:scratch+stack,arenaBytes:capacity,packedBytes:workspaceStart-stateAligned,
      refreshLocks(){
        for(const [physicalId,{fixed,id}] of lockPointers){
          const node=physical[physicalId];
          new Float64Array(buffer,fixed,node.lockedRows.length).set(node.lockedRows);
          decisions[id*8+2]=node.allLocked?node.lockedActions.reduce((bits,on,k)=>bits|(on<<k),0):-1;
        }
      },
      updatePolicy(){}, // The core updates non-fused compact policies.
      traverse(id,target,prior,weight,returnVector){
        const packedId=physicalToPacked[id];
        if(packedId<0)throw Error('CFR requires a canonical traversal root.');
        reachVectors[target].set(prior);
        if(!kernel.train_locked(nodePtr,decisionPtr,playerPtr,packedId,target,game.pot,reach[target],out[target],
          weight?own[target]:0,workspaceStart,workspaceEnd,weight,variant,game._positiveDiscount??1,
          game._negativeDiscount??1,+(fused&&!game.deriveCurrent),tieFloor,precision))throw Error('Compact traversal scratch overflow.');
        if(returnVector)return Float64Array.from(outVectors[target].subarray(0,game.players[target].ids.length));
      },
      evaluateValues(target,includeProfile,includeUnrestricted){
        reachVectors[target].set(game.players[1-target].priors);
        const trackUnrestricted=includeUnrestricted&&game.nodeLocks.some(lock=>lock.player===target);
        if(!kernel.evaluate_gto(nodePtr,decisionPtr,playerPtr,root,target,game.pot,reach[target],out[target],
          workspaceStart,workspaceEnd,+includeProfile,+trackUnrestricted,precision,tieFloor))
          throw Error('Compact best-response scratch overflow.');
        const priors=game.players[target].priors,n=priors.length,values=outVectors[target];
        function total(vector){
          let sum=0;
          for(let i=0;i<n;i++)sum+=priors[i]*values[vector*n+i];
          return sum/game.jointZ;
        }
        const constrained=total(0);
        return {constrained,profile:includeProfile?total(1):null,
          unrestricted:includeUnrestricted?(trackUnrestricted?total(1+Number(includeProfile)):constrained):null};
      },
    };
    bridge.refreshLocks();
    return bridge;
  }
}
