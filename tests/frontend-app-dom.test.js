import {unavailablePianoResult} from './piano-fingering-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {beat,pitchMidi} from '../web/music.js';
import {InputEvidence} from '../web/input-evidence.js';

// Node DOM integration only: no browser, layout engine, real audio or HTTP is run.
test('application module initializes the lobby and activates only through explicit Start',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
 const requests=[],values=new Map();let audioContexts=0,holdCheck=null,heldCheck=null,holdCompile=null,heldCompile=false;
 const originalEvidenceStart=InputEvidence.prototype.start,originalCreateUrl=URL.createObjectURL;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>paint;
 const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}};
 class Audio{constructor(){audioContexts++;this.state='running';this.currentTime=0;this.destination={}}createGain(){return{gain:{...param},connect(){},disconnect(){}}}createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){},stop(){}}}}
 const compile=score=>({score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],velocity:note.velocity,part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff}))),duration_ms:1000},diagnostics:[]});
 const item={id:fixture.id,title:fixture.title,composer:fixture.composer,provenance:fixture.provenance,written_event_count:2,pitched_note_count:2,rest_count:0,opening_bpm:120,part_count:1};
 const otherScore={...structuredClone(fixture),id:'other-preview',title:'Another selected score'};
 const installed={window,document,location:{origin:'http://local-node-dom.invalid'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},AudioContext:Audio,fetch:async(path,options={})=>{
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
  else if(path==='/api/assess')result={hits:[],misses:body.timeline.notes.map(note=>note.id),extras:[],accuracy_percent:0,mean_abs_error_ms:null,grade_counts:{perfect:0,good:0,early:0,late:0,missed:2,extra:0},onset_completion:{total:2,complete:0,longest_complete_sequence:0}};
  else throw Error(`Unexpected Node DOM test request: ${path}`);
  if(path==='/api/compile'&&holdCompile){const gate=holdCompile;holdCompile=null;heldCompile=true;await gate;}
  if(path==='/api/instrument-check'&&holdCheck){const gate=holdCheck;holdCheck=null;heldCheck=true;await gate;}
  return{ok:true,json:async()=>result};
 }};
 const originals=new Map(Object.keys(installed).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const[key,value]of Object.entries(installed))Object.defineProperty(globalThis,key,{configurable:true,value});
 const until=async(predicate,label)=>{for(let attempt=0;attempt<100;attempt++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve))}assert.fail(label)};
 try{
  await import('../web/app.js?node-shell-initialization');
  await until(()=>!document.getElementById('start-practice').disabled,'Preview never became ready');
  assert.equal(document.body.dataset.screen,'library');assert.equal(audioContexts,0);assert.equal(document.getElementById('resume-session').hidden,true);assert.equal(requests.filter(r=>r.path==='/api/compile').length,1);assert.equal(requests.some(r=>r.path==='/api/export/musicxml'),false,'Hidden notation is not engraved');
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
  document.getElementById('results-dialog').close();document.getElementById('reset-button').click();assert.equal(document.getElementById('feedback-results').hidden,true);
  const instrument=document.getElementById('instrument');instrument.value='guitar';instrument.dispatchEvent(new window.Event('change'));await until(()=>!document.getElementById('play-button').disabled,'Guitar target verification never completed');document.getElementById('reset-button').click();
  assert.equal(document.getElementById('piano-stage').hidden,true);assert.equal(document.getElementById('guitar-stage').hidden,false);assert.match(document.getElementById('practice-hint').textContent,/upcoming pitch times/);assert.doesNotMatch(document.getElementById('practice-hint').textContent,/reaches the line/);assert.equal(document.getElementById('stage-cue-main').textContent,'READY');assert.equal(document.getElementById('stage-cue').closest('#piano-stage'),null);
  const guitarPlan=requests.filter(r=>r.path==='/api/practice-targets'&&r.body.profile.kind==='guitar').at(-1).body.timeline;
  assert.deepEqual([...document.querySelectorAll('.guitar-target')].map(item=>[item.dataset.targetId,Number(item.dataset.startMs)]),guitarPlan.notes.map(note=>[note.id,note.start_ms]));assert.equal(document.querySelectorAll('.fret-button').length,78);
  const key=document.querySelector('.fret-button');key.setPointerCapture=()=>{};
  const emit=(target,type,properties={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{repeat:false,...properties});Object.defineProperty(event,'timeStamp',{value:performance.now()});target.dispatchEvent(event)};
  const enter={key:'Enter',code:'Enter'},typing={key:'a',code:'KeyA'};
  let blob;URL.createObjectURL=value=>{blob=value;return 'blob:node-evidence-test'};
  const exportTake=async()=>{document.getElementById('export-takes').click();return JSON.parse(await blob.text())};
  const startPractice=async()=>{document.getElementById('count-in').checked=false;document.getElementById('play-button').click();await until(()=>document.getElementById('play-button').textContent.includes('Pause'),'Practice did not start')};
  await startPractice();
  // A real validation notice can be read and dismissed while playing without
  // recording its keyboard controls, retrying a request or pausing the take.
  const beforeNotice=await exportTake(),beforeNoticeRequests=requests.length;
  const beforeNoticeControls=['score-title','transport-status','play-button','practice-gate','retry-assessments','diagnostic-list'].map(id=>document.getElementById(id).outerHTML);
  document.getElementById('tempo').value='0';emit(document.getElementById('tempo'),'change');
  assert.equal(document.getElementById('notice').hidden,false);assert.match(document.getElementById('notice-message').textContent,/Choose a tempo/);
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
  assert.ok(lifecycle.slice(hiddenBoundary+1).some(event=>event.kind==='note_on'&&event.input_kind==='typing_keyboard'),'Hidden/audio-suppressed notes are still observed independently of held sound state');
  const pausedSnapshot=await exportTake();
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
 }finally{InputEvidence.prototype.start=originalEvidenceStart;URL.createObjectURL=originalCreateUrl;for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
});
