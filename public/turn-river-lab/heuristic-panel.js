/* Heuristic Tester controls for the Solver's Setup view. */
function createHeuristicPanel(tester,multiTester,host) {
  'use strict';
  const $=id=>document.getElementById('heuristic-'+id),panel=document.getElementById('heuristic-tester');
  const {escapeHtml,format,cardText}=host;
  const interval=(bounds,suffix='')=>format(bounds.lower,4)+suffix+' to '+format(bounds.upper,4)+suffix;
  const seconds=ms=>format(ms/1000,2)+' s';
  const side=player=>player===0?'OOP':'IP';
  const scopeLabel=scope=>scope==='fixed-sampled-flop'?'Fixed sampled game':'Exact full flop game';
  const isMulti=()=>$('mode').value==='multi';
  const choiceKey=choice=>JSON.stringify([choice?.player,choice?.history,choice?.actions,choice?.actionTotals]);
  let choices=new Map(),worker=null,cancelling=false,snapshotPending=false,preview=null,baseline=null,rows=[],result=null;
  const multi=createMultiFlopPanel(multiTester,{...host,status,clearPreview,updateControls:renderControls,running:()=>!!worker,
    restoreStudy(saved){
      $('mode').value='multi';$('scope').value=saved.scope;$('target').value=saved.targetWidthPercent;
      $('input').value=JSON.stringify(saved.candidates,null,2);
      $('decision').value=choiceKey(saved.selection);clearPreview();renderActions();
    }});

  function status(text,error=false) {
    $('status').textContent=text;
    $('status').toggleAttribute('data-error',error);
  }
  function clearPreview() {
    preview=null;$('combos').hidden=true;$('preview-table').replaceChildren();
  }
  function selection() {
    const choice=choices.get($('decision').value);
    if(!choice)throw Error('Choose a flop decision with at least two legal actions.');
    return choice;
  }
  function renderActions() {
    const choice=choices.get($('decision').value);
    $('action-labels').textContent=choice?'Legal action labels · '+choice.actions.join(' · '):'Set up a valid flop game with at least one decision.';
  }
  function renderControls() {
    for(const id of ['mode','decision','scope','target','input','example','import','preview','run'])$(id).disabled=!!worker;
    $('example').disabled=$('preview').disabled=$('run').disabled=!!worker||!choices.size;
    $('cancel').hidden=!worker;$('cancel').disabled=cancelling;
    $('export').disabled=isMulti()?(worker?!multi.canSnapshot():!multi.exportable()):!!worker||!result?.baseline;
    $('import').closest('label').setAttribute('aria-disabled',String(!!worker));
    $('results').hidden=isMulti()||!baseline;
    multi.controls(isMulti(),!!worker);
  }
  function refresh() {
    clearPreview();multi.invalidatePlan();
    if(panel.hidden||!panel.open)return;
    const nodes=tester.flopDecisions(host.game()),select=$('decision'),previous=select.value;
    choices=new Map(nodes.map(node=>{
      const choice=tester.decisionDescriptor(node);
      return [choiceKey(choice),choice];
    }));
    select.replaceChildren(...Array.from(choices,([value,choice])=>
      new Option(side(choice.player)+' · '+choice.history.join(' → '),value)));
    if(choices.has(previous))select.value=previous;
    renderActions();renderControls();
  }
  function setVisible(isFlop) {
    panel.hidden=!isFlop;
    if(!isFlop&&worker)cancel();
  }

  function parseCandidates(text) {
    const data=JSON.parse(text);
    const candidates=['PokerTools-heuristic-results-v1',multiTester.format].includes(data?.format)?data.candidates:data;
    if(!Array.isArray(candidates)||!candidates.length)throw Error('Enter a JSON array of one or more candidates.');
    return candidates;
  }
  function startRequest() {
    return {config:host.config(),selection:selection(),scope:$('scope').value,
      candidates:parseCandidates($('input').value),maxIterations:host.maxIterations(),
      targetWidthPercent:$('target').valueAsNumber};
  }
  function loadExample() {
    const {actions}=selection(),passive=actions[0];
    const aggressive=actions.find(action=>/^(Bet|Donk|Raise|All-in) /.test(action))??actions[1];
    const candidates=[
      {name:'Unrestricted control',unrestricted:true},
      {name:'Entire range',rules:[{match:{type:'all'},mix:aggressive}],default:passive},
      {name:'Value and draws',rules:[
        {match:{type:'made',values:['two-pair','trips','straight','flush','full-house','quads','straight-flush']},mix:aggressive},
        {match:{type:'pair',values:['top-pair','overpair']},mix:{[aggressive]:75,[passive]:25}},
        {match:{type:'draw',values:['flush-draw','open-ended']},mix:{[aggressive]:50,[passive]:50}},
      ],default:passive},
    ];
    $('input').value=JSON.stringify(candidates,null,2);
    clearPreview();multi.invalidatePlan();status('Example loaded. Preview the mixes or run the comparison.');
  }
  function previewCombos() {
    // The flop action labels and combo coverage are independent of how
    // later runouts are enumerated. Reuse Setup's tree for this preview.
    const skipBlockedCombos=isMulti()&&$('exact-policy').value==='skip-blocked';
    const ranges=isMulti()?multi.ranges():null;
    const game=ranges?host.previewGame({...tester.referenceConfig({...host.config(),...ranges}),
      flopTurnSamples:1,flopRiverSamples:1}):host.game();
    preview=tester.compileCandidates(game,selection(),parseCandidates($('input').value),{skipBlockedCombos});
    $('preview-candidate').replaceChildren(...preview.compiled.map((candidate,i)=>new Option(candidate.name,String(i))));
    $('preview-candidate').selectedIndex=Math.max(0,preview.compiled.findIndex(candidate=>candidate.lock));
    $('combos').hidden=false;$('combos').open=true;renderPreview();
    status(isMulti()?`Preview uses the Setup flop.${preview.skippedCombos.length?` ${preview.skippedCombos.length} blocked exact references skipped.`:''}`:
      'All candidates validated for this decision.');
  }
  function renderPreview() {
    const candidate=preview?.compiled[$('preview-candidate').selectedIndex];
    if(!candidate)return;
    if(!candidate.lock){
      $('coverage').textContent='Unrestricted control. The baseline supplies its result.';
      $('preview-table').replaceChildren();return;
    }
    const fallbacks=candidate.rows.filter(row=>row.rule===null).length;
    $('coverage').textContent=`${candidate.rows.length} legal combos · ${fallbacks} use the default`;
    $('preview-table').innerHTML='<table class="heuristic-table heuristic-combo-table" aria-label="Compiled combo mixes"><thead><tr><th scope="col">Combo</th><th scope="col">Action mix</th><th scope="col">Match</th></tr></thead><tbody>'+
      candidate.rows.map(row=>{
        const mix=row.mix.flatMap((weight,k)=>weight>0?[escapeHtml(preview.decision.actions[k])+' '+format(weight,2)+'%']:[]).join(' · ');
        return `<tr><td>${escapeHtml(row.combo)}</td><td>${mix}</td><td>${row.rule===null?'Default':'Rule '+row.rule}</td></tr>`;
      }).join('')+'</tbody></table>';
    $('preview-table').scrollTop=0;
  }

  function renderResults() {
    $('results').hidden=isMulti()||!baseline;
    if(!baseline)return;
    $('baseline').textContent=baseline.label+' · Unrestricted Hero EV '+interval(baseline.data.heroBounds)+' chips · '+
      (baseline.data.reached?'target met':'iteration limit')+' · '+baseline.data.backend;
    $('summary').textContent=result?result.config.board.map(cardText).join(' ')+' · '+side(result.decision.player)+' · '+
      (result.cancelled?'Cancelled after ':'Completed in ')+seconds(result.elapsedMs):'';
    function lossCell(bounds,suffix='') {
      return `<td><strong>${format(bounds.estimate,4)}${suffix}</strong><small>${interval(bounds,suffix)}</small></td>`;
    }
    $('result-rows').innerHTML=rows.map(({name,lockedCombos,equilibrium,loss,elapsedMs})=>{
      const close=lockedCombos?(equilibrium.reached?'Target met':'Iteration limit')+' · '+seconds(elapsedMs):'Reused baseline';
      return `<tr><th scope="row">${escapeHtml(name)}<small>${close}</small><small>Hero EV ${interval(equilibrium.heroBounds)}</small></th>`+
        lossCell(loss.chips)+lossCell(loss.potPercent,'%')+'</tr>';
    }).join('');
  }

  function closeWorker() {
    worker?.terminate();worker=null;cancelling=false;snapshotPending=false;multi.stop();renderControls();
  }
  function run(planning=false) {
    if(worker)return;
    if(host.busy())throw Error('Finish or cancel the current Solver run before comparing heuristics.');
    const base=startRequest(),mode=isMulti()?'multi':'single';
    const request=mode==='multi'?multi.request(base,planning):base;
    const current=host.createWorker();
    worker=current;
    if(mode==='multi')multi.begin(planning);
    else {baseline=null;result=null;rows=[];renderResults();}
    renderControls();
    status(mode==='multi'?'Preparing the flop collection…':'Preparing the baseline game…');
    current.onmessage=event=>{
      if(worker!==current)return;
      const message=event.data;
      if(message.type==='heuristic-progress'){
        const progress=message.progress;
        if(mode==='multi'){if(!cancelling)multi.progress(progress);return;}
        if(progress.type==='baseline'){
          baseline={data:progress.baseline,label:scopeLabel(progress.evaluationGame)};renderResults();
        }else if(progress.type==='candidate'){
          rows.push(progress.row);renderResults();
        }else if(!cancelling){
          const phase=progress.index>0?`Candidate ${progress.index} of ${progress.total}`:'Baseline';
          status(progress.type==='preparing'?`${phase} · Preparing ${progress.name}…`:
            `${phase} · ${progress.name} · ${progress.iteration} / ${progress.maxIterations} iterations`);
        }
      }else if(message.type==='heuristic-finished'){
        if(mode==='multi'){
          if(snapshotPending&&message.result.completed.length)
            host.download('PokerTools-heuristic-flops-progress.json',message.result);
          multi.finish(message.result);closeWorker();return;
        }
        result=message.result;rows=result.results;
        if(result.baseline)baseline={data:result.baseline,label:scopeLabel(result.evaluationGame)};
        closeWorker();renderResults();
        status(result.cancelled?'Comparison cancelled.':`Compared ${rows.length} candidates. Values are interval midpoints.`);
      }else if(message.type==='heuristic-prepared'){
        multi.prepared(message.preview);closeWorker();
      }else if(message.type==='heuristic-snapshot'){
        snapshotPending=false;
        host.download('PokerTools-heuristic-flops-progress.json',message.result);
      }else if(message.type==='heuristic-error'){
        closeWorker();status(message.message,true);
      }
    };
    current.onerror=event=>{
      if(worker!==current)return;
      event.preventDefault();closeWorker();status(event.message||'Could not start the Solver worker.',true);
    };
    try{current.postMessage({type:'heuristic-start',request,mode,planning});}catch(error){closeWorker();throw error;}
  }
  function cancel() {
    if(!worker||cancelling)return;
    cancelling=true;renderControls();status('Cancelling after the current worker batch…');
    worker.postMessage({type:'heuristic-cancel'});
  }
  function attempt(action) {
    return ()=>{try{action();}catch(error){status(error.message,true);}};
  }

  panel.addEventListener('toggle',()=>{if(panel.open)refresh();});
  $('mode').addEventListener('change',()=>{clearPreview();renderControls();status('');});
  $('decision').addEventListener('change',()=>{clearPreview();multi.invalidatePlan();renderActions();});
  $('scope').addEventListener('change',()=>{clearPreview();multi.invalidatePlan();});
  $('target').addEventListener('input',multi.invalidatePlan);
  $('input').addEventListener('input',()=>{clearPreview();multi.invalidatePlan();});
  $('example').addEventListener('click',attempt(loadExample));
  $('preview').addEventListener('click',attempt(previewCombos));
  $('preview-candidate').addEventListener('change',renderPreview);
  $('run').addEventListener('click',attempt(run));
  $('plan-button').addEventListener('click',attempt(()=>run(true)));
  $('cancel').addEventListener('click',cancel);
  $('export').addEventListener('click',()=>{
    if(isMulti()&&worker){
      if(!snapshotPending){snapshotPending=true;worker.postMessage({type:'heuristic-export'});}
    }
    else if(isMulti()&&multi.exportable())host.download('PokerTools-heuristic-flops.json',multi.exportData());
    else if(!isMulti()&&result?.baseline)host.download('PokerTools-heuristic-results.json',result);
  });
  $('import').addEventListener('change',async event=>{
    const input=event.currentTarget,file=input.files?.[0];
    try{
      if(!file)return;
      const candidates=parseCandidates(await file.text());
      if(worker)return;
      $('input').value=JSON.stringify(candidates,null,2);clearPreview();multi.invalidatePlan();status('Candidates imported.');
    }catch(error){status(error.message,true);}finally{input.value='';}
  });
  return {refresh,setVisible,invalidatePlan:multi.invalidatePlan,running:()=>!!worker};
}
