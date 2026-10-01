import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {beat,pitchMidi} from '../web/music.js';

// Node DOM integration only: no browser, layout engine, real audio or HTTP is run.
test('application module initializes the lobby and activates only through explicit Start',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
 const requests=[],values=new Map();let audioContexts=0,holdCheck=null,heldCheck=null;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 const paint=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>paint;
 const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}};
 class Audio{constructor(){audioContexts++;this.state='running';this.currentTime=0;this.destination={}}createGain(){return{gain:{...param},connect(){},disconnect(){}}}createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){},stop(){}}}}
 const compile=score=>({score,timeline:{notes:score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff}))),duration_ms:1000},diagnostics:[]});
 const item={id:fixture.id,title:fixture.title,composer:fixture.composer,provenance:fixture.provenance,written_event_count:2,pitched_note_count:2,rest_count:0,opening_bpm:120,part_count:1};
 const otherScore={...structuredClone(fixture),id:'other-preview',title:'Another selected score'};
 const installed={window,document,location:{origin:'http://local-node-dom.invalid'},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},AudioContext:Audio,fetch:async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({path,body});let result;
  if(path==='/api/catalog/index')result={version:1,items:[item,{...item,id:otherScore.id,title:otherScore.title}]};
  else if(path==='/api/catalog/score/'+fixture.id)result=structuredClone(fixture);
  else if(path==='/api/catalog/score/'+otherScore.id)result=structuredClone(otherScore);
  else if(path==='/api/compile')result=compile(body);
  else if(path==='/api/practice-targets')result={timeline:body.timeline,groups:body.timeline.notes.map(note=>({target_id:note.id,source_occurrence_ids:[note.id],source_note_ids:[note.id],part_ids:[note.part_id]})),diagnostics:[],source_note_count:body.timeline.notes.length,target_count:body.timeline.notes.length,playable:true};
  else if(path==='/api/instrument-check')result={lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false};
  else throw Error(`Unexpected Node DOM test request: ${path}`);
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
 }finally{for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
});
