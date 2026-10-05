import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {readFileSync} from 'node:fs';
import {createI18n} from '../web/i18n.js';
import {ScorePreview} from '../web/score-preview.js';
import {setupCompletePerformanceListening} from '../web/complete-performance-listening.js';
import {completePerformanceSong,completePerformanceDescriptor,PerformanceAudio,PerformanceTimers} from './complete-performance-ui-fixture.js';
import {nativeScoreServer,nativeStorageApp,deferred,nativeResponse} from './native-storage-app-fixtures.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sounding=audio=>audio?.nodes.filter(node=>['oscillator','noise'].includes(node.kind)&&!node.disconnected)||[];
function viewFixture(){
  const{document,window}=parseHTML('<html><body><section id="preview"></section></body></html>'),i18n=createI18n({locale:'en'}),timers=new PerformanceTimers();
  let visible=true,allowed=true,unlocks=0,unlock=null,starts=0;const transitions=[];
  const synth={muted:false,context:null,output:null,async unlock(){unlocks++;if(unlock)return unlock();this.context ||=new PerformanceAudio();this.output ||=this.context.createGain();}};
  const view=setupCompletePerformanceListening({document,i18n,synth,timers,host:document.getElementById('preview'),isVisible:()=>visible,allowed:()=>allowed,onBeforePlay:()=>starts++,onActiveChange:value=>transitions.push(value),onSoundChange:value=>{synth.muted=!value;view.soundChanged();}});
  const $=id=>document.getElementById(`complete-performance-${id}`),emit=(id,type='change')=>$(id).dispatchEvent(new window.Event(type,{bubbles:true}));
  i18n.setLocale('en');
  return{view,document,i18n,timers,synth,$,emit,transitions,unlocks:()=>unlocks,starts:()=>starts,setUnlock:fn=>{unlock=fn;},visible:value=>{visible=value;view.screenChanged();},allowed:value=>{allowed=value;},accept(){ $('policy-accept').checked=true;emit('policy-accept');},async play(){ $('play').click();await tick();}};
}

test('complete saved events never enter the notation compiler, VSQ choice or canonical start path',async()=>{
  const song=await completePerformanceSong(),calls=[];
  const preview=new ScorePreview({compile:()=>{calls.push('compile');throw Error('No notation');},check:()=>{calls.push('targets');throw Error('No targets');}});
  assert.equal(await preview.select(song.libraryKey,async()=>({score:null,cleanSong:song})),true);
  assert.equal(preview.value.status,'performance');assert.equal(preview.value.score,null);assert.equal(preview.value.compiled,null);assert.equal(preview.value.part,null);
  assert.equal(preview.canStart('listen'),false);assert.equal(preview.canStart('practice'),false);assert.deepEqual(calls,[]);
  const old=deferred();const loading=preview.select('old',()=>old.promise);await preview.select('new',async()=>({score:null,cleanSong:song}));old.resolve({score:null,cleanSong:song});assert.equal(await loading,false);assert.equal(preview.value.identity,'new');
});

test('pitch-bend policy discloses declared range, exact events and unavailable notation in English and Chinese before playback',async()=>{
  const f=viewFixture(),song=await completePerformanceSong({pitchBend:true});
  try{
    f.view.select(song);assert.equal(f.$('policy-pitch').hidden,false);
    assert.match(f.$('policy-pitch').textContent,/two semitones.*twelve-semitone/);
    assert.match(f.$('policy-pitch').textContent,/Original keys stay unchanged/);
    assert.match(f.$('policy-pitch').textContent,/not proof of original tuning, timbre, voice fidelity or complete playability/);
    assert.match(f.$('policy-pitch').textContent,/frequencies are never clamped/);
    assert.equal(f.$('play').disabled,true);assert.equal(f.unlocks(),0);
    assert.match(f.$('policy').dataset.policyId,/fifo-pitch-v3/);
    const controls=[...f.document.querySelectorAll('input,button')];f.i18n.setLocale('zh-CN');
    assert.deepEqual([...f.document.querySelectorAll('input,button')],controls);
    assert.match(f.$('policy-pitch').textContent,/默认 2 半音.*12 半音/);
    assert.match(f.$('policy-pitch').textContent,/原始按键音高不变/);
    assert.match(f.$('policy-pitch').textContent,/不证明原始调音、音色、声部还原或完整可演奏性/);
    assert.match(f.$('coverage').textContent,/记谱不可用.*评分不可用/);
    f.accept();await f.play();f.timers.advance(180,f.synth.context);
    const first=sounding(f.synth.context)[0];
    assert.ok(first.frequency.events.some(([kind,hz,time])=>kind==='set'&&Math.abs(time-.2)<1e-10&&Math.abs(hz-440*2**((61-69)/12))<1e-10));
    f.view.stop();assert.equal(sounding(f.synth.context).length,0);
    assert.equal(song.notation,null);assert.equal(song.compilation,null);
    f.view.select(await completePerformanceSong());assert.equal(f.$('policy-pitch').hidden,true);
  }finally{f.view.destroy();}
});

test('saved reference panel retains every track and attack, requires policy, uses shared production audio and keeps FIFO gates out of notation',async()=>{
  const f=viewFixture(),song=await completePerformanceSong(),before=song.score_json;
  try{
    f.view.select(song);assert.equal(f.$('policy-routing').hidden,true);assert.equal(f.$('policy-routing').textContent,'');assert.equal(f.$('policy-label').textContent,'I select this reference sound and event playback policy');assert.equal(f.$('tracks').children.length,3);assert.equal(f.$('counts').dataset.onsetCount,'3');assert.equal(f.$('counts').dataset.eventCount,'11');
    assert.deepEqual([...f.$('tracks').children].map(row=>[row.dataset.eventCount,row.dataset.onsetCount]),[['2','0'],['6','2'],['3','1']]);
    assert.match(f.$('coverage').textContent,/Notation unavailable.*Practice targets and grades unavailable/);assert.match(f.$('policy-events').textContent,/FIFO/);assert.match(f.$('policy-gates').textContent,/reference sound gates only/);assert.match(f.$('policy-tone').textContent,/not the original instruments/);
    assert.equal(f.unlocks(),0);assert.equal(f.$('play').disabled,true);await f.play();assert.equal(f.unlocks(),0);
    f.accept();await f.play();assert.equal(f.$('status').dataset.state,'playing');assert.equal(f.unlocks(),1);assert.equal(f.starts(),1);
    assert.ok(sounding(f.synth.context).length);assert.ok(f.synth.context.nodes.some(node=>node.connections.includes(f.synth.output)));
    const first=sounding(f.synth.context)[0];assert.deepEqual(first.starts,[0.05]);assert.deepEqual(first.stops,[0.25],'Original first release closes the first FIFO reference gate');
    const nodes=[...f.document.querySelectorAll('input,button')];f.i18n.setLocale('zh-CN');assert.deepEqual([...f.document.querySelectorAll('input,button')],nodes);assert.match(f.$('coverage').textContent,/记谱不可用/);assert.doesNotMatch(f.$('coverage').textContent,/0.*音符/);
    f.timers.advance(170,f.synth.context);f.$('pause').click();assert.equal(f.view.snapshot().state,'paused');assert.equal(sounding(f.synth.context).length,0);assert.equal(f.$('mute-1').disabled,true);
    await f.play();assert.equal(f.view.snapshot().state,'playing');f.$('stop').click();assert.equal(sounding(f.synth.context).length,0);assert.equal(f.view.snapshot().positionSeconds,0);assert.equal(f.$('mute-1').disabled,false);
    f.$('mute-1').checked=true;f.emit('mute-1');await f.play();assert.deepEqual(f.view.snapshot().mutedTracks,[1]);assert.equal(sounding(f.synth.context).length,2);assert.equal(song.score_json,before);assert.equal(song.notation,null);assert.equal(song.compilation,null);
  }finally{f.view.destroy();}
});

test('unsupported commands block listening and all mute controls; shared-channel mute stays unavailable',async()=>{
  const f=viewFixture();try{
    f.view.select(await completePerformanceSong({blocked:true}));f.accept();assert.equal(f.$('play').disabled,true);assert.match(f.$('problems').textContent,/unsupported_channel_pressure/);assert.ok([...f.$('tracks').querySelectorAll('input')].every(input=>input.disabled));await f.play();assert.equal(f.unlocks(),0);
    assert.equal(f.$('counts').dataset.eventCount,'12');assert.equal(f.$('tracks').children.length,3);
    f.view.select(await completePerformanceSong({shared:true}));assert.equal(f.$('mute-1').disabled,true);assert.equal(f.$('mute-2').disabled,true);assert.match(f.$('tracks').textContent,/Shared channels; independent mute unavailable/);
    f.$('mute-1').checked=true;f.emit('mute-1');assert.deepEqual(f.view.snapshot().mutedTracks,[]);f.accept();await f.play();assert.equal(f.view.snapshot().state,'playing');
  }finally{f.view.destroy();}
});

test('new preview, Stop, navigation, global sound and destroy cancel pending audio without automatic restart',async()=>{
  for(const action of ['stop','new-preview','navigation','sound','destroy']){
    const f=viewFixture(),pending=deferred();try{
      f.view.select(await completePerformanceSong());f.setUnlock(()=>pending.promise);f.accept();await f.play();assert.equal(f.view.snapshot().state,'starting');
      if(action==='stop')f.view.stop();if(action==='new-preview')f.view.select(null);if(action==='navigation')f.visible(false);if(action==='sound'){f.synth.muted=true;f.view.soundChanged();}if(action==='destroy')f.view.destroy();
      const audio=new PerformanceAudio();f.synth.context=audio;f.synth.output=audio.createGain();pending.resolve();await tick();assert.equal(sounding(audio).length,0,action);assert.equal(f.view.snapshot().state,'stopped',action);
      if(action==='navigation'){f.visible(true);assert.equal(f.$('policy-accept').checked,false);assert.equal(f.$('play').disabled,true);assert.deepEqual(f.transitions,[true,false,true]);}
      if(action==='sound'){f.synth.muted=false;f.view.soundChanged();assert.equal(f.view.snapshot().state,'stopped');}
      assert.equal(f.unlocks(),1);
    }finally{f.view.destroy();}
  }
});

test('production receiver failure silences audio, preserves diagnostics, and requires Stop before retry',async()=>{
  const f=viewFixture();try{
    f.view.select(await completePerformanceSong());f.accept();await f.play();f.synth.context.currentTime=2;
    for(const[id,item]of [...f.timers.pending]){f.timers.pending.delete(id);item.fn();}
    assert.equal(f.view.snapshot().state,'error');assert.match(f.$('problems').textContent,/late_scheduler/);assert.equal(sounding(f.synth.context).length,0);assert.equal(f.$('play').disabled,true);await f.play();assert.equal(f.unlocks(),1);
    f.$('stop').click();assert.equal(f.$('problems').hidden,true);assert.equal(f.view.snapshot().state,'stopped');
  }finally{f.view.destroy();}
});

async function appFixture(options){
  const opened=JSON.parse(readFileSync(new URL('./fixtures/complete-performance-v2-native-open.json',import.meta.url),'utf8'));
  const fixture=options?completePerformanceDescriptor(options):{key:opened.entry.key,descriptor:opened.clean_package,entry:opened.entry},server=await nativeScoreServer();
  server.records.set(fixture.key,{entry:fixture.entry,score_json:null,clean_package:fixture.descriptor});
  const app=await nativeStorageApp(server);await app.until(()=>app.savedButton(fixture.key));await app.click('home-single-player');app.savedButton(fixture.key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='performance','Complete performance preview unavailable');
  return{...fixture,server,app};
}

test('actual saved-song app uses null-notation preview, preserves prior take, and cancels selected reference on navigation and newer loads',async()=>{
  const{app,server,key}=await appFixture();
  try{
    assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('preview-part-label').hidden,true);
    assert.match(app.$('preview-music-meta').textContent,/Notation unavailable/);assert.match(app.$('preview-gate').textContent,/practice targets and grades unavailable/);
    assert.equal(app.$('complete-performance-tracks').children.length,11);assert.equal(app.$('complete-performance-counts').dataset.onsetCount,'20');assert.equal(app.$('vsq-practice-choice').hidden,true);
    const take=await app.exported('export-takes'),compiled=app.requests.filter(row=>row.path==='/api/compile').length;
    // Reuse the app's actual Synth instance: invoke its production unlock after
    // providing the authored WebAudio fixture, rather than replacing the player.
    const oldAudio=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:PerformanceAudio});
    try{
      app.$('complete-performance-policy-accept').checked=true;app.emit(app.$('complete-performance-policy-accept'),'change');await app.click('complete-performance-play');await app.until(()=>app.$('complete-performance-status').dataset.state==='playing');
      assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.requests.filter(row=>row.path==='/api/compile').length,compiled);
      Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');assert.equal(app.$('complete-performance-status').dataset.state,'stopped');assert.equal(app.$('complete-performance-play').disabled,true);
      Object.defineProperty(app.document,'hidden',{configurable:true,value:false});app.emit(app.document,'visibilitychange');assert.equal(app.$('complete-performance-status').dataset.state,'stopped');assert.equal(app.$('complete-performance-play').disabled,false);
      await app.click('complete-performance-play');await app.until(()=>app.$('complete-performance-status').dataset.state==='playing');
      await app.click('play-button');await app.click('assess-button');assert.equal(app.requests.some(row=>row.path==='/api/assess'),false);assert.deepEqual(await app.exported('export-takes'),take);
      await app.click('home-single-player');assert.equal(app.$('complete-performance-status').dataset.state,'stopped');assert.equal(app.$('complete-performance-policy-accept').checked,false);
      app.$('complete-performance-policy-accept').checked=true;app.emit(app.$('complete-performance-policy-accept'),'change');await app.click('complete-performance-play');await app.until(()=>app.$('complete-performance-status').dataset.state==='playing');
      server.setRoute(({path})=>path==='/api/library/load'?nativeResponse({code:'library_not_found',error:'Authored unavailable replacement'},404):undefined);app.savedButton(key).click();
      await app.until(()=>app.$('song-lobby').dataset.previewStatus==='error');assert.equal(app.$('complete-performance-listening').hidden,true);assert.equal(app.$('start-listen').disabled,true);
    }finally{Object.defineProperty(globalThis,'AudioContext',oldAudio);}
  }finally{await app.close();}
});

test('complete-event preview excludes human contacts from the prior practice take, including delayed contacts after leaving',async()=>{
  const{app,key}=await appFixture(),oldAudio=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:PerformanceAudio});
  try{
    app.document.querySelector('#catalog [data-score-id]').click();await app.until(()=>!app.$('start-practice').disabled);
    await app.click('sound-button');app.$('count-in').checked=false;await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('play-button').textContent.includes('Pause'));await app.click('play-button');await app.click('sound-button');
    await app.click('back-to-library');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='performance');
    const before=await app.exported('export-takes'),sounds=app.plays.length,note=app.document.querySelector('#keyboard [data-midi="60"]');
    const interval=performance.now();
    for(const[type,properties]of [['pointerdown',{pointerId:71,button:0}],['pointerup',{pointerId:71}]])app.emit(note,type,properties);
    for(const type of ['keydown','keyup'])app.emit(app.document.body,type,{code:'KeyR',key:'r'});
    app.$('complete-performance-policy-accept').checked=true;app.emit(app.$('complete-performance-policy-accept'),'change');await app.click('complete-performance-play');await app.until(()=>app.$('complete-performance-status').dataset.state==='playing');
    await app.click('assess-button');assert.deepEqual(await app.exported('export-takes'),before);assert.equal(app.plays.length,sounds);
    await app.click('resume-session');assert.equal(app.document.body.dataset.screen,'stage');
    for(const[type,properties]of [['pointerdown',{pointerId:72,button:0}],['pointerup',{pointerId:72}]]){
      const event=new app.window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,properties);Object.defineProperty(event,'timeStamp',{value:interval});note.dispatchEvent(event);
    }
    assert.deepEqual(await app.exported('export-takes'),before);assert.equal(app.plays.length,sounds);assert.equal(app.requests.some(row=>row.path==='/api/assess'),false);
  }finally{Object.defineProperty(globalThis,'AudioContext',oldAudio);await app.close();}
});

test('actual app newer selection and pagehide defeat late complete-performance audio admission',async()=>{
  const{app,key}=await appFixture();try{
    const pending=deferred();app.setUnlock(()=>pending.promise);app.$('complete-performance-policy-accept').checked=true;app.emit(app.$('complete-performance-policy-accept'),'change');await app.click('complete-performance-play');
    assert.equal(app.$('complete-performance-status').dataset.state,'starting');app.document.querySelector('#catalog [data-score-id]').click();await app.until(()=>app.$('complete-performance-listening').hidden);pending.resolve();await app.tick();
    assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator').length,0);assert.equal(app.$('song-lobby').dataset.previewStatus,'ready');
    app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='performance');assert.equal(app.$('complete-performance-policy-accept').checked,false);
    const leaving=deferred();app.setUnlock(()=>leaving.promise);app.$('complete-performance-policy-accept').checked=true;app.emit(app.$('complete-performance-policy-accept'),'change');await app.click('complete-performance-play');app.emit(app.window,'pagehide');leaving.resolve();await app.tick();
    assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator').length,0);assert.equal(app.$('complete-performance-status').dataset.state,'stopped');assert.equal(app.$('complete-performance-policy-accept').checked,false);
    app.emit(app.window,'pageshow',{persisted:true});assert.equal(app.$('complete-performance-status').dataset.state,'stopped');assert.equal(app.$('complete-performance-play').disabled,true);
  }finally{await app.close();}
});

test('controlled COMPLETE listening discloses sustain and mix policy, preserves null grading, and stops on navigation',async()=>{
  const f=viewFixture(),song=await completePerformanceSong({controls:true});
  try{
    f.view.select(song);assert.equal(f.$('policy').dataset.policyId,'wmh-original-reference-fifo-controls-v2');
    assert.equal(f.$('policy-controls').hidden,false);assert.match(f.$('policy-controls').textContent,/volume × expression/);assert.match(f.$('policy-events').textContent,/sustain values 64–127/);
    assert.equal(f.$('play').disabled,true);f.accept();await f.play();assert.equal(f.view.snapshot().state,'playing');
    const sources=sounding(f.synth.context);assert.ok(sources.length);assert.deepEqual(sources[0].stops,[0.55]);
    assert.equal(song.notation,null);assert.equal(song.compilation,null);assert.equal(song.runtime.coverage.targets.represented_attacks,0);
    f.visible(false);assert.equal(sounding(f.synth.context).length,0);assert.equal(f.$('policy-accept').checked,false);
    f.i18n.setLocale('zh-CN');assert.match(f.$('policy-controls').textContent,/延音踏板/);
  }finally{f.view.destroy();}
});


test('complete listening discloses exact logical destination and includes its mapping in the bilingual policy choice',async()=>{
  const f=viewFixture(),name='Authored <device> & “键盘”  ',song=await completePerformanceSong({deviceName:name}),before=song.score_json;
  try{
    f.view.select(song);const routing=f.$('policy-routing');assert.equal(routing.hidden,false);assert.ok(routing.textContent.includes(name));assert.equal(routing.children.length,0);
    assert.match(routing.textContent,/selected procedural reference receiver/);assert.match(routing.textContent,/source device and timbre are unverified/);assert.match(f.$('policy-label').textContent,/logical device mapping policy/);
    assert.equal(f.$('policy').dataset.policyId,song.reference.policy.id);assert.equal(f.$('policy').dataset.policyId,'wmh-original-reference-fifo-v1:single-named-device-v1');assert.equal(song.reference.policy.logical_device_mapping.policy,'single_named_device_to_procedural_receiver');
    assert.equal(f.$('play').disabled,true);await f.play();assert.equal(f.unlocks(),0);
    f.i18n.setLocale('zh-CN');assert.equal(f.$('policy-routing'),routing);assert.ok(routing.textContent.includes(name));assert.match(routing.textContent,/逻辑目标.*所选程序合成参考接收器/);assert.match(routing.textContent,/未验证源设备与原始音色/);assert.match(f.$('policy-label').textContent,/逻辑设备映射策略/);
    f.accept();await f.play();assert.equal(f.view.snapshot().state,'playing');assert.ok(sounding(f.synth.context).length);assert.equal(song.score_json,before);assert.equal(song.notation,null);assert.equal(song.compilation,null);
    f.view.select(await completePerformanceSong());assert.equal(routing.hidden,true);assert.equal(routing.textContent,'');assert.doesNotMatch(f.$('policy-label').textContent,/逻辑设备/);assert.equal(f.$('policy-accept').checked,false);assert.equal(f.$('policy').dataset.policyId,'wmh-original-reference-fifo-v1');
  }finally{f.view.destroy();}
});

test('unresolved complete-event logical routes retain data and block play with a specific bilingual reason',async()=>{
  const f=viewFixture(),song=await completePerformanceSong({deviceName:'Authored Shared Device',shared:true}),before=song.score_json;
  try{
    f.view.select(song);assert.equal(f.$('policy-routing').hidden,true);assert.equal(f.$('policy-accept').disabled,true);assert.equal(f.$('play').disabled,true);
    assert.match(f.$('problems').textContent,/unresolved_logical_device_route: Logical device routing is unresolved/);assert.match(f.$('problems').textContent,/Multiple tracks share a channel/);assert.match(f.$('problems').textContent,/Playback is blocked; all source events and device names remain saved/);
    assert.equal(f.$('counts').dataset.eventCount,'13');assert.equal(f.$('tracks').children.length,3);f.accept();await f.play();assert.equal(f.unlocks(),0);assert.equal(f.view.snapshot().state,'stopped');
    f.i18n.setLocale('zh-CN');assert.match(f.$('problems').textContent,/逻辑设备路由无法解析/);assert.match(f.$('problems').textContent,/多条音轨共用一个通道/);assert.match(f.$('problems').textContent,/已阻止播放；所有源事件与设备名称仍完整保存/);assert.equal(f.$('play').disabled,true);assert.equal(song.score_json,before);
  }finally{f.view.destroy();}
});
