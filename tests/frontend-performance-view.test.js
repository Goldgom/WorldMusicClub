import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView,performanceCue,previewMusicMetadata,FIELD_COLORS} from '../web/performance-view.js';
import {keyboardGeometry} from '../web/music.js';
import {Transport} from '../web/transport.js';
import {contrastRatio} from '../web/themes.js';
import {fixture} from './frontend-fixtures.js';

test('lobby musical metadata preserves unknown modes and labels only verified opening values',()=>{
 const score=structuredClone(fixture),before=structuredClone(score);
 assert.equal(previewMusicMetadata(score),'Opening · 起始: C major · 120 BPM · 1 part');assert.deepEqual(score,before);
 score.keys[0]={...score.keys[0],fifths:-2,mode:'unknown'};score.tempo[0].bpm=38.5;score.parts.push({...score.parts[0],id:'voice'});
 assert.equal(previewMusicMetadata(score),'Opening · 起始: 2 flats · mode unspecified · 38.5 BPM · 2 parts');
 score.tempo.push({at:{numerator:4,denominator:1},bpm:90});score.keys.push({at:{numerator:4,denominator:1},fifths:1,mode:'minor'});
 assert.match(previewMusicMetadata(score),/Later tempo \/ key changes$/);
 score.keys=[];assert.match(previewMusicMetadata(score),/Key unspecified/);assert.doesNotMatch(previewMusicMetadata(score),/C major|B♭/);
 score.keys=[{at:{numerator:4,denominator:1},fifths:0,mode:'major'}];assert.match(previewMusicMetadata(score),/Key unspecified/,'A later key marking cannot be assumed at the opening');
});

test('count-in and first-onset pauses use transport start state rather than the sign of musical position',()=>{
 const transport=new Transport(),context=now=>({position:transport.time(now),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,segmentStart:0,countInBeatMs:500,mode:'listen'});
 assert.equal(performanceCue(context(0)).main,'READY');transport.start(1000,[],2000);assert.equal(performanceCue(context(1000)).main,'4');transport.pause(1500);assert.equal(transport.position,-1500);assert.equal(performanceCue(context(1500)).main,'PAUSED');transport.start(5000,[],2000);assert.equal(performanceCue(context(5000)).main,'3');assert.equal(performanceCue(context(6500)),null);transport.pause(6500);assert.equal(transport.position,0);assert.equal(performanceCue(context(6500)).main,'PAUSED');transport.reset();assert.equal(performanceCue(context(6500)).main,'READY');
});
test('note names retain AA contrast on every scheduled note color',()=>{for(const key of ['natural','accidental','scheduled'])assert.ok(contrastRatio(FIELD_COLORS.noteText,FIELD_COLORS[key])>=4.5,key)});

test('performance presentation moves existing controls once and scopes checked values to the active revision',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),originals=new Map(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'window',{configurable:true,value:window});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 try{
  const ids=[...document.querySelectorAll('[id]')].map(el=>el.id),midi=document.getElementById('midi-button'),countIn=document.getElementById('count-in'),sound=document.getElementById('sound-button');let view;
  let onViewportChange;const compactMedia={matches:false,addEventListener(type,listener){assert.equal(type,'change');onViewportChange=listener}};window.matchMedia=()=>compactMedia;
  const shell=setupGameShell({pausePlayback(){},onNotation(){},onScreen:screen=>view?.screenChanged(screen)}),context={geometry:keyboardGeometry(61),rangeLabel:'C2–C7',mode:'listen',position:0,segmentStart:0,countInBeatMs:500,running:false,completed:false,now:900,recorder:{active:null,interruptions:[],latencyMs:0,toleranceMs:180}};
  view=setupPerformanceView({getContext:()=>context});
  for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  assert.ok(document.getElementById('midi-button')===midi);assert.ok(document.getElementById('count-in')===countIn);assert.ok(document.getElementById('sound-button')===sound);
  assert.equal(midi.closest('dialog').id,'settings-dialog');assert.equal(countIn.closest('dialog').id,'settings-dialog');assert.equal(sound.closest('.transport')!==null,true);
  assert.equal(document.querySelector('.preview-actions').parentElement.className,'preview-footer');assert.equal(document.querySelector('.preview-footnote').closest('details').className,'preview-session-help');
  for(const id of ['preview-title','preview-meta','preview-music-meta'])assert.ok(document.getElementById(id).closest('.preview-identity'),`${id} stays above the scrolling details`);assert.ok(document.getElementById('preview-gate').closest('.preview-footer'),'The blocking instrument warning stays with Start');
  shell.show('stage');assert.equal(document.querySelector('.shell-header').hidden,true);assert.equal(document.querySelectorAll('.stage-hud nav').length,1);assert.equal(document.getElementById('hud-result').hidden,true);assert.equal(document.getElementById('stage-cue-main').textContent,'READY');
  shell.show('library');assert.equal(document.querySelector('.shell-header').hidden,false);assert.equal(document.querySelectorAll('.shell-header nav').length,1);assert.equal(document.querySelectorAll('.stage-hud nav').length,0);
  const engravedPart=document.getElementById('engraving-part'),pages=document.querySelector('.engraving-pages');compactMedia.matches=true;onViewportChange();assert.ok(engravedPart.closest('.dock-help'),'Short landscape keeps optional display controls available in Help');assert.ok(pages.closest('.engraving-follow-controls'),'Current page controls stay outside collapsed Help');assert.ok(document.querySelector('.notation-panel').classList.contains('short-notation'));assert.equal(document.querySelector('.dock-help').open,false);
  compactMedia.matches=false;onViewportChange();assert.ok(engravedPart.closest('.engraving-controls'),'Returning to a tall viewport restores inline display controls');assert.ok(pages.closest('.engraving-controls'));assert.equal(document.getElementById('engraving-part'),engravedPart);for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  context.mode='practice';context.recorder.active={id:2,label:'Take 2',inputs:[{}],revision:1,assessedRevision:1,closedWall:500,deadline:680,manualDeadline:null,inFlight:false,error:null,boundaryReviews:[],timeline:{notes:[{}]},assessment:{hits:[{grade:'late'}],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:1,missed:0,extra:0},onset_completion:{total:1,complete:1,longest_complete_sequence:1}}};view.update();
  assert.equal(document.getElementById('hud-result').hidden,false);assert.equal(document.getElementById('hud-accuracy').textContent,'100%');assert.match(document.getElementById('hud-result').textContent,/Onset match rate/);assert.equal(document.querySelector('.performance-status').dataset.passId,'2');assert.equal(document.querySelector('.performance-status').dataset.revision,'1');
  context.recorder.active.inputs.push({});context.recorder.active.revision=2;view.update();assert.equal(document.getElementById('hud-result').hidden,true);assert.equal(document.getElementById('hud-accuracy').textContent,'—');assert.equal(document.getElementById('hud-captured').textContent,'2');assert.equal(document.querySelector('.performance-status').dataset.phase,'pending');
 }finally{for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
});
