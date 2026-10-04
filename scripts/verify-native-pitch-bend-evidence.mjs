import assert from 'node:assert/strict';
import {readFile,lstat,readdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pitchBendAcceptanceFixtures,PITCH_BEND_FIXTURE_FILENAME} from './prepare-pitch-bend-fixtures.mjs';
import {digest} from '../tests/clean-song-package-fixtures.js';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {validateVsqPickerGestures} from './verify-native-vsq-song-evidence.mjs';
import {validatePerformanceTakes,validatePerformanceExport,validateLivePerformanceAudio} from './verify-native-performance-song-evidence.mjs';
import {performanceSeconds} from '../web/clean-performance-player.js';
import {PROGRAM_FAMILIES} from '../web/midi-reference-synth.js';
export {validatePerformanceTakes};
export const PITCH_BEND_PHASES=Object.freeze(['pitch-bend-seed','pitch-bend-restart']);
export const PITCH_BEND_REPORT_BYTES=1024*1024;
export const PITCH_BEND_CHECKS=Object.freeze(['null-notation-no-practice-or-fingering','explicit-pitch-reference-policy-both-locales','native-source-clock-active-and-pedal-bends','melody-track-mute-without-key-rewrite','pause-resume-restores-held-pitch','bounds-blocked-before-audio','human-take-and-machine-input-separated','reload-no-implicit-policy']);
export const PITCH_BEND_CLAIMS=Object.freeze(JSON.parse(await readFile(new URL('./native-pitch-bend-claims.json',import.meta.url),'utf8')));
const positive=n=>Number.isSafeInteger(n)&&n>0,finite=Number.isFinite,sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),sort=rows=>[...rows].sort((a,b)=>a.path.localeCompare(b.path));
const near=(actual,expected,label,tolerance=1e-9)=>assert.ok(finite(actual)&&Math.abs(actual-expected)<tolerance,`${label}: ${actual} != ${expected}`);
const silent=(audio,label)=>{assert.ok(audio&&audio.activeSources===0&&audio.pendingSources===0,`${label}: live or scheduled sources remain`);for(const row of audio.sources||[])assert.equal(row.disconnected,true,`${label}: source remained connected`);};

// Independent interpretation of the retained source commands. This verifies
// observations of the production receiver; it never supplies its audio or clock.
export function expectedPitchCommands(fixture) {
 const channels=Array.from({length:16},()=>({value:8192,range:2})),out=[];
 for(const [index,event]of fixture.opened.clean_package.runtime.events.entries()){
  const c=event.command,state=channels[c.channel];
  if(c.kind==='pitch_bend'){assert.ok(Number.isInteger(c.value)&&c.value>=0&&c.value<=16383);state.value=c.value;}
  else if(c.kind==='initial_controller_reset')state.value=8192;
  else if(c.kind==='initial_pitch_bend_sensitivity12'){if(c.step==='set_semitones12')state.range=12;}
  else continue;
  out.push({index,eventId:event.event_id,channel:c.channel,at:performanceSeconds(event.exact_microseconds),semitones:(state.value-8192)/8192*state.range});
 }
 return out;
}
const pitchAt=(commands,channel,predicate)=>commands.filter(row=>row.channel===channel&&predicate(row)).at(-1)?.semitones??0;
function validateReceiverLedger(audio) {
 assert.ok(audio&&Array.isArray(audio.sources)&&audio.sources.length<=128);
 const receiver=audio.receiver;assert.deepEqual(Object.keys(receiver).sort(),['retunes','schedules','silences']);
 for(const rows of Object.values(receiver))assert.ok(Array.isArray(rows)&&rows.length<=128);
 const calls=Object.values(receiver).flat().sort((a,b)=>a.sequence-b.sequence);
 for(const [index,row]of calls.entries()){assert.equal(row.sequence,index+1);assert.equal(row.success,true);assert.ok(finite(row.currentTime)&&row.currentTime>=0);if(index)assert.ok(row.currentTime>=calls[index-1].currentTime,'Native receiver clock regressed');}
 assert.equal(audio.sources.length,receiver.schedules.length*2,'Each melodic voice must expose its two actual oscillators');
 assert.equal(audio.sourceStarts,audio.sources.length);assert.equal(audio.oscillatorStarts,audio.sources.length);
 for(const [index,schedule]of receiver.schedules.entries()){
  assert.equal(schedule.strictPitchRange,true);assert.ok(finite(schedule.start)&&finite(schedule.end)&&schedule.end>schedule.start);assert.ok(schedule.start>=schedule.currentTime,'Receiver scheduled late onset');
  const silence=receiver.silences.find(row=>row.sequence>schedule.sequence)?.sequence??Infinity;
  for(const source of audio.sources.slice(index*2,index*2+2)){
   assert.equal(source.kind,'createOscillator');assert.deepEqual(source.starts,[schedule.start]);assert.ok(Array.isArray(source.stops)&&source.stops.length>=1&&source.stops.length<=4&&source.stops.every(n=>finite(n)&&n>=0));near(source.stops[0],schedule.end,'Native source gate');
   assert.ok(finite(source.sampleRate)&&source.sampleRate>=8000&&finite(source.currentTime));
   assert.ok(Array.isArray(source.frequencies)&&source.frequencies.length>0&&source.frequencies.length<=12);
   const changes=receiver.retunes.filter(row=>row.sequence>schedule.sequence&&row.sequence<silence&&row.channel===schedule.channel&&row.at>=schedule.start&&row.at<schedule.end);
   assert.equal(source.frequencies.length,1+changes.length,'Pitch writes must retain every event, including duplicate values');
  }
 }
 const active=audio.sources.filter(row=>!row.disconnected&&row.starts[0]<=row.currentTime&&row.stops.at(-1)>row.currentTime).length;
 const pending=audio.sources.filter(row=>!row.disconnected&&row.starts[0]>row.currentTime&&row.stops.at(-1)>row.starts[0]).length;
 assert.equal(audio.activeSources,active);assert.equal(audio.pendingSources,pending);
}
export function validatePitchSegment(audio,fixture,{mutedTracks=[],position=0,complete=true,previous=null}={}) {
 validateReceiverLedger(audio);
 const commands=expectedPitchCommands(fixture),events=fixture.opened.clean_package.runtime.events;
 const schedules=audio.receiver.schedules.slice(previous?.receiver.schedules.length??0),retunes=audio.receiver.retunes.slice(previous?.receiver.retunes.length??0);
 const expectedVoices=fixture.reference.voices.filter(v=>!mutedTracks.includes(v.trackIndex)&&performanceSeconds(v.end)>position);
 if(complete)assert.equal(schedules.length,expectedVoices.length);else assert.ok(schedules.length<=expectedVoices.length);
 const anchor=schedules.length?schedules[0].end-performanceSeconds(expectedVoices[0].end):retunes[0]?.at-Math.max(position,commands[0].at);
 assert.ok(finite(anchor),'No native clock anchor was observed');
 if(complete)assert.equal(retunes.length,commands.length);else assert.ok(retunes.length<=commands.length);
 for(const [index,row]of retunes.entries()){
  const want=commands[index];assert.equal(row.channel,want.channel);near(row.semitones,want.semitones,'Raw14-bit/range displacement');near(row.at,anchor+Math.max(position,want.at),'Native retained event clock');
  assert.ok(row.at+1e-6>=row.currentTime,'Retune was scheduled late');
  assert.ok(row.at-row.currentTime<=.151,'Retune escaped production lookahead bound');
 }
 for(const [index,row]of schedules.entries()){
  const voice=expectedVoices[index],sourceStart=performanceSeconds(voice.start),sourceEnd=performanceSeconds(voice.end),resumed=sourceStart<position;
  assert.equal(row.eventId,voice.eventId);assert.equal(row.channel,voice.channel);assert.equal(row.key,voice.key);assert.equal(row.resumed,resumed);near(row.start,anchor+Math.max(position,sourceStart),'Native onset/source restoration clock');near(row.end,anchor+sourceEnd,'Retained sustain gate');
  const attackIndex=events.findIndex(event=>event.event_id===voice.eventId),pitch=pitchAt(commands,voice.channel,change=>resumed?change.at<position:change.index<attackIndex);
  near(row.pitchSemitones,pitch,'Initial/restored pitch excludes future events');
  const family=PROGRAM_FAMILIES[voice.program>>3],base=440*2**((voice.key-69)/12),silence=audio.receiver.silences.find(call=>call.sequence>row.sequence)?.sequence??Infinity;
  const changes=audio.receiver.retunes.filter(call=>call.sequence>row.sequence&&call.sequence<silence&&call.channel===row.channel&&call.at>=row.start&&call.at<row.end);
  for(const [oscillator,ratio]of [1,family.ratio].entries()){
   const source=audio.sources[(index+(previous?.receiver.schedules.length??0))*2+oscillator];assert.equal(source.wave,oscillator?family.harmonic:family.wave);
   const pitches=[{at:row.start,semitones:pitch},...changes];
   for(const [pitchIndex,want]of pitches.entries()){
    const hz=base*ratio*2**(want.semitones/12),actual=source.frequencies[pitchIndex];assert.ok(hz>=20&&hz<=18000&&hz<=source.sampleRate*.45,'Declared acoustic/device bounds exceeded');
    near(actual.value,hz,'Actual oscillator pitch, without clamping');near(actual.at,want.at,'Actual frequency source clock');
   }
  }
 }
 return {anchor,position};
}
export function validatePitchBendRun(run,fixture) {
 assert.ok(Array.isArray(run.mutedTracks)&&(JSON.stringify(run.mutedTracks)==='[]'||JSON.stringify(run.mutedTracks)==='[1]'));
 assert.ok(finite(run.elapsedMs)&&run.elapsedMs>=fixture.reference.durationSeconds*1000&&run.elapsedMs<15000,'Run did not span full fractional source clock');assert.equal(run.clock,'0:05.0 / 0:05.0');
 silent(run.audio,'full pitch run');const {anchor}=validatePitchSegment(run.audio,fixture,{mutedTracks:run.mutedTracks});
 assert.equal(run.audio.receiver.silences.length,1,'Full run must reach production end cleanup');
 assert.ok(run.audio.receiver.silences[0].currentTime>=anchor+fixture.reference.durationSeconds,'End cleanup preceded exact fractional duration');
 for(const row of run.audio.sources){assert.ok(row.currentTime>=row.stops[0]);assert.ok(row.stops.slice(1).every(at=>at>=row.stops[0]),'Full run was stopped before its retained gate');}
 return run;
}
const sameLedgerPrefix=(before,after)=>{
 for(const field of ['schedules','retunes','silences'])assert.deepEqual(after.receiver[field].slice(0,before.receiver[field].length),before.receiver[field]);
 for(const [index,row]of before.sources.entries()){
  const newer=after.sources[index];for(const field of ['kind','wave','sampleRate','starts'])assert.deepEqual(newer[field],row[field]);
  for(const field of ['frequencies','stops'])assert.deepEqual(newer[field].slice(0,row[field].length),row[field]);
 }
};
export function validatePitchBendInterruption(value,fixture) {
 assert.deepEqual(Object.keys(value).sort(),['playing','paused','resumed','ended','stopped','pauseClock','resumeClock','endClock','stopClock'].sort());
 validateLivePerformanceAudio(value.playing);assert.equal(value.playing.activeSources,6);validatePitchSegment(value.playing,fixture,{complete:false});
 silent(value.paused,'pause');const original=validatePitchSegment(value.paused,fixture,{complete:false});assert.equal(value.paused.receiver.silences.length,1);
 const pausedAt=value.paused.receiver.silences[0].currentTime-original.anchor;assert.ok(pausedAt>=3&&pausedAt<4,'Pause must preserve three pedal-held layers before future center');
 for(const source of value.paused.sources)near(source.stops.at(-1),value.paused.receiver.silences[0].currentTime,'Pause cancels native sources',.01);
 assert.equal(value.pauseClock.before,value.pauseClock.after);assert.match(value.pauseClock.before,/^0:03\.[0-9] \/ 0:05\.0$/);
 validateLivePerformanceAudio(value.resumed);assert.equal(value.resumed.activeSources,6);
 const restored=value.resumed.receiver.schedules.slice(value.paused.receiver.schedules.length);assert.equal(restored.length,3);assert.ok(restored.every(row=>row.resumed));
 const voice=fixture.reference.voices.find(v=>v.eventId===restored[0].eventId),anchor=restored[0].end-performanceSeconds(voice.end),position=restored[0].start-anchor;
 near(position,pausedAt,'Pause/resume source position',.01);
 validatePitchSegment(value.resumed,fixture,{position,complete:false,previous:value.paused});
 silent(value.ended,'resumed end');validatePitchSegment(value.ended,fixture,{position,previous:value.paused});assert.equal(value.ended.receiver.silences.length,2);
 silent(value.stopped,'stop');validatePitchSegment(value.stopped,fixture,{position,previous:value.paused});assert.equal(value.stopped.receiver.silences.length,3);
 assert.equal(value.endClock,'0:05.0 / 0:05.0');assert.equal(value.stopClock,'0:00.0 / 0:05.0');assert.match(value.resumeClock,/^0:03\.[0-9] \/ 0:05\.0$/);
 for(const [before,after]of [[value.playing,value.paused],[value.paused,value.resumed],[value.resumed,value.ended],[value.ended,value.stopped]])sameLedgerPrefix(before,after);
 // Both original releases and later pedal gates remain authoritative source data.
 for(const v of fixture.reference.voices){assert.equal(v.endReason,'sustain_release');assert.notEqual(v.releaseEventId,v.sustainReleaseEventId);assert.ok(performanceSeconds(eventsFor(fixture,v.releaseEventId).exact_microseconds)<performanceSeconds(v.end));}
 return value;
}
const eventsFor=(fixture,id)=>fixture.opened.clean_package.runtime.events.find(event=>event.event_id===id);
const PITCH_DISCLOSURES=Object.freeze(["Pitch-bend reference: every retained 14-bit value sets pitch at its original time for all sounding channel layers, including pedal-held layers. The declared default range is two semitones; only the reviewed initial twelve-semitone setup changes it. Values use (value − 8192) / 8192, with no invented curve between events. Original keys stay unchanged. This is a procedural interpretation, not proof of original tuning, timbre, voice fidelity or complete playability. Percussion bends and melodic oscillator ranges outside 20–18000 Hz remain unavailable; frequencies are never clamped. Pause and resume restore channel state; arbitrary seek is unavailable.", "弯音参考：每个保留的 14 位数值都在原始时刻调整该通道所有发声层，包括踏板保持的声音。明确采用默认 2 半音范围；只有已验证的起音前 12 半音设置可改变它。数值按 (值 − 8192) / 8192 换算，不虚构事件之间的曲线，原始按键音高不变。这是程序化参考解释，不证明原始调音、音色、声部还原或完整可演奏性。打击乐弯音以及超出 20–18000 Hz 的旋律振荡器范围仍不可播放，不会截断频率。暂停与继续重建通道状态；不支持任意跳转。"]);
function validatePitchDisclosure(pitch,chinese=false) {
 assert.equal(pitch.hidden,false);assert.equal(pitch.text,PITCH_DISCLOSURES[chinese?1:0],'The complete bilingual pitch policy must remain exact');
}

function validateChoice(state,fixture,{accepted=false}={}) {
 validatePitchDisclosure(state.pitch);
 assert.equal(state.preview,'performance');assert.equal(state.policy,fixture.reference.policy.id);assert.equal(state.accepted,accepted);assert.equal(state.acceptDisabled,!fixture.reference.playable);assert.equal(state.playDisabled,!accepted||!fixture.reference.playable);assert.equal(state.listenDisabled,true);assert.equal(state.practiceDisabled,true);assert.match(state.notation,/Notation unavailable/);assert.match(state.notation,/Practice targets and grades unavailable/);assert.deepEqual(state.counts,{tracks:fixture.reference.trackCount,events:fixture.reference.eventCount,attacks:fixture.reference.voices.length});assert.equal(state.tracks.length,fixture.reference.trackCount);
 for(const [index,row]of state.tracks.entries()){const track=fixture.reference.tracks[index];assert.equal(row.index,index);assert.equal(row.events,track.source_event_count);assert.equal(row.attacks,fixture.reference.voices.filter(v=>v.trackIndex===index).length);assert.ok(row.text.includes(track.name));assert.equal(row.checked,false);assert.equal(row.disabled,!fixture.reference.playable||!track.independent);}
 const device=fixture.reference.logical_device_mapping?.device_name;
 assert.deepEqual(state.routing,{hidden:!device,text:device?`Logical destination “${device}” is mapped to the selected procedural reference receiver. The source device and timbre are unverified.`:''});
 if(device)assert.equal(state.policyLabel,'I select this reference sound, event playback and logical device mapping policy');
 assert.equal(state.problems.hidden,fixture.reference.playable);
 if(fixture.reference.playable)assert.equal(state.problems.text,'');else assert.match(state.problems.text,/unsupported_pitch_range/);
 silent(state.audio,'policy choice');assert.equal(state.audio.sourceStarts,0,'Load/choice implicitly scheduled sources');assert.deepEqual(state.audio.sources,[]);
 // Selecting/revoking a song honestly stops the previous receiver, even when
 // it is already silent. Cleanup is permitted; loading may not replay commands
 // or allocate a voice before a new explicit policy and Play gesture.
 const receiver=state.audio.receiver;assert.deepEqual(Object.keys(receiver).sort(),['retunes','schedules','silences']);assert.deepEqual(receiver.schedules,[]);assert.deepEqual(receiver.retunes,[]);assert.ok(Array.isArray(receiver.silences)&&receiver.silences.length<=128);for(const [index,row]of receiver.silences.entries()){assert.equal(row.sequence,index+1);assert.equal(row.success,true);assert.ok(finite(row.currentTime)&&row.currentTime>=0);}
}
function validateChineseRoute(state,fixture) {
 validatePitchDisclosure(state.pitch,true);
 const device=fixture.reference.logical_device_mapping?.device_name;
 assert.deepEqual(state.routing,{hidden:!device,text:device?`逻辑目标“${device}”映射到所选程序合成参考接收器。未验证源设备与原始音色。`:''});
 if(device)assert.equal(state.policy,'我选择此参考声音、事件播放与逻辑设备映射策略');
}
export function validatePitchBendPicker(report) {
 assert.ok(Array.isArray(report.pickerObservations));assert.equal(report.pickerObservations.length,report.phase==='pitch-bend-seed'?1:0);
 for(const row of report.pickerObservations){validateVsqPickerGestures(row.gestures);assert.ok(positive(row.sequence)&&row.sequence<=64);assert.equal(row.filename,PITCH_BEND_FIXTURE_FILENAME);assert.equal(row.completed,true);assert.deepEqual(row.delegatedClicks,[{type:'click',trusted:false,id:'score-file',sequence:row.sequence}]);assert.deepEqual(row.changes,[{type:'change',trusted:true,id:'score-file',sequence:row.sequence,filename:PITCH_BEND_FIXTURE_FILENAME}]);assert.equal(report.trusted.filter(e=>e.id==='score-file'&&e.type==='change'&&e.pickerSequence===row.sequence&&e.trusted).length,1);}
 assert.equal(report.trusted.filter(e=>e.id==='score-file'&&e.type==='change').length,report.pickerObservations.length);
}
export function validatePitchBendRenderer(report,pack=pitchBendAcceptanceFixtures()) {
 assert.equal(report.version,1);assert.equal(report.ok,true,report.error);assert.ok(PITCH_BEND_PHASES.includes(report.phase));assert.equal(report.origin,'https://wmh.localhost');assert.equal(report.stage,'complete');assert.equal(report.profileMarkerAbsent,true);assert.deepEqual(report.errors,[]);assert.ok(Array.isArray(report.diagnostics)&&report.diagnostics.length>0&&report.diagnostics.length<=64&&report.diagnostics.every(r=>typeof r.stage==='string'&&finite(r.elapsedMs)));
 const checks=[...PITCH_BEND_CHECKS,...(report.phase==='pitch-bend-seed'?['chooser-preflight-all-songs-all-tracks-save','exact-complete-pack-export']:['fresh-process-rpn12-pitch-reconstruction'])];assert.deepEqual([...report.checks].sort(),checks.sort());assert.equal(report.inventory.length,pack.fixtures.length);assert.equal(new Set(report.inventory.map(e=>e.key)).size,pack.fixtures.length);assert.equal(report.opened.length,pack.fixtures.length);
 for(const f of pack.fixtures){const entry=report.inventory.find(e=>e.key===f.key),opened=report.opened.find(e=>e.key===f.key);assert.ok(entry&&opened);assert.equal(entry.score_id,f.metadata.id);assert.equal(entry.title,f.metadata.title);assert.equal(entry.library_format_version,2);assert.equal(entry.revision,1);assert.equal(entry.content_sha256,f.opened.clean_package.content_sha256);assert.equal(entry.score_sha256,f.metadata.score.sha256);assert.equal(entry.score_bytes,f.files.get('score.json').length);assert.equal(entry.retained_source,null);assert.deepEqual(entry.clean_package,f.summary);assert.deepEqual({score_json:opened.score_json,clean_package:opened.clean_package},f.opened,'Exact null-notation native package changed');}
 const wanted=pack.fixtures.filter(f=>f.name===(report.phase==='pitch-bend-seed'?'performance-pitch-default2-v2':'performance-pitch-proved12-v2'));assert.equal(wanted.length,1);assert.equal(report.variants.length,wanted.length);assert.equal(new Set(report.variants.map(v=>v.key)).size,wanted.length);
 for(const variant of report.variants){const f=wanted.find(f=>f.key===variant.key);assert.ok(f);validateChoice(variant.beforeChoice,f);validateChoice(variant.afterChoice,f,{accepted:true});validateChoice(variant.reloadChoice,f);validateChineseRoute(variant.chineseChoice,f);assert.match(variant.chineseChoice.coverage,/记谱不可用/);assert.match(variant.chineseChoice.coverage,/评分不可用/);assert.match(variant.chineseChoice.policy,/[\u3400-\u9fff]/);
  assert.deepEqual(variant.runs.map(r=>r.mutedTracks),[[],[1]],'Both phases must prove the complete run and melody-track mute');for(const run of variant.runs)validatePitchBendRun(run,f);
  assert.deepEqual(Object.keys(variant.liveCapture).sort(),['after','before']);for(const value of Object.values(variant.liveCapture)){validateLivePerformanceAudio(value);validatePitchSegment(value,f,{complete:false});}
  validatePitchBendInterruption(variant.interruption,f);silent(variant.navigationAudio,'navigation');validatePitchSegment(variant.navigationAudio,f,{complete:false});assert.ok(variant.navigationAudio.receiver.schedules.length>0&&variant.navigationAudio.receiver.schedules.every(row=>!row.resumed),'Navigation must stop a real fresh zero-position run');

 }
 const blocked=pack.fixtures.filter(f=>!f.reference.playable);assert.equal(blocked.length,1);assert.equal(report.blocked.length,blocked.length);
 for(const f of blocked){const value=report.blocked.find(v=>v.key===f.key);assert.ok(value);validateChoice(value.beforeChoice,f);validateChoice(value.afterChoice,f);validateChineseRoute(value.chineseChoice,f);}
 assert.deepEqual(report.beforeTakeState,report.afterTakeState,'Reference playback changed prior human take');assert.ok(Array.isArray(report.requests)&&report.requests.length<=128);assert.ok(Number.isSafeInteger(report.referenceRequestStart)&&report.referenceRequestStart>=0&&report.referenceRequestStart<=report.requests.length);assert.ok(!report.requests.slice(report.referenceRequestStart).some(r=>/assess|fingering|\/api\/compile|notation-navigation|\/api\/library\/runtime/.test(r.path)),'Reference-only song requested notation/targets/scoring/fingering');
 const baseline=report.baselineScope;assert.equal(baseline.humanActionStart,report.phase==='pitch-bend-seed'?4:0);assert.equal(baseline.humanActionEnd,baseline.humanActionStart+3);assert.equal(baseline.readyAfterAction,baseline.humanActionEnd+1);assert.ok(baseline.readyAfterAction<report.actions);
 assert.equal(report.originalScoreSetup.kind,'scripted-menu');assert.ok(typeof report.originalScoreSetup.previewId==='string'&&report.originalScoreSetup.previewId.length>0&&!report.originalScoreSetup.previewId.startsWith('native:'));assert.ok(typeof report.originalScoreSetup.title==='string'&&report.originalScoreSetup.title.length>0);
 if(report.phase==='pitch-bend-seed'){
  const setup=report.importSetup;assert.equal(setup.actionStart,0);assert.equal(setup.actionEnd,baseline.humanActionStart);assert.deepEqual(setup.after,setup.before,'Import changed the original preview or active score/take');assert.equal(setup.before.screen,'library');assert.equal(setup.before.previewStatus,'ready');assert.equal(setup.before.previewId,report.originalScoreSetup.previewId);assert.equal(setup.before.previewTitle,report.originalScoreSetup.title);assert.equal(setup.before.resumeHidden,true);assert.equal(setup.before.playDisabled,true);assert.equal(setup.before.resultsDisabled,true);assert.equal(setup.before.captured,'0');assert.ok(!setup.before.pass&&!setup.before.revision);
  silent(setup.audio,'import');assert.equal(setup.audio.sourceStarts,0);assert.deepEqual(setup.audio.sources,[]);assert.ok(Number.isSafeInteger(setup.requestStart)&&setup.requestStart>=0&&Number.isSafeInteger(setup.requestEnd)&&setup.requestEnd>setup.requestStart&&setup.requestEnd<=report.referenceRequestStart);const requests=report.requests.slice(setup.requestStart,setup.requestEnd);assert.deepEqual(requests.filter(r=>r.path.startsWith('/api/library/import/')).map(r=>r.path),['/api/library/import/preview','/api/library/import/commit']);assert.ok(!requests.some(r=>/assess|fingering|\/api\/compile|practice-targets|\/api\/library\/runtime/.test(r.path)),'Import created targets, scoring or a canonical score');assert.equal(report.pickerObservations[0]?.sequence,1);
 }else assert.equal(report.importSetup,undefined);
 assert.ok(Array.isArray(report.trusted)&&report.trusted.length<=256&&report.trusted.every(r=>r.trusted===true),'Untrusted performance input/control event');validatePitchBendPicker(report);for(const id of ['stage-title','complete-performance-title'])for(const type of ['keydown','keyup'])assert.equal(report.trusted.filter(row=>row.id===id&&row.type===type&&row.code==='KeyR').length,1,'Each actual input surface needs a trusted key pair');assert.equal(report.trusted.filter(e=>e.id==='complete-performance-policy-accept'&&e.type==='change'&&e.checked===true).length,wanted.length);
 for(const f of wanted)for(const i of [1])for(const checked of [true,false])assert.ok(report.trusted.some(e=>e.id===`complete-performance-mute-${i}`&&e.type==='change'&&e.checked===checked),'Track mute lacks actual trusted change');
 const expectedImports=report.phase==='pitch-bend-seed'?['preview','commit']:[];assert.deepEqual(report.imports.map(r=>r.path),expectedImports.map(s=>'/api/library/import/'+s));assert.deepEqual(report.responseObservations,report.imports.map(r=>({path:r.path,status:200,state:'consumed'})));
 for(const [index,r]of report.imports.entries()){assert.equal(r.status,200);assert.equal(r.body.source.sha256,pack.manifest.sha256);assert.equal(r.body.source.bytes,pack.bytes.length);assert.equal(r.body.source.retained,index===1);assert.equal(r.body.items.length,pack.fixtures.length);for(const f of pack.fixtures){const item=r.body.items.find(i=>i.clean_package?.content_sha256===f.summary.content_sha256);assert.ok(item);assert.equal(item.playable,false);assert.equal(item.status,index===0?'ready':'saved');assert.deepEqual(item.clean_package,f.summary);}}
 if(report.phase==='pitch-bend-seed'){assert.equal(report.preflight.length,pack.fixtures.length);for(const p of report.preflight){assert.equal(p.status,'ready');assert.equal(p.playable,false);}assert.deepEqual(report.preflight.map(p=>p.coverage.performance.source_tracks).sort((a,b)=>a-b),pack.fixtures.map(f=>f.reference.trackCount).sort((a,b)=>a-b));}
 assert.ok(positive(report.actions)&&report.actions<=64);const roles=report.phase==='pitch-bend-seed'?['beforeTake','afterTake','package']:['beforeTake','afterTake'];assert.deepEqual(Object.keys(report.files).sort(),roles.sort());assert.equal(report.downloads.length,roles.length);assert.equal(new Set(Object.values(report.files)).size,roles.length);for(const [role,file]of Object.entries(report.files)){assert.match(file,new RegExp(`^${report.phase}-(?:[1-9]|1[0-6])\\.${role==='package'?'zip':'json'}$`));assert.equal(report.downloads.filter(d=>d.file===file&&d.complete&&d.success).length,1);}
 return report;
}
async function boundedFile(directory,path,limit=PITCH_BEND_REPORT_BYTES){assert.ok(typeof path==='string'&&path.length<1024&&!/[\\\0\r\n:]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe performance evidence path');let full=directory;for(const [index,part]of path.split('/').entries()){full=join(full,part);const s=await lstat(full);assert.ok(!s.isSymbolicLink()&&(index===path.split('/').length-1?s.isFile()&&s.size>0&&s.size<=limit:s.isDirectory()),`Invalid bounded performance evidence ${path}`);}return readFile(full);}
export async function verifyNativePitchBendEvidence(directory){
 const pack=pitchBendAcceptanceFixtures(),files=[],read=async(path,limit)=>{const b=await boundedFile(directory,path,limit);files.push({path,bytes:b.length,sha256:digest(b)});return b;},json=async(path,limit)=>JSON.parse((await read(path,limit)).toString());
 const native=await json('native-pitch-bend.json');assert.equal(native.version,1);assert.equal(native.ok,true);assert.equal(native.scenario,'pitch-bend');assert.equal(native.profile_reused,false);assert.match(native.os,/Windows/);for(const k of ['source_sha','source_tree'])assert.match(native[k],/^[a-f0-9]{40}$/);assert.ok(sha(native.executable_sha256)&&positive(native.executable_bytes));assert.deepEqual(native.phases.map(p=>p.phase),PITCH_BEND_PHASES);assert.equal(new Set(native.phases.map(p=>p.process_id)).size,2);
 assert.deepEqual(await json('fixtures/pitch-bend-fixtures.json'),pack.manifest);assert.deepEqual(await read(`fixtures/${PITCH_BEND_FIXTURE_FILENAME}`),pack.bytes);const reports={};
 for(const host of native.phases){const phase=host.phase,r=validatePitchBendRenderer(await json(`renderer-${phase}.json`),pack);reports[phase]=r;assert.equal(r.actions,host.actions);assert.equal(r.directory,native.directory);for(const k of ['renderer_ok','normal_close','launched_new_process','profile_fresh'])assert.equal(host[k],true);assert.equal(host.profile_reused,false);assert.equal(host.executable_tcp_listeners,0);assert.equal(host.renderer_origin,'https://wmh.localhost');assert.ok(positive(host.process_id));
  const actions=[];for(let n=1;n<=host.actions;n++){const a=await json(`action-${phase}-${n}.json`,16*1024),result=await json(`result-${phase}-${n}.json`,256*1024);assert.equal(a.version,1);assert.equal(a.sequence,n);assert.ok(['click','picker','key-r'].includes(a.kind));assert.ok([a.x,a.y,a.width,a.height].every(finite)&&a.x>0&&a.x<a.width&&a.y>0&&a.y<a.height);assert.equal(result.ok,true);const c=result.client_click;assert.ok(c&&positive(c.app_hwnd)&&c.foreground===c.app_hwnd&&c.hit_hwnd>0);assert.deepEqual(c.actual,c.requested);assert.deepEqual(c.viewport,[a.width,a.height]);if(a.kind==='picker'){const o=result.owned_dialog,p=result.picker_completion;assert.ok(o?.class==='#32770'&&positive(o.hwnd)&&o.process_id===host.process_id&&o.app_process_id===host.process_id&&o.root_owner_hwnd===o.app_hwnd&&p?.dialog_dismissed===true&&p.app_enabled===true&&p.owned_popup_visible===false,'Native picker ownership absent');}actions.push(a);}
  assert.equal((await readdir(directory)).filter(n=>n.startsWith(`action-${phase}-`)||n.startsWith(`result-${phase}-`)).length,2*host.actions);assert.deepEqual(actions.filter(a=>a.kind==='picker').map(a=>a.file),phase==='pitch-bend-seed'?[PITCH_BEND_FIXTURE_FILENAME]:[]);assert.deepEqual(r.pickerObservations.map(p=>p.sequence),actions.filter(a=>a.kind==='picker').map(a=>a.sequence));assert.equal(actions.filter(a=>a.kind==='key-r').length,2);
  assert.deepEqual(actions.slice(r.baselineScope.humanActionStart,r.baselineScope.humanActionEnd).map(a=>a.kind),['click','key-r','click'],'Human transport proof must follow completed picker/import setup');assert.ok(actions.filter(a=>a.kind==='picker').every(a=>a.sequence<=r.baselineScope.humanActionStart));
  const screenshotRoles=[...(phase==='pitch-bend-seed'?['preflight']:[]),'choice','playing','bounds'];assert.deepEqual(Object.keys(r.screenshots).sort(),screenshotRoles.sort());for(const role of screenshotRoles){const n=r.screenshots[role];assert.ok(positive(n)&&n<=actions.length&&actions[n-1].kind==='click');validateCleanScreenshot(await read(`native-action-${phase}-${n}.png`,16*1024*1024));}validateCleanScreenshot(await read(`native-${phase}.png`,16*1024*1024));
  validatePerformanceTakes(await json(`downloads/${r.files.beforeTake}`),await json(`downloads/${r.files.afterTake}`),r,pack);if(phase==='pitch-bend-seed')validatePerformanceExport(await read(`downloads/${r.files.package}`),pack);
 }
 for(const phase of PITCH_BEND_PHASES.slice(1))assert.deepEqual(reports[phase].inventory,reports[PITCH_BEND_PHASES[0]].inventory,'Fresh-process library changed');
 const rows=[];async function walk(relative){const full=join(directory,'Scores',relative),s=await lstat(full);assert.ok(!s.isSymbolicLink());if(s.isDirectory()){for(const name of await readdir(full))await walk(`${relative}/${name}`);}else{const b=await read(`Scores/${relative}`,8*1024*1024);rows.push({path:relative,bytes:b.length,sha256:digest(b)});}}
 for(const area of ['clean-songs','clean-backups']){assert.deepEqual((await readdir(join(directory,'Scores',area))).sort(),pack.fixtures.map(f=>f.key).sort());for(const f of pack.fixtures){assert.deepEqual(await json(`Scores/${area}/${f.key}/entry.json`),reports[PITCH_BEND_PHASES[0]].inventory.find(e=>e.key===f.key));for(const [name,b]of f.files)assert.deepEqual(await read(`Scores/${area}/${f.key}/package/${name}`),b);}await walk(area);for(const f of pack.fixtures)assert.deepEqual(rows.filter(r=>r.path.startsWith(`${area}/${f.key}/`)).map(r=>r.path.slice(`${area}/${f.key}/`.length)).sort(),['entry.json','package/metadata.json','package/score.json']);}
 for(const area of ['imports','import-backups']){await walk(area);assert.deepEqual(rows.filter(r=>r.path.startsWith(`${area}/`)&&r.path.endsWith('/source.bin')).map(r=>r.sha256),[pack.manifest.sha256]);}
 for(const phase of PITCH_BEND_PHASES){const snapshot=await json(`snapshot-${phase}.json`);assert.equal(snapshot.version,1);assert.deepEqual(sort(snapshot.files),sort(rows));}
 return{version:1,ok:true,source_sha:native.source_sha,source_tree:native.source_tree,executable_sha256:native.executable_sha256,executable_bytes:native.executable_bytes,fixture_sha256:pack.manifest.sha256,claims:{...PITCH_BEND_CLAIMS},files:sort([...new Map(files.map(f=>[f.path,f])).values()])};
}
async function main(){const args=process.argv.slice(2),check=args.includes('--check'),paths=args.filter(a=>a!=='--check');assert.ok(paths.length===1&&args.length===(check?2:1),'Usage: node scripts/verify-native-pitch-bend-evidence.mjs [--check] <directory>');const directory=resolve(paths[0]),path=join(directory,'native-pitch-bend-files.json');if(!check)await rm(path,{force:true});const proof=await verifyNativePitchBendEvidence(directory);if(check)assert.deepEqual(JSON.parse(await readFile(path)),proof);else await writeFile(path,JSON.stringify(proof,null,2)+'\n');console.log('Verified source-bound native original pitch-bend picker, clock-exact receiver events, input isolation, exact bytes and fresh restart');}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
