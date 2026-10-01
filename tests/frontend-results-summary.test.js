import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {resultsSummaryView,setupResultsSummary} from '../web/results-summary.js';
import {PracticeRecorder} from '../web/practice-recorder.js';

const assessment={hits:[{grade:'perfect'},{grade:'late'}],misses:['chord-e'],extras:[{midi:90,at_ms:100}],accuracy_percent:50,grade_counts:{perfect:1,good:0,early:0,late:1,missed:1,extra:1},onset_completion:{total:2,complete:1,longest_complete_sequence:1}};
const pass=()=>({id:2,label:'Loop 2',inputs:[{},{},{}],revision:3,assessedRevision:3,closedWall:500,deadline:680,manualDeadline:null,inFlight:false,error:null,boundaryReviews:[],timeline:{notes:[{},{},{}]},assessment:structuredClone(assessment)});

test('selected Results snapshot retains exclusive Rust grades and partial-chord group counts',()=>{
  const value=pass(),before=structuredClone(value),view=resultsSummaryView({pass:value,now:700});
  assert.equal(view.title,'Loop 2');assert.equal(view.passId,2);assert.match(view.status,/Previous check/);
  assert.deepEqual(view.grades,assessment.grade_counts);assert.deepEqual(view.onsets,assessment.onset_completion);
  assert.equal(view.grades.perfect,1);assert.equal(view.grades.late,1);assert.equal(view.grades.extra,1);
  assert.equal(view.onsets.complete,1,'A partial chord does not become a complete group');
  assert.match(view.revisionText,/Checked input revision 3.*Current input revision 3/);assert.deepEqual(value,before);
  const another={...pass(),id:4,label:'Take 4',assessment:{...assessment,onset_completion:{total:2,complete:0,longest_complete_sequence:0}}};
  assert.equal(resultsSummaryView({pass:another,now:700}).title,'Take 4');assert.equal(resultsSummaryView({pass:value,now:700}).onsets.complete,1);
});

test('absent, invalid and zero-target metadata stays explicitly unavailable without deriving grades',()=>{
  for(const metadata of [{grade_counts:undefined,onset_completion:undefined},{grade_counts:null,onset_completion:null},{grade_counts:{...assessment.grade_counts,perfect:2}},{onset_completion:{total:2,complete:1,longest_complete_sequence:2}}]){
    const view=resultsSummaryView({pass:{...pass(),assessment:{...assessment,...metadata}},now:700});
    assert.equal(view.grades,null);assert.equal(view.onsets,null);assert.match(view.gradeStatus,/Unavailable/);assert.match(view.onsetStatus,/Unavailable/);
  }
  const gradesOnly=resultsSummaryView({pass:{...pass(),assessment:{...assessment,onset_completion:undefined}},now:700});assert.deepEqual(gradesOnly.grades,assessment.grade_counts);assert.equal(gradesOnly.onsets,null);assert.match(gradesOnly.onsetStatus,/此结果未提供/);
  const onsetsOnly=resultsSummaryView({pass:{...pass(),assessment:{...assessment,grade_counts:undefined}},now:700});assert.equal(onsetsOnly.grades,null);assert.deepEqual(onsetsOnly.onsets,assessment.onset_completion);
  const empty=resultsSummaryView({pass:{...pass(),timeline:{notes:[]},assessment:{hits:[],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:0,missed:0,extra:0},onset_completion:{total:0,complete:0,longest_complete_sequence:0}}},now:700});
  assert.equal(empty.phase,'empty');assert.equal(empty.grades,null);assert.equal(empty.onsets,null);assert.match(empty.status,/not a successful take/);assert.match(empty.gradeStatus,/no note-on targets/);
});

test('results counters hide stale revisions, delayed input, pending work and failed checks',()=>{
  for(const [value,context,phase]of [[{...pass(),closedWall:null},{running:true,now:700},'capturing'],[pass(),{now:650},'grace'],[{...pass(),revision:4},{now:700},'pending'],[{...pass(),inFlight:true},{now:700},'pending'],[{...pass(),manualDeadline:900},{now:700},'grace'],[{...pass(),error:'offline'},{now:700},'error']]){
    const view=resultsSummaryView({pass:value,...context});assert.equal(view.phase,phase);assert.equal(view.grades,null);assert.equal(view.onsets,null);assert.match(view.gradeStatus,/Unavailable/);
  }
  for(const context of [{pass:{...pass(),boundaryReviews:[{}]}},{pass:pass(),interrupted:true}]){const view=resultsSummaryView({...context,now:700});assert.equal(view.phase,'review');assert.match(view.status,/Provisional.*boundary or clock-gap/);assert.deepEqual(view.grades,assessment.grade_counts);}
});

test('late recorder input clears previous counters until Rust checks the new revision',()=>{
  const recorder=new PracticeRecorder({latencyMs:500}),timeline={duration_ms:1000,notes:[{id:'c',midi:60,start_ms:0,duration_ms:100}]};
  const value=recorder.begin({wallTime:1000,position:0,startMs:0,endMs:1000,timeline});recorder.capture({midi:60,eventWall:1500});recorder.pause(1600);recorder.requestAssessment(1600);
  const checked={hits:[{grade:'late'}],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:1,missed:0,extra:0},onset_completion:{total:1,complete:1,longest_complete_sequence:1}};
  recorder.complete(recorder.submit(value),checked);const context={pass:value,latencyMs:500};
  assert.equal(resultsSummaryView({...context,now:2279}).grades,null);assert.equal(resultsSummaryView({...context,now:2280}).grades.late,1);
  recorder.capture({midi:90,eventWall:1610,receivedWall:2400});const pending=resultsSummaryView({...context,now:2400});assert.equal(pending.phase,'pending');assert.equal(pending.onsets,null);assert.match(pending.revisionText,/revision 1.*revision 2/);
  const updated={...checked,extras:[{midi:90,at_ms:110}],accuracy_percent:50,grade_counts:{...checked.grade_counts,extra:1}};recorder.complete(recorder.submit(value),updated);
  const view=resultsSummaryView({...context,now:2500});assert.equal(view.grades.extra,1);assert.equal(view.grades.perfect,0);assert.equal(view.grades.late,1);assert.equal(view.onsets.longest_complete_sequence,1,'Extras do not break the Rust coverage sequence');
});

test('Results DOM labels, counts and unavailable states update together without old pass values',async()=>{
  const {document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),render=setupResultsSummary(document),text=id=>document.getElementById(id).textContent;
  render({pass:pass(),now:700});assert.equal(text('result-grade-perfect'),'1');assert.equal(text('result-grade-late'),'1');assert.equal(text('result-grade-missed'),'1');assert.equal(text('result-grade-extra'),'1');assert.equal(text('result-onsets-complete'),'1 / 2');assert.equal(text('result-onsets-sequence'),'1');
  assert.equal(document.getElementById('result-summary-status').getAttribute('role'),'status');assert.equal(document.getElementById('result-summary-status').getAttribute('aria-live'),'polite');assert.equal(document.querySelectorAll('.result-grade-grid dt').length,6);assert.ok([...document.querySelectorAll('.result-grade-grid dt')].every(node=>node.textContent.includes('·')));
  assert.equal(document.querySelector('.result-summary-help').hasAttribute('open'),false);assert.match(text('result-onset-help'),/exactly the same expected score time.*Every target.*partial chord/);assert.match(text('result-onset-help'),/extra inputs.*do not break/);assert.match(text('result-summary-limits'),/not a combo or an error-free streak/);assert.match(text('result-summary-limits'),/simultaneous chord attacks or perfect timing.*Sustain, release and pedal.*Very late/);
  render({pass:{...pass(),id:3,label:'Take 3',assessment:{...assessment,grade_counts:undefined,onset_completion:undefined}},now:700});assert.equal(text('result-summary-take'),'Take 3');assert.match(text('result-grade-status'),/Unavailable/);assert.equal(text('result-onsets-complete'),'—');assert.ok([...document.querySelectorAll('.result-grade-grid dd')].every(node=>node.textContent==='—'));
  render({pass:pass(),now:700});render({pass:{...pass(),revision:4},now:700});assert.equal(document.getElementById('result-summary').dataset.phase,'pending');assert.equal(text('result-onsets-sequence'),'—');assert.equal(text('result-grade-extra'),'—');
  render({now:800});assert.equal(text('result-summary-take'),'No take selected · 未选择记录');assert.equal(text('result-summary-revision'),'');assert.equal(document.getElementById('result-summary').dataset.passId,'');
});
