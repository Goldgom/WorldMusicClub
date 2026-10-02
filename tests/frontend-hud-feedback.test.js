import test from 'node:test';
import assert from 'node:assert/strict';
import {rustSnapshotSummary,stageFeedbackView} from '../web/hud-feedback.js';
import {PracticeRecorder} from '../web/practice-recorder.js';
const assessment={hits:[{grade:'perfect'},{grade:'good'}],misses:['missing'],extras:[{midi:90,at_ms:50}],accuracy_percent:50,grade_counts:{perfect:1,good:1,early:0,late:0,missed:1,extra:1},onset_completion:{total:2,complete:1,longest_complete_sequence:1}};
const pass=()=>({id:2,label:'Loop 2',inputs:[{},{}],revision:2,assessedRevision:2,closedWall:500,deadline:680,manualDeadline:null,inFlight:false,error:null,boundaryReviews:[],timeline:{notes:[{},{},{}]},assessment:structuredClone(assessment)});
test('HUD uses exact supplied Rust grades and chord-aware onset counts without inventing a combo',()=>{
 const source=structuredClone(assessment),view=rustSnapshotSummary(source,3);assert.deepEqual(view.grades,assessment.grade_counts);assert.deepEqual(view.onsets,assessment.onset_completion);assert.equal(view.accuracy,'50%');assert.match(view.message,/not a combo/);assert.deepEqual(source,assessment);
 const legacy={...source,grade_counts:undefined,onset_completion:undefined};const absent=rustSnapshotSummary(legacy,3);assert.equal(absent.grades,null);assert.equal(absent.onsets,null);assert.equal(absent.available,false);assert.match(absent.message,/unavailable/);
});
test('inconsistent supplied totals or invented onset sequences never become a HUD grade',()=>{
 for(const change of [{grade_counts:{...assessment.grade_counts,perfect:2}},{grade_counts:{...assessment.grade_counts,missed:0}},{grade_counts:{...assessment.grade_counts,extra:-1}},{onset_completion:{total:2,complete:1,longest_complete_sequence:2}},{onset_completion:{total:0,complete:0,longest_complete_sequence:0}}]){const view=rustSnapshotSummary({...assessment,...change},3);assert.equal(view.accuracy,null);assert.equal(view.grades,null);assert.equal(view.onsets,null);assert.match(view.message,/inconsistent/)}
});
test('capture, latency grace and in-flight work hide assessment values even if an old result exists',()=>{
 for(const[value,context,phase]of[[{...pass(),closedWall:null},{running:true,now:800},'capturing'],[pass(),{now:600},'grace'],[{...pass(),inFlight:true},{now:800},'pending'],[{...pass(),revision:3},{now:800},'pending'],[{...pass(),manualDeadline:900},{now:800},'grace']]){const view=stageFeedbackView({mode:'practice',pass:value,...context});assert.equal(view.phase,phase);assert.equal(view.accuracy,null);assert.equal(view.grades,null);assert.equal(view.captured,2);}
});
test('a settled revision stays tied to its pass and becomes provisional for boundary or clock-gap review',()=>{
 const value=pass(),view=stageFeedbackView({mode:'practice',pass:value,now:700});assert.equal(view.phase,'assessed');assert.equal(view.passId,2);assert.equal(view.revision,2);assert.match(view.label,/Loop 2.*Previous check/);assert.equal(view.accuracy,'50%');
 value.boundaryReviews.push({});const boundary=stageFeedbackView({mode:'practice',pass:value,now:700});assert.equal(boundary.phase,'review');assert.match(boundary.label,/Provisional/);assert.match(boundary.message,/cross-pass/);assert.match(boundary.onsetHelp,/Inputs need not arrive simultaneously/);
 value.boundaryReviews=[];assert.equal(stageFeedbackView({mode:'practice',pass:value,now:700,interrupted:true}).phase,'review');
});
test('empty targets, listen mode, new sessions and failed checks cannot inherit a success display',()=>{
 const empty={...pass(),timeline:{notes:[]},assessment:{...assessment,hits:[],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:0,missed:0,extra:0},onset_completion:{total:0,complete:0,longest_complete_sequence:0}}};assert.equal(stageFeedbackView({mode:'practice',pass:empty,now:900}).phase,'empty');assert.equal(stageFeedbackView({mode:'practice',pass:empty,now:900}).accuracy,null);
 assert.equal(stageFeedbackView({mode:'listen',pass:pass(),now:900}).accuracy,null);assert.equal(stageFeedbackView({mode:'practice',now:900}).passId,null);assert.equal(stageFeedbackView({mode:'practice',pass:{...pass(),error:'offline'},now:900}).phase,'error');
});

test('a real assessed recorder resume and ordinary pause hides its previous score through pause-tail grace',()=>{
 for(const latencyMs of [0,500]){
  const recorder=new PracticeRecorder({latencyMs,toleranceMs:180}),timeline={duration_ms:1000,notes:[{id:'c',midi:60,start_ms:0,duration_ms:100}]};
  const value=recorder.begin({wallTime:0,position:0,startMs:0,endMs:1000,timeline});recorder.capture({midi:60,eventWall:latencyMs});recorder.pause(100);recorder.requestAssessment(100);
  const prior={hits:[{grade:'perfect'}],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:1,good:0,early:0,late:0,missed:0,extra:0},onset_completion:{total:1,complete:1,longest_complete_sequence:1}};recorder.complete(recorder.submit(value),prior);
  recorder.resume(1000,100);recorder.pause(1100);assert.equal(value.manualDeadline,null);assert.equal(value.deadline,null);
  for(const now of [1101,1100+Math.max(0,latencyMs)+179]){const view=stageFeedbackView({mode:'practice',pass:value,now,latencyMs,toleranceMs:180});assert.equal(view.phase,'grace');assert.equal(view.accuracy,null);}
  const captured=recorder.capture({midi:90,eventWall:1110+latencyMs,receivedWall:1120+latencyMs});assert.equal(captured.pass,value);assert.equal(value.revision,2);
  const after=stageFeedbackView({mode:'practice',pass:value,now:1100+latencyMs+180,latencyMs,toleranceMs:180});assert.equal(after.phase,'pending');assert.equal(after.accuracy,null,'The old 100% cannot survive a delayed extra attack');
 }
});

test('a 100 percent onset match snapshot can contain only late grades and never means perfect timing',()=>{
 const late={hits:[{grade:'late'},{grade:'late'},{grade:'late'}],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:3,missed:0,extra:0},onset_completion:{total:3,complete:3,longest_complete_sequence:3}};
 const view=rustSnapshotSummary(late,3);assert.equal(view.accuracy,'100%');assert.equal(view.grades.perfect,0);assert.equal(view.grades.late,3);assert.match(view.message,/does not mean perfect timing/);
});


test('snapshot validation exposes stable reasons without changing legacy snapshot prose or readiness',()=>{
 const ready=rustSnapshotSummary(assessment,3);assert.equal(ready.reasonCode,'summary_ready');
 const missing=rustSnapshotSummary({...assessment,grade_counts:undefined,onset_completion:undefined},3);assert.equal(missing.reasonCode,'summary_unavailable');assert.equal(missing.available,false);assert.match(missing.message,/unavailable/);
 assert.equal(rustSnapshotSummary({...assessment,hits:null},3).reasonCode,'summary_unavailable');
 assert.equal(rustSnapshotSummary({...assessment,grade_counts:{...assessment.grade_counts,perfect:2}},3).reasonCode,'grade_counts_inconsistent');
 assert.equal(rustSnapshotSummary({...assessment,onset_completion:{total:2,complete:1,longest_complete_sequence:2}},3).reasonCode,'onset_counts_inconsistent');
 const value=pass(),before=structuredClone(value);assert.equal(stageFeedbackView({mode:'practice',pass:value,now:700}).summaryReasonCode,'summary_ready');assert.deepEqual(value,before);
 value.boundaryReviews.push({});value.assessment.grade_counts.perfect=99;const checked=stageFeedbackView({mode:'practice',pass:value,now:700});assert.equal(checked.summaryReasonCode,'grade_counts_inconsistent');assert.equal(checked.phase,'review');assert.match(checked.message,/cross-pass/);
 for(const context of [{mode:'listen',pass:value,now:700},{mode:'practice',pass:value,now:650},{mode:'practice',pass:{...value,revision:99},now:700}])assert.equal(stageFeedbackView(context).summaryReasonCode,null);
});
