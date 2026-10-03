import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {Synth} from '../web/transport.js';

let sequence=0;
export async function freePracticeApp({fetchResult=null}={}) {
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const requests=[],downloads=[],plays=[],values=new Map(),factory=new IDBFactory();
  let audioContexts=0,unlockCalls=0,midiRequests=0,unlockImpl=null;
  const device={id:'test-device',name:'Test MIDI',state:'connected',connection:'open',onmidimessage:null};
  const access={inputs:new Map([[device.id,device]]),onstatechange:null};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',Boolean(value));}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  window.HTMLElement.prototype.setPointerCapture=function(){};
  const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});
  window.HTMLCanvasElement.prototype.getContext=()=>paint;
  const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}};
  class Audio{constructor(){audioContexts++;this.state='running';this.currentTime=0;this.destination={};}createGain(){return{gain:{...param},connect(){},disconnect(){}};}createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){},stop(){}};}}
  const originalUnlock=Synth.prototype.unlock,originalPlay=Synth.prototype.play,originalURL=URL.createObjectURL;
  Synth.prototype.unlock=function(...args){unlockCalls++;return unlockImpl?unlockImpl():originalUnlock.apply(this,args);};
  Synth.prototype.play=function(...args){plays.push(args);return originalPlay.apply(this,args);};
  URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:node-free-practice';};
  const installed={window,document,indexedDB:factory,navigator:{requestMIDIAccess:async()=>{midiRequests++;return access;}},location:{origin:'http://free-node-dom.invalid'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},AudioContext:Audio,fetch:async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):null;requests.push({path,body});
    if(fetchResult)return {ok:true,json:async()=>fetchResult(path,body)};
    throw new Error('Test server unavailable');
  }};
  const originals=new Map(Object.keys(installed).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(installed))Object.defineProperty(globalThis,key,{configurable:true,value});
  const $=id=>document.getElementById(id);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const until=async(predicate,label='App state did not settle')=>{for(let i=0;i<200;i++){if(predicate())return;await tick();}assert.fail(label);};
  const emit=(target,type,properties={},timestamp=performance.now())=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{repeat:false,...properties});Object.defineProperty(event,'timeStamp',{value:timestamp});target.dispatchEvent(event);return event;};
  const click=async id=>{$(id).click();await until(()=>$('free-practice-screen').getAttribute('aria-busy')!=='true');await tick();};
  const exported=async id=>{const count=downloads.length;await click(id);assert.equal(downloads.length,count+1,`${id} did not export`);return JSON.parse(await downloads.at(-1).text());};
  await import(`../web/app.js?free-practice-integration-${++sequence}`);await tick();
  return {document,window,$,requests,downloads,plays,factory,device,access,emit,click,exported,until,tick,
    midi:(data,time=performance.now())=>device.onmidimessage?.({data,timeStamp:time}),
    audio:()=>({contexts:audioContexts,unlocks:unlockCalls}),midiRequests:()=>midiRequests,setUnlock:fn=>{unlockImpl=fn;},
    async close(){emit(window,'pagehide');await tick();Synth.prototype.unlock=originalUnlock;Synth.prototype.play=originalPlay;URL.createObjectURL=originalURL;for(const [key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  };
}

export async function fixtureScoreServer() {
  const [{fixture},{beat,pitchMidi},{unavailablePianoResult}]=await Promise.all([import('./frontend-fixtures.js'),import('../web/music.js'),import('./piano-fingering-fixtures.js')]);
  const compile=score=>({score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],velocity:note.velocity,part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff}))),duration_ms:1000},diagnostics:[]});
  return (path,body)=>{
    if(path==='/api/catalog/index')return {version:1,items:[{id:fixture.id,title:fixture.title,composer:fixture.composer,provenance:fixture.provenance,written_event_count:2,pitched_note_count:2,rest_count:0,opening_bpm:120,part_count:1}]};
    if(path==='/api/catalog/score/'+fixture.id)return structuredClone(fixture);
    if(path==='/api/compile')return compile(body);
    if(path==='/api/practice-targets')return {timeline:body.timeline,groups:body.timeline.notes.map(note=>({target_id:note.id,source_occurrence_ids:[note.id],source_note_ids:[note.id],part_ids:[note.part_id]})),diagnostics:[],source_note_count:body.timeline.notes.length,target_count:body.timeline.notes.length,playable:true};
    if(path==='/api/instrument-check')return {lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false};
    if(path==='/api/fingering/piano')return unavailablePianoResult(body,compile(body.score).timeline);
    throw Error(`Unexpected free-app score fixture request: ${path}`);
  };
}
