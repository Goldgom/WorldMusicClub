import {createI18n} from '../web/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView,performanceCue,previewMusicMetadata,FIELD_COLORS,updateWrittenNoteHighlights,fallingNoteShadow} from '../web/performance-view.js';
import {keyboardGeometry} from '../web/music.js';
import {Transport} from '../web/transport.js';
import {contrastRatio} from '../web/themes.js';
import {fixture} from './frontend-fixtures.js';
import './frontend-midi-settings.test.js';
const english=createI18n({locale:'en',onReport(){}});

test('dense written highlighting mutates only changed identities and initializes replaced pages',()=>{
 const {document}=parseHTML('<section id="score"></section>'),root=document.getElementById('score');
 for(let i=0;i<2048;i++){const node=document.createElement('span');node.className='score-note';node.dataset.noteId=`original-${i}`;root.append(node);}
 const nodes=[...root.children],source=nodes.map(n=>n.dataset.noteId);let attributes=0,classes=0;
 for(const node of nodes){const set=node.setAttribute,toggle=node.classList.toggle;node.setAttribute=function(...args){attributes++;return Reflect.apply(set,this,args);};node.classList.toggle=function(...args){classes++;return Reflect.apply(toggle,this,args);};}
 updateWrittenNoteHighlights(root,['original-0','original-1']);attributes=classes=0;
 for(let frame=0;frame<20;frame++)updateWrittenNoteHighlights(root,['original-0','original-1']);
 assert.equal(attributes,0);assert.equal(classes,0);
 updateWrittenNoteHighlights(root,['original-1','original-2']);assert.equal(attributes,2);assert.equal(classes,2);
 assert.deepEqual([...root.querySelectorAll('[aria-current="true"]')].map(n=>n.dataset.noteId),['original-1','original-2']);
 const replacement=document.createElement('span');replacement.className='score-note';replacement.dataset.noteId='original-1';root.replaceChildren(replacement);updateWrittenNoteHighlights(root,['original-1']);assert.equal(replacement.getAttribute('aria-current'),'true');assert.equal(replacement.classList.contains('active'),true);
 assert.deepEqual(nodes.map(n=>n.dataset.noteId),source);
});

test('dense falling decoration preserves every target and reserves shadows for sounding notes',()=>{
 const notes=Array.from({length:512},(_,i)=>({id:`original-${i}`,start_ms:i*8,duration_ms:40})),before=structuredClone(notes),position=800;
 const shadows=notes.map(note=>fallingNoteShadow(note,position,notes.length,false));
 assert.equal(shadows.length,notes.length);assert.equal(shadows.filter(n=>n===6).length,5);assert.ok(notes.every((note,i)=>shadows[i]===(note.start_ms<=position&&note.start_ms+note.duration_ms>position?6:0)));
 assert.equal(fallingNoteShadow(notes[511],position,128,false),6);assert.ok(notes.every(note=>fallingNoteShadow(note,position,notes.length,true)===0));assert.deepEqual(notes,before);
});

test('lobby musical metadata preserves unknown modes and labels only verified opening values',()=>{
 const score=structuredClone(fixture),before=structuredClone(score);
 assert.equal(previewMusicMetadata(score,english),'Opening: C major · 120 BPM · 1 part');assert.deepEqual(score,before);
 score.keys[0]={...score.keys[0],fifths:-2,mode:'unknown'};score.tempo[0].bpm=38.5;score.parts.push({...score.parts[0],id:'voice'});
 assert.equal(previewMusicMetadata(score,english),'Opening: 2 flats Mode unspecified · 38.5 BPM · 2 parts');
 score.tempo.push({at:{numerator:4,denominator:1},bpm:90});score.keys.push({at:{numerator:4,denominator:1},fifths:1,mode:'minor'});
 assert.match(previewMusicMetadata(score,english),/Later tempo and key changes$/);
 score.keys=[];assert.match(previewMusicMetadata(score,english),/Key unspecified/);assert.doesNotMatch(previewMusicMetadata(score,english),/C major|B♭/);
 score.keys=[{at:{numerator:4,denominator:1},fifths:0,mode:'major'}];assert.match(previewMusicMetadata(score,english),/Key unspecified/,'A later key marking cannot be assumed at the opening');
});

test('count-in and first-onset pauses use transport start state rather than the sign of musical position',()=>{
 const transport=new Transport(),context=now=>({position:transport.time(now),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed,segmentStart:0,countInBeatMs:500,mode:'listen'});
 assert.equal(performanceCue(context(0),english).main,'READY');transport.start(1000,[],2000);assert.equal(performanceCue(context(1000),english).main,'4');transport.pause(1500);assert.equal(transport.position,-1500);assert.equal(performanceCue(context(1500),english).main,'PAUSED');transport.start(5000,[],2000);assert.equal(performanceCue(context(5000),english).main,'3');assert.equal(performanceCue(context(6500),english),null);transport.pause(6500);assert.equal(transport.position,0);assert.equal(performanceCue(context(6500),english).main,'PAUSED');transport.reset();assert.equal(performanceCue(context(6500),english).main,'READY');
});
test('note names retain AA contrast on every scheduled note color',()=>{for(const key of ['natural','accidental','scheduled'])assert.ok(contrastRatio(FIELD_COLORS.noteText,FIELD_COLORS[key])>=4.5,key)});

test('short landscape gives following status a full non-shrinking row instead of the controls remainder',async()=>{
 // CSS/DOM contract only: actual notehead visibility still requires real-browser
 // geometry checks on the exact source, including Windows font metrics.
 const css=await readFile(new URL('../web/performance-stage.css',import.meta.url),'utf8');
 const {document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
 const landscapeRules=rules.filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
 const statusRule=landscapeRules.findLast(rule=>rule.selectorText==='.performance-layout #workspace.with-notation #notation-dock #engraving-follow-status');
 assert.ok(statusRule,'Short landscape must explicitly allocate the follow-status row');
 assert.equal(statusRule.style.flex,'0 0 100%','Status cannot share leftover width with paging and Follow, or shrink into it');
 assert.equal(statusRule.style.width,'100%');assert.equal(statusRule.style['min-width'],'0');
 assert.equal(statusRule.style['overflow-wrap'],'anywhere','Long diagnostic tokens must wrap within the full row');
 for(const property of ['height','max-height','overflow','overflow-y','display','visibility','position','text-overflow','-webkit-line-clamp'])assert.equal(statusRule.style.getPropertyValue(property),'',`Status must remain fully readable in the scrolling pane: ${property}`);
 const controlsRule=rules.find(rule=>rule.selectorText==='.performance-layout #notation-dock .engraving-follow-controls');
 assert.equal(controlsRule.style.display,'flex');assert.equal(controlsRule.style['flex-wrap'],'wrap','Paging and Follow must still wrap when their text needs more width');
});

test('performance presentation moves existing controls once and scopes checked values to the active revision',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8')),originals=new Map(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'window',{configurable:true,value:window});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 try{
  const ids=[...document.querySelectorAll('[id]')].map(el=>el.id),midi=document.getElementById('midi-button'),countIn=document.getElementById('count-in'),sound=document.getElementById('sound-button');let view;
  const viewportListeners=new Set(),onViewportChange=()=>{for(const listener of viewportListeners)listener();};const compactMedia={matches:false,addEventListener(type,listener){assert.equal(type,'change');viewportListeners.add(listener)},removeEventListener(type,listener){assert.equal(type,'change');viewportListeners.delete(listener)}};window.matchMedia=()=>compactMedia;
  const i18n=createI18n({locale:'en',onReport(){}});const shell=setupGameShell({i18n,pausePlayback(){},onNotation(){},onScreen:screen=>view?.screenChanged(screen)}),context={geometry:keyboardGeometry(61),rangeLabel:'C2–C7',mode:'listen',position:0,segmentStart:0,countInBeatMs:500,running:false,completed:false,now:900,recorder:{active:null,interruptions:[],latencyMs:0,toleranceMs:180}};
  view=setupPerformanceView({getContext:()=>context,i18n});
  const guidance=document.createElement('details');guidance.id='piano-fingering-guidance';guidance.innerHTML='<summary>Fingering</summary><button id="test-guidance-lock">Lock</button>';guidance.open=true;view.setPianoGuidance(guidance);const pan=document.querySelector('.keyboard-pan'),panHome=pan.previousSibling,guidanceHome=guidance.previousSibling;let locks=0;guidance.querySelector('button').addEventListener('click',()=>locks++);
  for(const compact of [true,false,true,false]){compactMedia.matches=compact;onViewportChange();assert.equal(pan.parentElement===document.querySelector('.transport'),compact);assert.equal(guidance.parentElement===document.querySelector('.transport'),compact);assert.equal(guidance.open,true);if(!compact){assert.ok(pan.previousSibling===panHome);assert.ok(guidance.previousSibling===guidanceHome);}guidance.querySelector('button').click();for(const id of ['keyboard-pan-left','keyboard-pan-right','piano-fingering-guidance'])assert.equal(document.querySelectorAll(`#${id}`).length,1);}
  assert.equal(locks,4,'Responsive placement preserves the original fingering handler');
  for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  assert.ok(document.getElementById('midi-button')===midi);assert.ok(document.getElementById('count-in')===countIn);assert.ok(document.getElementById('sound-button')===sound);
  assert.equal(midi.closest('dialog').id,'settings-dialog');assert.equal(countIn.closest('dialog').id,'settings-dialog');assert.equal(sound.closest('.piano-stage-toolbar')!==null,true);
  assert.equal(document.querySelector('.preview-actions').parentElement.className,'preview-footer');assert.equal(document.querySelector('.preview-footnote').closest('details').className,'preview-session-help');
  for(const id of ['preview-title','preview-meta','preview-music-meta'])assert.ok(document.getElementById(id).closest('.preview-identity'),`${id} stays above the scrolling details`);assert.ok(document.getElementById('preview-gate').closest('.preview-footer'),'The blocking instrument warning stays with Start');
  shell.show('stage');assert.equal(document.querySelector('.shell-header').hidden,true);assert.equal(document.querySelectorAll('.stage-hud nav').length,1);assert.equal(document.getElementById('hud-result').hidden,true);assert.equal(document.getElementById('stage-cue-main').textContent,'READY');
  const cue=document.getElementById('stage-cue'),field=document.querySelector('.performance-field');assert.equal(cue.closest('#piano-stage,#guitar-stage'),null,'Neither instrument can hide the shared transport cue');assert.equal(field.querySelector('#piano-stage'),document.getElementById('piano-stage'));assert.equal(field.querySelector('#guitar-stage'),document.getElementById('guitar-stage'));
  compactMedia.matches=true;onViewportChange();context.instrument='guitar';document.getElementById('piano-stage').hidden=true;document.getElementById('guitar-stage').hidden=false;view.update();assert.ok(pan.previousSibling===panHome);assert.ok(guidance.previousSibling===guidanceHome);assert.equal(document.querySelector('.transport').classList.contains('piano-compact-transport'),false);assert.equal(document.querySelector('.play-panel').dataset.instrument,'guitar');assert.ok(document.getElementById('sound-button')===sound,'Guitar keeps the exact original sound control');assert.equal(sound.closest('.transport')!==null,true,'Guitar exposes sound in its visible transport');assert.equal(cue.hidden,false);assert.equal(document.querySelector('.keyboard-pan').hidden,true);
  context.running=true;context.position=-1000;view.update();assert.equal(document.getElementById('stage-cue-main').textContent,'2');context.running=false;context.hasStarted=true;view.update();assert.equal(document.getElementById('stage-cue-main').textContent,'PAUSED');context.completed=true;view.update();assert.equal(document.getElementById('stage-cue-main').textContent,'LISTEN COMPLETE');
  context.instrument='piano';context.position=0;context.hasStarted=false;context.completed=false;document.getElementById('piano-stage').hidden=false;document.getElementById('guitar-stage').hidden=true;view.update();assert.equal(document.getElementById('stage-cue'),cue);assert.equal(document.getElementById('stage-cue-main').textContent,'READY');assert.ok(document.getElementById('sound-button')===sound,'Piano restores the original sound control');assert.equal(sound.closest('.piano-stage-toolbar')!==null,true);
  shell.show('library');assert.equal(document.querySelector('.shell-header').hidden,false);assert.equal(document.querySelectorAll('.shell-header nav').length,1);assert.equal(document.querySelectorAll('.stage-hud nav').length,0);
  const engravedPart=document.getElementById('engraving-part'),pages=document.querySelector('.engraving-pages');compactMedia.matches=true;onViewportChange();assert.ok(engravedPart.closest('.dock-help'),'Short landscape keeps optional display controls available in Help');assert.ok(pages.closest('.engraving-follow-controls'),'Current page controls stay outside collapsed Help');assert.ok(document.querySelector('.notation-panel').classList.contains('short-notation'));assert.equal(document.querySelector('.dock-help').open,false);
  const followControls=document.querySelector('.engraving-follow-controls'),followLabel=document.getElementById('engraving-follow').closest('label'),followStatus=document.getElementById('engraving-follow-status');
  assert.deepEqual([...followControls.children],[pages,followLabel,followStatus],'Paging and Follow precede the full-row status, without duplicated or hidden controls');assert.equal(followStatus.hidden,false);assert.equal(followStatus.closest('.dock-help'),null);assert.equal(followStatus.closest('details').id,'notation-tools');assert.equal(followStatus.getAttribute('role'),'status');assert.equal(document.getElementById('engraving-follow').getAttribute('aria-describedby'),'engraving-follow-help');assert.ok(document.getElementById('engraving-follow-help').closest('.dock-help'));
  compactMedia.matches=false;document.getElementById('workspace').classList.remove('notation-on-lanes');onViewportChange();assert.ok(engravedPart.closest('.engraving-controls'),'Returning to a tall viewport restores inline display controls');assert.ok(pages.closest('.engraving-controls'));assert.equal(document.getElementById('engraving-part'),engravedPart);for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  const help=document.querySelector('.dock-help'),stage=document.getElementById('workspace'),originalActive=Object.getOwnPropertyDescriptor(document,'activeElement'),insert=help.insertBefore;
  let focused=null;Object.defineProperty(document,'activeElement',{configurable:true,get:()=>focused});
  help.insertBefore=function(node,before){if(node.contains(focused))focused=document.body;return insert.call(this,node,before);};
  try{
    for(const id of ['engraving-part','engraving-page-size']){
      stage.classList.remove('notation-on-lanes');onViewportChange();help.open=false;document.getElementById('notation-tools').open=true;
      const control=document.getElementById(id);control.focus=function(){focused=this.closest('details:not([open])')?document.body:this;};control.focus();
      stage.classList.add('notation-on-lanes');onViewportChange();
      assert.equal(help.open,true,'The destination disclosure opens before focus is restored to a moved display setting');assert.equal(focused,control);assert.equal(control.closest('.dock-help'),help);
    }
  }finally{help.insertBefore=insert;stage.classList.remove('notation-on-lanes');onViewportChange();if(originalActive)Object.defineProperty(document,'activeElement',originalActive);else delete document.activeElement;}
  context.mode='practice';context.recorder.active={id:2,label:'Take 2',inputs:[{}],revision:1,assessedRevision:1,closedWall:500,deadline:680,manualDeadline:null,inFlight:false,error:null,boundaryReviews:[],timeline:{notes:[{}]},assessment:{hits:[{grade:'late'}],misses:[],extras:[],accuracy_percent:100,grade_counts:{perfect:0,good:0,early:0,late:1,missed:0,extra:0},onset_completion:{total:1,complete:1,longest_complete_sequence:1}}};view.update();
  assert.equal(document.getElementById('hud-result').hidden,false);assert.equal(document.getElementById('hud-accuracy').textContent,'100%');assert.match(document.getElementById('hud-result').textContent,/Onset match rate/);assert.equal(document.querySelector('.performance-status').dataset.passId,'2');assert.equal(document.querySelector('.performance-status').dataset.revision,'1');
  context.recorder.active.inputs.push({});context.recorder.active.revision=2;view.update();assert.equal(document.getElementById('hud-result').hidden,true);assert.equal(document.getElementById('hud-accuracy').textContent,'—');assert.equal(document.getElementById('hud-captured').textContent,'2');assert.equal(document.querySelector('.performance-status').dataset.phase,'pending');
 }finally{for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
});

test('complete practice shares a flexible toolbar row without shrinking fixed actions or wrapping its summary',async()=>{
 // This checks responsive CSS ownership. Actual text metrics and two-row fit
 // remain part of the real hosted/native toolbar geometry and screenshots.
 const css=await readFile(new URL('../web/clean-song.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
 const controls=rules.findLast(rule=>rule.selectorText==='.performance-layout .stage-hud>.complete-practice-controls'),[grow,shrink,basis]=controls.style.flex.split(' ');assert.equal(grow,'1');assert.equal(shrink,'1');assert.match(basis,/^\d+rem$/);assert.ok(parseInt(basis)>=18&&parseInt(basis)<=22,'The row basis must leave room for navigation on laptop widths');assert.equal(controls.style['min-width'],'0');
 const fixed=rules.findLast(rule=>rule.selectorText==='.performance-layout .complete-practice-controls>.button,.performance-layout .complete-practice-controls>label');assert.equal(fixed.style.flex,'none');assert.equal(fixed.style['white-space'],'nowrap');
 const summary=rules.findLast(rule=>rule.selectorText==='.performance-layout .complete-practice-controls>p');assert.equal(summary.style['min-width'],'0');assert.equal(summary.style['white-space'],'nowrap');assert.equal(summary.style['text-overflow'],'ellipsis');
 const laptop=rules.find(rule=>rule.media?.mediaText==='(min-width:651px) and (max-width:1050px)');assert.ok(laptop);assert.ok([...laptop.cssRules].some(rule=>rule.selectorText.includes('nav .button')&&rule.style['font-size']==='11px'&&rule.style['padding-left']==='7px'));
 const mobile=rules.find(rule=>rule.media?.mediaText==='(max-width:650px)');assert.equal([...mobile.cssRules].find(rule=>rule.selectorText==='.performance-layout .stage-hud>.complete-practice-controls').style['flex-basis'],'100%');
});
