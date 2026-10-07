// Finite actual-Windows progression proof. Synthetic records only test rejection.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {assistanceNativeFixtures,progressionNativeFixtures} from './native-assistance-fixtures.mjs';
import {expectedAudioPlan,validateAudioThreadRuns,validateAudioThreadStatus} from './audio-thread-rendition-proof.mjs';
import {expectedBasicKeySchedules} from './basic-key-rendition-proof.mjs';
import {canonicalFingerprint} from '../web/canonical-audio-fingerprint.js';
import {admitPracticeProgression} from '../web/practice-progression-receipt.js';
import {validateProgressionPreference} from '../web/practice-progression.js';
import {progressionText} from '../web/practice-progression-locales.js';

const originals=()=>assistanceNativeFixtures(),fixtures=()=>progressionNativeFixtures();
const checked=(kind='basic',layer='balanced')=>fixtures()[kind].layers[layer].response.checked;
const identity=c=>({plan:c.plan,receipt:c.receipt,human_target_ids:c.human_targets.groups.map(g=>g.target_id),machine_occurrence_ids:c.machine_occurrence_ids,scored_mode_allowed:c.scored_mode_allowed});
export const PROGRESSION_NATIVE_FILES=Object.freeze({
 'assistance-progression':['progressionMachineOnly','progressionHuman','progressionPaused','progressionAfterCancel','progressionOff'],
 'assistance-off-restart':['progressionOffRestart'],
});
export function progressionExpectedSchedules(layer='balanced'){
 const c=checked('basic',layer).assistance;
 return expectedBasicKeySchedules(originals().basic.opened.clean_package.runtime).filter(n=>c.machine_occurrence_ids.includes(n.noteId));
}
export function progressionExpectedAudioPlan(expected,{sampleRate,layer='balanced',off=false,...options}){
 const f=originals().basic,base=expectedAudioPlan(expected,{...options,sampleRate,sourceSha256:f.opened.clean_package.runtime.source_sha256,durationMs:1000,sourceNotes:6});
 if(off)return base;
 const {plan,receipt}=checked('basic',layer).assistance;
 return{...base,timbreProfile:'wmh-basic-synthetic-colors-v1',timbres:expected.map(n=>n.part==='midi-t1-c1-r0'?3:0),assistanceFingerprint:canonicalFingerprint('wmc-assistance-audio-ownership-v1',{receipt,revision:plan.revision,planner_revision:plan.planner_revision,selection:plan.selection,mode:plan.mode,settings:plan.settings,selection_digest:plan.selection_digest})};
}
export function validateNativeProgressionAudio(report){
 const off=report.phase==='assistance-off-restart',names=off?['progressionOffRestart']:['progressionMachineOnly','progressionHuman','paused'];
 assert.deepEqual(Object.keys(report.progressionRuns).sort(),[...names].sort());
 const seen=new Set();
 for(const name of names){
  const runs=report.progressionRuns[name];assert.equal(runs.length,1,'Each finite case owns one actual source run');
  const run=runs[0],key=`${run.receiverId}:${run.planGeneration}`;assert.ok(!seen.has(key));seen.add(key);assert.equal(run.positionFrame,0,'Original source-zero anchor is retained');
  const paused=name==='paused',expected=off?[]:progressionExpectedSchedules();
  validateAudioThreadRuns(runs,expected,{sourceSha256:originals().basic.opened.clean_package.runtime.source_sha256,durationMs:1000,sourceNotes:6,off,complete:!paused,natural:!paused,pcm:!off&&!paused,planOracle:progressionExpectedAudioPlan});
  assert.equal(run.terminals[0].record.type,paused?'canceled':'ended');
  if(paused){assert.ok(run.terminals[0].record.frame>run.started.anchorFrame);assert.ok(run.terminals[0].record.frame<run.started.anchorFrame+run.plan.durationFrames);}
 }
 validateAudioThreadStatus(report.audioStatus,{quiet:true});assert.equal(report.audioStatus.started,names.length);
 return report;
}
export function validateNativeProgressionTake(take,{human=false,off=false,capture=true}={}){
 const f=originals().basic,p=checked(),c=off?f.original.checked:p.assistance;
 assert.deepEqual(take.practice_assistance,off?null:identity(c));assert.deepEqual(take.practice_progression,off?null:p.plan);
 if(off)assert.equal(take.practice_assistance_disabled,true);else assert.notEqual(take.practice_assistance_disabled,true);
 if(off){const {diagnostics,...targets}=take.target_plan,{diagnostics:ignored,...expected}=c.human_targets;assert.deepEqual(targets,expected);assert.ok(Array.isArray(diagnostics));}else assert.deepEqual(take.target_plan,c.human_targets);
 assert.deepEqual(take.practice_selection,{kind:'all',part_ids:c.plan.selection.selected_part_ids});
 assert.ok(take.song_mod.config.parts.every(part=>part.performer==='human'));assert.equal(take.song_mod.config.parts.find(part=>part.partId==='midi-t1-c1-r0').instrument,'reed');
 assert.equal(take.passes.length,1);const pass=take.passes[0];assert.equal(pass.id,1);assert.equal(pass.capture_enabled,capture);assert.equal(pass.pending,false);assert.deepEqual(pass.timeline,c.human_targets.timeline);
 assert.deepEqual(pass.interpretation.practice_assistance,take.practice_assistance);assert.deepEqual(pass.interpretation.practice_progression,take.practice_progression);assert.deepEqual(pass.interpretation.song_mod,take.song_mod);
 assert.deepEqual(pass.interpretation.source_revision,{songId:JSON.parse(f.opened.clean_package.score_json).notation.id,sourceRevision:{kind:'clean-package-sha256',value:f.source.content_sha256}});
 if(off)assert.equal(pass.interpretation.practice_assistance_disabled,true);
 assert.equal(pass.inputs.length,human?1:0);assert.equal(pass.captures.length,human?1:0);assert.ok(pass.assessment);assert.equal(pass.assessment.hits.length,human?1:0);assert.deepEqual(pass.assessment.extras,[]);
 assert.deepEqual([...pass.assessment.hits.map(n=>n.note_id),...pass.assessment.misses].sort(),c.human_targets.timeline.notes.map(n=>n.id).sort());
 if(capture){
  assert.equal(take.input_evidence.version,1);assert.equal(take.input_evidence.truncated,false);assert.equal(take.input_evidence.omitted_observations,0);
  const onsets=take.input_evidence.events.filter(e=>e.kind==='note_on');assert.equal(onsets.length,human?1:0);
  if(human){const input=pass.inputs[0],event=onsets[0],cap=pass.captures[0];assert.equal(input.midi,72);assert.ok(input.at_ms>=570&&input.at_ms<=930);assert.equal(pass.assessment.hits[0].note_id,'midi-t1-e11');assert.deepEqual(cap.input,input);assert.equal(event.input_kind,'typing_keyboard');assert.equal(event.encoding,'key_down');assert.equal(event.midi,72);assert.equal(event.onset_capture.pass_id,pass.id);assert.equal(event.onset_capture.event_id,cap.event_id);assert.equal(cap.event_wall_ms,event.raw_timestamp_ms);assert.ok(Number.isFinite(cap.received_wall_ms)&&cap.received_wall_ms>=cap.event_wall_ms);const segment=pass.clock_segments[0];assert.equal(pass.clock_segments.length,1);assert.equal(input.at_ms,segment.positionStart+cap.event_wall_ms-take.latency_ms-segment.wallStart);}
 }else assert.equal(take.input_evidence,undefined);
 return take;
}
export function nativeProgressionResponse(request){
 const kind=request.source?.profile==='wmh-basic-keys-midi1-v1'?'basic':'vsq',f=fixtures()[kind],layer=request.layer||request.plan?.layer;
 assert.deepEqual(request.source,f.source);assert.ok(['single','balanced','dense'].includes(layer));
 const selection=request.selection||request.plan?.selection;
 const expected=kind==='vsq'&&selection?.selected_part_ids.length===1?f.narrow_scope:f.layers[layer].response;
 assert.deepEqual(selection,expected.checked.plan.selection);assert.equal(layer,expected.checked.plan.layer);
 return expected;
}
export function validateNativeProgressionRequests(report,takes,validateCompletion){
 const successful=[];assert.ok(report.requests.length>0&&report.requests.length<=40);assert.equal(report.requestsRestored,true);assert.ok(report.requests.filter(r=>r.canceled).length<=4);
 for(const [index,row]of report.requests.entries()){
  if(!validateCompletion(row,report,index))continue;successful.push(row);
  if(row.path.startsWith('/api/library/progression/')){
   const expected=nativeProgressionResponse(row.request);assert.deepEqual(row.response,expected,'Actual consumed Rust progression must match its original API vector');
   assert.deepEqual(row.request,row.path.endsWith('/validate')?{source:expected.source,plan:expected.checked.plan}:{source:expected.source,selection:expected.checked.plan.selection,layer:expected.checked.plan.layer});
   assert.ok(['/api/library/progression/generate','/api/library/progression/validate'].includes(row.path));
   admitPracticeProgression(row.response,{sourceToken:{},runtimeToken:{},source:expected.source,selection:expected.checked.plan.selection,layer:expected.checked.plan.layer,...(row.path.endsWith('/validate')?{plan:expected.checked.plan}:{})});
  }else if(row.path.startsWith('/api/library/assistance/')){
   // Only the untouched v1 VSQ preference can be restored before opting in.
   assert.equal(row.path,'/api/library/assistance/generate');const f=originals().vsq;assert.deepEqual(row.request,{source:f.source,selection:f.narrow_scope.checked.plan.selection,settings:f.narrow_scope.checked.plan.settings});assert.deepEqual(row.response,f.narrow_scope);
  }else if(row.path==='/api/library/runtime'){assert.deepEqual(row.request,{key:originals().vsq.source.key,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'});assert.deepEqual(row.response,originals().vsq.selected_runtime);}
  else if(['/api/practice-targets','/api/instrument-check'].includes(row.path)){
   const f=originals().basic,compact=f.opened.clean_package.runtime.compilation.timeline,source={duration_ms:compact.duration_ms,notes:compact.notes.map(([id,part_id,midi,velocity,start_ms,duration_ms])=>({id,part_id,midi,velocity,start_ms,duration_ms,source_note_id:id,source_note_ids:[id],voice:'1',staff:1}))};
   assert.deepEqual(row.request,{timeline:source,profile:f.original.checked.plan.selection.profile});
   if(row.path==='/api/practice-targets'){const {diagnostics,...actual}=row.response,{diagnostics:ignored,...expected}=f.original.checked.human_targets;assert.deepEqual(actual,expected);assert.ok(Array.isArray(diagnostics));}
   else{assert.equal(row.response.changed_source_notes,false);assert.deepEqual(row.response.note_options,source.notes.map(n=>({note_id:n.id,midi:n.midi,playable:true,positions:[]})));}
  }
  else{assert.equal(row.path,'/api/assess');assert.ok(Object.values(takes).some(t=>t.passes?.some(pass=>isDeepStrictEqual(row.request.timeline,pass.timeline)&&isDeepStrictEqual(row.request.inputs,pass.inputs)&&isDeepStrictEqual(row.response,pass.assessment))),'Assessment must match a retained current human-only take');}
 }
 if(report.phase==='assistance-off-restart'){
  for(const path of ['/api/practice-targets','/api/instrument-check','/api/assess'])assert.ok(successful.some(r=>r.path===path));assert.ok(report.requests.every(r=>['/api/assess','/api/practice-targets','/api/instrument-check'].includes(r.path)),'Restarted Off cannot rebuild any assistance or Original DTO');
 }else{
  assert.ok(successful.filter(r=>r.path==='/api/library/progression/validate'&&r.request.source.key===originals().basic.source.key).length>=2,'Saved preview and stage independently validate the exact progression proof');
  assert.equal(successful.filter(r=>r.path==='/api/library/runtime').length,1);
  assert.ok(Number.isSafeInteger(report.offRequestStart)&&Number.isSafeInteger(report.offRequestEnd)&&report.offRequestStart<report.offRequestEnd);
  assert.ok(report.requests.slice(report.offRequestStart,report.offRequestEnd).every(r=>['/api/assess','/api/practice-targets','/api/instrument-check'].includes(r.path)),'Off uses ordinary target admission, never a giant Original response');
  const ordinary=report.requests.slice(report.offRequestStart,report.offRequestEnd);for(const path of ['/api/practice-targets','/api/instrument-check'])assert.ok(ordinary.some(r=>r.path===path&&r.observation==='consumed'));
  const off=successful.filter(r=>r.started.actionSequence===report.offAssessAction);assert.equal(off.length,1);assert.deepEqual(off[0].response,takes.progressionOff.passes[0].assessment);
 }
 return successful;
}
export function validateNativeProgressionView(view,response,{layer=response?.checked.plan.layer,draft=false}={}){
 assert.equal(view.mode,'progression');assert.equal(view.visible,true);assert.equal(view.layer,layer);assert.equal(view.state,draft?'unchecked':'checked');
 if(draft){assert.deepEqual(view.rows,[{layer:null,selected:null,current:null,text:progressionText('en','unchecked')}]);return;}
 const c=response.checked;assert.deepEqual(view.rows,c.layers.map(row=>({layer:row.layer,selected:String(row.layer===layer),current:row.layer===layer?'step':null,text:progressionText('en','row',{name:progressionText('en',row.layer),human:row.human_target_count,units:row.human_source_unit_count})+(row.equals_previous_layer?' · '+progressionText('en','equal'):'')+(!row.human_target_count?' · '+progressionText('en','empty'):'')})));
}
export function validateNativeProgressionControls(report){
 const cp=label=>{const rows=report.checkpoints.filter(r=>r.label===label);assert.equal(rows.length,1,label);return rows[0];};
 if(report.phase==='assistance-off-restart'){const row=cp('progression-off-restored');assert.equal(row.progression.mode,'original');assert.equal(row.progression.visible,false);assert.equal(row.status,'editing');return;}
 const f=fixtures();
 for(const [label,response]of [['progression-balanced-checked',f.basic.layers.balanced.response],['progression-change-checked',f.basic.layers.single.response],['progression-reset-checked',f.basic.layers.single.response],['progression-vsq-checked',f.vsq.layers.single.response],['progression-vsq-empty-checked',f.vsq.narrow_scope]]){
  const row=cp(label);validateNativeProgressionView(row.progression,response);assert.ok(report.controls.some(c=>c.id==='song-mod-assistance-check'&&c.kind==='click'&&c.sequence===row.actionSequence));assert.ok(report.requests.some(r=>r.started.actionSequence===row.actionSequence&&r.observation==='consumed'&&isDeepStrictEqual(r.response,response)),'Each selected stage binds to its consumed Check');
 }
 validateNativeProgressionView(cp('progression-balanced-reopened').progression,f.basic.layers.balanced.response);
 for(const [label,layer]of [['progression-balanced-draft','balanced'],['progression-change-draft','single']]){const row=cp(label);validateNativeProgressionView(row.progression,null,{layer,draft:true});const control=report.controls.find(c=>c.sequence===row.actionSequence);assert.equal(control.id,'song-mod-progression-layer');assert.equal(control.kind,layer==='single'?'select-first':'select-second');assert.ok(report.trusted.some(e=>e.sequence===control.sequence&&e.id===control.id&&e.type==='change'&&e.owned&&e.trusted&&e.value===layer));}
 assert.ok(report.trusted.some(e=>e.id==='song-mod-assistance-mode'&&e.type==='change'&&e.trusted&&e.owned&&e.value==='progression'));
 for(const label of ['progression-change-draft','progression-change-checked','progression-reset-checked','progression-off-draft'])assert.equal(cp(label).applyDisabled,true);
 const paused=report.progressionPaused;assert.deepEqual(paused.after,paused.before,'Cancel must preserve the actual paused source clock');assert.deepEqual(paused.afterStorage,paused.storage);assert.equal(paused.before.running,false);assert.equal(paused.before.completed,false);assert.ok(paused.before.positionMs>0&&paused.before.positionMs<1000);
 for(const reset of [report.progressionReset,report.progressionOff]){assert.equal(reset.historyHidden,true);assert.equal(reset.exportDisabled,true);assert.equal(reset.assessmentDisabled,false);assert.deepEqual(reset.passOptions,['']);assert.equal(reset.clock.running,false);assert.equal(reset.clock.positionMs,0);assert.equal(reset.sourceStarts,report.offSourceStarts);}
 assert.match(report.progressionOff.summary,/Note assistance is off/);assert.equal(report.offAfterAssessment.clock.running,false);assert.equal(report.offAfterAssessment.sourceStarts,report.offSourceStarts);
 assert.equal(report.zeroHuman.startDisabled,true);assert.equal(report.zeroHuman.clock.running,false);assert.equal(report.zeroHuman.sourceStarts,report.vsqBeforeChoice.sourceStarts);assert.equal(report.vsqBeforeChoice.startDisabled,true);assert.equal(report.vsqBeforeChoice.modDisabled,true);
 assert.ok(report.controls.some(c=>c.id==='vsq-choose-base-notes'));assert.equal(report.controls.filter(c=>c.id==='song-mod-assistance-reset').length,2);
}
export function validateNativeProgressionStorage(reports){
 const [legacySeed,legacyRestart,progression,restart]=reports,f=fixtures();assert.equal(progression.phase,'assistance-progression');assert.equal(restart.phase,'assistance-off-restart');assert.deepEqual(progression.storageBefore,legacyRestart.storageAfter);assert.deepEqual(progression.storageAfter,legacyRestart.storageAfter);assert.deepEqual(restart.storageBefore,legacyRestart.storageAfter);assert.deepEqual(restart.storageAfter,legacyRestart.storageAfter,'New progression must never rewrite v1 bytes');assert.deepEqual(progression.progressionStorageBefore,{});
 const inspect=(rows,expected)=>{assert.deepEqual(Object.keys(rows).sort(),Object.keys(expected).map(kind=>'worldmusichub.practice-progression.v1.'+encodeURIComponent(JSON.stringify([f[kind].source.key,f[kind].source.content_sha256,f[kind].source.profile,f[kind].source.choice,f[kind].source.runtime_policy]))).sort());for(const raw of Object.values(rows)){assert.equal(typeof raw,'string');assert.ok(raw.length<4096);const value=JSON.parse(raw),kind=value.source?.key===f.basic.source.key?'basic':'vsq';validateProgressionPreference(value,{source:f[kind].source});assert.deepEqual(value.plan,expected[kind]==='off'?null:kind==='vsq'?f.vsq.narrow_scope.checked.plan:f.basic.layers[expected[kind]].response.checked.plan);assert.equal(value.mode,expected[kind]==='off'?'off':'progression');}};
 inspect(progression.progressionSaved,{basic:'balanced'});inspect(progression.progressionPaused.storage,{basic:'balanced'});inspect(progression.progressionResetStorage,{basic:'single'});inspect(progression.progressionOffStorage,{basic:'off'});inspect(progression.progressionStorageAfter,{basic:'off',vsq:'single'});
 assert.deepEqual(restart.progressionStorageBefore,progression.progressionStorageAfter);assert.deepEqual(restart.progressionStorageAfter,progression.progressionStorageAfter);
 assert.ok(Object.keys(legacySeed.storageAfter).length>0);
}
