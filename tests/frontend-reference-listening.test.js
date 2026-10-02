import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {Synth} from '../web/transport.js';
import {setupReferenceListening} from '../web/reference-listening.js';
import {originalReferenceMidiFixture} from './reference-listening-fixture.js';
import {fixtureScoreServer} from './free-practice-app-fixtures.js';

// Node DOM + actual reference controller/receiver; no browser or HTTP launched.
class AudioParam {
  setValueAtTime(value) {this.value=value;}
  linearRampToValueAtTime(value) {this.value=value;}
  exponentialRampToValueAtTime(value) {this.value=value;}
  cancelScheduledValues() {}
}
class AudioNode {
  constructor(context,kind) {this.context=context;this.kind=kind;this.gain=new AudioParam();this.frequency=new AudioParam();this.Q=new AudioParam();this.starts=[];this.stops=[];this.connections=[];this.disconnected=false;}
  connect(node) {this.connections.push(node);}
  disconnect() {this.disconnected=true;}
  start(at) {this.starts.push(at);}
  stop(at) {this.stops.push(at);}
}
class FakeAudio {
  static created=[];
  constructor() {this.currentTime=0;this.state='running';this.sampleRate=48000;this.nodes=[];this.destination={};FakeAudio.created.push(this);}
  make(kind) {const node=new AudioNode(this,kind);this.nodes.push(node);return node;}
  createGain() {return this.make('gain');}
  createOscillator() {return this.make('oscillator');}
  createBufferSource() {return this.make('noise');}
  createBiquadFilter() {return this.make('filter');}
  createBuffer(channels,length) {return {getChannelData:()=>new Float32Array(length)};}
  async resume() {this.state='running';}
}
class Timers {
  now=0; next=0; pending=new Map();
  setTimeout=(fn,delay)=>{const id=++this.next;this.pending.set(id,{fn,at:this.now+delay});return id;};
  clearTimeout=id=>this.pending.delete(id);
  advance(ms,audio) {const until=this.now+ms;while(this.now<until){this.now=Math.min(this.now+10,until);audio.currentTime=this.now/1000;for(const [id,item]of [...this.pending])if(item.at<=this.now){this.pending.delete(id);item.fn();}}}
}
function installDOM(html) {
  const {document,window}=parseHTML(html);
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',value);}});
  window.HTMLElement.prototype.showModal=function(){this.open=true;};
  window.HTMLElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  return {document,window};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='State did not settle') {for(let i=0;i<200;i++){if(predicate())return;await tick();}assert.fail(label);}
function emit(window,node,type,values={}) {const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,values);node.dispatchEvent(event);return event;}
function setFile(window,input,file) {Object.defineProperty(input,'files',{configurable:true,value:file?[file]:[]});emit(window,input,'change');}
const sourceFile=f=>({name:f.name,size:f.bytes.length,arrayBuffer:async()=>Uint8Array.from(f.bytes).buffer});
const sounding=audio=>audio.nodes.filter(node=>['oscillator','noise'].includes(node.kind)&&!node.disconnected);

// The UI does not construct prepared event JSON. Its only admission route remains
// loadMidiReference with complete original bytes and an injected HTTP transport.
test('Import panel uses complete bytes, real controller, shared audio, explicit policy, stable localized nodes and exact source download',async()=>{
  const {document,window}=installDOM('<html><body><dialog id="import-tools-dialog" open><div class="shell-dialog-content"></div></dialog><input id="retained-draft" value="D#3"></body></html>');
  const f=originalReferenceMidiFixture(),i18n=createI18n(),timers=new Timers(),calls=[],downloads=[],transitions=[];
  const synth={context:null,output:null,unlocks:0,async unlock(){this.unlocks++;this.context ||=new FakeAudio();this.output ||=this.context.createGain();}};
  let sound=true,paused=0;
  const view=setupReferenceListening({document,i18n,synth,timers,crypto:webcrypto,pausePlayback:()=>paused++,onActiveChange:value=>transitions.push(value),getSoundEnabled:()=>sound,onSoundChange:value=>{sound=value;view.soundChanged();},
    request:async(path,options)=>{calls.push({path,body:new Uint8Array(options.body)});return {ok:true,json:async()=>structuredClone(f.timeline)};},
    urls:{createObjectURL:blob=>{downloads.push(blob);return 'blob:original-reference';},revokeObjectURL(){}}});
  const $=id=>document.getElementById(`reference-${id}`);
  try {
    assert.equal($('listening-entry').textContent,'完整 MIDI 参考聆听');$('listening-entry').click();assert.equal(view.isOpen(),true);assert.equal(paused,1);assert.equal(document.getElementById('import-tools-dialog').open,false);
    assert.equal(synth.context,null);setFile(window,$('file'),sourceFile(f));await until(()=>$('counts').dataset.eventCount==='26');
    assert.deepEqual(calls,[{path:'/api/midi/events',body:Uint8Array.from(f.bytes)}]);assert.equal(synth.context,null);
    assert.equal($('counts').dataset.onsetCount,'8');assert.equal($('tracks').children.length,3);
    assert.deepEqual([...$('tracks').children].map(row=>[Number(row.dataset.eventCount),Number(row.dataset.onsetCount)]),[[10,3],[7,2],[9,3]]);
    assert.match($('policy-percussion').textContent,/118/);assert.match($('programs').textContent,/118.*WMH 参考打击乐/);
    assert.equal($('play').disabled,true);$('play').click();assert.equal(synth.context,null);
    $('policy-accept').checked=true;emit(window,$('policy-accept'),'change');$('play').click();await until(()=>$('status').dataset.state==='playing');
    assert.equal(synth.unlocks,1);assert.ok(sounding(synth.context).length>0);assert.ok(synth.context.nodes.some(node=>node.connections.includes(synth.output)));
    timers.advance(750,synth.context);assert.notEqual($('clock').textContent,'0:00.0 / 0:06.0');
    $('choose-file').click();assert.equal($('status').dataset.state,'paused','File chooser pauses before it opens');emit(window,$('file'),'cancel');setFile(window,$('file'),null);assert.equal($('source-name').textContent,f.name);assert.equal($('status').dataset.state,'paused','Cancel keeps the prior position and source');assert.equal(sounding(synth.context).length,0);assert.equal($('mute-0').disabled,true);
    const nodes=[...$('listening-dialog').querySelectorAll('input,button')],draft=document.getElementById('retained-draft'),clockBefore=$('clock').textContent;
    i18n.setLocale('en');assert.equal($('play').textContent,'Resume reference');assert.equal($('clock').textContent,clockBefore);assert.deepEqual([...$('listening-dialog').querySelectorAll('input,button')],nodes);assert.equal(document.getElementById('retained-draft'),draft);assert.equal(draft.value,'D#3');assert.equal(calls.length,1);
    $('play').click();await until(()=>$('status').dataset.state==='playing');assert.equal(synth.unlocks,2);const sameContext=synth.context;timers.advance(300,synth.context);
    $('stop').click();assert.equal($('clock').textContent,'0:00.0 / 0:06.0');assert.equal(sounding(synth.context).length,0);assert.equal($('mute-1').disabled,false);
    $('mute-1').checked=true;emit(window,$('mute-1'),'change');$('play').click();await until(()=>$('status').dataset.state==='playing');assert.equal(synth.context,sameContext);assert.equal($('mute-1').checked,true);assert.equal($('counts').dataset.eventCount,'26');
    $('sound').checked=false;emit(window,$('sound'),'change');assert.equal($('status').dataset.state,'muted');assert.equal(sounding(synth.context).length,0);assert.equal($('play').disabled,true);
    const unlocks=synth.unlocks;$('play').click();await tick();assert.equal(synth.unlocks,unlocks);
    $('sound').checked=true;emit(window,$('sound'),'change');assert.equal(synth.unlocks,unlocks);assert.equal($('status').dataset.state,'stopped');
    $('download').click();assert.deepEqual(new Uint8Array(await downloads.at(-1).arrayBuffer()),Uint8Array.from(f.bytes));
    $('play').click();await until(()=>$('status').dataset.state==='playing');$('close').click();assert.equal(view.isOpen(),false);assert.equal(sounding(synth.context).length,0);
    view.open();assert.equal($('source-name').textContent,f.name);assert.equal($('counts').dataset.eventCount,'26');assert.equal($('mute-1').checked,true);assert.equal(calls.length,1);assert.deepEqual(transitions,[true,false,true]);
    setFile(window,$('file'),null);assert.equal($('counts').dataset.eventCount,'26');
    // A real controller failure is localized and blocks restart until Stop.
    $('play').click();await until(()=>$('status').dataset.state==='playing');synth.context.currentTime+=2;timers.advance(20,{set currentTime(_) {}});
    assert.equal($('status').dataset.state,'error');assert.match($('problems').textContent,/late_scheduler/);assert.equal(sounding(synth.context).length,0);
    i18n.setLocale('zh-CN');assert.match($('problems').textContent,/调度错过时间/);assert.doesNotMatch($('problems').textContent,/Audio missed/);
    $('stop').click();setFile(window,$('file'),{name:'too-large.mid',size:5*1024*1024+1});await until(()=>$('problems').textContent.includes('source_limit'));assert.match($('problems').textContent,/不超过 5 MiB/);
    $('download').click();assert.deepEqual(new Uint8Array(await downloads.at(-1).arrayBuffer()),Uint8Array.from(f.bytes),'A rejected replacement preserves the last complete source');
  } finally {view.destroy();}
});

test('actual app Import entry preserves prior score, take, drafts and nodes; suppresses MIDI and pointer captures; stops on navigation and global sound off',async()=>{
  const {document,window}=installDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const server=await fixtureScoreServer(),f=originalReferenceMidiFixture(),requests=[],downloads=[],values=new Map();let resolveAssessment;
  const delayedAssessment=new Promise(resolve=>{resolveAssessment=resolve;});
  const device={id:'reference-test-midi',name:'Original synthetic MIDI input',state:'connected',connection:'open',onmidimessage:null};
  const access={inputs:new Map([[device.id,device]]),onstatechange:null};
  const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>paint;window.HTMLElement.prototype.setPointerCapture=function(){};
  const installed={document,window,crypto:webcrypto,AudioContext:FakeAudio,navigator:{requestMIDIAccess:async()=>access},location:{origin:'http://reference-node-dom.invalid'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},fetch:async(path,options={})=>{
    const body=path==='/api/midi/events'?new Uint8Array(options.body):options.body?JSON.parse(options.body):null;requests.push({path,body});return {ok:true,json:async()=>path==='/api/midi/events'?structuredClone(f.timeline):path==='/api/assess'?delayedAssessment:server(path,body)};
  }};
  const originals=new Map(Object.keys(installed).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const[key,value]of Object.entries(installed))Object.defineProperty(globalThis,key,{configurable:true,value});
  const originalURL=URL.createObjectURL;URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:reference-app';};
  const originalPlay=Synth.prototype.play;let scoreSounds=0;Synth.prototype.play=function(...args){scoreSounds++;return originalPlay.apply(this,args);};
  const $=id=>document.getElementById(id),exportJson=async id=>{$(id).click();return JSON.parse(await downloads.at(-1).text());};
  const event=(node,type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{repeat:false,...properties});Object.defineProperty(e,'timeStamp',{value:performance.now()});node.dispatchEvent(e);};
  try {
    await import('../web/app.js?reference-listening-integration');await until(()=>!$('start-practice').disabled);$('start-practice').click();await until(()=>document.body.dataset.screen==='stage'&&!$('start-practice').disabled);
    if($('play-button').textContent.includes('暂停'))$('play-button').click();$('midi-button').click();await until(()=>device.onmidimessage!==null);$('count-in').checked=false;$('play-button').click();await until(()=>$('play-button').textContent.includes('暂停'));
    const earlierHumanTime=performance.now();event(document.body,'keydown',{key:'r',code:'KeyR'});event(document.body,'keyup',{key:'r',code:'KeyR'});
    $('play-button').click();$('custom-lowest').value='D#3';const draft=$('custom-lowest'),key=document.querySelector('#keyboard [data-midi="60"]');
    const priorTake=await exportJson('export-takes'),priorScore=await exportJson('export-button'),priorSounds=scoreSounds;
    $('import-tools-button').click();$('reference-listening-entry').click();assert.equal($('reference-listening-dialog').open,true);
    setFile(window,$('reference-file'),sourceFile(f));await until(()=>$('reference-counts').dataset.eventCount==='26');
    assert.deepEqual(requests.find(r=>r.path==='/api/midi/events').body,Uint8Array.from(f.bytes));
    const suppressedTime=performance.now();device.onmidimessage({data:[0x90,60,90],timeStamp:suppressedTime});device.onmidimessage({data:[0x80,60,0],timeStamp:suppressedTime+0.1});
    event(key,'pointerdown',{pointerId:55,button:0});event(key,'pointerup',{pointerId:55});event(document.body,'keydown',{key:'r',code:'KeyR'});event(document.body,'keyup',{key:'r',code:'KeyR'});$('assess-button').click();$('play-button').click();
    $('reference-policy-accept').checked=true;event($('reference-policy-accept'),'change');$('reference-play').click();await until(()=>$('reference-status').dataset.state==='playing');
    event(window,'blur');assert.equal($('reference-status').dataset.state,'paused');getAppI18n(document).setLocale('en');assert.equal($('reference-play').textContent,'Resume reference');assert.equal($('custom-lowest'),draft);assert.equal(draft.value,'D#3');assert.equal(document.querySelector('#keyboard [data-midi="60"]'),key);
    $('reference-play').click();await until(()=>$('reference-status').dataset.state==='playing');$('sound-button').click();assert.equal($('reference-status').dataset.state,'muted');assert.equal($('sound-button').getAttribute('aria-pressed'),'true');assert.equal(sounding(FakeAudio.created.at(-1)).length,0);
    $('sound-button').click();$('reference-play').click();await until(()=>$('reference-status').dataset.state==='playing');$('back-to-library').click();assert.equal($('reference-listening-dialog').open,false);assert.equal(sounding(FakeAudio.created.at(-1)).length,0);
    // A delayed callback stamped inside the reference interval must stay excluded
    // after the original score route is restored.
    device.onmidimessage({data:[0x90,64,90],timeStamp:suppressedTime});device.onmidimessage({data:[0x80,64,0],timeStamp:suppressedTime+0.1});
    assert.deepEqual(await exportJson('export-takes'),priorTake);assert.deepEqual(await exportJson('export-button'),priorScore);assert.equal(scoreSounds,priorSounds);assert.equal(requests.some(r=>r.path==='/api/assess'),false);
    $('import-tools-button').click();$('reference-listening-entry').click();assert.equal($('reference-source-name').textContent,f.name);assert.equal(requests.filter(r=>r.path==='/api/midi/events').length,1);
    $('reference-download').click();assert.deepEqual(new Uint8Array(await downloads.at(-1).arrayBuffer()),Uint8Array.from(f.bytes));
    device.onmidimessage({data:[0x90,67,91],timeStamp:earlierHumanTime});device.onmidimessage({data:[0x80,67,0],timeStamp:earlierHumanTime+0.01});
    const historicalTake=await exportJson('export-takes');assert.equal(historicalTake.passes.at(-1).inputs.at(-1).midi,67,'A delayed pre-listening human onset retains its original scored interval');assert.equal(scoreSounds,priorSounds,'Historical evidence must never retrigger audio in the modal');$('reference-close').click();
    // Already requested grading is held without mutating the retained take while
    // the listener is open, then is applied after close.
    $('resume-session').click();$('reset-button').click();$('assess-button').click();await until(()=>requests.some(r=>r.path==='/api/assess'));
    $('import-tools-button').click();$('reference-listening-entry').click();const gradingPending=await exportJson('export-takes');
    resolveAssessment({hits:[],misses:[],extras:[],accuracy_percent:0,mean_abs_error_ms:null,summary:{expected_notes:2,coverage_percent:0,timing_bias_ms:null,timing_stddev_ms:null,advice:[]},pitch_breakdown:[],grade_counts:{perfect:0,good:0,early:0,late:0,missed:0,extra:0},onset_completion:{total:0,complete:0,longest_complete_sequence:0}});
    await tick();await tick();assert.deepEqual(await exportJson('export-takes'),gradingPending,'An in-flight assessment does not settle inside reference listening');
    $('reference-close').click();await until(()=>!$('feedback-results').hidden);assert.notDeepEqual(await exportJson('export-takes'),gradingPending,'The completed result is retained and settles after closing');
  } finally {event(window,'pagehide');await tick();Synth.prototype.play=originalPlay;URL.createObjectURL=originalURL;for(const[key,value]of originals)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
});

test('pending audio unlock and stale file reads cannot bypass Stop, shared mute, or newer complete source selection',async()=>{
  const {document,window}=installDOM('<html><body><dialog id="import-tools-dialog"><div class="shell-dialog-content"></div></dialog></body></html>');
  const f=originalReferenceMidiFixture(),timers=new Timers();let resolveUnlock,resolveFile,sound=true,calls=0;
  const synth={context:new FakeAudio(),output:null,unlock:()=>new Promise(resolve=>{resolveUnlock=resolve;})};synth.output=synth.context.createGain();
  const view=setupReferenceListening({document,i18n:createI18n(),synth,timers,crypto:webcrypto,pausePlayback(){},getSoundEnabled:()=>sound,onSoundChange:value=>{sound=value;view.soundChanged();},request:async()=>{calls++;return{ok:true,json:async()=>structuredClone(f.timeline)};}});
  const $=id=>document.getElementById(`reference-${id}`);
  try {
    view.open();setFile(window,$('file'),{name:'empty.mid',size:0});await until(()=>$('status').dataset.state==='error');assert.match($('problems').textContent,/source_limit/);
    setFile(window,$('file'),sourceFile(f));await until(()=>$('counts').dataset.eventCount==='26');$('policy-accept').checked=true;emit(window,$('policy-accept'),'change');
    $('play').click();assert.equal($('status').dataset.state,'starting');assert.equal($('pause').disabled,false);assert.equal($('stop').disabled,false);assert.equal($('mute-0').disabled,true);assert.equal($('policy-accept').disabled,true);
    $('stop').click();resolveUnlock();await tick();assert.equal($('status').dataset.state,'stopped');assert.equal(sounding(synth.context).length,0);
    $('play').click();$('sound').checked=false;emit(window,$('sound'),'change');resolveUnlock();await tick();assert.equal($('status').dataset.state,'muted');assert.equal(sounding(synth.context).length,0);
    setFile(window,$('file'),{...sourceFile(f),name:'stale-read.mid',arrayBuffer:()=>new Promise(resolve=>{resolveFile=resolve;})});
    setFile(window,$('file'),{...sourceFile(f),name:'newest-source.mid'});await until(()=>$('source-name').textContent==='newest-source.mid'&&$('counts').dataset.eventCount==='26');
    resolveFile(Uint8Array.from(f.bytes).buffer);await tick();assert.equal($('source-name').textContent,'newest-source.mid');assert.equal(calls,2,'Stale bytes never reach the Rust loader or replace the newer source');
    sound=true;view.soundChanged();$('policy-accept').checked=true;emit(window,$('policy-accept'),'change');$('play').click();view.destroy();resolveUnlock();await tick();assert.equal(sounding(synth.context).length,0,'Destroy cancels pending unlock without rendering removed nodes');
  } finally {view.destroy();}
});
