import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBObjectStore} from 'fake-indexeddb';
import {freePracticeApp,fixtureScoreServer} from './free-practice-app-fixtures.js';
import {openPerformanceLibrary} from '../web/performance-library.js';
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';
import {getAppI18n} from '../web/app-locale.js';

const musical={code:'KeyR',key:'r'};
const onsets=record=>record.observations.events.filter(event=>event.kind==='note_on');
async function enter(app){await app.click('start-free-practice');assert.equal(app.document.body.dataset.screen,'free');assert.equal(app.$('free-practice-screen').hidden,false);}
async function silentStart(app){await enter(app);await app.click('free-sound');await app.click('free-start');assert.equal(app.$('free-practice-screen').dataset.state,'recording');}
function key(app,properties=musical,target=app.$('free-practice-title')){app.emit(target,'keydown',properties);app.emit(target,'keyup',properties);}
async function stopDraft(app){await app.click('free-stop');return app.exported('free-export-draft');}

test('actual app records silently without a score or server, persists complete mapping and compares immutable records',async()=>{
  const app=await freePracticeApp();try{
    const {$,document,requests}=app;
    assert.equal($('start-free-practice').disabled,false);assert.equal(app.midiRequests(),0);
    await silentStart(app);const requestCount=requests.length;
    key(app);const firstNode=$('free-practice-title'),mapping=$('free-practice-keys').firstElementChild;
    app.emit(firstNode,'keydown',{code:'ArrowRight',key:'ArrowRight'});app.emit(firstNode,'keyup',{code:'ArrowRight',key:'ArrowRight'});key(app);
    $('free-record-label').value='A <original> 名称';getAppI18n(document).setLocale('en');
    assert.equal($('free-practice-title'),firstNode);assert.equal($('free-record-label').value,'A <original> 名称');assert.equal($('free-practice-screen').dataset.state,'recording');
    const first=await stopDraft(app);
    assert.equal(first.score_context,null);assert.equal(first.mode,'free');assert.deepEqual(onsets(first).map(event=>event.midi),[60,61]);
    const configurations=first.configuration.filter(row=>row.key==='keyboard_configuration');
    assert.equal(configurations.length,2);assert.equal(configurations[0].value.mapping.length,47);assert.equal(configurations[1].value.transpose_semitones,1);
    assert.equal(requests.length,requestCount,'No free action calls compilation, admission or assessment');assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
    await app.click('free-save');assert.match($('free-save-status').textContent,/Saved/);await app.click('free-choose-baseline');
    const exported=await app.exported('free-export-record');assert.equal(exported.id,first.id);
    await app.click('free-start');key(app,{code:'KeyZ',key:'z'});const second=await stopDraft(app);assert.notEqual(second.id,first.id);
    $('free-record-label').value='B';await app.click('free-save');assert.equal($('free-comparison').hidden,false);assert.match($('free-comparison-body').textContent,/A <original> 名称/);assert.match($('free-comparison-body').textContent,/B/);
    assert.equal($('free-record-select').options.length,2);const beforeAudio=app.audio();await app.click('free-load');assert.deepEqual(app.audio(),beforeAudio,'Loading never autoplays');
    const backup=await app.exported('free-export-backup');assert.equal(backup.entries.length,2);
    assert.equal($('resume-session').hidden,true,'A free record never invents a score session');
    assert.equal(mapping.isConnected,false,'A real transpose updates the visual map');
  }finally{await app.close();}
});

test('free input is limited to explicit surfaces and survives pause, screen changes, IME and lifecycle cleanup',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);
    for(const target of [app.document.body,app.$('free-record-label'),app.$('free-record-select'),app.$('free-start'),app.$('catalog-search')])key(app,musical,target);
    key(app,{code:'Space',key:' '});key(app,{code:'Enter',key:'Enter'});
    key(app,{...musical,isComposing:true});key(app,{...musical,keyCode:229});key(app,{...musical,ctrlKey:true});
    app.emit(app.document,'compositionstart');key(app);app.emit(app.document,'compositionend');
    key(app);app.emit(app.$('free-practice-title'),'keydown',{code:'KeyZ',key:'z'});app.emit(app.document,'compositionstart');app.emit(app.$('free-practice-title'),'keyup',{code:'KeyZ',key:'z'});app.emit(app.document,'compositionend');
    app.emit(app.$('free-practice-title'),'keydown',{code:'KeyX',key:'x'});app.emit(app.window,'blur');assert.equal(app.$('free-practice-screen').dataset.state,'paused');app.emit(app.$('free-practice-title'),'keyup',{code:'KeyX',key:'x'});
    await app.click('free-resume');app.emit(app.$('free-practice-title'),'keydown',{code:'KeyC',key:'c'});Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');key(app);Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.$('free-practice-title'),'keyup',{code:'KeyC',key:'c'});
    await app.click('free-exit');assert.equal(app.document.body.dataset.screen,'library');key(app,musical,app.document.body);
    await enter(app);assert.equal(app.$('free-practice-screen').dataset.state,'paused');await app.click('free-resume');key(app);
    const record=await stopDraft(app);assert.equal(onsets(record).length,5);assert.ok(record.observations.events.some(event=>event.kind==='synthetic_release'&&event.reason==='keyboard_composition'));assert.equal(record.segments.length,3);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{await app.close();}
});

test('MIDI permission is explicit, key-test input stays isolated and delayed events retain original free ownership',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);assert.equal(app.midiRequests(),0);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);assert.equal(app.midiRequests(),1);app.$('settings-dialog').close();await app.click('free-resume');
    // The later-delivered note must precede this onset, not share its timestamp.
    const firstTime=performance.now();await app.tick();app.midi([0x90,60,101]);app.midi([0x80,60,44]);
    await app.click('free-pause');const gapTime=performance.now();await app.tick();await app.click('free-resume');
    app.midi([0x90,62,90],gapTime);app.midi([0x80,62,0]);app.midi([0x90,64,80],firstTime);app.midi([0x80,64,0]);
    const settings=app.$('settings-button');settings.click();const testButton=app.$('midi-test-toggle');assert.ok(testButton,'MIDI key-test control exists');testButton.click();app.midi([0x90,90,127]);testButton.click();app.$('settings-dialog').close();await app.click('free-resume');
    const first=await stopDraft(app);assert.deepEqual(onsets(first).map(event=>event.midi),[60,62,64]);assert.equal(onsets(first)[1].segment_id,null);assert.equal(onsets(first)[2].segment_id,onsets(first)[0].segment_id);assert.equal(first.score_context,null);
    await app.click('free-save');await app.click('free-sound');const beforePreview=app.requests.length;await app.click('free-preview');await app.until(()=>app.plays.some(args=>String(args[0]).startsWith('free-preview:')));await app.click('free-preview-stop');assert.deepEqual(app.plays.filter(args=>String(args[0]).startsWith('free-preview:')).map(args=>args[1]),[60],'Paused and receipt-reordered onsets are excluded in the real preview');assert.equal(app.requests.length,beforePreview);await app.click('free-sound');const silentUnlocks=app.audio().unlocks;await app.click('free-start');app.midi([0x90,70,90],firstTime);app.midi([0x80,70,0]);app.midi([0x90,72,91]);app.midi([0x80,72,0]);const second=await stopDraft(app);assert.deepEqual(onsets(second).map(event=>event.midi),[72]);assert.equal(app.audio().unlocks,silentUnlocks);
  }finally{await app.close();}
});

test('a failed performance transaction retains its sealed draft and permits explicit save retry',async()=>{
  const app=await freePracticeApp();const originalAdd=IDBObjectStore.prototype.add;
  try{
    await silentStart(app);key(app);const draft=await stopDraft(app);app.$('free-record-label').value='Retry me';
    IDBObjectStore.prototype.add=function(...args){if(this.name==='records')throw new DOMException('full','QuotaExceededError');return originalAdd.apply(this,args);};
    await app.click('free-save');getAppI18n(app.document).setLocale('en');assert.match(app.$('free-save-status').textContent,/Save failed/);assert.deepEqual(await app.exported('free-export-draft'),draft);assert.equal(app.$('free-start').disabled,true);
    IDBObjectStore.prototype.add=originalAdd;await app.click('free-save');assert.match(app.$('free-save-status').textContent,/Saved/);assert.equal(app.$('free-record-label').value,'Retry me');assert.deepEqual(await app.exported('free-export-draft'),draft);
  }finally{IDBObjectStore.prototype.add=originalAdd;await app.close();}
});

test('late audio unlock, Stop and a new recording cannot revive the old contact, and preview never becomes input',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-start');let resolve;app.setUnlock(()=>new Promise(done=>{resolve=done;}));
    app.emit(app.$('free-practice-title'),'keydown',musical);await app.click('free-stop');await app.click('free-save');await app.click('free-start');resolve();await app.tick();assert.equal(app.plays.length,0);
    app.emit(app.$('free-practice-title'),'keyup',musical);app.setUnlock(()=>Promise.resolve());app.emit(app.$('free-practice-title'),'keydown',{code:'KeyZ',key:'z'});await app.tick();assert.equal(app.plays.length,1);app.emit(app.$('free-practice-title'),'keyup',{code:'KeyZ',key:'z'});const draft=await stopDraft(app);await app.click('free-save');
    const before=app.requests.length;await app.click('free-preview');await app.until(()=>app.plays.some(args=>String(args[0]).startsWith('free-preview:')));await app.click('free-preview-stop');
    const previewTones=app.plays.filter(args=>String(args[0]).startsWith('free-preview:'));assert.ok(previewTones.every(args=>args[2]===160));assert.deepEqual(await app.exported('free-export-draft'),draft);assert.equal(app.requests.length,before);
    await app.click('free-start');app.setUnlock(()=>Promise.reject(new Error('audio denied')));key(app);await app.tick();getAppI18n(app.document).setLocale('en');assert.match(app.$('notice-message').textContent,/continue recording silently/);assert.equal(app.$('free-practice-screen').dataset.state,'recording');await app.click('free-sound');const silent=app.audio().unlocks;key(app);assert.equal(app.audio().unlocks,silent);
  }finally{await app.close();}
});


test('an unarchivable applied mapping pauses and blocks PC until a full corrected mapping is recorded',async()=>{
  const app=await freePracticeApp(),original=FreePracticeRecorder.prototype.configure;let reject=false;
  FreePracticeRecorder.prototype.configure=function(name,value,time){return original.call(this,name,reject&&name==='keyboard_configuration'?{...value,mapping:[]}:value,time);};
  try{
    await silentStart(app);key(app);reject=true;
    key(app,{code:'ArrowRight',key:'ArrowRight'});assert.equal(app.$('free-practice-screen').dataset.state,'paused');getAppI18n(app.document).setLocale('en');assert.match(app.$('free-operation-status').textContent,/configuration|mapping/i);
    key(app);await app.click('free-resume');assert.equal(app.$('free-practice-screen').dataset.state,'paused');
    reject=false;key(app,{code:'ArrowRight',key:'ArrowRight'});assert.equal(app.$('free-practice-screen').dataset.state,'paused');await app.click('free-resume');key(app);
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(row=>row.midi),[60,62]);assert.deepEqual(record.configuration.filter(row=>row.key==='keyboard_configuration').map(row=>row.value.transpose_semitones),[0,2]);
  }finally{FreePracticeRecorder.prototype.configure=original;await app.close();}
});


test('explicit import and backup restore append independent local copies without score APIs or autoplay',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);key(app);const record=await stopDraft(app);await app.click('free-save');const backup=await app.exported('free-export-backup');const before=app.requests.length;
    const file=text=>Object.defineProperty(app.$('free-import-file'),'files',{configurable:true,value:[{size:new Blob([text]).size,text:async()=>text}]});
    file(JSON.stringify(record));await app.click('free-import-record');assert.equal(app.$('free-record-select').options.length,2);
    file(JSON.stringify(backup));await app.click('free-restore-backup');assert.equal(app.$('free-record-select').options.length,3);
    const rows=[...app.$('free-record-select').options];assert.equal(new Set(rows.map(row=>row.value)).size,3);const all=await app.exported('free-export-backup');assert.ok(all.entries.every(entry=>entry.record.id===record.id));assert.equal(app.requests.length,before);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{await app.close();}
});

test('a save completing after navigation stays saved and never restarts either transport',async()=>{
  const app=await freePracticeApp(),library=await openPerformanceLibrary({factory:app.factory});const prototype=Object.getPrototypeOf(library),original=prototype.save;let release;
  try{
    await silentStart(app);key(app);const draft=await stopDraft(app);const gate=new Promise(resolve=>{release=resolve;});prototype.save=async function(...args){await gate;return original.apply(this,args);};
    app.$('free-save').click();await app.tick();assert.equal(app.$('free-practice-screen').getAttribute('aria-busy'),'true');app.$('free-exit').click();assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('resume-session').hidden,true);
    release();await app.until(()=>app.$('free-practice-screen').getAttribute('aria-busy')==='false');await enter(app);getAppI18n(app.document).setLocale('en');assert.match(app.$('free-save-status').textContent,/Saved/);assert.equal(app.$('free-practice-screen').dataset.state,'stopped');assert.deepEqual(await app.exported('free-export-draft'),draft);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{release?.();prototype.save=original;library.close();await app.close();}
});


test('muted scored Start and Play need no audio and a stale unmuted Start cannot leave the free screen',async()=>{
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});try{
    await app.until(()=>!app.$('start-practice').disabled);getAppI18n(app.document).setLocale('en');await enter(app);await app.click('free-sound');await app.click('free-exit');app.$('count-in').checked=false;
    app.$('start-practice').click();await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('play-button').textContent.includes('Pause'));assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
    key(app,musical,app.$('stage-title'));app.$('play-button').click();const scored=await app.exported('export-takes');assert.equal(scored.passes.at(-1).inputs.length,1);
    app.$('play-button').click();await app.until(()=>app.$('play-button').textContent.includes('Pause'));assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
    app.$('sound-button').click();await app.tick();assert.deepEqual(app.audio(),{contexts:1,unlocks:1},'An explicit unmute initializes sound for a running silent transport');
    app.$('back-to-library').click();let resolve;app.setUnlock(()=>new Promise(done=>{resolve=done;}));app.$('start-listen').click();await app.tick();await enter(app);const before=app.requests.length;resolve();await app.tick();assert.equal(app.document.body.dataset.screen,'free');assert.equal(app.requests.length,before,'Cancelled audio admission cannot compile a replacement session');
    app.$('settings-button').click();for(const node of app.document.querySelectorAll('#settings-dialog .control-grid,#instrument-settings,#settings-dialog .practice-options'))assert.ok(node.classList.contains('free-score-settings-hidden'));
    assert.equal(app.$('keyboard-input-settings').classList.contains('free-score-settings-hidden'),false);assert.match(app.$('free-live-tone').textContent,/Piano tone/);
  }finally{await app.close();}
});

test('retired MIDI bindings retain delayed old evidence without reviving free audio or key-test input',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-start');await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-resume');
    const oldHandler=app.device.onmidimessage,oldTime=performance.now();app.midi([0x90,60,90],oldTime);await app.tick();app.midi([0x80,60,0]);const played=app.plays.length;
    app.$('settings-button').click();app.$('midi-test-toggle').click();oldHandler({data:[0x90,64,82],timeStamp:oldTime});app.midi([0x90,90,127]);app.$('midi-test-toggle').click();app.$('settings-dialog').close();await app.click('free-resume');await app.tick();assert.equal(app.plays.length,played);
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.midi),[60,64]);assert.ok(onsets(record).every(event=>event.segment_id===2));
  }finally{await app.close();}
});

test('exact recording-start MIDI evidence is retained and old note-off cannot release a new same-pitch contact',async()=>{
  const app=await freePracticeApp(),originalStart=FreePracticeRecorder.prototype.start;let startWall;
  FreePracticeRecorder.prototype.start=function(wall){startWall=wall;return originalStart.call(this,wall);};
  try{
    await enter(app);await app.click('free-sound');await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const oldWall=startWall;app.midi([0x90,60,92],oldWall);app.midi([0x80,60,0]);const first=await stopDraft(app);assert.equal(onsets(first).length,1);assert.equal(onsets(first)[0].event_ms,0);assert.equal(onsets(first)[0].segment_id,1);
    await app.click('free-save');await app.click('free-start');app.midi([0x90,60,93]);const key=app.$('free-practice-keys').querySelector('[data-midi="60"]');assert.ok(key.classList.contains('held'));
    app.midi([0x80,60,0],oldWall);assert.ok(key.classList.contains('held'),'Old recording note-off cannot release a new same-source voice or key visual');app.midi([0x80,60,0]);assert.equal(key.classList.contains('held'),false);
    const second=await stopDraft(app);assert.equal(onsets(second).length,1);assert.equal(second.observations.events.filter(event=>event.kind==='note_off').length,1);
  }finally{FreePracticeRecorder.prototype.start=originalStart;await app.close();}
});


test('shared footer moves only after mode cleanup and records its real transpose controls in free input history',async()=>{
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});let restoreMove;
  try{
    await app.until(()=>!app.$('start-practice').disabled);await enter(app);await app.click('free-sound');await app.click('free-exit');app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage');
    const score=await app.exported('export-button'),footer=app.document.querySelector('.keyboard-input-footer'),up=app.$('keyboard-semitone-up'),map=app.$('keyboard-map'),details=app.$('keyboard-performance-details');
    const freeStage=app.$('free-piano-stage'),originalAfter=freeStage.after,moves=[];
    freeStage.after=function(...nodes){if(nodes.includes(footer))moves.push({pressed:app.document.querySelectorAll('#keyboard .pressed,#free-practice-keys .pressed').length,heldMap:app.document.querySelectorAll('#keyboard-map .held').length});return originalAfter.apply(this,nodes);};restoreMove=()=>{freeStage.after=originalAfter;};
    app.emit(app.$('stage-title'),'keydown',musical);assert.equal(app.document.querySelectorAll('#keyboard .pressed').length,1);await app.click('rhythm-stage-free');
    assert.deepEqual(moves,[{pressed:0,heldMap:0}],'Owned notes are released before the existing footer is moved');assert.ok(footer.previousElementSibling===freeStage);assert.ok(app.$('keyboard-semitone-up')===up);assert.ok(app.$('keyboard-map')===map);assert.equal(app.document.querySelectorAll('.keyboard-input-footer').length,1);
    app.emit(app.$('free-practice-title'),'keydown',{...musical,repeat:true});assert.equal(app.document.querySelectorAll('#free-practice-keys .pressed').length,0,'Held physical repeat cannot restart a note after navigation');app.emit(app.$('free-practice-title'),'keyup',musical);
    const preserved=await app.exported('export-takes'); // The physical release still belongs to the original normal contact.
    await app.click('free-start');app.emit(app.$('free-practice-title'),'keydown',musical);assert.equal(app.document.querySelectorAll('#free-practice-keys .pressed').length,1);await app.click('keyboard-semitone-up');assert.equal(app.$('keyboard-current-offset').textContent,'+1');assert.equal(app.document.querySelectorAll('#free-practice-keys .pressed').length,0,'The shared transpose control releases its old musical contact');
    app.emit(app.$('free-practice-title'),'keydown',{...musical,repeat:true});assert.equal(app.document.querySelectorAll('#free-practice-keys .pressed').length,0);app.emit(app.$('free-practice-title'),'keyup',musical);key(app);
    const currentMap=app.document.querySelector('#keyboard-map [data-code="KeyR"]');details.open=true;for(const locale of ['en','zh-CN']){getAppI18n(app.document).setLocale(locale);assert.ok(app.document.querySelector('#keyboard-map [data-code="KeyR"]')===currentMap);assert.ok(app.$('keyboard-semitone-up')===up);assert.equal(details.open,true);}
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.midi),[60,61]);assert.deepEqual(record.configuration.filter(row=>row.key==='keyboard_configuration').map(row=>row.value.transpose_semitones),[0,1]);assert.ok(record.observations.events.some(event=>event.kind==='synthetic_release'),'Transpose retains cleanup evidence');
    await app.click('rhythm-free-resume');assert.equal(footer.closest('.play-panel')!==null,true);assert.ok(app.$('keyboard-semitone-up')===up);assert.equal(app.document.querySelectorAll('.keyboard-input-footer').length,1);assert.equal(app.document.querySelectorAll('#keyboard .pressed').length,0);
    const {keyboard_input_configuration:beforeMap,...beforeTake}=preserved,{keyboard_input_configuration:afterMap,...afterTake}=await app.exported('export-takes');assert.deepEqual(afterTake,beforeTake,'Shared input configuration never rewrites score passes, timing or assessments');assert.deepEqual(afterMap.events.slice(0,beforeMap.events.length),beforeMap.events);assert.equal(afterMap.current_configuration.transpose_semitones,1);assert.deepEqual(await app.exported('export-button'),score);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{restoreMove?.();await app.close();}
});

test('free mapping cleanup cannot append boundaries to a score contact already cancelled on navigation',async()=>{
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});try{
    await app.until(()=>!app.$('start-practice').disabled);await enter(app);await app.click('free-sound');await app.click('free-exit');app.$('count-in').checked=false;app.$('start-practice').click();await app.until(()=>app.document.body.dataset.screen==='stage');
    app.emit(app.$('stage-title'),'keydown',musical);app.$('back-to-library').click();const preserved=await app.exported('export-takes');
    await enter(app);await app.click('free-start');app.emit(app.$('free-practice-title'),'keydown',{code:'KeyZ',key:'z'});key(app,{code:'ArrowRight',key:'ArrowRight'});app.emit(app.$('free-practice-title'),'keyup',{code:'KeyZ',key:'z'});
    await app.click('free-stop');await app.click('free-exit');app.$('resume-session').click();const {keyboard_input_configuration:currentMap,...currentScore}=await app.exported('export-takes');const {keyboard_input_configuration:previousMap,...previousScore}=preserved;assert.deepEqual(currentScore,previousScore);assert.deepEqual(currentMap.events.slice(0,previousMap.events.length),previousMap.events);assert.equal(currentMap.current_configuration.transpose_semitones,1,'The shared physical keyboard settings remain explicit in the separate configuration export');
  }finally{await app.close();}
});

test('current untimestamped MIDI after Free Start is visibly retained as unassigned receipt evidence, never sound or a performance',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const handler=app.device.onmidimessage,permissionCount=app.midiRequests(),beforeDownloads=app.downloads.length,lower=performance.now();
    handler({data:[0x92,60,111]});handler({data:[0x82,60,23]});const upper=performance.now();
    assert.equal(app.$('free-midi-quarantine').hidden,false);assert.equal(app.$('settings-midi-quarantine').hidden,false);assert.equal(app.downloads.length,beforeDownloads,'Retaining ambiguous evidence never downloads automatically');
    assert.deepEqual(app.audio(),{contexts:0,unlocks:0});assert.equal(app.device.onmidimessage,handler,'Quarantine does not rotate or reopen the MIDI binding');assert.equal(app.midiRequests(),permissionCount);
    getAppI18n(app.document).setLocale('en');assert.match(app.$('free-midi-quarantine-status').textContent,/tab: 2\./);assert.match(app.$('free-midi-quarantine').textContent,/missing or invalid/);assert.match(app.$('settings-midi-quarantine').textContent,/Performance JSON and backups do not include it/);
    const report=await app.exported('free-midi-quarantine-export');assert.equal(report.format,'worldmusichub-midi-timing-quarantine');assert.equal(report.version,1);assert.equal(report.retained_count,2);assert.equal(report.omitted_count,0);
    assert.deepEqual(report.observations.map(event=>[event.kind,event.channel,event.midi,event.velocity,event.encoding]),[['note_on',2,60,111,'midi_note_on'],['note_off',2,60,23,'midi_note_off']]);
    for(const event of report.observations){assert.equal(event.timestamp_issue,'missing');assert.equal(event.raw_timestamp_ms,null);assert.equal(event.event_wall_ms,null);assert.equal(event.segment_id,null);assert.equal(event.recording_id,null);assert.equal(event.routing,'timing_ambiguous');assert.equal(event.timestamp_basis,'receipt_fallback');assert.ok(event.received_wall_ms>=lower&&event.received_wall_ms<=upper);assert.match(event.source_id,/^source-\d+$/);assert.match(event.source_generation,/^generation-\d+$/);}
    assert.equal(report.observations[0].source_id,report.observations[1].source_id);assert.doesNotMatch(JSON.stringify(report),/test-device|Test MIDI|midi:test/);
    const validTime=performance.now();app.midi([0x90,64,95],validTime);app.midi([0x80,64,0]);const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.midi),[64]);assert.equal(onsets(record)[0].event_wall_ms,validTime);assert.equal(onsets(record)[0].timestamp_basis,'event_monotonic');assert.equal(Object.hasOwn(record,'quarantine'),false);
    await app.click('free-save');await app.click('free-start');handler({data:[0x90,67,100]});assert.match(app.$('free-midi-quarantine-status').textContent,/tab: 3\./);const next=await stopDraft(app);assert.equal(onsets(next).length,0);assert.equal(app.device.onmidimessage,handler);assert.equal(app.midiRequests(),permissionCount);
    app.$('settings-button').click();const fromSettings=await app.exported('settings-midi-quarantine-export');assert.equal(fromSettings.retained_count,3);assert.deepEqual(fromSettings.observations.slice(0,2),report.observations);
    const statusNode=app.$('settings-midi-quarantine-status');getAppI18n(app.document).setLocale('zh-CN');assert.equal(app.$('settings-midi-quarantine-status'),statusNode);assert.match(statusNode.textContent,/3 条消息/);assert.equal((await app.exported('settings-midi-quarantine-export')).retained_count,3);
  }finally{await app.close();}
});

test('quarantine records invalid timestamp reasons without evaluating objects, and untimed cleanup cannot release a fresh contact',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-resume');const handler=app.device.onmidimessage;
    const secret={toString(){throw Error('must not stringify raw objects');},toJSON(){throw Error('must not serialize raw objects');},secret:'device-secret'};
    const invalid=[undefined,null,NaN,Infinity,0,-10,Number.MAX_VALUE,'device-secret',secret];
    for(const timeStamp of invalid)handler({data:[0x90,60,90],timeStamp});
    app.midi([0x90,65,91]);const held=app.$('free-practice-keys').querySelector('[data-midi="65"]');assert.ok(held.classList.contains('held'));
    handler({data:[0x80,65,0]});assert.ok(held.classList.contains('held'),'An untimed release has unknown ownership');handler({data:[0xb0,123,0]});assert.ok(held.classList.contains('held'),'An untimed channel cleanup must not silence a newer recording contact');
    app.midi([0x80,65,0]);assert.equal(held.classList.contains('held'),false);
    const report=await app.exported('free-midi-quarantine-export');assert.deepEqual(report.observations.slice(0,invalid.length).map(event=>event.timestamp_issue),['missing','missing','non_finite','non_finite','non_positive','non_positive','out_of_range','non_numeric','non_numeric']);
    assert.deepEqual(report.observations.slice(0,invalid.length).map(event=>event.raw_timestamp_ms),[null,null,null,null,0,-10,Number.MAX_VALUE,null,null]);assert.equal(report.observations.at(-1).kind,'cleanup');assert.equal(report.observations.at(-1).cleanup_reason,'midi_cc123');assert.equal(report.observations.at(-1).channel,0);assert.doesNotMatch(JSON.stringify(report),/device-secret|test-device|Test MIDI/);
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.midi),[65]);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{await app.close();}
});

test('quarantine has fixed capacity, truthful omitted counts and stable aliases across records without touching record v1',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-resume');
    const handler=app.device.onmidimessage,downloads=app.downloads.length;
    for(let index=0;index<4200;index++)handler({data:[0x90|(index%16),index%128,90]});
    assert.equal(app.downloads.length,downloads);const report=await app.exported('free-midi-quarantine-export');assert.ok(report.retained_count>0);assert.ok(report.retained_count<=report.limits.observations);assert.ok(report.estimated_retained_observation_bytes<=report.limits.observationBytes);assert.equal(report.retained_count+report.omitted_count,4200);assert.ok(report.omitted_count>0);assert.ok(report.first_omitted_received_wall_ms>=report.observations.at(-1).received_wall_ms);assert.ok(['observation_byte_limit','observation_count_limit'].includes(report.omission_reason));
    const record=await stopDraft(app);assert.equal(onsets(record).length,0);await app.click('free-save');await app.click('free-start');handler({data:[0x90,60,90]});const after=await app.exported('free-midi-quarantine-export');assert.deepEqual(after.observations,report.observations);assert.equal(after.omitted_count,report.omitted_count+1);assert.equal(after.first_omitted_received_wall_ms,report.first_omitted_received_wall_ms);assert.equal(app.device.onmidimessage,handler);assert.equal(app.midiRequests(),1);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  }finally{await app.close();}
});

test('untimed scored MIDI stays outside score evidence and its persistent report remains available in Settings',async()=>{
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});try{
    await app.until(()=>!app.$('start-practice').disabled);await enter(app);await app.click('free-sound');await app.click('free-exit');app.$('count-in').checked=false;app.$('start-practice').click();await app.until(()=>app.document.body.dataset.screen==='stage');
    app.$('midi-button').click();await app.until(()=>app.device.onmidimessage);const before=await app.exported('export-takes');const handler=app.device.onmidimessage;
    handler({data:[0x90,60,120]});handler({data:[0x80,60,0]});assert.deepEqual(await app.exported('export-takes'),before,'Unknown ownership cannot append scored evidence, inputs or a fabricated timing segment');assert.equal(app.$('notice').hidden,false);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
    app.$('settings-button').click();assert.equal(app.$('settings-midi-quarantine').hidden,false);assert.ok(app.$('settings-midi-quarantine').closest('#settings-dialog'));const report=await app.exported('settings-midi-quarantine-export');assert.equal(report.retained_count,2);assert.ok(report.observations.every(event=>event.segment_id===null&&event.event_wall_ms===null));assert.equal(app.device.onmidimessage,handler);assert.equal(app.midiRequests(),1);
  }finally{await app.close();}
});


test('delayed MIDI panic cannot cancel a newer record or newer same-record contact',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-sound');await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const old=performance.now();app.midi([0x90,60,80],old);app.midi([0x80,60,0]);await app.click('free-stop');await app.click('free-save');await app.click('free-start');
    const sameRecordOld=performance.now();await app.tick();app.midi([0x90,60,90]);app.midi([0xb0,123,0],old);
    assert.ok(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'));
    app.midi([0xb0,120,0],sameRecordOld);
    assert.ok(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'));
    app.midi([0x80,60,0]);const record=await stopDraft(app);
    assert.equal(record.observations.events.filter(e=>e.reason==='midi_cc123').length,0);
    assert.equal(record.observations.events.filter(e=>e.reason==='midi_cc120' && e.kind==='synthetic_release').length,0);
    assert.equal(record.observations.events.filter(e=>e.reason==='midi_cc120' && e.kind==='boundary').length,1,'Receipt-side cleanup is retained without cancelling a newer note');
    assert.equal(record.observations.events.filter(e=>e.kind==='note_off').length,1);
  }finally{await app.close();}
});


test('reordered same-source onset remains evidence without replacing or reopening a newer live contact',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const oldOn=performance.now();await app.tick();const oldOff=performance.now();await app.tick();
    app.midi([0x90,60,110]);await app.tick();app.midi([0x90,60,40],oldOn);await app.tick();app.midi([0x80,60,0],oldOff);
    assert.deepEqual(app.plays.map(args=>args[5]),[110]);assert.ok(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'));
    app.midi([0x80,60,0]);app.midi([0x90,60,41],oldOn);await app.tick();
    assert.deepEqual(app.plays.map(args=>args[5]),[110]);assert.equal(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'),false);
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.velocity),[110,40,41]);assert.equal(record.observations.events.filter(event=>event.kind==='note_off').length,2);
  }finally{await app.close();}
});


test('bounded contact history cannot strand a key held across thousands of later presses',async()=>{
  const app=await freePracticeApp();try{
    await silentStart(app);const target=app.$('free-practice-title');
    app.emit(target,'keydown',{code:'KeyZ',key:'z'});
    for(let index=0;index<2048;index++){app.emit(target,'keydown',{code:'KeyX',key:'x'});app.emit(target,'keyup',{code:'KeyX',key:'x'});}
    app.emit(target,'keyup',{code:'KeyZ',key:'z'});
    assert.equal(app.$('free-practice-keys').querySelector('[data-midi="36"]').classList.contains('held'),false);
    const record=await stopDraft(app);const heldOn=record.observations.events.find(event=>event.kind==='note_on' && event.midi===36);assert.ok(heldOn);assert.equal(record.observations.events.filter(event=>event.kind==='note_off' && event.source_id===heldOn.source_id).length,1);
  }finally{await app.close();}
});


test('an observed orphan MIDI off blocks live revival by its older delayed onset',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const oldOn=performance.now();await app.tick();app.midi([0x80,60,0]);app.midi([0x90,60,40],oldOn);await app.tick();
    assert.equal(app.plays.length,0);assert.equal(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'),false);
    const record=await stopDraft(app);assert.deepEqual(record.observations.events.filter(event=>event.kind.startsWith('note_')).map(event=>event.kind),['note_off','note_on']);
  }finally{await app.close();}
});


test('MIDI channel panic blocks delayed pre-panic live onsets without removing raw evidence or other channels',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();await app.click('free-start');
    const oldOn=performance.now();await app.tick();app.midi([0xb0,123,0]);app.midi([0x90,60,40],oldOn);await app.tick();
    assert.equal(app.plays.length,0);assert.equal(app.$('free-practice-keys').querySelector('[data-midi="60"]').classList.contains('held'),false);
    app.midi([0x91,62,80],oldOn);await app.tick();assert.deepEqual(app.plays.map(args=>args[1]),[62]);app.midi([0x81,62,0]);
    app.midi([0x90,60,90]);await app.tick();assert.deepEqual(app.plays.map(args=>args[1]),[62,60]);app.midi([0x80,60,0]);
    const record=await stopDraft(app);assert.deepEqual(onsets(record).map(event=>event.velocity),[40,80,90]);
  }finally{await app.close();}
});
