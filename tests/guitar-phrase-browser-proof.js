import assert from 'node:assert/strict';
import {originalGuitarPhraseStudy,GUITAR_PHRASE_SCOPE,GUITAR_PHRASE_OLD_SCOPE,GUITAR_PHRASE_LOCKS} from './guitar-phrase-fixture.js';

export const GUITAR_PHRASE_BROWSER_CASE='real guitar written phrase preserves exact union and fences both Rust request phases';
export const GUITAR_PHRASE_REPORT='worldmusichub-guitar-phrase.json';
export const GUITAR_PHRASE_RACES=['inventory','plan'].flatMap(phase=>['apply','revert','source','parts'].map(action=>({phase,action})));
export const GUITAR_PHRASE_PROFILE={kind:'guitar',tuning:[64,59,55,50,45,40],frets:5,capo:0};
const sorted=values=>[...values].sort();
const sources=notes=>notes.flatMap(note=>note.source_note_ids);

export function assertPhraseCompilation(compilation,score=originalGuitarPhraseStudy()) {
  assert.deepEqual(compilation.score,score);
  assert.equal(compilation.timeline.duration_ms,8000);
  const notes=compilation.timeline.notes;
  assert.equal(notes.length,5);assert.equal(new Set(notes.map(note=>note.id)).size,5);
  for(const [ids,part,midi,start,end] of [
    [['outside-before'],'A',60,0,2500], [['entry-e','entry-e-tail'],'A',64,1000,5000],
    [['inside-g'],'B',67,3000,4500], [['outside-after'],'A',45,4000,5000], [['machine-d'],'C',50,2750,3750],
  ]) {
    const note=notes.find(note=>note.source_note_ids.includes(ids[0]));assert.ok(note);
    assert.deepEqual(note.source_note_ids,ids);assert.equal(note.part_id,part);assert.equal(note.midi,midi);
    assert.equal(note.start_ms,start);assert.equal(note.start_ms+note.duration_ms,end);
  }
  return notes;
}

export function expectedPhraseInventory(compilation,ids,scope) {
  const all=compilation.timeline.notes.filter(note=>ids.includes(note.part_id));
  const start=scope.from.numerator/scope.from.denominator*1000,end=scope.to.numerator/scope.to.denominator*1000;
  // Independent fixture oracle, not application membership inference. This
  // original 60-BPM fixture has exactly representable half/quarter-beat bounds.
  const included=all.filter(note=>note.start_ms<end&&note.start_ms+note.duration_ms>start);
  return {requested:scope,start_ms:start,end_ms:end,full_occurrence_count:all.length,selected_occurrence_count:included.length,included_occurrence_ids:included.map(note=>note.id),entry_hold_occurrence_ids:included.filter(note=>note.start_ms<start).map(note=>note.id)};
}

export function assertPhraseExchange(row,compilation,{ids=['A','B'],scope=null,locks=[],inventory=false}={}) {
  assert.equal(row.path,'/api/fingering/guitar');assert.equal(row.httpStatus,200);
  assert.deepEqual(row.request,{score:compilation.score,part_id:null,profile:GUITAR_PHRASE_PROFILE,selected_part_ids:ids,max_fret_span:3,locks,...(scope?{planning_scope:scope,...(inventory?{inventory_only:true}:{})}:{})});
  const plan=row.plan;
  assert.equal(plan.version,1);assert.equal(plan.algorithm,'deterministic_guitar_beam_v1');
  assert.equal(plan.score_id,compilation.score.id);assert.equal(plan.part_id,null);assert.deepEqual(plan.selected_part_ids,ids);
  assert.deepEqual(plan.profile,GUITAR_PHRASE_PROFILE);assert.equal(plan.changed_source_notes,false);
  assert.equal(plan.max_fret_span,3);assert.deepEqual(plan.requested_locks,locks);
  assert.equal(plan.beam_width,64);assert.ok(Number.isSafeInteger(plan.explored_choices)&&plan.explored_choices>=0&&plan.explored_choices<=2000000);assert.equal(typeof plan.beam_pruned,'boolean');
  const selected=compilation.timeline.notes.filter(note=>ids.includes(note.part_id));
  let expected=selected;
  if(scope){
    const wanted=expectedPhraseInventory(compilation,ids,scope);
    assert.deepEqual(plan.planning_scope,wanted);assert.equal(plan.purpose,inventory?'scope_inventory':'phrase_plan');
    expected=selected.filter(note=>wanted.included_occurrence_ids.includes(note.id));
  }else{assert.equal(plan.planning_scope,undefined);assert.equal(plan.purpose,undefined);}
  assert.equal(plan.source_occurrence_count,expected.length);
  assert.equal(plan.status,inventory?'unavailable':'ready');assert.equal(plan.complete,!inventory);
  if(inventory){assert.deepEqual(plan.assignments,[]);assert.equal(plan.objective_cost,null);assert.ok(plan.diagnostics.some(row=>row.code==='guitar_fingering_scope_inventory'));return;}
  assert.ok(Number.isSafeInteger(plan.objective_cost)&&plan.objective_cost>=0);
  assert.deepEqual(sorted(plan.assignments.map(choice=>choice.occurrence_id)),sorted(expected.map(note=>note.id)));
  for(const choice of plan.assignments){
    const note=expected.find(note=>note.id===choice.occurrence_id);assert.ok(note);
    for(const key of ['part_id','midi','start_ms'])assert.equal(choice[key],note[key]);
    assert.equal(choice.end_ms,note.start_ms+note.duration_ms);assert.deepEqual(choice.source_note_ids,note.source_note_ids);
    assert.equal(plan.profile.tuning[choice.string-1]+choice.fret,choice.midi);
    assert.ok(Number.isInteger(choice.fret)&&choice.fret>=0&&choice.fret<=5);assert.ok(Number.isInteger(choice.finger)&&choice.finger>=0&&choice.finger<=4);
    assert.equal(choice.finger===0,choice.fret===0);
    for(const lock of locks.filter(lock=>choice.source_note_ids.includes(lock.source_note_id)))for(const key of ['string','fret','finger'])assert.equal(choice[key],lock[key]);
    for(const other of plan.assignments)if(other!==choice&&choice.start_ms<other.end_ms&&other.start_ms<choice.end_ms)assert.notEqual(choice.string,other.string,'Every held human occurrence reserves its string through the original tail');
  }
}

export function assertPhraseUi(ui,plan,{draft=false,all=false}={}) {
  assert.equal(ui.instrument,'guitar');assert.equal(ui.mode,'practice');assert.equal(ui.firstPart,all?'':'A');
  assert.ok(ui.cards.length>0,'Real current/upcoming cards must be present');
  if(draft){assert.equal(ui.status,'draft');assert.equal(ui.recommendedCount,0);}
  else {assert.equal(ui.status,'ready');assert.ok(ui.cards.some(card=>card.route.length>0),'At least one actual card must show the accepted route');assert.ok(ui.liveAssignments.length>0,'The actual current/next route must contain accepted assignments');}
  for(const card of ui.cards){
    assert.ok(card.occurrenceIds.length>0);
    for(const id of card.occurrenceIds){
      const choice=plan?.assignments.find(choice=>choice.occurrence_id===id);
      assert.deepEqual(card.route,draft||!choice?[]:[{string:choice.string,fret:choice.fret,finger:choice.finger}]);
      if(choice)assert.deepEqual(card.sourceIds,choice.source_note_ids);
    }
  }
  if(draft)assert.equal(ui.liveAssignments.length,0);
  for(const choice of ui.liveAssignments)assert.deepEqual(choice,plan.assignments.find(item=>item.occurrence_id===choice.occurrence_id));
}

export function assertGuitarPhraseReport(report) {
  assert.equal(report.version,1);assert.equal(report.scenario,'guitar-written-phrase');assert.equal(report.ok,true);
  for(const key of ['physical_midi_verified','physical_fingering_verified','global_optimum_claimed','accepted_package','windows_native_verified'])assert.equal(report[key],false);
  assert.equal(report.original_fixtures_only,true);
  assert.match(report.source.sha,/^[a-f0-9]{40}$/);assert.match(report.source.tree,/^[a-f0-9]{40}$/);assert.match(report.source.server_sha256,/^[a-f0-9]{64}$/);
  const notes=assertPhraseCompilation(report.compilation);
  assertPhraseExchange(report.whole,report.compilation);
  assertPhraseExchange(report.locked,report.compilation,{locks:GUITAR_PHRASE_LOCKS});
  assertPhraseExchange(report.inventory,report.compilation,{scope:GUITAR_PHRASE_SCOPE,inventory:true});
  assertPhraseExchange(report.phrase,report.compilation,{scope:GUITAR_PHRASE_SCOPE,locks:[GUITAR_PHRASE_LOCKS[0]]});
  assert.deepEqual(report.inventory.plan.planning_scope,report.phrase.plan.planning_scope);
  const held=report.phrase.plan.assignments.find(choice=>choice.source_note_ids.includes('entry-e'));
  assert.equal(held.string,2);assert.equal(held.fret,5);assert.equal(held.start_ms,1000);assert.equal(held.end_ms,5000);assert.deepEqual(held.source_note_ids,['entry-e','entry-e-tail']);
  assert.deepEqual(report.phrase.plan.assignments.find(choice=>choice.source_note_ids.includes('inside-g')).end_ms,4500);
  assertPhraseUi(report.phrase.ui,report.phrase.plan);
  assert.match(report.phrase.ui.phraseStatus,/2 of 4 occurrences · 1 entry holds/);
  assert.match(report.phrase.ui.lockStatus,/2 session locks; 1 apply/);assert.match(report.phrase.ui.lockList,/outside-after:.*outside this planning phrase; stored, inactive/);
  assert.deepEqual(sorted(report.phrase.ui.lockSources),sorted(sources(notes.filter(note=>['A','B'].includes(note.part_id)))));
  assert.equal(report.invalid.from,'1/0');assert.equal(report.invalid.requests.length,0);assert.match(report.invalid.ui.phraseStatus,/denominator/);assertPhraseUi(report.invalid.ui,null,{draft:true});
  assertPhraseExchange(report.reverted.inventory,report.compilation,{scope:GUITAR_PHRASE_SCOPE,inventory:true});
  assertPhraseExchange(report.reverted.plan,report.compilation,{scope:GUITAR_PHRASE_SCOPE,locks:[GUITAR_PHRASE_LOCKS[0]]});
  assert.equal(report.reverted.ui.from,'5/2');assert.equal(report.reverted.ui.to,'4');assertPhraseUi(report.reverted.ui,report.reverted.plan.plan);
  assert.deepEqual(report.reverted.plan.plan.assignments,report.phrase.plan.assignments);
  assert.ok(report.before.take.passes.some(pass=>pass.inputs.length===1));
  const take=report.before.take.passes.find(pass=>pass.inputs.length===1);
  assert.equal(report.assessment.path,'/api/assess');assert.equal(report.assessment.httpStatus,200);
  assert.deepEqual(report.assessment.request.timeline,take.timeline);assert.deepEqual(report.assessment.request.inputs,take.inputs);
  assert.equal(report.assessment.request.tolerance_ms,180);assert.deepEqual(take.assessment,report.assessment.result);
  assert.equal(take.revision,1);assert.equal(take.assessed_revision,take.revision);assert.equal(take.pending,false);
  assert.equal(take.assessment.hits.length+take.assessment.misses.length,4);assert.equal(take.assessment.hits.length+take.assessment.extras.length,1);
  assert.deepEqual(report.before.take.practice_selection,{kind:'parts',part_ids:['A','B']});
  assert.equal(report.before.take.target_plan.source_note_count,4);
  assert.deepEqual(sorted(report.before.take.target_plan.groups.flatMap(group=>group.source_occurrence_ids)),sorted(notes.filter(note=>['A','B'].includes(note.part_id)).map(note=>note.id)));
  assert.deepEqual(report.after,report.before,'Phrase, lock, invalid draft and Revert preserve source, take, scoring, clock and playback loop');
  assert.deepEqual(report.before.score,originalGuitarPhraseStudy());assert.equal(report.before.clock.running,false);assert.equal(report.before.clock.phase,'paused');
  const view=report.routeSnapshot,position=report.before.clock.positionMs;assert.deepEqual(view.clock,report.before.clock);assert.equal(view.controlsClosed,true);
  const current=report.phrase.plan.assignments.filter(choice=>choice.start_ms<=position&&choice.end_ms>position),nextAt=Math.min(...notes.filter(note=>['A','B'].includes(note.part_id)&&note.start_ms>position).map(note=>note.start_ms));
  const next=[...current.filter(choice=>choice.end_ms>nextAt),...report.phrase.plan.assignments.filter(choice=>choice.start_ms===nextAt)];
  assert.ok(current.length+next.length>0,'The fixture must expose a visible accepted current/next route');
  for(const [markers,expected]of [[view.current,current],[view.next,next]]){
    assert.deepEqual(sorted(markers.flatMap(marker=>marker.occurrences)),sorted(expected.map(choice=>choice.occurrence_id)));
    for(const marker of markers){assert.equal(marker.painted,true);assert.ok(marker.fraction>=.98&&marker.width>=20&&marker.height>=24,'Chosen route labels are readable inside actual clipping ancestors');assert.deepEqual(marker.assignments,expected.filter(choice=>marker.occurrences.includes(choice.occurrence_id)));assert.deepEqual(sorted(marker.sources),sorted(sources(marker.assignments)));assert.ok(marker.text.trim().length>2);assert.ok(marker.accessible.includes(marker.sources[0]));}
  }
  assert.deepEqual(report.phraseRequests.map(row=>row.path),['/api/fingering/guitar','/api/fingering/guitar']);
  assert.deepEqual(report.phraseRequests.map(row=>JSON.parse(row.body)),[report.inventory.request,report.phrase.request]);
  assert.deepEqual(report.races.map(({phase,action})=>({phase,action})),GUITAR_PHRASE_RACES);
  for(const race of report.races){
    const score=originalGuitarPhraseStudy(race.action==='source'?`-${race.phase}`:'');
    assertPhraseCompilation(race.compilation,score);
    assertPhraseExchange(race.stale,report.compilation,{scope:GUITAR_PHRASE_OLD_SCOPE,inventory:race.phase==='inventory'});
    const ids=race.action==='source'?['A','B','C']:race.action==='parts'?['A','C']:['A','B'];
    const scope=race.action==='source'?null:race.action==='apply'?GUITAR_PHRASE_SCOPE:GUITAR_PHRASE_OLD_SCOPE;
    assertPhraseExchange(race.replacement,race.compilation,{ids,scope,inventory:!!scope});
    assertPhraseExchange(race.final,race.compilation,{ids,scope});
    assert.ok(race.replacement.ordinal>race.stale.ordinal);
    assert.ok(['fulfilled','aborted'].includes(race.staleRelease));
    assert.equal(race.beforeRelease.status,'loading');assert.equal(race.afterRelease.status,'loading');
    for(const ui of [race.beforeRelease,race.afterRelease]){assert.equal(ui.recommendedCount,0);assert.equal(ui.liveAssignments.length,0);assert.ok(ui.cards.every(card=>card.route.length===0));}
    assert.deepEqual(race.afterRelease,race.beforeRelease,'An old response cannot replace even a pending new generation');
    assertPhraseUi(race.final.ui,race.final.plan,{all:race.action==='source'});assert.equal(race.final.ui.from,scope?`${scope.from.numerator}${scope.from.denominator===1?'':'/'+scope.from.denominator}`:'0');
    assert.deepEqual(race.scoreExport,score);
    // Neither the held inventory nor its held plan may generate another final
    // request after cancellation. Revert can reuse the same exact range, so
    // serial request evidence, not scope equality, distinguishes generations.
    assert.deepEqual(race.newRequestsWhileReplacementHeld,[]);
  }
  assert.deepEqual(report.screenshots.map(row=>row.name),['worldmusichub-guitar-phrase-ready.png','worldmusichub-guitar-phrase-route.png','worldmusichub-guitar-phrase-invalid.png']);
  for(const shot of report.screenshots){assert.equal(shot.width,1440);assert.equal(shot.height,1100);assert.ok(shot.bytes>100&&shot.bytes<=8*1024*1024);assert.match(shot.sha256,/^[a-f0-9]{64}$/);}
  return report;
}
