/* Collection inputs and results for the multi-flop mode of Heuristic Tester. */
function createMultiFlopPanel(tester,host) {
  'use strict';
  const $=id=>document.getElementById('heuristic-'+id);
  const {escapeHtml,format,status}=host,boardText=tester.boardText;
  const pct=(value,digits=4)=>format(value,digits)+'%';
  const mass=value=>pct(100*value);
  const bounds=(value,digits=4)=>format(value.lower,digits)+' to '+format(value.upper,digits);
  const pageSize=20;
  let result=null,resume=null,previewed=null,ranges=null,page=0,timer=null,started=0,progressText='',liveCompleted=0;

  function invalidatePlan() {
    previewed=null;$('plan').textContent='';
  }
  function settings() {
    const mode=$('collection').value;
    return {collection:{mode,...(mode==='selected'?{boards:$('board-list').value}:{})},
      collapse:$('collapse').checked,exactComboPolicy:$('exact-policy').value,
      thresholds:$('thresholds').value.split(',').map(value=>value.trim()).filter(Boolean).map(Number)};
  }
  function request(base,preview) {
    const options=settings();
    if(!preview&&options.collection.mode==='all'&&!previewed)
      throw Error('Preview the all-flop collection to see the solve count before running it.');
    return {...base,...options,config:ranges?{...base.config,...ranges}:base.config,resume,
      confirmedFingerprints:previewed?.fingerprints};
  }
  function controls(active,busy) {
    $('multi-settings').hidden=!active;
    $('listed-boards').hidden=$('collection').value!=='selected';
    $('multi-results').hidden=!active||!result;
    $('multi-progress').hidden=!active||(!busy&&!progressText);
    $('export-csv').hidden=!active;$('export-csv').disabled=busy||!result;
    for(const id of ['collection','exact-policy','board-list','default-boards','board-import','collapse',
      'thresholds','plan-button','resume','clear-resume','range-import','clear-ranges'])$(id).disabled=busy;
    $('clear-resume').hidden=$('resume-note').hidden=!resume;
    $('clear-ranges').hidden=!ranges;
    $('range-note').textContent=ranges?'Using the imported preflop range weights.':'Using the range weights from Setup.';
  }
  function label(plan) {
    return plan.population==='complete-population'?'Complete flop population':'Selected flop subset';
  }
  function describePlan(plan) {
    return `${label(plan)} · ${plan.solveCount.toLocaleString()} solves for ${plan.physicalBoards.toLocaleString()} physical flops`+
      ` · ${mass(plan.probabilityCoverage)} of total probability`+
      (plan.zeroBoards?` · ${plan.zeroBoards.toLocaleString()} zero-probability flops`:'');
  }
  function prepared(preview) {
    previewed=preview;
    $('plan').textContent=preview?describePlan(preview.plan)+` · ${preview.plan.suitPermutations} verified suit permutations.`:'';
    status(preview?'Collection ready. Run the comparison to start solving.':'Collection preview cancelled.');
  }
  function displayTime() {
    $('multi-progress').textContent=progressText+' · '+format((performance.now()-started)/1000,1)+' s elapsed';
  }
  function begin(preview) {
    if(!preview){result=null;page=0;}
    liveCompleted=0;progressText='Preparing flop collection';started=performance.now();displayTime();
    timer=setInterval(displayTime,500);
  }
  function stop() {clearInterval(timer);timer=null;progressText='';liveCompleted=0;$('multi-progress').hidden=true;}
  function progress(event) {
    if(event.type==='multi-planning'){
      progressText=`Checked ${event.scanned.toLocaleString()} of ${event.total.toLocaleString()} flops`;
    }else{
      progressText=`${event.completed} of ${event.total} solves complete · ${event.failed} failed · ${mass(event.completedCoverage)} population coverage`;
      if(event.type==='multi-ready')$('plan').textContent=describePlan(event.plan);
      if(liveCompleted!==event.completed){liveCompleted=event.completed;host.updateControls();}
    }
    displayTime();
    if(event.board){
      const phase=event.solve?.name??(event.type==='multi-board-failed'?'Board failed':'Preparing board');
      const step=event.solve?.type==='solving'?` · ${event.solve.iteration} / ${event.solve.maxIterations} iterations`:'';
      status(`Flop ${event.index} of ${event.total} · ${boardText(event.board)} · ${phase}${step}`);
    }
  }

  function percentLoss(value) {
    return `<strong>${pct(value.estimate)}</strong><small>${bounds(value)}% pot</small>`;
  }
  function renderAggregate() {
    const rows=result.aggregate;
    $('ranking-note').hidden=$('aggregate-table').hidden=!rows.length;
    $('aggregate-rows').innerHTML=rows.map(row=>{
      const best=`Best ${boardText(row.best.board)} · ${pct(row.best.loss.potPercent.estimate)}`;
      const worst=`Worst ${boardText(row.worst.board)} · ${pct(row.worst.loss.potPercent.estimate)}`;
      const below=row.below.map(item=>`<small>&lt; ${pct(item.threshold,3)} pot · ${pct(item.estimate,2)}`+
        `<br>${bounds(item,2)}% of mass</small>`).join('');
      return `<tr><th scope="row">${escapeHtml(row.name)}<small>Median ${format(row.medianChips,4)} chips</small>`+
        `<small>${best}</small><small>${worst}</small></th><td>${percentLoss(row.loss.potPercent)}`+
        `<small>${format(row.loss.chips.estimate,4)} chips<br>${bounds(row.loss.chips)} chips</small></td><td>${below}</td></tr>`;
    }).join('');
  }
  function renderBoards() {
    if(!result?.completed.length)return;
    const index=$('board-candidate').selectedIndex,sort=$('board-sort').value;
    const rows=result.completed.map(board=>({board,row:board.results[index]}));
    const loss=item=>item.row.loss.potPercent.estimate;
    if(sort==='mass')rows.sort((a,b)=>b.board.probability-a.board.probability);
    else if(sort==='best')rows.sort((a,b)=>loss(a)-loss(b));
    else if(sort==='worst')rows.sort((a,b)=>loss(b)-loss(a));
    else rows.sort((a,b)=>boardText(a.board.board).localeCompare(boardText(b.board.board)));
    const start=page*pageSize,end=Math.min(rows.length,start+pageSize);
    $('board-rows').innerHTML=rows.slice(start,end).map(({board,row})=>{
      const group=board.multiplicity>1?`<small>${board.multiplicity} equivalent flops</small>`:'';
      const skipped=board.skippedCombos.filter(combo=>combo.candidate===row.name);
      const warning=skipped.length?`<small>Skipped ${escapeHtml(skipped.map(combo=>combo.combo).join(', '))}</small>`:'';
      const accuracy=row.lockedCombos&&!row.equilibrium.reached?'<small>Iteration limit</small>':'';
      return `<tr><th scope="row">${boardText(board.board)}${group}${warning}</th><td>${mass(board.probability)}</td>`+
        `<td>${percentLoss(row.loss.potPercent)}${accuracy}</td></tr>`;
    }).join('');
    $('board-pagination').hidden=rows.length<=pageSize;
    $('board-page').textContent=`${start+1}–${end} of ${rows.length}`;
    $('prev-page').disabled=page===0;$('next-page').disabled=end===rows.length;
  }
  function finish(study) {
    if(!study.plan){status('Comparison cancelled.');return;}
    result=study;
    const scope=study.evaluationGame==='full-flop'?'Exact full runouts':'Fixed sampled runouts';
    $('multi-summary').textContent=`${scope} · ${describePlan(study.plan)}.`+
      ` Completed ${study.completedPhysicalBoards} physical flops, ${mass(study.completedCoverage)} of total probability`+
      ` and ${pct(100*study.completedCoverage/study.plan.probabilityCoverage,2)} of collection mass.`+
      (study.resumed?` Reused ${study.resumed} completed solves.`:'')+
      ` ${format(study.elapsedMs/1000,2)} s this run.`;
    renderAggregate();
    $('per-flop').hidden=!study.completed.length;
    if(study.completed.length){
      $('board-candidate').replaceChildren(...study.completed[0].results.map(row=>new Option(row.name,row.name)));
      renderBoards();
    }
    const issues=study.failed.map(row=>`${boardText(row.board)} · ${row.message}`).concat(
      study.plan.unplayable.map(board=>`${boardText(board)} · Zero probability in the original ranges`));
    $('issues').hidden=issues.length===0;
    $('issue-count').textContent=`${study.failed.length} failed solves · ${study.plan.zeroBoards} zero-probability flops`;
    $('issue-list').innerHTML=issues.slice(0,50).map(issue=>`<li>${escapeHtml(issue)}</li>`).join('')+
      (issues.length>50?'<li>See the JSON export for the full list.</li>':'');
    status(study.cancelled?'Comparison cancelled. Completed boards are available to export.':
      `Compared ${study.completed.length} of ${study.plan.solveCount} planned flop solves.`);
  }

  function importFile(id,accept) {
    $(id).addEventListener('change',async event=>{
      const input=event.currentTarget,file=input.files?.[0];
      try{if(file){const data=JSON.parse(await file.text());if(!host.running())accept(data);}}
      catch(error){status(error.message,true);}finally{input.value='';}
    });
  }
  function setBoards(boards) {
    $('board-list').value=tester.readBoards(boards).map(boardText).join('\n');
    $('collection').value='selected';invalidatePlan();host.updateControls();
  }
  importFile('board-import',data=>{setBoards(Array.isArray(data)?data:data?.boards);status('Flops imported.');});
  importFile('range-import',data=>{
    const {weights0,weights1}=data?.config??data??{};
    const {ranges:original}=tester.flopProbabilities(weights0,weights1);
    ranges={weights0:original[0].raw,weights1:original[1].raw};
    invalidatePlan();host.clearPreview();host.updateControls();status('Original ranges imported for this study.');
  });
  importFile('resume',data=>{
    if(data?.format!==tester.format||!Array.isArray(data.completed)||!Array.isArray(data.candidates)||
       !Array.isArray(data.thresholds)||!['selected','all'].includes(data.collection?.mode)||
       !['full','fixed'].includes(data.scope)||!['strict','skip-blocked'].includes(data.exactComboPolicy))
      throw Error('Choose a Heuristic Tester multi-flop results JSON file.');
    if(data.collection.mode==='selected')setBoards(data.collection.boards);
    $('collection').value=data.collection.mode;$('collapse').checked=!!data.collapse;
    $('exact-policy').value=data.exactComboPolicy;$('thresholds').value=data.thresholds.join(', ');
    resume=data;invalidatePlan();host.restoreStudy(data);
    $('resume-note').textContent=`Loaded ${data.completed.length} completed solves. Use the same Solver setup and ${data.maxIterations} iteration limit.`;
    host.updateControls();status('Saved run loaded. Its settings will be checked before reusing any board.');
  });
  $('clear-resume').onclick=()=>{resume=null;host.updateControls();status('Saved run cleared.');};
  $('clear-ranges').onclick=()=>{ranges=null;invalidatePlan();host.clearPreview();host.updateControls();};
  $('default-boards').onclick=()=>setBoards(tester.representativeFlops);
  $('collection').onchange=()=>{invalidatePlan();host.updateControls();};
  for(const id of ['collapse','exact-policy','board-list'])$(id).addEventListener('input',invalidatePlan);
  for(const id of ['board-candidate','board-sort'])$(id).onchange=()=>{page=0;renderBoards();};
  $('prev-page').onclick=()=>{page--;renderBoards();};
  $('next-page').onclick=()=>{page++;renderBoards();};
  $('export-csv').onclick=()=>{if(result)host.downloadText('PokerTools-heuristic-flops.csv',tester.toCsv(result),'text/csv;charset=utf-8');};
  return {request,controls,invalidatePlan,prepared,begin,stop,progress,finish,exportable:()=>!!result,
    exportData:()=>result,ranges:()=>ranges,canSnapshot:()=>liveCompleted>0};
}
