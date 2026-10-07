import assert from 'node:assert/strict';
import {originalGuitarUnionStudy} from './guitar-union-fixture.js';

export const GUITAR_UNION_BROWSER_CASE='real guitar human union replans held strings across Mod subsets and explicit All';
export const GUITAR_UNION_REPORT='worldmusichub-guitar-human-union.json';
export const GUITAR_UNION_VIEWPORTS=Object.freeze([{width:1280,height:720},{width:844,height:390}]);
export const guitarUnionScreenshot=(scope,viewport)=>`worldmusichub-guitar-human-union-${scope}-${viewport.width}x${viewport.height}.png`;
const sorted=items=>[...items].sort();
const sourceIds=notes=>notes.flatMap(note=>note.source_note_ids);

export function assertGuitarUnionState(row,compilation,ids,{blocked=false}={}) {
  assert.equal(row.path,'/api/fingering/guitar');assert.equal(row.httpStatus,200);
  const {request,plan,ui}=row,score=originalGuitarUnionStudy();
  assert.deepEqual(request.score,score,'The real Rust request retains all three source parts');
  assert.equal(request.part_id,null);assert.deepEqual(request.selected_part_ids,ids);
  assert.deepEqual(request.profile,{kind:'guitar',tuning:[64,59,55,50,45,40],frets:5,capo:0});
  assert.equal(request.max_fret_span,3);assert.equal(request.inventory_only,undefined);assert.equal(request.planning_scope,undefined);
  assert.equal(plan.version,1);assert.equal(plan.algorithm,'deterministic_guitar_beam_v1');assert.equal(plan.score_id,score.id);
  assert.deepEqual(plan.selected_part_ids,ids);assert.equal(plan.part_id,null);assert.deepEqual(plan.profile,request.profile);assert.equal(plan.changed_source_notes,false);
  assert.equal(plan.max_fret_span,request.max_fret_span);assert.deepEqual(plan.requested_locks,request.locks);
  const expected=compilation.timeline.notes.filter(note=>ids.includes(note.part_id));
  assert.equal(plan.source_occurrence_count,expected.length);assert.equal(plan.complete,!blocked);
  assert.equal(plan.status,blocked?'infeasible_under_model':'ready');
  assert.equal(ui.status,plan.status);
  assert.equal(ui.scope,`Human parts: ${score.parts.filter(part=>ids.includes(part.id)).map(part=>part.name).join(', ')} · ${expected.length} source occurrences in this selection`);
  assert.deepEqual(sorted(ui.lockSources),sorted(sourceIds(expected)),'The source chooser covers every selected occurrence and excludes machine parts');
  assert.equal(ui.mode,'practice');assert.equal(ui.firstPart,ids.length===score.parts.length?'':ids[0]);
  assert.deepEqual(ui.humanPartIds,ids);
  if(blocked){
    assert.deepEqual(plan.assignments,[]);assert.equal(plan.objective_cost,null);
    assert.ok(plan.diagnostics.some(item=>item.code==='guitar_fingering_incomplete'));
    assert.match(ui.diagnostics,/held-e/);assert.match(ui.diagnostics,/later-g/);assert.doesNotMatch(ui.diagnostics,/middle-c/);
    assert.equal(ui.recommendedCount,0);
  }else{
    assert.deepEqual(sorted(plan.assignments.map(choice=>choice.occurrence_id)),sorted(expected.map(note=>note.id)));
    for(const choice of plan.assignments){
      const note=expected.find(note=>note.id===choice.occurrence_id);assert.ok(note);
      assert.equal(choice.part_id,note.part_id);assert.equal(choice.midi,note.midi);assert.deepEqual(choice.source_note_ids,note.source_note_ids);
      assert.equal(choice.start_ms,note.start_ms);assert.equal(choice.end_ms,note.start_ms+note.duration_ms);
      assert.equal(plan.profile.tuning[choice.string-1]+choice.fret+plan.profile.capo,choice.midi);
    }
    for(const [index,choice]of plan.assignments.entries())for(const other of plan.assignments.slice(index+1))if(choice.start_ms<other.end_ms&&other.start_ms<choice.end_ms)assert.notEqual(choice.string,other.string,'Overlapping human notes reserve distinct strings');
  }
  assert.ok(ui.cards.length>0);
  for(const card of ui.cards){
    const note=expected.find(note=>note.id===card.id);assert.ok(note,'No machine-only card is admitted');
    assert.deepEqual(card.occurrenceIds,[note.id]);assert.deepEqual(card.sourceIds,note.source_note_ids);
    const choice=plan.assignments.find(choice=>choice.occurrence_id===note.id);
    assert.deepEqual(card.route,blocked?[]:[{string:choice.string,fret:choice.fret,finger:choice.finger}]);
  }
  return expected;
}

export function assertGuitarUnionReport(report) {
  assert.equal(report.version,1);assert.equal(report.scenario,'guitar-human-union');
  assert.equal(report.original_fixtures_only,true);assert.equal(report.physical_midi_verified,false);assert.equal(report.physical_fingering_verified,false);assert.equal(report.global_optimum_claimed,false);
  const score=originalGuitarUnionStudy();assert.deepEqual(report.compilation.score,score);
  const notes=report.compilation.timeline.notes;
  assert.equal(notes.length,3);assert.equal(new Set(notes.map(note=>note.id)).size,3);
  for(const [partId,id,midi,start,duration]of [['A','held-e',64,0,8000],['B','later-g',67,4000,4000],['C','middle-c',60,2000,4000]]){
    const note=notes.find(note=>note.part_id===partId);assert.ok(note);assert.deepEqual(note.source_note_ids,[id]);assert.equal(note.midi,midi);assert.equal(note.start_ms,start);assert.equal(note.duration_ms,duration);
  }
  assert.deepEqual(report.states.map(row=>row.label),['ab','blocked','recovered','ac','all']);
  for(const row of report.states)assertGuitarUnionState(row,report.compilation,row.label==='ac'?['A','C']:row.label==='all'?['A','B','C']:['A','B'],{blocked:row.label==='blocked'});
  const [ab,blocked,recovered,ac,all]=report.states;
  assert.deepEqual(ab.request.locks,[]);assert.deepEqual(blocked.request.locks,[{source_note_id:'held-e',string:1,fret:0,finger:0}]);
  for(const row of [recovered,ac,all])assert.deepEqual(row.request.locks,[]);
  assert.deepEqual(recovered.plan.assignments,ab.plan.assignments);
  const held=ab.plan.assignments.find(choice=>choice.source_note_ids.includes('held-e')),later=ab.plan.assignments.find(choice=>choice.source_note_ids.includes('later-g'));
  assert.equal(ab.plan.profile.tuning[held.string-1],59);assert.equal(held.fret,5);
  assert.equal(ab.plan.profile.tuning[later.string-1],64);assert.equal(later.fret,3);
  assert.equal(ab.ui.firstPart,ac.ui.firstPart,'A remains first so a first-part-only cache cannot satisfy this test');
  assert.notDeepEqual(ab.plan.assignments,ac.plan.assignments);
  assert.equal(report.takeBefore.score_id,score.id);assert.equal(report.takeBefore.practice_part,'A');assert.deepEqual(report.takeBefore.practice_selection,{kind:'parts',part_ids:['A','B']});
  assert.equal(report.takeBefore.target_plan.source_note_count,2);assert.deepEqual(sorted(report.takeBefore.target_plan.groups.flatMap(group=>group.source_occurrence_ids)),sorted(notes.filter(note=>note.part_id!=='C').map(note=>note.id)));
  assert.ok(report.takeBefore.passes.some(pass=>pass.inputs.length===1));assert.deepEqual(report.takeAfterLockRecovery,report.takeBefore);assert.deepEqual(report.takeAfterCancel,report.takeBefore);
  assert.match(report.cancelWarning,/restarts this session and clears its in-memory takes/);
  assert.match(report.applyWarning,/restarts this session and clears its in-memory takes/);
  assert.deepEqual(report.cancelHumanPartIds,['A','B']);
  assert.equal(report.reset.clock.positionMs,0);assert.equal(report.reset.clock.running,false);assert.equal(report.reset.clock.phase,'ready');assert.equal(report.reset.captured,'0');assert.equal(report.reset.exportDisabled,true);
  assert.deepEqual(report.exports.map(row=>row.label),['ab','blocked','ac','all']);for(const row of report.exports)assert.deepEqual(row.score,score);
  assert.deepEqual(report.snapshots.map(row=>[row.scope,row.viewport]),['ab','ac','all'].flatMap(scope=>GUITAR_UNION_VIEWPORTS.map(viewport=>[scope,viewport])));
  for(const snapshot of report.snapshots){
    const row=report.states.find(row=>row.label===snapshot.scope),assignments=row.plan.assignments;
    assert.equal(snapshot.positionMs,0);assert.equal(snapshot.controlsClosed,true);
    const current=assignments.filter(choice=>choice.start_ms===0),nextAt=Math.min(...assignments.filter(choice=>choice.start_ms>0).map(choice=>choice.start_ms));
    const next=[...current.filter(choice=>choice.end_ms>nextAt),...assignments.filter(choice=>choice.start_ms===nextAt)];
    for(const [markers,expected]of [[snapshot.current,current],[snapshot.next,next]]){
      assert.deepEqual(sorted(markers.flatMap(marker=>marker.occurrences)),sorted(expected.map(choice=>choice.occurrence_id)));
      for(const marker of markers){
        assert.equal(marker.painted,true);assert.ok(marker.fraction>=.98&&marker.height>=24&&marker.width>=20,'Complete current/next labels remain readable');
        assert.deepEqual(marker.assignments,expected.filter(choice=>marker.occurrences.includes(choice.occurrence_id)));
        assert.deepEqual(sorted(marker.sources),sorted(sourceIds(marker.assignments)));
        assert.ok(marker.text.trim().length>2);assert.ok(marker.accessible.includes(marker.sources[0]));
      }
    }
    assert.equal(snapshot.scopeLabel.text,row.ui.scope);assert.equal(snapshot.scopeLabel.painted,true);assert.ok(snapshot.scopeLabel.fraction>=.98&&snapshot.scopeLabel.height>=12);
    assert.equal(snapshot.play.painted,true);assert.ok(snapshot.play.fraction>=.98);assert.equal(snapshot.play.hit,true);
    assert.ok(snapshot.document.width<=snapshot.viewport.width+1&&snapshot.document.height<=snapshot.viewport.height+1);
    assert.match(snapshot.transition,/Chosen frets/);
    assert.equal(snapshot.screenshot.name,guitarUnionScreenshot(snapshot.scope,snapshot.viewport));assert.equal(snapshot.screenshot.width,snapshot.viewport.width);assert.equal(snapshot.screenshot.height,snapshot.viewport.height);assert.match(snapshot.screenshot.sha256,/^[a-f0-9]{64}$/);assert.ok(snapshot.screenshot.bytes>100);
  }
  return report;
}
