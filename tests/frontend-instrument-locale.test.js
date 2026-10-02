import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {getAppI18n} from '../web/app-locale.js';
import {createI18n,LOCALE_CATALOGS,MESSAGE_SCHEMA} from '../web/i18n.js';
import instrumentSchema from '../web/locales/instrument-runtime-schema.js';
import {fixture} from './frontend-fixtures.js';
import {pianoContext,pianoResult} from './piano-fingering-fixtures.js';
import {setupGuitarFingering} from '../web/guitar-fingering.js';
import {setupGuitarFingeringView,highlightGuitarRoute,guitarPlanSummary} from '../web/guitar-fingering-view.js';
import {setupGuitarGuidance,guitarGuidanceView} from '../web/guitar-guidance.js';
import {setupPianoFingeringView,pianoGuidanceView} from '../web/piano-fingering-view.js';
import {TimelineIndex} from '../web/transport.js';

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){
  const {document,window}=parseHTML(html);
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  return{document,window,$:id=>document.getElementById(id),fire:(node,type)=>node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}))};
}
function guitarContext(){return{score:structuredClone(fixture),part_id:null,profile:{kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0},dirty:false,timeline:{duration_ms:1500,notes:[{id:'c4@1',part_id:'piano',midi:60,start_ms:0,duration_ms:1250,source_note_ids:['c4']},{id:'e4@1',part_id:'piano',midi:64,start_ms:1000,duration_ms:500,source_note_ids:['e4']}]}};}
function guitarResult(context,settings){return{version:1,algorithm:'deterministic_guitar_beam_v1',score_id:context.score.id,part_id:null,status:'ready',profile:structuredClone(context.profile),complete:true,changed_source_notes:false,source_occurrence_count:2,max_fret_span:settings.max_fret_span,requested_locks:structuredClone(settings.locks),beam_width:64,beam_pruned:false,explored_choices:24,objective_cost:5,diagnostics:[],assignments:context.timeline.notes.map((note,i)=>({...note,occurrence_id:note.id,end_ms:note.start_ms+note.duration_ms,onset_index:i,string:i?1:2,fret:i?0:1,finger:i?0:1,picking_hint:i?'upstroke_suggestion':'downstroke_suggestion'}))};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function button(document,midi,string,fret){const b=document.createElement('button');b.className='fret-button pressed';Object.assign(b.dataset,{midi:String(midi),string:String(string),fret:String(fret)});b.setAttribute('aria-pressed','true');b.append(document.createElement('span'));document.getElementById('fretboard').append(b);return b;}

test('instrument catalogs are integrated with exact schemas and every message renders in both selected languages',()=>{
  for(const [key,schema]of Object.entries(instrumentSchema)){
    assert.deepEqual(MESSAGE_SCHEMA[key],schema,key);
    const params=Object.fromEntries(Object.entries(schema.params).map(([key,type])=>[key,type==='text'?'literal source <x>':2]));
    for(const locale of ['zh-CN','en']){assert.equal(typeof LOCALE_CATALOGS[locale][key],'string',key);const i18n=createI18n({locale,onReport:()=>{}});assert.notEqual(i18n.t(key,params),i18n.t('i18n.unavailable'),key);assert.deepEqual(i18n.getReports(),[]);}
  }
});

test('default Chinese guitar and piano pure readouts retain exact plans and stable phase codes across locale changes',()=>{
  const context=guitarContext(),plan=guitarResult(context,{max_fret_span:3,locks:[]}),piano=pianoResult(pianoContext()),before=structuredClone({context,plan,piano}),i18n=createI18n();
  const input={index:new TimelineIndex(context.timeline.notes),plan,position:500,running:true,hasStarted:true,i18n,showPicking:true};
  const zh=guitarGuidanceView(input),pzh=pianoGuidanceView({plan:piano,position:200,i18n});
  assert.match(zh.state,/乐谱发声/);assert.match(zh.items[0].route,/第 2 行/);assert.match(zh.items[0].picking,/有限拨弦启发式/);assert.equal(pzh.items[0].label,'右手 1');
  i18n.setLocale('en');const en=guitarGuidanceView(input),pen=pianoGuidanceView({plan:piano,position:200,i18n});
  assert.equal(en.phase,zh.phase);assert.deepEqual(en.currentChoices,zh.currentChoices);assert.deepEqual(en.nextChoices,zh.nextChoices);assert.deepEqual(en.retainedChoices,zh.retainedChoices);assert.equal(en.nextOnsetMs,zh.nextOnsetMs);assert.equal(pen.items[0].target_id,pzh.items[0].target_id);assert.equal(pen.items[0].start_ms,pzh.items[0].start_ms);assert.equal(pen.items[0].label,'Right 1');assert.deepEqual({context,plan,piano},before);assert.deepEqual(i18n.getReports(),[]);
});

test('guitar switches while planning and in an open editor without replanning, changing locks, drafts, validation or node identities',async()=>{
  const h=dom(),context=guitarContext(),calls=[];let view;
  const controller=setupGuitarFingering({getContext:()=>context,onChange:()=>view?.render(),api:(path,body,signal)=>{const pending=deferred();calls.push({path,body,signal,...pending});return pending.promise;}});
  view=setupGuitarFingeringView({document:h.document,controller,getContext:()=>context});view.render();const i18n=getAppI18n(h.document),pending=controller.prepare();await tick();
  assert.equal(controller.state().messageCode,'guitar_loading');assert.match(h.$('guitar-plan-status').textContent,/正在通过 Rust/);h.$('guitar-plan-controls').setAttribute('open','');
  i18n.setLocale('en');assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);assert.match(h.$('guitar-plan-status').textContent,/Planning a complete/);
  calls[0].resolve(guitarResult(context,calls[0].body));await pending;
  controller.setSettings({max_fret_span:3,locks:[{source_note_id:'c4',finger:1}]});const locked=controller.prepare();await tick();calls[1].resolve(guitarResult(context,calls[1].body));await locked;
  const plan=controller.state().plan,before=structuredClone(controller.state()),scoreBefore=structuredClone(context),remove=h.$('guitar-lock-list').querySelector('button'),option=h.$('guitar-lock-string').querySelector('[value="3"]'),source=h.$('guitar-lock-source').firstElementChild;
  h.$('guitar-lock-string').value='3';h.$('guitar-lock-fret').value='5';h.$('guitar-lock-finger').value='2';h.$('guitar-max-span').value='';h.$('guitar-replan').click();
  const focus=h.$('guitar-max-span');Object.defineProperty(h.document,'activeElement',{configurable:true,value:focus});assert.match(h.$('guitar-lock-message').textContent,/span.*unchanged/);
  i18n.setLocale('zh-CN');assert.match(h.$('guitar-lock-message').textContent,/跨度.*保持不变/);assert.match(h.$('guitar-plan-status').textContent,/完整乐句路线/);assert.equal(h.$('guitar-lock-string').value,'3');assert.equal(h.$('guitar-lock-fret').value,'5');assert.equal(h.$('guitar-lock-finger').value,'2');assert.equal(h.$('guitar-max-span').value,'');
  assert.equal(h.$('guitar-lock-string').querySelector('[value="3"]'),option);assert.equal(h.$('guitar-lock-source').firstElementChild,source);assert.equal(h.$('guitar-lock-list').querySelector('button'),remove);assert.equal(h.document.activeElement,focus);assert.equal(h.$('guitar-plan-controls').hasAttribute('open'),true);assert.equal(controller.state().plan,plan);assert.deepEqual(controller.state(),before);assert.deepEqual(context,scoreBefore);assert.equal(calls.length,2);assert.deepEqual(i18n.getReports(),[]);
  remove.click();await tick();assert.equal(calls.length,3,'The original remove listener is still active once');assert.deepEqual(controller.state().settings.locks,[]);calls[2].resolve(guitarResult(context,calls[2].body));await controller.prepare();view.destroy();
});

test('guitar live matrix, stable cards and current/next board ARIA redraw from retained playback without changing route or input',()=>{
  const h=dom(),context=guitarContext(),plan=guitarResult(context,{max_fret_span:3,locks:[]}),i18n=getAppI18n(h.document),render=setupGuitarGuidance(h.document),current=button(h.document,60,1,1),next=button(h.document,64,0,0),input={timeline:context.timeline,plan,profile:context.profile,parts:context.score.parts,position:500,running:false,hasStarted:true,showPicking:true};
  render(input);highlightGuitarRoute(h.document,{notes:[context.timeline.notes[0]],nextNotes:[context.timeline.notes[1]],plan,position:500,nextOnsetMs:1000});
  const card=h.document.querySelector('.guitar-target'),marker=h.document.querySelector('.guitar-live-choice'),markerData={...marker.dataset},boardData={...current.dataset},before=structuredClone(plan);assert.match(current.getAttribute('aria-description'),/当前推荐/);assert.match(h.$('guitar-guidance-state').textContent,/已暂停/);
  h.$('guitar-guidance-items').scrollLeft=123;h.document.querySelector('.guitar-details').open=true;i18n.setLocale('en');
  assert.equal(h.document.querySelector('.guitar-target'),card);assert.equal(h.document.querySelector('.guitar-live-choice'),marker);assert.deepEqual({...marker.dataset},markerData);assert.equal(h.$('guitar-guidance-items').scrollLeft,123);assert.equal(h.document.querySelector('.guitar-details').open,true);assert.match(h.$('guitar-guidance-state').textContent,/Paused/);assert.match(marker.title,/Score guidance only; pitch input cannot verify/);assert.match(card.querySelector('.guitar-target-route').textContent,/Row 2/);assert.match(current.getAttribute('aria-description'),/hold, no new attack/);assert.match(next.getAttribute('aria-description'),/new attack/);assert.equal(current.dataset.routeLabel,'Now 1 · Next 1');assert.equal(current.dataset.occurrenceIds,boardData.occurrenceIds);assert.equal(current.dataset.nextOccurrenceIds,boardData.nextOccurrenceIds);assert.equal(current.getAttribute('aria-pressed'),'true');assert.equal(current.classList.contains('pressed'),true);assert.deepEqual(plan,before);assert.deepEqual(i18n.getReports(),[]);render.destroy();
});

test('piano switches during pending work and keeps open controls, successful plan, cards, input, invalid drafts and their validation',async()=>{
  const h=dom(),context=pianoContext(),calls=[],i18n=getAppI18n(h.document),ui=setupPianoFingeringView({document:h.document,getContext:()=>context,api:(path,body,signal)=>{const pending=deferred();calls.push({path,body,signal,...pending});return pending.promise;}});
  const key=h.document.createElement('button');key.className='piano-key pressed';key.dataset.midi='60';key.setAttribute('aria-pressed','true');key.setAttribute('aria-label','Original key label');h.$('keyboard').append(key);
  h.$('instrument-settings').open=true;h.$('piano-fingering-guidance').open=true;ui.render({position:200,running:false,hasStarted:true});await tick();assert.match(h.$('piano-fingering-title').textContent,/钢琴用手与指法/);assert.match(h.$('piano-guidance-state').textContent,/正在规划/);
  const source=h.$('piano-source-note').firstElementChild,input=h.$('piano-left-low'),apply=h.$('piano-fingering-replan');i18n.setLocale('en');assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);assert.equal(h.$('piano-source-note').firstElementChild,source);assert.equal(h.$('piano-fingering-title').textContent,'Piano hands & fingers');
  calls[0].resolve(pianoResult(context,calls[0].body));await ui.prepare();ui.render({position:200,running:false,hasStarted:true});const plan=ui.state().plan,before=structuredClone({plan,context,settings:ui.state().settings}),card=h.document.querySelector('.piano-finger-target'),badge=key.querySelector('.piano-finger-label');
  i18n.setLocale('zh-CN');assert.equal(ui.state().plan,plan);assert.equal(h.document.querySelector('.piano-finger-target'),card);assert.equal(key.querySelector('.piano-finger-label'),badge);assert.equal(badge.textContent,'右1');assert.equal(key.getAttribute('aria-pressed'),'true');assert.equal(key.getAttribute('aria-label'),'Original key label');assert.equal(key.classList.contains('pressed'),true);assert.deepEqual({plan,context,settings:ui.state().settings},before);assert.equal(calls.length,1);
  input.value='';h.fire(input,'input');apply.click();assert.equal(ui.state().draftDirty,true);assert.match(h.$('piano-fingering-status').textContent,/MIDI 范围/);const draftBefore=structuredClone(ui.state());Object.defineProperty(h.document,'activeElement',{configurable:true,value:input});
  i18n.setLocale('en');assert.equal(h.$('piano-left-low'),input);assert.equal(h.$('piano-fingering-replan'),apply);assert.equal(input.value,'');assert.equal(h.document.activeElement,input);assert.equal(h.$('instrument-settings').open,true);assert.equal(h.$('piano-fingering-guidance').open,true);assert.equal(calls.length,1);assert.deepEqual(ui.state(),draftBefore);assert.match(h.$('piano-fingering-status').textContent,/MIDI limits/);assert.deepEqual(i18n.getReports(),[]);ui.destroy();
});

test('stable model statuses localize without interpreting raw diagnostic prose and unknown failures stay literal behind local labels',async()=>{
  const i18n=createI18n();for(const status of ['infeasible_under_model','no_plan_found','search_limit','unavailable']){
    const state={phase:'unavailable',message:'READY: success! invented external prose',plan:{status,assignments:[]}};
    const zh=guitarPlanSummary(state,i18n);assert.doesNotMatch(zh,/READY|success/);i18n.setLocale('en');const en=guitarPlanSummary(state,i18n);assert.notEqual(zh,en);if(status==='no_plan_found')assert.match(en,/another route may exist/);i18n.setLocale('zh-CN');
  }
  for(const instrument of ['guitar','piano']){
    const h=dom(),locale=getAppI18n(h.document),error=Object.assign(Error('<unknown failure> READY: retain original '+ 'x'.repeat(9000)),{code:'external_42'});let ui,controller;
    if(instrument==='guitar'){const context=guitarContext();controller=setupGuitarFingering({getContext:()=>context,onChange:()=>ui?.render(),api:async()=>{throw error;}});ui=setupGuitarFingeringView({document:h.document,controller,getContext:()=>context});ui.render();await controller.prepare();}
    else{ui=setupPianoFingeringView({document:h.document,getContext:()=>pianoContextForError,api:async()=>{throw error;}});controller=ui.controller;ui.render();await ui.prepare();}
    const diagnostics=h.$(instrument==='guitar'?'guitar-plan-diagnostics':'piano-fingering-diagnostics');assert.match(diagnostics.textContent,/原始技术详情 \[external_42\]/);assert.ok(diagnostics.textContent.includes(error.message));assert.equal(diagnostics.querySelector('unknown'),null);const state=controller.state();assert.equal(state.messageCode,instrument+'_error');assert.equal(state.errorDetails.code,'external_42');locale.setLocale('en');assert.match(diagnostics.textContent,/Original technical details \[external_42\]/);assert.ok(diagnostics.textContent.includes(error.message));assert.equal(controller.state().phase,'error');assert.deepEqual(locale.getReports(),[]);ui.destroy();
  }
});
const pianoContextForError=pianoContext();
