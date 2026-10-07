import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setupSongModView} from '../web/song-mod-view.js';
import {createSongMod} from '../web/song-mod.js';
import {createPracticeAssistanceController,PracticeAssistanceStore} from '../web/practice-assistance.js';
import {assistanceContext,assistanceResponse,memoryStorage,deferred} from './practice-assistance-fixtures.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(predicate){for(let i=0;i<30;i++){if(predicate())return;await tick();}assert.ok(predicate(),'Expected the DOM operation to settle');}
function fixture({stage=false,hasTakes=stage,guitar=false,api,storage=memoryStorage()}={}){
 const {document,window}=parseHTML('<html><body><section class="preview-copy"></section><div class="preview-actions"></div><div id="stage-hud"></div><div id="workspace"></div><input type="checkbox" id="falling-note-labels"></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',Boolean(value));}});
 window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),emit=(node,type)=>node.dispatchEvent(new window.Event(type,{bubbles:true}));
 $('falling-note-labels').checked=false;
 const localeListeners=[],i18n={locale:'en',subscribe:fn=>(localeListeners.push(fn),()=>{}),setLocale(value){this.locale=value;for(const fn of localeListeners)fn();}};
 const binding=assistanceContext();if(guitar)binding.selection.profile={kind:'guitar',tuning:[64,59,55,50,45,40],frets:20,capo:0};
 const score={id:'original',parts:[{id:'piano',name:'Piano',notes:[]},{id:'bass',name:'Bass',notes:[]}]},identity={songId:score.id,sourceRevision:{kind:'canonical-score-v1',value:'e'.repeat(64)}},mod=createSongMod(identity,{layout:'complete',showOtherParts:true,parts:score.parts.map(part=>({partId:part.id,performer:part.id==='piano'?'human':'machine',instrument:'reed',liveInstrument:'follow',muted:false,visible:true}))});
 let context={score,mod,original:mod,hasTakes,capabilities:{instruments:true,liveAudio:true},performanceInstrument:'piano'},starts=0,applies=0;const calls=[],applyOptions=[];
 const currentBinding=()=>({...binding,selection:{selected_part_ids:context.mod.config.parts.filter(p=>p.performer==='human').map(p=>p.partId),profile:binding.selection.profile}});
 const controller=createPracticeAssistanceController({getContext:currentBinding,store:new PracticeAssistanceStore({storage}),api:async(path,body,signal)=>{calls.push({path,body,signal});return api?api(path,body,signal):assistanceResponse(currentBinding(),{mode:path.endsWith('/original')?'original':'automatic',settings:body.settings??null,selection:body.selection});}});
 context.assistanceController=controller;
 const view=setupSongModView({document,i18n,getContext:()=>context,onStart:()=>starts++,onApply:async options=>{applies++;applyOptions.push(options);const checked=options.commitAssistance();context={...context,mod:options.mod,assistance:checked};context.assistanceStatus=controller.state().persistence.status;assert.equal(options.commit(),true);view.update({preview:context,stage:stage?context:null,canStart:true});}});
 view.update({preview:context,stage:stage?context:null,canStart:true});view.open(stage?'stage':'preview');
 const change=(id,value,type='change')=>{const n=$(id);if(typeof value==='boolean')n.checked=value;else n.value=value;emit(n,type);};
 return{$,document,window,i18n,view,controller,storage,calls,binding,change,emit,applyOptions,get context(){return context;},get starts(){return starts;},get applies(){return applies;}};
}

test('one Start, numeric assistance in Mod, bilingual noncolor legend, actual counts and separate same-part timbres',async()=>{
 const f=fixture();assert.deepEqual([...f.document.querySelectorAll('.preview-actions button')].map(n=>n.id),['start-performance','configure-song-mod']);assert.equal(f.$('falling-note-labels').checked,false);
 assert.equal(f.$('song-mod-assistance-limits').hidden,true);f.change('song-mod-assistance-mode','automatic');assert.equal(f.$('song-mod-assistance-limits').hidden,false);
 assert.equal(f.$('song-mod-assistance-max_targets_per_onset').value,'2');assert.equal(f.$('song-mod-assistance-min_onset_interval_ms').value,'250');assert.equal(f.$('song-mod-assistance-max_simultaneous_keys').value,'3');assert.equal(f.$('song-mod-assistance-max_held_span_semitones').value,'7');
 assert.match(f.$('song-mod-assistance-legend').textContent,/● Human.*◆ Machine/);assert.match(f.$('song-mod-assistance').textContent,/semitones/);
 f.$('song-mod-assistance-check').click();await settle(()=>f.controller.state().phase==='prepared');
 assert.match(f.$('song-mod-assistance-status').textContent,/2 human targets · 2 machine occurrences/);assert.match(f.$('song-mod-assistance-units').textContent,/2 human source units \+ 2 machine source units = 4/);
 const machine=f.document.querySelector('[data-mod-instrument="piano"]'),live=f.document.querySelector('[data-mod-live-instrument="piano"]');assert.equal(machine.disabled,false);assert.equal(live.disabled,false);assert.equal(machine.value,'reed');assert.match(f.$(machine.getAttribute('aria-describedby')).textContent,/saved machine sound/);
 f.i18n.setLocale('zh-CN');assert.match(f.$('song-mod-assistance-legend').textContent,/● 真人.*◆ 机器/);assert.match(f.$('song-mod-assistance-status').textContent,/2 个真人目标/);f.i18n.setLocale('en');
 assert.equal(f.starts,0);assert.equal(f.applies,0);assert.equal(f.storage.values.size,0);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.applies,1);assert.equal(f.starts,0);assert.equal(f.storage.values.size,1);assert.equal(f.context.mod.config.parts[0].instrument,'reed');assert.equal(f.context.mod.config.parts[0].liveInstrument,'follow');
});
test('stage ownership Apply requires a fresh explicit reset acknowledgement and stays stopped',async()=>{
 const f=fixture({stage:true});f.change('song-mod-assistance-mode','automatic');assert.equal(f.$('song-mod-assistance-reset-label').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);
 f.change('song-mod-assistance-reset',true);assert.equal(f.$('song-mod-apply').disabled,false);f.change('song-mod-assistance-max_targets_per_onset','1','input');assert.equal(f.$('song-mod-assistance-reset').checked,false);assert.equal(f.$('song-mod-apply').disabled,true);
 f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.starts,0);assert.equal(f.controller.current().plan.settings.max_targets_per_onset,1);
});
test('Cancel while checking and a later response cannot install, save or play anything',async()=>{
 const gate=deferred(),f=fixture({api:()=>gate.promise});f.change('song-mod-assistance-mode','automatic');f.$('song-mod-assistance-check').click();await settle(()=>f.calls.length===1);f.$('song-mod-cancel').click();assert.equal(f.$('song-mod-dialog').open,false);assert.equal(f.calls[0].signal.aborted,true);gate.resolve(assistanceResponse(f.binding));await tick();assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);assert.equal(f.starts,0);assert.equal(f.applies,0);
});
test('rapid numeric edits discard old checked counts and late responses; repeated Apply commits once',async()=>{
 const gates=[],f=fixture({api:()=>{const gate=deferred();gates.push(gate);return gate.promise;}});f.change('song-mod-assistance-mode','automatic');f.$('song-mod-assistance-check').click();await settle(()=>gates.length===1);f.change('song-mod-assistance-max_targets_per_onset','1','input');assert.match(f.$('song-mod-assistance-status').textContent,/Check the assignment/);f.$('song-mod-assistance-check').click();await settle(()=>gates.length===2);
 gates[0].resolve(assistanceResponse(f.binding));await tick();assert.equal(f.controller.state().prepared,null);gates[1].resolve(assistanceResponse(f.binding,{settings:f.calls[1].body.settings}));await settle(()=>f.controller.state().prepared!==null);
 f.$('song-mod-apply').click();f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.applies,1);assert.equal(f.starts,0);
});
test('unsupported guitar Automatic is explicit and Original retains existing profile behavior',async()=>{
 const f=fixture({guitar:true});assert.equal(f.$('song-mod-assistance-mode').options[1].disabled,true);assert.match(f.$('song-mod-assistance-availability').textContent,/keyboard\/Piano only/);assert.equal(f.$('song-mod-assistance-mode').value,'original');f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.calls.length,0);assert.equal(f.controller.current(),null);assert.equal(f.starts,0);
});
test('restoring a default Mod uses Original without adding score fields or changing falling letters',async()=>{
 const f=fixture();f.change('song-mod-assistance-mode','automatic');f.$('song-mod-restore').click();assert.equal(f.$('song-mod-assistance-mode').value,'original');f.$('song-mod-cancel').click();f.view.open('preview');assert.equal(f.$('song-mod-assistance-mode').value,'original');assert.equal(f.$('falling-note-labels').checked,false);assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);
});

test('an incompatible saved preference stays intact until explicit replacement is checked',async()=>{
 const storage=memoryStorage(),store=new PracticeAssistanceStore({storage}),key=store.key(assistanceContext());storage.values.set(key,'invalid saved preference');const f=fixture({storage});
 assert.match(f.$('song-mod-assistance-persistence').textContent,/preserved/);assert.equal(f.$('song-mod-assistance-replace-label').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);assert.equal(storage.values.get(key),'invalid saved preference');
 f.change('song-mod-assistance-replace',true);assert.equal(f.$('song-mod-apply').disabled,false);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(JSON.parse(storage.values.get(key)).mode,'original');assert.equal(f.starts,0);
});
test('quota failure discloses session-only ownership in the closed Mod summary and when reopened',async()=>{
 const storage=memoryStorage();storage.setItem=()=>{throw Error('Quota exceeded');};const f=fixture({storage});f.change('song-mod-assistance-mode','automatic');f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);
 assert.match(f.$('song-mod-preview-summary').textContent,/This tab only/);assert.equal(f.controller.state().persistence.status,'unsaved');assert.equal(storage.values.size,0);f.view.open('preview');assert.match(f.$('song-mod-assistance-persistence').textContent,/This tab only/);assert.equal(f.$('song-mod-assistance-mode').value,'automatic');f.$('song-mod-cancel').click();assert.equal(f.controller.current().plan.mode,'automatic');
});
test('a display-only edit keeps the checked assignment and take-reset checkbox off',async()=>{
 const f=fixture({stage:true});f.change('song-mod-assistance-mode','automatic');f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);const active=f.controller.current(),requests=f.calls.length;
 f.view.open('stage');f.change('song-mod-show-others',false);assert.equal(f.$('song-mod-assistance-reset-label').hidden,true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.controller.current(),active);assert.equal(f.calls.length,requests);assert.equal(f.controller.state().draft,null);assert.equal(f.starts,0);
});

test('default Original part-union and sound edits keep the ordinary Mod path without assistance API or preference writes',async()=>{
 const f=fixture({api:()=>{throw Error('Unrequested strict Original would reject this cross-scope source');}});
 const human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');
 const live=f.document.querySelector('[data-mod-live-instrument="piano"]');live.value='piano';f.emit(live,'change');
 f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);
 assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);assert.equal(f.controller.current(),null);assert.equal(f.applyOptions[0].assistanceChanged,false);assert.equal(f.applyOptions[0].assistanceExplicitOptIn,false);assert.equal(f.applyOptions[0].assistance,null);assert.equal(f.context.mod.config.parts[1].performer,'human');assert.equal(f.context.mod.config.parts[0].liveInstrument,'piano');
 await f.controller.restore();assert.equal(f.controller.state().phase,'default');assert.equal(f.calls.length,0);
});
test('explicit Original check opts into checked receipt admission and persists only after Apply',async()=>{
 const f=fixture();f.$('song-mod-assistance-check').click();await settle(()=>f.controller.state().phase==='prepared');assert.equal(f.calls[0].path,'/api/library/assistance/original');assert.equal(f.storage.values.size,0);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);
 assert.equal(f.applyOptions[0].assistanceChanged,true);assert.equal(f.applyOptions[0].assistanceExplicitOptIn,true);assert.equal(f.controller.current().plan.mode,'original');assert.equal(f.storage.values.size,1);
});
test('existing Original and Automatic assignments still regenerate when the human union changes',async()=>{
 for(const mode of ['original','automatic']){
  const f=fixture();if(mode==='automatic')f.change('song-mod-assistance-mode',mode);else f.$('song-mod-assistance-check').click();if(mode==='original')await settle(()=>f.controller.state().phase==='prepared');f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);const previous=f.controller.current(),requests=f.calls.length;
  f.view.open('preview');const human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);
  assert.equal(f.calls.length,requests+1);assert.equal(f.applyOptions.at(-1).assistanceChanged,true);assert.equal(f.applyOptions.at(-1).assistanceExplicitOptIn,false);assert.notEqual(f.controller.current(),previous);assert.deepEqual(f.controller.current().plan.selection.selected_part_ids,['bass','piano']);
 }
});
test('an invalid saved preference cannot use a plain Original union edit as a fallback',async()=>{
 const storage=memoryStorage(),store=new PracticeAssistanceStore({storage}),key=store.key(assistanceContext());storage.values.set(key,'incompatible saved bytes');const f=fixture({storage});
 const human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');assert.equal(f.$('song-mod-apply').disabled,true);assert.equal(f.calls.length,0);assert.equal(storage.values.get(key),'incompatible saved bytes');
 f.change('song-mod-assistance-replace',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/library/assistance/original');assert.equal(f.applyOptions.at(-1).assistanceChanged,true);assert.equal(f.controller.current().plan.mode,'original');
});

test('idle stage Original union and sound changes preserve the ordinary path without a reset confirmation',async()=>{
 const f=fixture({stage:true,hasTakes:false});const human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');const live=f.document.querySelector('[data-mod-live-instrument="piano"]');live.value='piano';f.emit(live,'change');
 assert.equal(f.$('song-mod-assistance-reset-label').hidden,true);assert.equal(f.$('song-mod-assistance-reset').checked,false);assert.equal(f.$('song-mod-apply').disabled,false);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);
 assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);assert.equal(f.applyOptions[0].assistanceChanged,false);assert.equal(f.applyOptions[0].resetConfirmed,true);assert.equal(f.starts,0);
});
test('an in-progress ordinary Original stage edit keeps warning plus Apply without opting into assistance',async()=>{
 const f=fixture({stage:true,hasTakes:true}),before=structuredClone(f.context.mod);let human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');
 assert.match(f.$('song-mod-warning').textContent,/restarts this session/);assert.equal(f.$('song-mod-assistance-reset-label').hidden,true);assert.equal(f.$('song-mod-assistance-reset').checked,false);assert.equal(f.$('song-mod-apply').disabled,false);f.$('song-mod-cancel').click();assert.deepEqual(f.context.mod,before);
 f.view.open('stage');human=f.document.querySelector('[data-mod-performer="bass"]');human.value='human';f.emit(human,'change');f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.context.mod.config.parts[1].performer,'human');assert.equal(f.applyOptions[0].assistanceChanged,false);assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);assert.equal(f.starts,0);
});
test('an idle active assistance recipe replacement still requires explicit reset',async()=>{
 const f=fixture({stage:true,hasTakes:false});f.change('song-mod-assistance-mode','automatic');assert.equal(f.$('song-mod-assistance-reset-label').hidden,true);assert.equal(f.$('song-mod-apply').disabled,false);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);const active=f.controller.current();
 f.view.open('stage');f.change('song-mod-assistance-max_targets_per_onset','1','input');assert.equal(f.$('song-mod-assistance-reset-label').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);f.$('song-mod-cancel').click();assert.equal(f.controller.current(),active);
});
test('an idle saved recipe awaiting restore still requires reset confirmation for replacement',async()=>{
 const source=fixture();source.change('song-mod-assistance-mode','automatic');source.$('song-mod-apply').click();await settle(()=>!source.$('song-mod-dialog').open);
 const f=fixture({stage:true,hasTakes:false,storage:source.storage});assert.equal(f.controller.state().active,null);assert.ok(f.controller.state().persistence.recipe);f.change('song-mod-assistance-mode','original');assert.equal(f.$('song-mod-assistance-reset-label').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);
 f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.controller.current().plan.mode,'original');assert.equal(f.starts,0);
});


test('changing sound with an active checked recipe still requires the assistance reset acknowledgement',async()=>{
 const f=fixture({stage:true,hasTakes:true});f.change('song-mod-assistance-mode','automatic');f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);const active=f.controller.current();
 f.view.open('stage');const live=f.document.querySelector('[data-mod-live-instrument="piano"]');live.value='guitar';f.emit(live,'change');assert.equal(f.$('song-mod-assistance-reset-label').hidden,false);assert.equal(f.$('song-mod-apply').disabled,true);f.$('song-mod-cancel').click();assert.equal(f.controller.current(),active);
});

test('explicit Off is a bilingual reversible choice, requires stage acknowledgement and never calls checked Original',async()=>{
 const f=fixture({stage:true,hasTakes:true});f.change('song-mod-assistance-mode','automatic');f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);const active=f.controller.current(),calls=f.calls.length;
 f.view.open('stage');assert.match(f.$('song-mod-assistance-off').textContent,/Turn off note assistance/);f.$('song-mod-assistance-off').click();assert.equal(f.$('song-mod-assistance-off').getAttribute('aria-pressed'),'true');assert.equal(f.$('song-mod-assistance-check').hidden,true);assert.equal(f.$('song-mod-apply').disabled,true);f.i18n.setLocale('zh-CN');assert.match(f.$('song-mod-assistance-status').textContent,/关闭.*音符辅助/);f.$('song-mod-cancel').click();assert.equal(f.controller.current(),active);
 f.view.open('stage');f.$('song-mod-assistance-off').click();f.change('song-mod-assistance-reset',true);f.$('song-mod-apply').click();await settle(()=>!f.$('song-mod-dialog').open);assert.equal(f.controller.current(),null);assert.equal(f.controller.state().persistence.status,'off');assert.equal(f.calls.length,calls);assert.equal(f.applyOptions.at(-1).assistanceDisabled,true);assert.equal(f.starts,0);assert.match(f.$('song-mod-stage-summary').textContent,/音符辅助已关闭/);
});
