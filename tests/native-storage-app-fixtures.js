import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {waitForTestCondition} from './async-test-wait.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {Synth} from '../web/transport.js';
import {getAppI18n} from '../web/app-locale.js';
import {fixtureScoreServer} from './free-practice-app-fixtures.js';
import {fixture} from './frontend-fixtures.js';

const origin='https://wmh.localhost';
let sequence=0;
export const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
export const authoredScore=(overrides={})=>({...structuredClone(fixture),...overrides});
export const nativeResponse=(value,status=200)=>({ok:status>=200&&status<300,status,redirected:false,url:origin,json:async()=>structuredClone(value)});

/** In-memory native protocol fixture. Never opens an app-data directory or server. */
export async function nativeScoreServer({scores=[],directory='C:\\Test-only\\WorldMusicHub\\Scores',issues=[]}={}) {
  const base=await fixtureScoreServer(),records=new Map(),requests=[];
  let route=null;
  function seed(score,raw=JSON.stringify(score)) {
    const score_json=raw,key=`song-${createHash('sha256').update(JSON.stringify(score)).digest('hex')}`;
    const entry={key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(score_json),saved_at_unix_ms:1700000000000+records.size};
    records.set(key,{entry,score_json});return structuredClone(entry);
  }
  scores.forEach(score=>seed(score));
  function defaultReply(path,body) {
    if(path==='/api/health')return nativeResponse({name:'WorldMusicHub',engine:'rust',network:'native-protocol-no-listener',score_format_version:1});
    if(path==='/api/library/list')return nativeResponse({storage:'native-filesystem',library_format_version:1,directory,entries:[...records.values()].map(row=>row.entry),issues});
    if(path==='/api/library/load'||path==='/api/library/export') {
      const record=records.get(body.key);
      if(!record)return nativeResponse({code:'library_not_found',error:'The selected saved copy no longer exists'},404);
      return nativeResponse(path.endsWith('/export')?{format:'worldmusichub-native-score-backup',version:1,...record}:record);
    }
    if(path==='/api/library/save') {
      const score=JSON.parse(body.score_json),existing=[...records.values()].find(row=>JSON.stringify(JSON.parse(row.score_json))===JSON.stringify(score));
      if(existing)return nativeResponse({code:'library_duplicate',error:'This complete score already exists',existing:existing.entry},409);
      const conflict=[...records.values()].find(row=>row.entry.score_id===score.id);
      if(conflict&&!body.allow_conflicting_id)return nativeResponse({code:'library_id_conflict',error:'A different edition has the same score ID',existing:conflict.entry},409);
      return nativeResponse(seed(score,body.score_json));
    }
    return nativeResponse(base(path,body));
  }
  async function fetcher(path,options={}) {
    const body=typeof options.body==='string'&&options.headers?.['Content-Type']==='application/json'?JSON.parse(options.body):options.body??null;
    const request={path,body,options};requests.push(request);
    const response=route?await route({...request,defaultReply:()=>defaultReply(path,body)}):undefined;
    return response??defaultReply(path,body);
  }
  return{fetcher,requests,records,seed,directory,issues,setRoute:handler=>{route=handler;}};
}

/** Real app import, mocked DOM/audio/native transport and isolated browser storage. */
export async function nativeStorageApp(server,{now,audioSampleRate=8000,audioWorklet=true,audioMessages=true,storageValues=new Map()}={}) {
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const audioNodes=[],audioHarnesses=[],audioDevices=[];const downloads=[],plays=[],values=storageValues,factory=new IDBFactory(),openedDatabases=[];
  let unlockImpl=null,audioModuleImpl=null,audioContexts=0,unlockCalls=0,frameId=0;const frames=new Map();
  const originalOpen=factory.open.bind(factory);
  factory.open=(name,...args)=>{openedDatabases.push(name);return originalOpen(name,...args);};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',Boolean(value));}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  window.HTMLElement.prototype.setPointerCapture=function(){};
  const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});
  window.HTMLCanvasElement.prototype.getContext=()=>paint;
  const parameter=()=>({value:0,events:[],setValueAtTime(value,at){this.value=value;this.events.push({value,at});},setTargetAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}});
  const audioNode=(kind,props={})=>{const node={kind,disconnected:false,connect(){},disconnect(){this.disconnected=true;},...props};audioNodes.push(node);return node;};
  class Audio {
    constructor(){audioContexts++;audioDevices.push(this);this.createdWall=performance.now();this.state='running';this.sampleRate=audioSampleRate;this.destination={};this.harness=basicKeyAudioHarness({sampleRate:audioSampleRate,autoMessages:audioMessages});audioHarnesses.push(this.harness);if(audioWorklet)this.audioWorklet={addModule:url=>audioModuleImpl?audioModuleImpl(url):this.harness.context.audioWorklet.addModule(url)};}
    get currentTime(){return this.harness.context.currentTime;}
    addEventListener(...args){this.harness.context.addEventListener(...args);}
    removeEventListener(...args){this.harness.context.removeEventListener(...args);}
    async resume(){if(this.state==='closed')throw Error('Audio context closed');this.state='running';this.harness.setState('running');}
    createGain(){return audioNode('gain',{gain:parameter()});}
    createStereoPanner(){return audioNode('panner',{pan:parameter()});}
    createConvolver(){return audioNode('convolver');}
    createBuffer(channels,length){return{length,getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){return audioNode('buffer-source',{starts:[],start(at){this.starts.push(at);},stop(){}});}
    createBiquadFilter(){return audioNode('filter',{frequency:parameter(),Q:parameter()});}
    createOscillator(){return audioNode('oscillator',{frequency:parameter(),starts:[],start(at){this.starts.push(at);},stop(){}});}
  }
  const originalUnlock=Synth.prototype.unlock,originalPlay=Synth.prototype.play,originalURL=URL.createObjectURL;
  Synth.prototype.unlock=function(...args){unlockCalls++;return unlockImpl?unlockImpl():originalUnlock.apply(this,args);};
  Synth.prototype.play=function(...args){plays.push(args);return originalPlay.apply(this,args);};
  URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:node-native-storage';};
  const installed={window,document,indexedDB:factory,navigator:{},location:{origin},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id),AudioContext:Audio,AudioWorkletNode:audioWorklet?class{constructor(context){
    const harness=context.harness,node=harness.nodeFactory(),post=node.port.postMessage,emit=node.core.emit;
    node.kind='audio-worklet';
    node.port.postMessage=function(message,...args){if(message.type==='start')harness.wallAudioOffset=context.currentTime-(performance.now()-context.createdWall)/1000;return post.call(this,message,...args);};
    node.core.emit=(message,...args)=>{emit(message,...args);const delivered=harness.toMain.at(-1)?.[1];if(delivered?.ledger)node.lastCompletion=delivered;};
    audioNodes.push(node);return node;
  }}:undefined,fetch:server.fetcher};
  if(now)installed.performance={now};
  const originals=new Map(Object.keys(installed).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(installed))Object.defineProperty(globalThis,key,{configurable:true,value});
  const $=id=>document.getElementById(id),tick=()=>new Promise(resolve=>setImmediate(resolve));
  // Real WebCrypto/file completions may wait behind other test processes. A
  // fixed number of empty event-loop turns is not a bound on that async work.
  // Keep all state assertions, using a real monotonic deadline independent of
  // the deliberately frozen musical performance clock installed above.
  const until=(predicate,label='Native app state did not settle')=>waitForTestCondition(predicate,{label:()=>`${label}; screen=${document.body.dataset.screen}, media=${$('clean-song-media-status')?.textContent||''}`});
  const emit=(target,type,properties={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{repeat:false,...properties});Object.defineProperty(event,'timeStamp',{value:performance.now()});target.dispatchEvent(event);return event;};
  const click=async id=>{assert.ok($(id),`Missing control ${id}`);$(id).click();await tick();};
  const exported=async id=>{const before=downloads.length;await click(id);await until(()=>downloads.length===before+1,`${id} did not export`);return JSON.parse(await downloads.at(-1).text());};
  const storageAction=name=>document.querySelector(`[data-score-storage] [data-storage-action="${name}"]`);
  const savedButton=key=>document.querySelector(`#catalog [data-library-key="native:${key}"]`);
  const storageStatus=()=>document.querySelector('[data-score-storage] .score-storage-status');
  function importFile(score,{name='authored-score.json',text}={}) {
    const raw=typeof score==='string'?score:JSON.stringify(score),file={name,size:Buffer.byteLength(raw),text:text||(async()=>raw),arrayBuffer:async()=>new TextEncoder().encode(raw).buffer};
    Object.defineProperty($('score-file'),'files',{configurable:true,value:[file]});emit($('score-file'),'change');return file;
  }
  async function close() {
    emit(window,'pagehide');await tick();Synth.prototype.unlock=originalUnlock;Synth.prototype.play=originalPlay;URL.createObjectURL=originalURL;
    for(const [key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
  try{await import(`../web/app.js?native-storage-integration-${++sequence}`);getAppI18n(document).setLocale('en');await tick();}
  catch(error){await close();throw error;}
  return{document,window,$,audioNodes,audioHarnesses,setAudioState(state){for(const audio of audioDevices){audio.state=state;audio.harness.setState(state);}},renderAudioTo(seconds){for(const harness of audioHarnesses){const target=Math.floor((seconds+(harness.wallAudioOffset||0))*harness.context.sampleRate);while(harness.frame<target)harness.renderBlock(Math.min(128,target-harness.frame));} },downloads,plays,openedDatabases,factory,requests:server.requests,tick,until,emit,click,exported,storageAction,savedButton,storageStatus,importFile,close,
    frame(){const work=[...frames.values()];frames.clear();for(const callback of work)callback(performance.now());},audio:()=>({contexts:audioContexts,unlocks:unlockCalls}),setUnlock:fn=>{unlockImpl=fn;},setAudioModule:fn=>{audioModuleImpl=fn;}};
}
