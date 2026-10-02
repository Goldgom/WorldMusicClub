import {createI18n} from '../web/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {resultsSummaryView as buildResultsSummary,setupResultsSummary} from '../web/results-summary.js';
import {PracticeRecorder} from '../web/practice-recorder.js';

const english=createI18n({locale:'en',onReport(){}}),resultsSummaryView=context=>buildResultsSummary(context,english);
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
  const gradesOnly=resultsSummaryView({pass:{...pass(),assessment:{...assessment,onset_completion:undefined}},now:700});assert.deepEqual(gradesOnly.grades,assessment.grade_counts);assert.equal(gradesOnly.onsets,null);assert.match(gradesOnly.onsetStatus,/Unavailable in this saved result/);
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
  render({pass:pass(),now:700});assert.equal(text('result-grade-perfect'),'1');assert.equal(text('result-grade-late'),'1');assert.equal(text('result-grade-missed'),'1');assert.equal(text('result-grade-extra'),'1');assert.equal(text('result-onsets-complete'),'1／2');assert.equal(text('result-onsets-sequence'),'1');
  assert.equal(document.getElementById('result-summary-status').getAttribute('role'),'status');assert.equal(document.getElementById('result-summary-status').getAttribute('aria-live'),'polite');assert.equal(document.querySelectorAll('.result-grade-grid dt').length,6);assert.deepEqual([...document.querySelectorAll('.result-grade-grid dt')].map(node=>node.textContent),['精准','良好','偏早','偏晚','漏音','多音']);
  assert.equal(document.querySelector('.result-summary-help').hasAttribute('open'),false);assert.match(text('result-onset-help'),/同一预期时刻.*所有目标.*和弦漏音/);assert.match(text('result-onset-help'),/多余起音.*不打断/);assert.match(text('result-summary-limits'),/不代表无误连击/);assert.match(text('result-summary-limits'),/和弦同时弹下或节奏完全准确.*延音、松键和踏板.*很晚到达/);
  render({pass:{...pass(),id:3,label:'Take 3',assessment:{...assessment,grade_counts:undefined,onset_completion:undefined}},now:700});assert.equal(text('result-summary-take'),'Take 3');assert.match(text('result-grade-status'),/未提供/);assert.equal(text('result-onsets-complete'),'—');assert.ok([...document.querySelectorAll('.result-grade-grid dd')].every(node=>node.textContent==='—'));
  render({pass:pass(),now:700});render({pass:{...pass(),revision:4},now:700});assert.equal(document.getElementById('result-summary').dataset.phase,'pending');assert.equal(text('result-onsets-sequence'),'—');assert.equal(text('result-grade-extra'),'—');
  render({now:800});assert.equal(text('result-summary-take'),'未选择演奏记录');assert.equal(text('result-summary-revision'),'');assert.equal(document.getElementById('result-summary').dataset.passId,'');
});


test('Results switch locales while preserving selected pass, open help, revisions, counts and original label',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),i18n=createI18n({onReport(){}}),render=setupResultsSummary(document,{i18n}),value=pass();
 value.label='Original <img> 原名';const before=structuredClone(value),help=document.querySelector('.result-summary-help'),status=document.getElementById('result-summary-status');help.setAttribute('open','');let focusCalls=0;window.HTMLElement.prototype.focus=()=>focusCalls++;
 try{
  render({pass:value,now:700});assert.equal(status.textContent,'上次检查');const textNode=status.firstChild;render({pass:value,now:700});assert.equal(status.firstChild,textNode,'An unchanged snapshot is not re-announced');
  i18n.setLocale('en');assert.equal(status.textContent,'Previous check');assert.equal(document.querySelector('.result-grade-grid dt').textContent,'Perfect');assert.equal(document.getElementById('result-onsets-complete').textContent,'1 / 2');assert.equal(document.getElementById('result-summary-take').textContent,value.label);assert.equal(document.querySelector('#result-summary-take img'),null);assert.equal(help.hasAttribute('open'),true);assert.equal(focusCalls,0);assert.equal(document.getElementById('result-summary').dataset.revision,'3');assert.deepEqual(value,before);
  i18n.setLocale('zh-CN');assert.equal(status.textContent,'上次检查');assert.equal(document.querySelector('.result-grade-grid dt').textContent,'精准');assert.equal(document.getElementById('result-onsets-complete').textContent,'1／2');assert.deepEqual(value,before);
  render.destroy();i18n.setLocale('en');assert.equal(status.textContent,'上次检查');
 }finally{render.destroy()}
});

test('Results inconsistencies use validation codes, including provisional boundary reviews, without prose matching',async()=>{
 for(const[metadata,code]of [[{grade_counts:{...assessment.grade_counts,perfect:2}},'grade_counts_inconsistent'],[{onset_completion:{total:2,complete:1,longest_complete_sequence:2}},'onset_counts_inconsistent']]){
  for(const boundaryReviews of [[],[{}]]){
   const value={...pass(),boundaryReviews,assessment:{...assessment,...metadata}},view=buildResultsSummary({pass:value,now:700},english);
   assert.equal(view.summaryReasonCode,code);assert.equal(view.phase,boundaryReviews.length?'review':'assessed');assert.equal(view.gradeStatus,'Unavailable: inconsistent Rust summary');assert.equal(view.onsetStatus,'Unavailable: inconsistent Rust summary');assert.equal(view.grades,null);assert.equal(view.onsets,null);
  }
 }
 const source=await readFile(new URL('../web/results-summary.js',import.meta.url),'utf8');assert.doesNotMatch(source,/checked\.message|message\.includes/);
});


test('Results reevaluate explicit generated-title callbacks on locale redraw without changing canonical labels',async()=>{
 const {document}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),i18n=createI18n({onReport(){}}),render=setupResultsSummary(document,{i18n}),value=pass();
 value.label='Take 2';const before=structuredClone(value),context={pass:value,now:700,passLabel:()=>i18n.locale==='zh-CN'?'第 2 次练习':'Take 2'},title=document.getElementById('result-summary-take');
 try{
  render(context);assert.equal(title.textContent,'第 2 次练习');assert.notEqual(title.textContent,value.label);assert.equal(document.getElementById('result-grade-perfect').textContent,'1');
  i18n.setLocale('en');assert.equal(title.textContent,'Take 2');assert.equal(document.getElementById('result-summary').dataset.passId,'2');assert.equal(document.getElementById('result-summary').dataset.revision,'3');assert.deepEqual(value,before);
  i18n.setLocale('zh-CN');assert.equal(title.textContent,'第 2 次练习');assert.equal(document.getElementById('result-onsets-complete').textContent,'1／2');assert.deepEqual(value,before);
  const source={...value,label:'User source <img> 原名'},sourceBefore=structuredClone(source);render({pass:source,now:700,passLabel:()=>source.label});i18n.setLocale('en');assert.equal(title.textContent,source.label);assert.equal(title.querySelector('img'),null);assert.deepEqual(source,sourceBefore);
 }finally{render.destroy()}
});

test('Results display-title strings are literal and missing, invalid or failing adapters preserve original labels',()=>{
 const value=pass(),before=structuredClone(value);
 assert.equal(buildResultsSummary({pass:value,now:700,passLabel:'Display <b> 原名'},english).title,'Display <b> 原名');
 for(const passLabel of [undefined,null,'',{},()=>null,()=>({toString(){throw Error('Do not coerce');}}),()=>{throw Error('Display unavailable');}]){
  const view=buildResultsSummary({pass:value,now:700,passLabel},english);assert.equal(view.title,value.label);assert.deepEqual(view.grades,assessment.grade_counts);
 }
 assert.equal(buildResultsSummary({passLabel:()=> 'No selected pass'},english).title,'No take selected');assert.deepEqual(value,before);
});
