import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeOptions,canonicalDisplayNotes} from '../web/canonical-practice-session.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred,settleMutedAudioDisposal} from './native-storage-app-fixtures.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {getAppI18n} from '../web/app-locale.js';
import {canonicalAudioErrorText,canonicalAudioPolicyText} from '../web/canonical-practice-text.js';
const renderedPosition=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=.125,`Expected ${expected} ms within one 8 kHz rendered frame; observed ${actual} ms`);

test('canonical transformations preserve a complete multi-part human selection and legacy All anchor',()=>{
  const parts=[{id:'lead'},{id:'harmony'},{id:'bass'}],selection={kind:'parts',part_ids:['bass','lead']};
  const copy=canonicalPracticeOptions(parts,{practiceSelection:selection,practiceLayout:'complete',showOthers:false});
  assert.deepEqual(copy,{part:'lead',practiceSelection:{kind:'parts',part_ids:['lead','bass']},practiceLayout:'complete',showOthers:false});
  assert.equal(canonicalPracticeOptions(parts,{practiceSelection:{kind:'all'}}).part,null);
  assert.deepEqual(selection.part_ids,['bass','lead']);
  assert.throws(()=>canonicalPracticeOptions(parts.slice(1),{practiceSelection:selection}),/existing human parts/);
});

test('canonical audio keeps every machine occurrence while human same-onset keys dedupe and tie/repeat evidence exports',async()=>{
  const f=await canonicalPracticeApp(),{app,score,evidence}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-complete-practice');
    const policy=app.$('complete-practice-canonical-policy').textContent;assert.match(policy,/reference.*compiled score/);assert.match(policy,/sine/);assert.match(policy,/Mod/);
    for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=[score.parts[0].id,score.parts[2].id].includes(box.value);
    await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver();assert.ok(receiver);assert.equal(receiver.core.plan.count,4);
    f.time(1300);app.frame();assert.ok(receiver.core.startedCount>0);assert.ok(app.plays.every(call=>!call[0].startsWith('score:')));
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,2);assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);
    const interpretation=take.passes[0].interpretation;assert.equal(interpretation.source_fingerprint,evidence.profile.source_fingerprint);assert.equal(interpretation.compiled_fingerprint,evidence.profile.compiled_fingerprint);assert.equal(interpretation.source_fingerprint_scope,'normalized_canonical_score');assert.equal(interpretation.policy_id,'wmh-canonical-sine-ms-v1');assert.equal(interpretation.source_timbres_preserved,false);assert.equal(interpretation.source_target_ids.length,4);assert.ok(take.passes[0].timeline.notes.some(note=>note.source_note_ids.includes('续 🎼')));
  }finally{await app.close();}
});

test('canonical explicit pause and resume retains one receiver and uses acknowledged clock segments',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-complete-practice');await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver();assert.equal(receiver.core.plan.count,0,'All-human playback still owns a real source clock');
    f.time(1300);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const paused=readPlaybackClock(app.document).positionMs;assert.equal(receiver.core.state,'paused');
    f.time(1700);app.frame();assert.equal(readPlaybackClock(app.document).positionMs,paused);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    assert.equal(f.receiver(),receiver);f.time(1850);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.passes[0].clock_segments.length,2);assert.equal(take.passes[0].clock_segments[1].positionStart,paused);assert.ok(take.passes[0].clock_segments[1].wallStart>take.passes[0].clock_segments[0].wallEnd);
  }finally{await app.close();}
});

test('canonical rapid Resume then Pause before the future anchor preserves held source time',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const receiver=f.receiver(),zero=app.sourceStartWall();f.time(zero+200);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);const position=readPlaybackClock(app.document).positionMs;
    f.time(zero+400);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);assert.equal(f.receiver(),receiver);assert.equal(receiver.core.state,'paused');assert.equal(readPlaybackClock(app.document).positionMs,position);
    f.time(zero+700);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(zero+800);await app.tick();app.frame();assert.equal(f.receiver(),receiver);assert.ok(readPlaybackClock(app.document).positionMs>=position);assert.doesNotMatch(app.$('notice-message').textContent,/canonical_audio|invalid_audio|audio_render/);
  }finally{await app.close();}
});

for(const boundary of ['reset-button','settings-button','back-to-library'])test(`pending canonical Pause cannot revive a receiver after ${boundary}`,async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const receiver=f.receiver();
    f.time(1200);app.frame();app.$('play-button').click();assert.equal(receiver.core.state,'running','Pause has not yet reached the processor');app.$(boundary).click();await app.tick();await app.tick();
    assert.equal(receiver.connected,false);assert.equal(f.receiver(),undefined);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');
    if(boundary==='reset-button')assert.equal(readPlaybackClock(app.document).positionMs,0);
    if(boundary==='settings-button')assert.equal(app.$('settings-dialog').open,true);
    if(boundary==='back-to-library')assert.equal(app.document.body.dataset.screen,'library');
  }finally{await app.close();}
});

test('canonical paused source cannot resume itself after an audio device interruption',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const receiver=f.receiver();
    f.time(1300);await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);const position=readPlaybackClock(app.document).positionMs;
    getAppI18n(app.document).setLocale('zh-CN');app.setAudioState('suspended');await app.tick();app.setAudioState('running');f.time(1600);app.frame();
    assert.equal(receiver.connected,false);assert.equal(f.receiver(),undefined);assert.equal(readPlaybackClock(app.document).positionMs,position);assert.match(app.$('notice-message').textContent,/音频|设备/);
  }finally{await app.close();}
});

test('canonical all-part Listen completes at the full source endpoint and manual assessment has source evidence',async()=>{
  const f=await canonicalPracticeApp(),{app,evidence}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const receiver=f.receiver();assert.equal(receiver.core.plan.count,evidence.compilation.timeline.notes.length);
    f.time(5200);await app.tick();app.frame();assert.equal(readPlaybackClock(app.document).positionMs,4000);assert.equal(readPlaybackClock(app.document).completed,true);await settleMutedAudioDisposal(app,[receiver]);assert.equal(receiver.connected,false);assert.match(app.$('play-button').textContent,/Play again/);
    app.$('session-mode').value='practice';app.emit(app.$('session-mode'),'change');await app.click('assess-button');await app.until(()=>!app.$('export-takes').disabled);const take=await app.exported('export-takes');assert.equal(take.passes[0].interpretation.source_fingerprint,evidence.profile.source_fingerprint);assert.equal(take.passes[0].capture_enabled,false);assert.deepEqual(take.passes[0].captures,[]);
  }finally{await app.close();}
});

test('canonical canceled profile preparation cannot start after reset and requires another explicit play',async()=>{
  const f=await canonicalPracticeApp(),{app,evidence}=f,waiting=deferred();let requested=false;
  try{
    f.setRoute(({path})=>{if(path==='/api/canonical-audio-profile'){requested=true;return waiting.promise;}});
    app.$('start-listen').click();await app.until(()=>requested);await app.click('reset-button');waiting.resolve(nativeResponse(evidence.profile));await app.tick();await app.tick();
    assert.equal(f.receiver(),undefined);assert.equal(readPlaybackClock(app.document).running,false);assert.equal(readPlaybackClock(app.document).positionMs,0);
    f.setRoute(null);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.ok(f.receiver());
  }finally{waiting.resolve(nativeResponse(evidence.profile));await app.close();}
});

test('canonical A/B playback uses audio pass clocks, clips machine tiles and quarantines a missed complete pass',async()=>{
  const f=await canonicalPracticeApp(),{app,score}=f;
  try{
    await app.click('midi-button');await app.until(()=>Boolean(app.midiDevice.onmidimessage));app.$('count-in').checked=false;await app.click('start-complete-practice');for(const box of app.$('complete-practice-parts').querySelectorAll('input'))box.checked=box.value===score.parts[0].id;
    await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    app.$('loop-from').value='4';app.$('loop-to').value='5';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver(),zero=app.sourceStartWall();assert.equal(receiver.core.plan.rangeGateCount,2);assert.match(app.$('canonical-audio-policy').textContent,/at most 4096 passes/);
    f.time(zero+100);app.frame();renderedPosition(readPlaybackClock(app.document).positionMs,2100);assert.deepEqual(JSON.parse(app.$('falling-notes').dataset.machineNoteIds).sort(),['occurrence-4','occurrence-5']);
    f.time(zero+550);await app.tick();app.frame();let take=await app.exported('export-takes');assert.equal(take.passes.length,2);assert.equal(take.passes[1].clock_segments[0].wallStart,zero+500);assert.equal(take.passes[1].clock_segments[0].positionStart,2000);assert.equal(take.passes[1].interpretation.playback_segments[0].audio_clock.pass_index,1);assert.equal(f.receiver(),receiver,'An ordinary loop never tears down or reschedules source audio');
    f.time(zero+1800);await app.tick();app.frame();take=await app.exported('export-takes');assert.equal(take.passes.length,2);assert.equal(take.interruptions.length,1);assert.equal(take.interruptions[0].skipped_passes,1);assert.equal(receiver.connected,false);assert.equal(readPlaybackClock(app.document).running,false);
    app.midi([0x90,60,90],zero+1400);app.midi([0x80,60,0],zero+1420);await app.tick();take=await app.exported('export-takes');assert.equal(take.unassigned_captures.length,1);assert.equal(take.unassigned_captures[0].scored,false);assert.deepEqual(take.passes.flatMap(pass=>pass.inputs),[]);
  }finally{await app.close();}
});

test('canonical selected-part Listen keeps its audible subset through A/B seek and explicit resume',async()=>{
  const f=await canonicalPracticeApp(),{app,score}=f;
  try{
    app.$('preview-part').value=score.parts[0].id;app.emit(app.$('preview-part'),'change');await app.until(()=>!app.$('start-listen').disabled);app.$('count-in').checked=false;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(f.receiver().core.plan.count,2);
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);app.$('loop-from').value='4';app.$('loop-to').value='5';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked);app.$('progress').value=2250;app.emit(app.$('progress'),'input');await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver(),zero=app.sourceStartWall();assert.equal(receiver.core.plan.initialPositionFrame,2250*8);assert.equal(receiver.core.plan.firstGateCount,1);assert.equal(receiver.core.plan.rangeGateCount,1);assert.equal(receiver.core.plan.initialCountInFrames,0);
    f.time(zero+300);await app.tick();app.frame();renderedPosition(readPlaybackClock(app.document).positionMs,2050);assert.equal(f.receiver(),receiver);assert.equal(app.requests.some(request=>request.path==='/api/assess'),false);
    app.emit(app.$('progress'),'keydown',{key:'End'});assert.equal(readPlaybackClock(app.document).positionMs,2500);assert.equal(readPlaybackClock(app.document).completed,true);await settleMutedAudioDisposal(app,[receiver]);assert.equal(receiver.connected,false);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(f.receiver().core.plan.initialPositionFrame,2000*8,'An explicit replay after seeking to B begins at A');
  }finally{await app.close();}
});

test('canonical A/B settings cancellation resumes the remaining count-in and keeps full count-in on the next pass',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=true;await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');app.$('loop-from').value='4';app.$('loop-to').value='5';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const original=f.receiver(),zero=app.sourceStartWall();f.time(zero+750);app.frame();assert.equal(readPlaybackClock(app.document).transportPositionMs,750);await app.click('settings-button');assert.equal(original.connected,false);app.$('settings-dialog').close();await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver(),resumed=app.sourceStartWall();assert.notEqual(receiver,original);assert.equal(receiver.core.plan.initialCountInFrames,1250*8);assert.equal(receiver.core.plan.countInFrames,2000*8);
    f.time(resumed+1250);await app.tick();app.frame();assert.equal(readPlaybackClock(app.document).positionMs,2000);f.time(resumed+1850);await app.tick();app.frame();assert.equal(readPlaybackClock(app.document).transportPositionMs,100);assert.equal(f.receiver(),receiver);
  }finally{await app.close();}
});

test('all-human canonical loops stop at the finite generation boundary without fabricating missed takes',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    app.$('count-in').checked=false;await app.click('start-complete-practice');await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');app.$('loop-from').value='4';app.$('loop-to').value='4.5';await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const receiver=f.receiver(),zero=app.sourceStartWall();assert.equal(receiver.core.plan.rangeGateCount,0);assert.equal(receiver.core.plan.maxPasses,4096);f.time(zero+4096*250+1);await app.tick();app.frame();await app.tick();
    assert.equal(receiver.connected,false);assert.equal(readPlaybackClock(app.document).positionMs,2250);assert.equal(readPlaybackClock(app.document).completed,true);assert.match(app.$('canonical-audio-policy').textContent,/loop stopped at its complete-pass limit/);
    const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.interruptions[0].skipped_passes,4095);assert.equal(take.passes[0].interpretation.loop_budget.max_passes,4096);assert.deepEqual(take.passes[0].inputs,[]);
    await app.until(()=>!app.$('play-button').disabled);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.notEqual(f.receiver(),receiver);
  }finally{await app.close();}
});

test('manual keys retain sound and delayed event-time inputs cannot cross a canonical paused gap',async()=>{
  const f=await canonicalPracticeApp(),{app}=f;
  try{
    await app.click('midi-button');await app.until(()=>Boolean(app.midiDevice.onmidimessage));app.$('count-in').checked=false;await app.click('start-complete-practice');await app.click('complete-practice-apply');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    f.time(1400);await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);let take=await app.exported('export-takes');const first=take.passes[0].clock_segments[0];
    f.time(2000);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    // Delivery is late, but its physical event happened before the pause.
    app.midi([0x90,60,96],1300);app.midi([0x80,60,0],1320);await app.tick();
    // This event happened well inside the paused interval, outside grace.
    app.midi([0x90,60,96],1750);app.midi([0x80,60,0],1770);await app.tick();
    f.time(2200);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:42,button:0});await app.tick();app.emit(key,'pointerup',{pointerId:42,button:0});await app.tick();
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);take=await app.exported('export-takes');
    assert.ok(app.plays.some(call=>call[0].startsWith('manual:')),'Explicit keys retain the persistent live output');
    assert.equal(take.passes[0].captures.filter(capture=>capture.event_wall_ms===1300).length,1);
    assert.equal(take.passes[0].captures.find(capture=>capture.event_wall_ms===1300).input.at_ms,first.positionStart+1300-first.wallStart);
    assert.equal(take.passes[0].captures.some(capture=>capture.event_wall_ms===1750),false);assert.ok(take.passes[0].inputs.length>=2);
  }finally{await app.close();}
});

test('canonical errors and disclosure remain readable in both supported locales',()=>{
  for(const code of ['canonical_audio_profile','invalid_canonical_audio_plan','canonical_audio_budget','voice_budget_exceeded','canonical_audio_loop_unavailable','canonical_audio_timing','clean_clock_unavailable','clean_late_start','audio_worklet_unavailable']){
    assert.match(canonicalAudioErrorText('en',{code}),/[A-Z]/);assert.match(canonicalAudioErrorText('zh-CN',{code}),/[\u3400-\u9fff]/);
  }
  assert.match(canonicalAudioPolicyText('en'),/does not reproduce the original instruments/);assert.match(canonicalAudioPolicyText('zh-CN'),/正弦音.*采样帧/);
});

test('canonical accompaniment display clips crossing ties at both loop boundaries and excludes B onsets',()=>{
  const timeline={duration_ms:5000,notes:[{id:'crossing',source_note_ids:['tie-a','tie-b'],part_id:'bass',start_ms:500,duration_ms:3000},{id:'at-b',part_id:'bass',start_ms:2500,duration_ms:1000}]};
  const before=structuredClone(timeline),notes=canonicalDisplayNotes(timeline,{start_ms:1000,end_ms:2500});
  assert.deepEqual(notes,[{...timeline.notes[0],start_ms:1000,duration_ms:1500}]);
  assert.deepEqual(timeline,before);
});

test('canonical Complete popup supports subset, cancel, explicit All and silent full-source practice',async()=>{
  const score=originalMultipartNotation({partCount:3,measures:4}),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server,{now:()=>1000});
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);
    await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-complete-practice').disabled);
    await app.click('sound-button');await app.click('start-complete-practice');
    const boxes=[...app.$('complete-practice-parts').querySelectorAll('input')];boxes[1].checked=false;app.emit(boxes[1],'change');
    await app.click('complete-practice-apply');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('play-button').textContent.includes('Pause'));
    await app.click('play-button');let take=await app.exported('export-takes');
    assert.deepEqual(take.practice_selection,{kind:'parts',part_ids:[score.parts[0].id,score.parts[2].id]});
    assert.equal(take.view_configuration.practice_layout,'complete');assert.deepEqual(take.passes[0].inputs,[]);
    assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id!==score.parts[1].id));
    await app.click('edit-complete-practice');await app.click('complete-practice-all');await app.click('complete-practice-cancel');
    take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.practice_selection.kind,'parts');
    await app.click('edit-complete-practice');await app.click('complete-practice-all');await app.click('complete-practice-apply');await app.until(()=>!app.$('play-button').disabled);
    await app.click('play-button');take=await app.exported('export-takes');
    assert.equal(take.practice_selection.kind,'all');assert.equal(take.practice_part,null);assert.deepEqual(take.practice_selection.part_ids,score.parts.map(part=>part.id));
    assert.deepEqual(app.plays,[],'Automatic notes never enter the manual Synth input path');
  }finally{await app.close();}
});
