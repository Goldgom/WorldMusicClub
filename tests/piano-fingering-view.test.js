import {createI18n} from '../web/i18n.js';
const en=createI18n({locale:'en'});
const pianoGuidanceView=context=>localizedPianoGuidanceView({...context,i18n:en});
const setupPianoFingeringView=context=>localizedSetupPianoFingeringView({...context,i18n:en});
import test from 'node:test';
import {fingeringAssistance} from './fingering-assistance-fixtures.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {pianoContext,pianoResult} from './piano-fingering-fixtures.js';
import {pianoGuidanceView as localizedPianoGuidanceView,setupPianoFingeringView as localizedSetupPianoFingeringView,PIANO_VISIBLE_TARGETS} from '../web/piano-fingering-view.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixtureDom(){
  const {document,window}=parseHTML('<html><body><dialog id="settings-dialog"><details id="instrument-settings"></details></dialog><div id="piano-stage"><div id="piano-scroll"><div id="keyboard"><button class="piano-key pressed" data-midi="60" aria-pressed="true" aria-label="Play C4"><span>C4</span></button><button class="piano-key" data-midi="64" aria-pressed="false" aria-label="Play E4"><span>E4</span></button></div></div></div></body></html>');
  // Linkedom exposes only a getter; browser select.value supports assignment.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  return{document,window};
}
function dispatch(window,node,type){node.dispatchEvent(new window.Event(type,{bubbles:true}));}

test('piano guidance preserves exact Rust identity/times and keeps current recommendations separate from input',()=>{
  const plan=pianoResult(pianoContext()),before=structuredClone(plan),view=pianoGuidanceView({plan,position:200,running:true,hasStarted:true});
  assert.equal(view.items[0].time,'Expected now');assert.equal(view.items[0].label,'Right 1');assert.equal(view.items[0].start_ms,500/3);assert.deepEqual(view.items[0].source_note_ids,['c4','tie-end','unison']);
  assert.equal(view.keyHints.filter(item=>item.midi===60).length,1);assert.equal(view.keyHints.find(item=>item.midi===60).target_id,'c4@1');assert.deepEqual(plan,before);
  const paused=pianoGuidanceView({plan,position:200,hasStarted:true});assert.equal(paused.phase,'paused');assert.deepEqual(paused.items,view.items);
  assert.equal(pianoGuidanceView({plan,completed:true}).items.length,0);
  assert.equal(pianoGuidanceView({plan:{...plan,status:'no_plan_found',complete:false}}).items.length,0);
});
test('long holds do not hide every next attack and a loop-boundary tie keeps its original onset',()=>{
  const base=pianoResult(pianoContext()),notes=Array.from({length:10},(_,i)=>({...base.assignments[0],target_id:`hold-${i}`,start_ms:0,end_ms:10000,midi:40+i}));
  notes.push(...Array.from({length:7},(_,i)=>({...base.assignments[0],target_id:`next-${i}`,start_ms:1500+i*100,end_ms:2000+i*100,midi:60+i})));
  const view=pianoGuidanceView({plan:{...base,assignments:notes},position:1000,running:true,hasStarted:true});
  assert.equal(view.items.length,PIANO_VISIBLE_TARGETS);assert.equal(view.additional,9);assert.equal(view.items.filter(item=>item.phase==='upcoming').length,6);assert.equal(view.keyHints.length,17);
  const continuing=pianoGuidanceView({plan:base,position:0,segmentStart:500,running:true,hasStarted:true});assert.equal(continuing.items[0].phase,'continuing');assert.equal(continuing.items[0].start_ms,500/3);assert.equal(continuing.items[0].time,'Continues in 0.5s');
});
test('settings mount in moved instrument panel; finite stable cards and pointer-free badges never alter held keys',async()=>{
  const{document}=fixtureDom(),context=pianoContext(),requests=[];
  const ui=setupPianoFingeringView({document,getContext:()=>context,api:async(path,body)=>{requests.push({path,body});return pianoResult(context,body);}});
  assert.equal(document.querySelector('#settings-dialog #piano-fingering-settings')!==null,true);assert.equal(document.querySelector('#piano-fingering-guidance').hasAttribute('open'),false,'The compact stage starts collapsed');
  ui.render({position:0});await tick();ui.render({position:200,running:true,hasStarted:true});
  const card=document.querySelector('.piano-finger-target'),key=document.querySelector('[data-midi="60"]');assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/fingering/piano');
  assert.equal(card.dataset.targetId,'c4@1');assert.deepEqual(JSON.parse(card.dataset.sourceIds),['c4','tie-end','unison']);assert.match(card.getAttribute('aria-description'),/Source notes: c4, tie-end, unison/);
  assert.match(document.querySelector('#piano-fingering-keyboard').textContent,/61 keys, C2–C7/);assert.equal(document.querySelector('#piano-fingering-guidance').getAttribute('aria-live'),'off');assert.equal(document.querySelector('#piano-guidance-items [aria-live]'),null);
  assert.equal(key.querySelector('.piano-finger-label').textContent,'R1');assert.equal(key.querySelector('.piano-finger-label').getAttribute('aria-hidden'),'true');assert.equal(key.getAttribute('aria-pressed'),'true');assert.equal(key.classList.contains('pressed'),true);assert.equal(key.getAttribute('aria-label'),'Play C4');
  document.querySelector('#piano-guidance-items').scrollLeft=75;ui.render({position:250,running:true,hasStarted:true});assert.equal(document.querySelector('.piano-finger-target'),card);assert.equal(document.querySelector('#piano-guidance-items').scrollLeft,75);
  ui.render({position:4000,completed:true});assert.equal(document.querySelector('.piano-finger-target'),null);assert.equal(key.querySelector('.piano-finger-label'),null);assert.equal(key.getAttribute('aria-pressed'),'true');
});
test('canonical source editor applies hand/finger locks, removes them, and ranges invalidate badges before replan',async()=>{
  const{document,window}=fixtureDom();let context=pianoContext();const requests=[];
  const ui=setupPianoFingeringView({document,getContext:()=>context,api:async(_path,body)=>{requests.push(body);const result=pianoResult(context,body);for(const assignment of result.assignments){const lock=body.locks.find(lock=>assignment.source_note_ids.includes(lock.source_note_id));if(lock){assignment.hand=lock.hand||assignment.hand;assignment.finger=lock.finger||assignment.finger;}}return result;}});
  ui.render();await tick();const select=document.querySelector('#piano-source-note');assert.deepEqual([...select.options].map(option=>option.value),['c4','e4','tie-end','unison']);
  select.value='tie-end';dispatch(window,select,'change');document.querySelector('#piano-source-hand').value='left';dispatch(window,document.querySelector('#piano-source-hand'),'change');await tick();
  document.querySelector('#piano-source-finger').value='2';dispatch(window,document.querySelector('#piano-source-finger'),'change');await tick();assert.deepEqual(requests.at(-1).locks,[{source_note_id:'tie-end',hand:'left',finger:2}]);assert.equal(ui.state().phase,'ready');
  assert.match(document.querySelector('#piano-source-locks').textContent,/tie-end: Left, finger 2/);
  const input=document.querySelector('#piano-left-reach');input.value='8';dispatch(window,input,'input');assert.equal(ui.state().draftDirty,true);assert.equal(document.querySelector('.piano-finger-label'),null);assert.match(document.querySelector('#piano-guidance-state').textContent,/Settings edited/);
  dispatch(window,document.querySelector('#piano-fingering-replan'),'click');await tick();assert.equal(requests.at(-1).left_hand.max_span_semitones,8);assert.equal(ui.state().phase,'ready');
  dispatch(window,document.querySelector('#piano-lock-remove'),'click');await tick();assert.deepEqual(requests.at(-1).locks,[]);
  context={...context,part_id:'piano'};ui.render();await tick();assert.equal([...select.options].some(option=>option.value==='unison'),false);
});
test('invalid hand edits never request a plan; source search remains complete and not HTML-injected',async()=>{
  const{document,window}=fixtureDom(),context=pianoContext();let calls=0;
  for(let i=0;i<110;i++)context.score.parts[0].notes.push({...context.score.parts[0].notes[0],id:`extra-${i}`});
  context.score.parts[0].notes.push({...context.score.parts[0].notes[0],id:'<img src=x onerror=bad>'});
  const ui=setupPianoFingeringView({document,getContext:()=>context,api:async(_path,body)=>{calls++;return pianoResult(context,body);}});ui.render();await tick();
  const select=document.querySelector('#piano-source-note');assert.equal(select.options.length,100);assert.equal(document.querySelector('#piano-source-more').hidden,false);
  const search=document.querySelector('#piano-source-search');search.value='<img';dispatch(window,search,'input');assert.equal(select.options.length,1);assert.equal(select.value,'<img src=x onerror=bad>');assert.equal(select.querySelector('img'),null);
  const input=document.querySelector('#piano-left-low');input.value='';dispatch(window,input,'input');dispatch(window,document.querySelector('#piano-fingering-replan'),'click');await tick();assert.equal(calls,1);assert.match(document.querySelector('#piano-fingering-status').textContent,/MIDI limits/);assert.equal(ui.state().draftDirty,true);
  dispatch(window,document.querySelector('#piano-fingering-discard'),'click');await tick();assert.equal(input.value,'0');assert.equal(calls,2);assert.equal(ui.state().phase,'ready');
});
test('unavailable advisory response retains useful bounded-search distinction and shows exact affected sources',async()=>{
  const{document}=fixtureDom(),context=pianoContext();const plan={...pianoResult(context),status:'no_plan_found',complete:false,assignments:[],objective_cost:null,beam_pruned:true,issues:[{code:'review',message:'Search could not finish this onset.',onset_index:0,target_ids:['c4@1'],source_occurrence_ids:['c4@1','unison@1'],source_note_ids:['c4','tie-end','unison']}]};
  const ui=setupPianoFingeringView({document,getContext:()=>context,api:async()=>plan});ui.render();await tick();ui.render();
  assert.match(document.querySelector('#piano-fingering-status').textContent,/does not prove the music impossible/);assert.match(document.querySelector('#piano-fingering-issues').textContent,/c4, tie-end, unison/);assert.match(document.querySelector('#piano-fingering-search').textContent,/No partial finger route/);assert.equal(document.querySelector('.piano-finger-label'),null);
});
test('isolated CSS keeps keyboard hints pointer-free and has a compact landscape bound',async()=>{
  const css=await readFile(new URL('../web/piano-fingering.css',import.meta.url),'utf8');assert.match(css,/\.piano-finger-label\{[^}]*pointer-events:none/);assert.match(css,/@media\(max-height:600px\).*max-height:72px/);assert.doesNotMatch(css,/\.pressed|\.playing/);
});


test('assistance clears every piano card, key badge and accessible recommendation while keeping the keyboard profile clean',async()=>{
  const {document,window}=fixtureDom(),context=pianoContext(),i18n=createI18n({locale:'en'}),calls=[];
  const ui=localizedSetupPianoFingeringView({document,i18n,getContext:()=>context,api:async(_path,body)=>{calls.push(body);return pianoResult(context,body);}});
  const playback={position:200,running:true,hasStarted:true},key=document.querySelector('[data-midi="60"]');
  ui.render(playback);await tick();assert.ok(document.querySelector('.piano-finger-target'));assert.ok(key.querySelector('.piano-finger-label'));
  context.assistance=fingeringAssistance({partial:true});context.assistanceUnavailable=true;
  ui.render(playback);
  assert.equal(ui.state().plan,null);assert.equal(ui.controller.assignment('c4@1'),null);assert.equal(context.dirty,false);assert.equal(ui.state().draftDirty,false);
  assert.equal(document.querySelector('.piano-finger-target,.piano-finger-label,[data-finger-guidance]'),null);assert.equal(key.getAttribute('aria-description'),null);
  assert.equal(key.getAttribute('aria-pressed'),'true');assert.equal(key.classList.contains('pressed'),true);
  for(const id of ['piano-fingering-replan','piano-source-hand','piano-source-finger','piano-lock-remove'])assert.equal(document.getElementById(id).disabled,true);
  assert.match(document.getElementById('piano-fingering-status').textContent,/whole selected parts.*human-owned notes/);
  assert.match(document.getElementById('piano-guidance-state').textContent,/assisted selection/);
  document.getElementById('piano-source-search').value='c4';dispatch(window,document.getElementById('piano-source-search'),'input');assert.equal(document.getElementById('piano-source-hand').disabled,true);
  i18n.setLocale('zh-CN');assert.match(document.getElementById('piano-fingering-status').textContent,/完整的所选声部/);assert.match(document.getElementById('piano-guidance-state').textContent,/尚不能只为需要你演奏的音符/);
  assert.equal(document.querySelector('.piano-finger-target,.piano-finger-label'),null);assert.equal(calls.length,1);
  context.assistance=null;ui.render(playback);assert.match(document.getElementById('piano-guidance-state').textContent,/尚未通过核验/);
  context.assistance=fingeringAssistance();context.assistanceUnavailable=false;ui.render(playback);await tick();
  assert.equal(calls.length,2);assert.ok(document.querySelector('.piano-finger-target'));assert.equal(key.querySelector('.piano-finger-label').textContent,'右1');
  assert.equal(document.getElementById('piano-source-hand').disabled,false);assert.deepEqual(i18n.getReports(),[]);ui.destroy();
});

test('assistance unavailable reason takes precedence over a retained piano hand draft',async()=>{
  const {document}=fixtureDom(),context=pianoContext();let calls=0;
  const ui=setupPianoFingeringView({document,getContext:()=>context,api:async()=>{calls++;return pianoResult(context);}});
  await ui.prepare();ui.controller.setDraftDirty();context.assistanceUnavailable=true;ui.render();
  assert.equal(ui.state().draftDirty,true);assert.equal(context.dirty,false);assert.match(document.getElementById('piano-guidance-state').textContent,/ownership is checked/);
  context.assistanceUnavailable=false;ui.render();assert.equal(ui.state().plan,null);assert.equal(calls,1);
  assert.match(document.getElementById('piano-guidance-state').textContent,/Settings edited/);ui.destroy();
});
