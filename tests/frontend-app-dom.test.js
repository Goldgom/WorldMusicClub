import {waitForTestCondition} from './async-test-wait.js';
import {unavailablePianoResult} from './piano-fingering-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {beat,pitchMidi} from '../web/music.js';
import {InputEvidence} from '../web/input-evidence.js';
import {Synth} from '../web/transport.js';
import {getAppI18n} from '../web/app-locale.js';

// Node DOM integration only: no browser, layout engine, real audio or HTTP is run.
test('application module initializes the lobby and activates only through explicit Start',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
 // UI/export work and setImmediate polling must not consume the mock score's
 // 1000 ms performance window. Only explicit input events advance this clock;
 // real timers still run normally, and epoch timestamps keep a real timeOrigin.
 let eventWall=1000;const timeOrigin=performance.timeOrigin;
 const advanceEventTime=milliseconds=>{assert.ok(Number.isFinite(milliseconds)&&milliseconds>0);eventWall+=milliseconds;return eventWall;};
 const requests=[],values=new Map();let audioContexts=0,unlockCalls=0,holdCheck=null,heldCheck=null,holdCompile=null,heldCompile=false;
 const originalEvidenceStart=InputEvidence.prototype.start,originalCreateUrl=URL.createObjectURL,originalUnlock=Synth.prototype.unlock,originalPlay=Synth.prototype.play;
 Synth.prototype.unlock=function(...args){unlockCalls++;return originalUnlock.apply(this,args)};
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>paint;
 const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}};
 class Audio{constructor(){audioContexts++;this.state='running';this.currentTime=0;this.destination={}}createGain(){return{gain:{...param},connect(){},disconnect(){}}}createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){},stop(){}}}}
 const compile=score=>({score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],velocity:note.velocity,part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff}))),duration_ms:1000},diagnostics:[]});
 const item={id:fixture.id,title:fixture.title,composer:fixture.composer,provenance:fixture.provenance,written_event_count:2,pitched_note_count:2,rest_count:0,opening_bpm:120,part_count:1};
 const otherScore={...structuredClone(fixture),id:'other-preview',title:'Another selected score'};
 const installed={window,document,performance:{now:()=>eventWall,timeOrigin},location:{origin:'http://local-node-dom.invalid'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},AudioContext:Audio,fetch:async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({path,body});let result;
  if(path==='/api/catalog/index')result={version:1,items:[item,{...item,id:otherScore.id,title:otherScore.title}]};
  else if(path==='/api/catalog/score/'+fixture.id)result=structuredClone(fixture);
  else if(path==='/api/catalog/score/'+otherScore.id)result=structuredClone(otherScore);
  else if(path==='/api/compile')result=compile(body);
  else if(path==='/api/transposition/preview'){const score=structuredClone(body.score);for(const part of score.parts)for(const note of part.notes)if(note.pitch)note.pitch.octave++;score.id+=':semitones:+12';score.title+=' [+12 semitones]';score.source={format:'semitone-transposition',filename:null,content:JSON.stringify({version:1,operation:body.operation,original:body.score}),import_diagnostics:[{severity:'warning',code:'explicit_semitone_transposition',message:'Keep original JSON',note_id:null}]};const compilation=compile(score);result={compilation,operation:body.operation,written_interval:{diatonic_steps:7,fifths_delta:0},changed_note_count:score.parts.flatMap(part=>part.notes).filter(note=>note.pitch).length,original_preserved:true,scored_mode_allowed:true,instrument_report:{lowest_midi:36,highest_midi:96,note_options:compilation.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false}};}
  else if(path==='/api/transposition/restore')result=compile(JSON.parse(body.source.content).original);
  else if(path==='/api/practice-targets')result={timeline:body.timeline,groups:body.timeline.notes.map(note=>({target_id:note.id,source_occurrence_ids:[note.id],source_note_ids:[note.id],part_ids:[note.part_id]})),diagnostics:[],source_note_count:body.timeline.notes.length,target_count:body.timeline.notes.length,playable:true};
  else if(path==='/api/fingering/piano')result=unavailablePianoResult(body,compile(body.score).timeline);
  else if(path==='/api/instrument-check')result={lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false};
  else if(path==='/api/assess'){
   const counts=new Map();for(const note of body.timeline.notes)counts.set(note.midi,(counts.get(note.midi)||0)+1);
   result={hits:[],misses:body.timeline.notes.map(note=>note.id),extras:[],accuracy_percent:0,mean_abs_error_ms:null,summary:{expected_notes:body.timeline.notes.length,coverage_percent:0,timing_bias_ms:null,timing_stddev_ms:null,advice:[{code:'missed_targets',severity:'warning',message:'Retained original diagnostic <b>verbatim</b>'}]},pitch_breakdown:[...counts].sort(([a],[b])=>a-b).map(([midi,expected])=>({midi,expected,matched:0,missed:expected,extra:0,mean_abs_error_ms:null,timing_bias_ms:null})),grade_counts:{perfect:0,good:0,early:0,late:0,missed:2,extra:0},onset_completion:{total:2,complete:0,longest_complete_sequence:0}};
  }
  else throw Error(`Unexpected Node DOM test request: ${path}`);
  if(path==='/api/compile'&&holdCompile){const gate=holdCompile;holdCompile=null;heldCompile=true;await gate;}
  if(path==='/api/instrument-check'&&holdCheck){const gate=holdCheck;holdCheck=null;heldCheck=true;await gate;}
  return{ok:true,json:async()=>result};
 }};
 const originals=new Map(Object.keys(installed).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const[key,value]of Object.entries(installed))Object.defineProperty(globalThis,key,{configurable:true,value});
 const until=(predicate,label)=>waitForTestCondition(predicate,{label});
 try{
  await import('../web/app.js?node-shell-initialization');
  await until(()=>!document.getElementById('start-practice').disabled,'Preview never became ready');
  const i18n=getAppI18n(document);
  const switchLanguage=locale=>{const picker=document.getElementById('interface-language');picker.value=locale;picker.dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal(i18n.locale,locale);};
  assert.equal(i18n.locale,'zh-CN');assert.equal(document.documentElement.lang,'zh-CN');
  assert.match(document.getElementById('preview-status').textContent,/聆听乐谱/);
  assert.match(document.getElementById('preview-gate').textContent,/键盘音域/);
  assert.equal(document.getElementById('preview-part').firstElementChild.textContent,'所有声部');
  assert.match(document.querySelector('.catalog-item small').textContent,/谱面事件/);
  assert.match(document.querySelector('#keyboard [data-midi="60"]').getAttribute('aria-label'),/^弹奏 C4$/);
  const initialRequests=requests.length;switchLanguage('en');assert.equal(requests.length,initialRequests);
  assert.equal(document.getElementById('preview-title').textContent,fixture.title,'Source title survives an explicit locale switch');
  assert.equal(document.getElementById('preview-part').firstElementChild.textContent,'All parts');
  assert.match(document.querySelector('.catalog-item small').textContent,/Written events/);
  assert.equal(document.body.dataset.screen,'home');document.getElementById('home-single-player').click();assert.equal(document.body.dataset.screen,'library');assert.equal(audioContexts,0);assert.equal(document.getElementById('resume-session').hidden,true);assert.equal(requests.filter(r=>r.path==='/api/compile').length,1);assert.equal(requests.some(r=>r.path==='/api/export/musicxml'),false,'Hidden notation is not engraved');
  const originalCard=document.querySelector('.catalog-item');originalCard.click();await until(()=>!document.getElementById('start-practice').disabled,'Reselected preview never became ready');assert.ok(document.querySelector('.catalog-item')===originalCard,'Preview readiness must not detach a card being focused or clicked');
  document.getElementById('start-listen').click();await until(()=>document.body.dataset.screen==='stage'&&!document.getElementById('start-listen').disabled,'Start never entered the stage');
  assert.equal(audioContexts,1);assert.equal(document.getElementById('stage-title').textContent,fixture.title);assert.equal(document.getElementById('resume-session').hidden,false);assert.equal(requests.filter(r=>r.path==='/api/compile').length,3);assert.equal(requests.filter(r=>r.path==='/api/instrument-check').length,3,'Activation rechecks the actual target setup');
  document.getElementById('back-to-library').click();assert.equal(document.body.dataset.screen,'library');assert.match(document.getElementById('play-button').textContent,/Play/);assert.match(document.getElementById('preview-gate').textContent,/keyboard/);assert.doesNotMatch(document.getElementById('preview-gate').textContent,/Guitar|fingering/);const count=requests.length;
  document.getElementById('resume-session').click();assert.equal(document.body.dataset.screen,'stage');assert.equal(requests.length,count);assert.match(document.getElementById('play-button').textContent,/Play/);
  document.getElementById('settings-button').click();assert.equal(document.getElementById('settings-dialog').open,true);assert.match(document.getElementById('play-button').textContent,/Play/);
  document.getElementById('settings-dialog').close();document.getElementById('back-to-library').click();
  let release;holdCheck=new Promise(resolve=>{release=resolve});document.querySelector('.catalog-item').click();await until(()=>heldCheck,'Preview check did not enter its pending state');
  assert.equal(document.getElementById('start-practice').disabled,true);document.getElementById('settings-button').click();const range=document.getElementById('key-count');range.value='custom';range.dispatchEvent(new window.Event('change'));
  assert.equal(document.getElementById('start-practice').disabled,true,'Dirty setup invalidates admission synchronously');release();await until(()=>document.getElementById('song-lobby').dataset.previewStatus==='ready'&&!document.getElementById('start-listen').disabled&&document.getElementById('preview-gate').textContent.includes('Apply your edited'),'Dirty setup was not preserved');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('start-practice').disabled,true);assert.equal(document.getElementById('start-listen').disabled,false);assert.equal(document.getElementById('stage-title').textContent,fixture.title);
  document.getElementById('settings-dialog').close();const details=document.querySelector('.preview-copy');details.scrollTop=240;document.getElementById('preview-notices').open=true;
  document.querySelector(`[data-score-id="${otherScore.id}"]`).click();await until(()=>document.getElementById('preview-title').textContent===otherScore.title&&!document.getElementById('start-listen').disabled,'Changed preview never became ready');
  assert.equal(details.scrollTop,0,'A different score opens at its title instead of inheriting the old source-notice scroll');assert.equal(document.getElementById('preview-notices').open,false,'Source notices for a different score begin collapsed');assert.equal(document.getElementById('stage-title').textContent,fixture.title,'Preview positioning does not replace the active take');
  document.getElementById('resume-session').click();document.getElementById('settings-button').click();
  range.value='61';range.dispatchEvent(new window.Event('change'));await until(()=>!document.getElementById('play-button').disabled,'Instrument setup never recovered');
  const mode=document.getElementById('session-mode');mode.value='practice';mode.dispatchEvent(new window.Event('change'));await until(()=>!document.getElementById('assess-button').disabled,'Practice never became ready');document.getElementById('settings-dialog').close();
  document.getElementById('results-button').click();document.getElementById('assess-button').click();await until(()=>!document.getElementById('feedback-results').hidden,'Assessment was not rendered');
  assert.equal(document.getElementById('result-summary').dataset.passId,'1');assert.equal(document.getElementById('result-summary').dataset.assessedRevision,'0');assert.equal(document.getElementById('result-grade-missed').textContent,'2');assert.equal(document.getElementById('result-onsets-complete').textContent,'0 / 2');assert.match(document.getElementById('result-summary-status').textContent,/Previous check/);assert.deepEqual(requests.find(request=>request.path==='/api/assess').body.inputs,[]);
  const resultIdentity=document.getElementById('result-summary').dataset.passId,assessmentCalls=requests.filter(r=>r.path==='/api/assess').length;
  const retainedDiagnostic=document.querySelector('#feedback-advice details p');
  assert.equal(retainedDiagnostic.textContent,'missed_targets: Retained original diagnostic <b>verbatim</b>');assert.equal(retainedDiagnostic.querySelector('b'),null);
  switchLanguage('zh-CN');assert.equal(document.getElementById('results-dialog').open,true);assert.equal(document.getElementById('result-summary').dataset.passId,resultIdentity);
  assert.match(document.querySelector('#feedback-advice li > span').textContent,/多个预期起音未匹配/);
  assert.match(document.getElementById('pitch-breakdown-status').textContent,/这些数据由 Rust/);
  assert.match(document.getElementById('pitch-breakdown-body').textContent,/没有匹配的起音/);
  assert.match(document.getElementById('feedback-detail').textContent,/匹配窗口/);assert.equal(retainedDiagnostic.textContent,'missed_targets: Retained original diagnostic <b>verbatim</b>');
  assert.equal(requests.filter(r=>r.path==='/api/assess').length,assessmentCalls,'Results locale redraw does not resubmit an assessment');
  switchLanguage('en');assert.match(document.querySelector('#feedback-advice li > span').textContent,/Several expected onsets/);
  document.getElementById('results-dialog').close();document.getElementById('reset-button').click();assert.equal(document.getElementById('feedback-results').hidden,true);
  const instrument=document.getElementById('instrument');instrument.value='guitar';instrument.dispatchEvent(new window.Event('change'));await until(()=>!document.getElementById('play-button').disabled,'Guitar target verification never completed');document.getElementById('reset-button').click();
  assert.equal(document.getElementById('piano-stage').hidden,true);assert.equal(document.getElementById('guitar-stage').hidden,false);assert.match(document.getElementById('practice-hint').textContent,/upcoming pitch times/);assert.doesNotMatch(document.getElementById('practice-hint').textContent,/reaches the line/);assert.equal(document.getElementById('stage-cue-main').textContent,'READY');assert.equal(document.getElementById('stage-cue').closest('#piano-stage'),null);
  const guitarPlan=requests.filter(r=>r.path==='/api/practice-targets'&&r.body.profile.kind==='guitar').at(-1).body.timeline;
  assert.deepEqual([...document.querySelectorAll('.guitar-target')].map(item=>[item.dataset.targetId,Number(item.dataset.startMs)]),guitarPlan.notes.map(note=>[note.id,note.start_ms]));assert.equal(document.querySelectorAll('.fret-button').length,78);
  const key=document.querySelector('.fret-button');key.setPointerCapture=()=>{};
  const emit=(target,type,properties={},basis='monotonic')=>{const at=advanceEventTime(1),event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{repeat:false,...properties});Object.defineProperty(event,'timeStamp',{value:basis==='epoch'?timeOrigin+at:at});target.dispatchEvent(event);return at;};
  const enter={key:'Enter',code:'Enter'},typing={key:'r',code:'KeyR'};
  // A released pointer ID can be reused at the same pitch before its old audio
  // unlock resolves. Only the newest physical contact may start a voice.
  const countingUnlock=Synth.prototype.unlock;let resolveOldUnlock,holdFirstUnlock=true;const manualStarts=[];
  Synth.prototype.unlock=function(...args){if(holdFirstUnlock){holdFirstUnlock=false;return new Promise(resolve=>{resolveOldUnlock=resolve})}return countingUnlock.apply(this,args)};
  Synth.prototype.play=function(...args){if(String(args[0]).startsWith('manual:'))manualStarts.push(args);return originalPlay.apply(this,args)};
  emit(key,'pointerdown',{pointerId:72,button:0});emit(key,'pointerup',{pointerId:72});emit(key,'pointerdown',{pointerId:72,button:0});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(manualStarts.length,1,'The fresh reused pointer contact starts its own audio');
  resolveOldUnlock();await new Promise(resolve=>setImmediate(resolve));assert.equal(manualStarts.length,1,'A late unlock from the released same-source, same-pitch contact cannot retrigger audio');
  emit(key,'pointerup',{pointerId:72});Synth.prototype.unlock=countingUnlock;Synth.prototype.play=originalPlay;

  assert.equal(document.querySelector('#keyboard [data-midi="60"] .key-shortcut').textContent,'R','The current displayed physical mapping identifies C4');
  assert.equal(document.querySelectorAll('#keyboard-map [data-code]').length,47);
  document.getElementById('sound-button').click();const beforeSilentUnlock=unlockCalls;
  emit(document.body,'keydown',typing);emit(document.body,'keyup',typing);
  assert.equal(unlockCalls,beforeSilentUnlock,'Silent physical input never calls AudioContext unlock');
  document.getElementById('sound-button').click();
  let blob;URL.createObjectURL=value=>{blob=value;return 'blob:node-evidence-test'};
  const exportTake=async()=>{document.getElementById('export-takes').click();return JSON.parse(await blob.text())};
  const startPractice=async()=>{document.getElementById('count-in').checked=false;document.getElementById('play-button').click();await until(()=>document.getElementById('play-button').textContent.includes('Pause'),'Practice did not start')};
  await startPractice();
  const unchangedScore=document.getElementById('score-title').textContent;
  const runningBefore=await exportTake(),runningRequests=requests.length;
  const draft=document.getElementById('custom-lowest');draft.value='D#3';
  const draftNode=draft,heldNode=document.querySelector('#keyboard [data-midi="60"]');
  switchLanguage('zh-CN');
  assert.equal(document.getElementById('play-button').textContent,'Ⅱ 暂停');
  assert.match(document.getElementById('practice-hint').textContent,/按即将出现/);
  assert.match(document.getElementById('practice-scope').textContent,/所有声部/);
  assert.match(document.getElementById('feedback-pass').lastElementChild.textContent,/第 1 次练习/);
  assert.match(document.querySelector('.fret-button').getAttribute('aria-label'),/^第 1 弦/);
  assert.equal(document.getElementById('score-title').textContent,unchangedScore);
  assert.equal(document.getElementById('custom-lowest'),draftNode);assert.equal(draft.value,'D#3');assert.equal(document.querySelector('#keyboard [data-midi="60"]'),heldNode);
  assert.deepEqual(await exportTake(),runningBefore,'Changing language while recording preserves every take, input, clock segment, evidence event, and configuration');
  assert.equal(requests.length,runningRequests,'Language redraw does not recompile, validate, assess, or prepare a new request');
  switchLanguage('en');assert.equal(document.getElementById('play-button').textContent,'Ⅱ Pause');assert.deepEqual(await exportTake(),runningBefore);
  const initialKeyboardExport=(await exportTake()).keyboard_input_configuration;
  assert.equal(initialKeyboardExport.current_configuration.mapping.length,47);
  assert.equal(initialKeyboardExport.current_configuration.base_midi,36);
  const targetsBefore=structuredClone((await exportTake()).target_plan);
  emit(document.getElementById('stage-title'),'keydown',{key:'ArrowRight',code:'ArrowRight'});emit(document.getElementById('stage-title'),'keyup',{key:'ArrowRight',code:'ArrowRight'});
  emit(document.getElementById('play-button'),'keydown',{key:'ArrowUp',code:'ArrowUp'});emit(document.getElementById('play-button'),'keyup',{key:'ArrowUp',code:'ArrowUp'});
  const shiftedOnsetTime=emit(document.getElementById('stage-title'),'keydown',{key:'a',code:'KeyR'},'epoch');const shiftedReleaseTime=emit(document.getElementById('stage-title'),'keyup',{key:'a',code:'KeyR'});
  assert.equal(shiftedReleaseTime-shiftedOnsetTime,1,'Physical release follows its onset by a positive explicit interval');
  const shiftedTake=await exportTake();assert.equal(shiftedTake.input_evidence.events.filter(event=>event.kind==='note_on').at(-1).midi,61,'Evidence retains the actual input-shifted pitch from the physical code');
  const shiftedEvidence=shiftedTake.input_evidence.events.filter(event=>event.kind==='note_on').at(-1);
  assert.equal(shiftedEvidence.timestamp_basis,'event_epoch');assert.equal(shiftedEvidence.raw_timestamp_ms,timeOrigin+shiftedOnsetTime);assert.equal(shiftedEvidence.event_wall_ms,shiftedOnsetTime);assert.equal(shiftedEvidence.received_wall_ms,shiftedOnsetTime);
  assert.equal(shiftedTake.passes.at(-1).inputs.at(-1).midi,61);assert.equal(shiftedTake.keyboard_input_configuration.current_configuration.transpose_semitones,1,'Focused widget arrows never transpose');
  assert.deepEqual(shiftedTake.target_plan,targetsBefore);assert.equal(document.getElementById('score-title').textContent,unchangedScore);
  emit(document.body,'keydown',{key:'ArrowLeft',code:'ArrowLeft'});emit(document.body,'keyup',{key:'ArrowLeft',code:'ArrowLeft'});
  assert.equal(document.querySelector('#keyboard [data-midi="60"] .key-shortcut').textContent,'R');
  // A real validation notice can be read and dismissed while playing without
  // recording its keyboard controls, retrying a request or pausing the take.
  const beforeNotice=await exportTake(),beforeNoticeRequests=requests.length;
  const beforeNoticeControls=['score-title','transport-status','play-button','practice-gate','retry-assessments','diagnostic-list'].map(id=>document.getElementById(id).outerHTML);
  document.getElementById('tempo').value='0';emit(document.getElementById('tempo'),'change');
  assert.equal(document.getElementById('notice').hidden,false);assert.match(document.getElementById('notice-message').textContent,/Choose a tempo/);
  const noticeRows=document.querySelectorAll('#notice-history-list li').length;
  switchLanguage('zh-CN');assert.match(document.getElementById('notice-message').textContent,/请选择每分钟/);assert.match(document.getElementById('notice-history-list').textContent,/请选择每分钟/);
  assert.equal(document.querySelectorAll('#notice-history-list li').length,noticeRows);assert.deepEqual(await exportTake(),beforeNotice);
  switchLanguage('en');assert.match(document.getElementById('notice-message').textContent,/Choose a tempo/);

  for(const id of ['notice-message','notice-dismiss']){
   for(const properties of [typing,enter,{key:' ',code:'Space'}]){emit(document.getElementById(id),'keydown',properties);emit(document.getElementById(id),'keyup',properties)}
  }
  document.getElementById('notice-dismiss').click();
  assert.equal(document.getElementById('notice').hidden,true);assert.equal(requests.length,beforeNoticeRequests);
  assert.deepEqual(await exportTake(),beforeNotice,'Reading and dismissing a running notice preserves inputs, clock segments, revisions and pending checks');
  assert.deepEqual(['score-title','transport-status','play-button','practice-gate','retry-assessments','diagnostic-list'].map(id=>document.getElementById(id).outerHTML),beforeNoticeControls);
  assert.match(document.getElementById('notice-history-list').textContent,/Choose a tempo/);
  document.getElementById('play-button').click();assert.equal((await exportTake()).input_evidence.events.at(-1).reason,'pause','A real transport pause remains visible even without held notes');await startPractice();
  emit(key,'pointerdown',{pointerId:3,button:0});emit(key,'pointerup',{pointerId:3});emit(key,'lostpointercapture',{pointerId:3});
  emit(key,'keydown',enter);emit(key,'focusout');emit(document.body,'keyup',enter);emit(key,'focusout');
  emit(document.body,'keydown',typing);emit(document.body,'keyup',typing);
  const beforeTyping=(await exportTake()).input_evidence.events.length;
  emit(document.getElementById('tempo'),'keydown',typing);emit(document.getElementById('tempo'),'keyup',typing);
  assert.equal((await exportTake()).input_evidence.events.length,beforeTyping,'Text-field typing is not recorded, even after the same musical key was used');
  emit(document.body,'keydown',typing);emit(window,'blur');emit(document.body,'keyup',typing);await startPractice();
  emit(key,'pointerdown',{pointerId:4,button:0});emit(key,'pointercancel',{pointerId:4});emit(key,'lostpointercapture',{pointerId:4});
  emit(key,'keydown',enter);Object.defineProperty(document,'hidden',{configurable:true,value:true});emit(document,'visibilitychange');
  emit(document.body,'keydown',{key:'s',code:'KeyS'});emit(document.body,'keyup',{key:'s',code:'KeyS'});
  Object.defineProperty(document,'hidden',{configurable:true,value:false});await startPractice();
  emit(document.body,'keydown',typing);emit(window,'pagehide');
  const lifecycle=(await exportTake()).input_evidence.events;
  assert.deepEqual(lifecycle.filter(event=>event.kind==='synthetic_release').map(event=>event.reason),['focusout','blur','pointercancel','hidden','pagehide']);
  assert.equal(lifecycle.filter(event=>event.reason==='lostpointercapture').length,0);
  assert.ok(lifecycle.some(event=>event.kind==='note_off'&&event.encoding==='pointer_up'&&event.midi===null));
  const hiddenBoundary=lifecycle.findIndex(event=>event.reason==='hidden'&&event.kind==='boundary');
  assert.equal(lifecycle.slice(hiddenBoundary+1).filter(event=>event.kind==='note_on'&&event.input_kind==='typing_keyboard').length,1,'Only the fresh visible contact after resume is recorded; hidden physical typing is suppressed');
  const beforeComposition=(await exportTake()).input_evidence.events.length;
  emit(document.body,'keydown',typing);emit(document,'compositionstart');
  emit(document.body,'keydown',{key:'s',code:'KeyS'});emit(document.body,'keyup',typing);emit(document,'compositionend');
  const composition=(await exportTake()).input_evidence.events.slice(beforeComposition);
  assert.equal(composition.filter(event=>event.kind==='note_on').length,1);assert.equal(composition.find(event=>event.kind==='synthetic_release').reason,'keyboard_composition');
  emit(document.body,'keydown',typing);emit(document.getElementById('tempo'),'focusin');emit(document.body,'keyup',typing);
  assert.equal((await exportTake()).input_evidence.events.filter(event=>event.kind==='synthetic_release').at(-1).reason,'keyboard_focus_changed');
  let pausedSnapshot=await exportTake();
  const pausedRequests=requests.length;switchLanguage('zh-CN');
  assert.equal(document.getElementById('play-button').textContent,'▶ 播放');
  assert.match(document.getElementById('transport-status').textContent,/已暂停/);
  assert.equal(document.getElementById('custom-lowest').value,'D#3');
  assert.deepEqual(await exportTake(),pausedSnapshot,'Changing language while paused preserves the entire saved take');assert.equal(requests.length,pausedRequests);
  switchLanguage('en');assert.deepEqual(await exportTake(),pausedSnapshot);
  const imeUnlocks=unlockCalls;
  emit(document.body,'keydown',{key:' ',code:'Space',isComposing:true});emit(document.body,'keyup',{key:' ',code:'Space',isComposing:true});
  emit(document.body,'keydown',{key:' ',code:'Space',keyCode:229});emit(document.body,'keyup',{key:' ',code:'Space',keyCode:229});
  emit(document,'compositionstart');emit(document.body,'keydown',{key:' ',code:'Space'});emit(document.body,'keyup',{key:' ',code:'Space'});emit(document,'compositionend');
  assert.equal(unlockCalls,imeUnlocks,'IME Space must not start transport or audio');assert.equal(document.getElementById('play-button').textContent,'▶ Play');
  const afterIme=await exportTake();assert.deepEqual(afterIme.passes,pausedSnapshot.passes,'IME Space must not alter recorded passes or transport segments');assert.equal(afterIme.input_evidence.events.filter(event=>event.kind==='note_on').length,pausedSnapshot.input_evidence.events.filter(event=>event.kind==='note_on').length,'IME Space never starts musical input');pausedSnapshot=afterIme;

  // Entering the independent screen pauses and retains the complete scored take.
  const beforeFree=await exportTake(),requestsBeforeFree=requests.length;
  document.getElementById('back-to-library').click();document.getElementById('start-free-practice').click();
  assert.equal(document.body.dataset.screen,'free');assert.equal(document.getElementById('workspace').hidden,true);
  document.getElementById('free-sound').click();document.getElementById('free-start').click();await new Promise(resolve=>setImmediate(resolve));
  emit(document.getElementById('free-practice-title'),'keydown',typing);emit(document.getElementById('free-practice-title'),'keyup',typing);
  document.getElementById('free-stop').click();await new Promise(resolve=>setImmediate(resolve));
  document.getElementById('free-export-draft').click();await new Promise(resolve=>setImmediate(resolve));const freeRecord=JSON.parse(await blob.text());
  assert.equal(freeRecord.score_context,null);assert.equal(freeRecord.observations.events.filter(event=>event.kind==='note_on').length,1);
  const freeOnset=freeRecord.observations.events.find(event=>event.kind==='note_on'),freeRelease=freeRecord.observations.events.find(event=>event.kind==='note_off');
  assert.equal(freeOnset.timestamp_basis,'event_monotonic');assert.equal(freeRelease.event_wall_ms-freeOnset.event_wall_ms,1,'Free input retains a positive physical hold, not a frozen zero-duration pair');
  document.getElementById('free-exit').click();document.getElementById('resume-session').click();
  assert.equal(document.body.dataset.screen,'stage');assert.equal(document.getElementById('free-practice-screen').hidden,true);
  assert.deepEqual(await exportTake(),beforeFree,'Free recording leaves every scored take, target, clock segment and evidence event unchanged');
  assert.equal(requests.length,requestsBeforeFree,'Free entry and recording need no score APIs');document.getElementById('sound-button').click();

  for(let opening=0;opening<2;opening++){
   document.getElementById('results-button').click();assert.deepEqual(await exportTake(),pausedSnapshot,'Entering Results and exporting an idle paused take changes no export field');document.getElementById('results-dialog').close();
  }
  document.getElementById('back-to-library').click();document.querySelector(`[data-score-id="${otherScore.id}"]`).click();
  await until(()=>document.getElementById('song-lobby').dataset.previewStatus==='ready'&&document.getElementById('preview-title').textContent===otherScore.title,'Catalog browsing never completed');
  document.getElementById('results-button').click();assert.deepEqual(await exportTake(),pausedSnapshot,'Browsing and exporting preserves the complete paused take');document.getElementById('results-dialog').close();
  document.getElementById('resume-session').click();document.getElementById('settings-button').click();document.getElementById('settings-dialog').close();
  assert.deepEqual(await exportTake(),pausedSnapshot,'Returning to the paused stage or opening settings does not invent a cleanup boundary');
  // A manual contact can begin while paused; the next panel opening must still
  // record its actual cleanup even though the transport never restarted.
  emit(document.body,'keydown',typing);document.getElementById('results-button').click();
  const manualCleanup=(await exportTake()).input_evidence.events.at(-1);assert.equal(manualCleanup.kind,'synthetic_release');assert.equal(manualCleanup.reason,'pause');
  emit(document.body,'keyup',typing);document.getElementById('results-dialog').close();
  const beforeBlur=(await exportTake()).input_evidence.events.length;emit(window,'blur');
  const afterBlur=(await exportTake()).input_evidence.events;assert.equal(afterBlur.length,beforeBlur+1);assert.equal(afterBlur.at(-1).reason,'blur','Genuine focus boundaries survive without active contacts for late callbacks');
  document.getElementById('reset-button').click();
  // A tiny test-only cap exercises the ordinary UI flow without a pressure test.
  InputEvidence.prototype.start=function(){this.limit=2;return originalEvidenceStart.call(this)};
  await startPractice();
  for(let attack=0;attack<3;attack++){emit(key,'keydown',enter);emit(key,'keyup',enter)}
  assert.equal(document.getElementById('take-evidence-limit').hidden,false);assert.match(document.getElementById('notice').textContent,/export limit.*onset recording/);
  const exported=await exportTake();assert.equal(exported.passes[0].inputs.length,3);assert.equal(exported.passes[0].revision,3);
  assert.deepEqual(exported.input_evidence.events.map(event=>event.kind),['note_on','note_off']);assert.equal(exported.input_evidence.truncated,true);assert.equal(exported.input_evidence.omitted_observations,4);
  assert.equal(exported.input_evidence.events[1].encoding,'key_up');assert.equal(exported.input_evidence.release_assessment,'not_implemented');
  document.getElementById('notice-dismiss').click();
  assert.equal(document.getElementById('notice').hidden,true);assert.equal(document.getElementById('take-evidence-limit').hidden,false,'Dismissing the banner never hides the persistent evidence limitation');
  assert.deepEqual(await exportTake(),exported,'Dismissing an evidence-limit error never edits the captured take or its diagnostic counters');
  assert.match(document.getElementById('notice-history-list').textContent,/export limit.*onset recording/);
  document.getElementById('reset-button').click();assert.equal(document.getElementById('take-evidence-limit').hidden,true);
  // Exercise the actual shared loader's pre-commit cancellation and post-commit
  // compatibility wait. A view-only activation mock cannot establish this boundary.
  InputEvidence.prototype.start=originalEvidenceStart;await startPractice();emit(key,'keydown',enter);emit(key,'keyup',enter);document.getElementById('play-button').click();
  const beforeTranspose=await exportTake(),originalTitle=document.getElementById('score-title').textContent;
  const openTranspose=()=>{document.getElementById('settings-button').click();document.getElementById('transposition-button').click();document.getElementById('transposition-semitones').value='12'};
  const previewTranspose=async()=>{document.getElementById('transposition-preview').click();await until(()=>!document.getElementById('transposition-result').hidden,'Semitone preview did not become reviewable');const confirm=document.getElementById('transposition-confirm');confirm.checked=true;confirm.dispatchEvent(new window.Event('change'))};
  openTranspose();await previewTranspose();assert.deepEqual(await exportTake(),beforeTranspose,'Preview preserves every paused take field');
  let releaseCompile;holdCompile=new Promise(resolve=>{releaseCompile=resolve});document.getElementById('transposition-activate').click();await until(()=>heldCompile,'Activation compilation did not wait');document.getElementById('transposition-cancel').click();releaseCompile();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('score-title').textContent,originalTitle);assert.deepEqual(await exportTake(),beforeTranspose,'Cancellation before commit preserves complete history');
  openTranspose();await previewTranspose();heldCheck=false;let releaseCompatibility;holdCheck=new Promise(resolve=>{releaseCompatibility=resolve});document.getElementById('transposition-activate').click();await until(()=>heldCheck,'Committed copy did not wait for instrument checks');
  assert.equal(document.getElementById('transposition-dialog').open,false,'Review ends at score commit before the instrument request settles');assert.equal(document.getElementById('score-title').textContent,originalTitle+' [+12 semitones]');assert.equal(document.getElementById('export-takes').disabled,true,'Confirmed replacement clears the explicitly warned take history');assert.match(document.getElementById('notice').textContent,/copy loaded.*checks are updating/);
  openTranspose();releaseCompatibility();await until(()=>!document.getElementById('play-button').disabled,'Committed compatibility check never finished');assert.equal(document.getElementById('transposition-dialog').open,true,'Late activation completion does not dismiss a new review');assert.equal(document.getElementById('transposition-preview').disabled,true);assert.equal(document.getElementById('transposition-restore-preview').hidden,false);
  assert.deepEqual(i18n.getReports().filter(issue=>['message_key_missing','message_param_invalid','message_param_missing','message_param_unexpected','locale_subscriber_failed'].includes(issue.code)),[],'Every exercised dynamic locale binding satisfies its catalog contract');
 }finally{Synth.prototype.play=originalPlay;Synth.prototype.unlock=originalUnlock;InputEvidence.prototype.start=originalEvidenceStart;URL.createObjectURL=originalCreateUrl;for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
});
