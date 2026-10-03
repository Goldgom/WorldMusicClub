import test from 'node:test';
import assert from 'node:assert/strict';
import {freePracticeApp,fixtureScoreServer} from './free-practice-app-fixtures.js';
import {Synth} from '../web/transport.js';

const musical={code:'KeyR',key:'r'};
const manual=app=>app.plays.filter(([id])=>String(id).startsWith('manual:'));
const held=app=>app.document.querySelectorAll('#free-practice-keys .held').length;
const onsets=record=>record.observations.events.filter(event=>event.kind==='note_on');
async function enter(app){await app.click('start-free-practice');assert.equal(app.$('free-practice-screen').dataset.state,'idle');}
async function connect(app){await app.click('free-connect-midi');await app.until(()=>app.device.onmidimessage);app.$('settings-dialog').close();}
async function key(app,properties=musical,target=app.$('free-practice-title')){app.emit(target,'keydown',properties);await app.tick();app.emit(target,'keyup',properties);}
async function pointer(app,midi=64){const target=app.$('free-practice-keys').querySelector(`[data-midi="${midi}"]`);app.emit(target,'pointerdown',{pointerId:1,button:0});await app.tick();app.emit(target,'pointerup',{pointerId:1,button:0});}

test('idle and stopped free surfaces play without recording or changing the sealed draft',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);const requests=app.requests.length;
    await key(app);await pointer(app);await key(app,{code:'Enter',key:'Enter'},app.$('free-practice-keys').querySelector('[data-midi="67"]'));
    app.midi([0x90,69,104]);await app.tick();app.midi([0x80,69,0]);
    assert.deepEqual(manual(app).map(args=>args[1]),[60,64,67,69]);assert.equal(held(app),0);
    assert.equal(app.$('free-practice-screen').dataset.state,'idle');assert.equal(app.$('free-export-draft').disabled,true);
    await app.click('free-start');await app.click('free-stop');const draft=await app.exported('free-export-draft');
    assert.equal(onsets(draft).length,0);assert.equal(draft.segments.length,1,'Only explicit Start opens a recording segment');
    const count=app.$('free-event-count').textContent;
    await key(app);await pointer(app);app.midi([0x90,72,99]);await app.tick();app.midi([0x80,72,0]);
    assert.deepEqual(manual(app).slice(4).map(args=>args[1]),[60,64,72]);assert.equal(held(app),0);
    assert.equal(app.$('free-practice-screen').dataset.state,'stopped');assert.equal(app.$('free-event-count').textContent,count);
    assert.deepEqual(await app.exported('free-export-draft'),draft);assert.equal(app.requests.length,requests);
  }finally{await app.close();}
});

test('idle controls, hidden and blurred pages cannot start live audio; fresh focus can',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);
    for(const target of [app.document.body,app.$('free-record-label'),app.$('free-record-select'),app.$('free-start'),app.$('free-recordings-toggle')])await key(app,musical,target);
    await key(app,{...musical,isComposing:true});await key(app,{...musical,ctrlKey:true});
    app.$('settings-button').click();await key(app);app.midi([0x90,60,90]);app.midi([0x80,60,0]);app.$('settings-dialog').close();
    Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');await key(app);app.midi([0x90,62,90]);app.midi([0x80,62,0]);
    Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');
    app.emit(app.window,'blur');const blurredTime=performance.now();await key(app);await pointer(app);app.midi([0x90,64,90]);app.midi([0x80,64,0]);
    assert.equal(manual(app).length,0);assert.equal(held(app),0);
    app.emit(app.window,'focus');app.midi([0x90,67,90],blurredTime);app.midi([0x80,67,0],blurredTime);await app.tick();assert.equal(manual(app).length,0,'A pre-focus timestamp cannot become live after refocus');
    await key(app);assert.deepEqual(manual(app).map(args=>args[1]),[60]);assert.equal(app.$('free-export-draft').disabled,true);
  }finally{await app.close();}
});

test('idle and stopped live-only audio never changes scored inputs or evidence',async()=>{
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()});try{
    await app.until(()=>!app.$('start-practice').disabled);app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage');
    await key(app,musical,app.$('stage-title'));await app.click('rhythm-stage-free');const score=await app.exported('export-takes'),requests=app.requests.length;
    await key(app);await pointer(app);await app.click('free-start');await app.click('free-stop');await key(app);
    assert.equal(manual(app).length,4);assert.deepEqual(await app.exported('export-takes'),score);assert.equal(app.requests.length,requests);
    const draft=await app.exported('free-export-draft');assert.equal(onsets(draft).length,0);assert.equal(draft.score_context,null);
  }finally{await app.close();}
});

test('delayed MIDI keeps recording evidence while prior idle and stopped routes stay silent',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);const idleTime=performance.now();await app.tick();await app.click('free-start');
    const recordTime=performance.now();app.midi([0x90,60,90],recordTime);await app.tick();app.midi([0x80,60,0]);await app.click('free-pause');const gapTime=performance.now();await app.tick();
    app.midi([0x90,62,81],recordTime);app.midi([0x80,62,0]);await app.tick();assert.equal(manual(app).length,1);
    await app.click('free-resume');app.midi([0x90,64,82],gapTime);app.midi([0x80,64,0]);app.midi([0x90,65,83],idleTime);app.midi([0x80,65,0],idleTime);await app.tick();assert.equal(manual(app).length,1);
    await app.click('free-stop');const draft=await app.exported('free-export-draft');assert.deepEqual(onsets(draft).map(event=>event.midi),[60,62,64]);assert.equal(onsets(draft)[1].segment_id,1);assert.equal(onsets(draft)[2].segment_id,null);
    app.midi([0x90,67,84],recordTime);app.midi([0x80,67,0],recordTime);app.midi([0x90,69,85],idleTime);app.midi([0x80,69,0],idleTime);await app.tick();assert.equal(manual(app).length,1);
    app.midi([0x90,72,86]);await app.tick();app.midi([0x80,72,0]);assert.deepEqual(manual(app).map(args=>args[1]),[60,72]);assert.deepEqual(await app.exported('free-export-draft'),draft);
  }finally{await app.close();}
});

test('late live-only audio unlock cannot revive contacts after release, blur, Start or reentry',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);let resolves=[];app.setUnlock(()=>new Promise(resolve=>resolves.push(resolve)));
    app.emit(app.$('free-practice-title'),'keydown',musical);assert.equal(held(app),1);app.emit(app.$('free-practice-title'),'keyup',musical);
    app.emit(app.$('free-practice-title'),'keydown',musical);app.emit(app.window,'blur');app.emit(app.window,'focus');app.emit(app.$('free-practice-title'),'keyup',musical);
    app.emit(app.$('free-practice-title'),'keydown',musical);await app.click('free-start');app.emit(app.$('free-practice-title'),'keyup',musical);await app.click('free-stop');
    app.emit(app.$('free-practice-title'),'keydown',musical);await app.click('free-exit');await app.click('start-free-practice');app.emit(app.$('free-practice-title'),'keyup',musical);
    assert.equal(resolves.length,4);for(const resolve of resolves)resolve();await app.tick();assert.equal(manual(app).length,0);assert.equal(held(app),0);
    app.setUnlock(()=>Promise.resolve());await key(app);assert.equal(manual(app).length,1);assert.equal(onsets(await app.exported('free-export-draft')).length,0);
  }finally{await app.close();}
});

test('replay cancels pending live-only unlock and blocks PC, pointer and MIDI until it stops',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);await app.click('free-start');await key(app);await app.click('free-stop');await app.click('free-save');const draft=await app.exported('free-export-draft'),initial=manual(app).length;
    const resolves=[];app.setUnlock(()=>new Promise(resolve=>resolves.push(resolve)));
    app.emit(app.$('free-practice-title'),'keydown',musical);assert.equal(held(app),1);app.$('free-preview').click();await app.tick();assert.equal(held(app),0,'Preparing replay releases live input');
    app.emit(app.$('free-practice-title'),'keyup',musical);await key(app);await pointer(app);app.midi([0x90,65,90]);app.midi([0x80,65,0]);assert.equal(resolves.length,2,'Only the old live contact and replay request audio unlock');
    resolves[1]();await app.tick();assert.equal(app.$('free-preview-stop').disabled,false,'The fixture runs a playing preview, not an audio failure');const replayTime=performance.now();await key(app);app.midi([0x90,67,90]);app.midi([0x80,67,0]);assert.equal(resolves.length,2);assert.equal(manual(app).length,initial);
    await app.click('free-preview-stop');resolves[0]();app.midi([0x90,69,90],replayTime);app.midi([0x80,69,0],replayTime);await app.tick();assert.equal(resolves.length,2,'A delayed replay-time MIDI onset cannot become live after replay stops');assert.equal(manual(app).length,initial,'Stopping replay cannot revive the cancelled live note');
    app.setUnlock(()=>Promise.resolve());await key(app);assert.equal(manual(app).length,initial+1);assert.deepEqual(await app.exported('free-export-draft'),draft);
  }finally{await app.close();}
});

test('muted idle and stopped contacts update keys without constructing audio or recording',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await app.click('free-sound');app.emit(app.$('free-practice-title'),'keydown',musical);assert.equal(held(app),1);app.emit(app.$('free-practice-title'),'keyup',musical);
    await app.click('free-start');await app.click('free-stop');const draft=await app.exported('free-export-draft');await pointer(app);assert.deepEqual(app.audio(),{contexts:0,unlocks:0});assert.equal(held(app),0);assert.deepEqual(await app.exported('free-export-draft'),draft);
  }finally{await app.close();}
});

for(const mode of ['idle','stopped'])test(`${mode} free audio excludes delayed MIDI from a closed dialog or hidden interval`,async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);let draft;
    if(mode==='stopped'){await app.click('free-start');await app.click('free-stop');draft=await app.exported('free-export-draft');}
    app.$('settings-button').click();const modalTime=performance.now();await app.tick();app.$('settings-dialog').close();
    app.midi([0x90,60,91],modalTime);await app.tick();app.midi([0x80,60,0],modalTime);assert.equal(manual(app).length,0,'Closing Settings must end its blocked event-time interval');
    Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');const hiddenTime=performance.now();await app.tick();
    Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');
    app.midi([0x90,62,92],hiddenTime);await app.tick();app.midi([0x80,62,0],hiddenTime);assert.equal(manual(app).length,0,'Visibility restoration must end the hidden interval even without a window focus event');
    app.midi([0x90,64,93]);await app.tick();assert.equal(held(app),1);app.midi([0x80,64,0]);assert.deepEqual(manual(app).map(args=>args[1]),[64]);
    assert.equal(app.$('free-practice-screen').dataset.state,mode);
    if(draft)assert.deepEqual(await app.exported('free-export-draft'),draft);else assert.equal(app.$('free-export-draft').disabled,true);
  }finally{await app.close();}
});

test('dialog close and visibility restoration do not manufacture window focus',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);app.$('settings-button').click();app.emit(app.window,'blur');
    Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');app.$('settings-dialog').close();
    Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');
    app.midi([0x90,60,90]);await app.tick();app.midi([0x80,60,0]);assert.equal(manual(app).length,0);
    app.emit(app.window,'focus');app.midi([0x90,64,90]);await app.tick();app.midi([0x80,64,0]);assert.deepEqual(manual(app).map(args=>args[1]),[64]);
  }finally{await app.close();}
});

test('late dialog and hidden MIDI still retain recording evidence without reviving sound',async()=>{
  const app=await freePracticeApp();try{
    await enter(app);await connect(app);await app.click('free-start');
    app.$('settings-button').click();const modalTime=performance.now();await app.tick();app.$('settings-dialog').close();await app.click('free-resume');
    app.midi([0x90,60,91],modalTime);app.midi([0x80,60,0],modalTime);
    Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');const hiddenTime=performance.now();await app.tick();
    Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');await app.click('free-resume');
    app.midi([0x90,62,92],hiddenTime);app.midi([0x80,62,0],hiddenTime);await app.tick();assert.equal(manual(app).length,0);
    await app.click('free-stop');const draft=await app.exported('free-export-draft');assert.deepEqual(onsets(draft).map(event=>[event.midi,event.segment_id]),[[60,null],[62,null]]);
  }finally{await app.close();}
});

for(const screen of ['free','stage'])test(`${screen} genuine key release tapers only the instrument tone and hidden cleanup cancels its tail`,async()=>{
  const app=await freePracticeApp({fetchResult:screen==='stage'?await fixtureScoreServer():null});
  const play=Synth.prototype.play,click=Synth.prototype.click;let synth,clicks=0;
  Synth.prototype.play=function(...args){synth=this;return play.apply(this,args);};
  Synth.prototype.click=function(...args){clicks++;return click.apply(this,args);};
  try{
    if(screen==='free')await enter(app);else{await app.until(()=>!app.$('start-practice').disabled);app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage');}
    const target=app.$(screen==='free'?'free-practice-title':'stage-title');
    app.emit(target,'keydown',musical);await app.tick();
    const voice=[...synth.voices.values()].find(value=>value.id.startsWith('manual:'));
    assert.ok(voice);synth.context.currentTime=0.04;
    app.emit(target,'keyup',musical);
    assert.equal(synth.voices.has(voice.id),false);assert.ok(synth.releasingVoices.has(voice));
    assert.equal(app.document.querySelectorAll(screen==='free'?'#free-practice-keys .held':'#keyboard .pressed').length,0,'Visual key release remains immediate');
    assert.equal(clicks,0,'Manual input does not trigger an extra click oscillator');
    assert.equal(synth.clickVoices.size,0);assert.equal(manual(app).length,1);
    Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');
    assert.equal(synth.voices.size,0);assert.equal(synth.releasingVoices.size,0);assert.equal(voice.disposed,true,'Hidden cleanup must include a key whose release already cleared the held state');
  }finally{Synth.prototype.play=play;Synth.prototype.click=click;await app.close();}
});

test('free MIDI panic cancels owned release tails while an older timestamp cannot cut a newer tail',async()=>{
  const app=await freePracticeApp(),play=Synth.prototype.play;let synth;
  Synth.prototype.play=function(...args){synth=this;return play.apply(this,args);};
  try{
    await enter(app);await connect(app);const prior=performance.now();await app.tick();
    app.midi([0x90,64,97]);await app.tick();synth.context.currentTime=0.03;app.midi([0x80,64,0]);
    const [tail]=synth.releasingVoices;assert.ok(tail);assert.equal(held(app),0);
    app.midi([0xb0,123,0],prior);assert.ok(synth.releasingVoices.has(tail),'A delayed panic cannot claim a later contact');
    await app.tick();app.midi([0xb0,123,0]);assert.equal(synth.releasingVoices.size,0);assert.equal(tail.disposed,true);
  }finally{Synth.prototype.play=play;await app.close();}
});

test('synthetic pointer cancellation keeps immediate hard-stop semantics',async()=>{
  const app=await freePracticeApp(),play=Synth.prototype.play;let synth;
  Synth.prototype.play=function(...args){synth=this;return play.apply(this,args);};
  try{
    await enter(app);const target=app.$('free-practice-keys').querySelector('[data-midi="64"]');
    app.emit(target,'pointerdown',{pointerId:1,button:0});await app.tick();const [voice]=synth.voices.values();synth.context.currentTime=0.02;
    app.emit(target,'pointercancel',{pointerId:1,button:0});
    assert.equal(synth.voices.size,0);assert.equal(synth.releasingVoices.size,0);assert.equal(voice.disposed,true);assert.equal(held(app),0);
  }finally{Synth.prototype.play=play;await app.close();}
});
