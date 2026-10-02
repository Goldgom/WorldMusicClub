import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {setupGuitarFingering} from '../web/guitar-fingering.js';
import {setupGuitarFingeringView,guitarRowLabel,guitarPlanSummary,highlightGuitarRoute} from '../web/guitar-fingering-view.js';
import {setupGuitarGuidance} from '../web/guitar-guidance.js';

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
function context(){return{score:structuredClone(fixture),part_id:null,profile:{kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0},dirty:false,timeline:{duration_ms:1000,notes:[{id:'c4@pass1',part_id:'piano',midi:60,start_ms:0,duration_ms:500,source_note_ids:['c4']},{id:'e4@pass1',part_id:'piano',midi:64,start_ms:500,duration_ms:500,source_note_ids:['e4']}]}};}
function result(ctx,settings){
 const notes=ctx.timeline.notes.filter(note=>ctx.part_id===null||ctx.part_id===note.part_id),locked=settings.locks.find(lock=>lock.source_note_id==='c4');
 const plan={version:1,algorithm:'deterministic_guitar_beam_v1',score_id:ctx.score.id,part_id:ctx.part_id,status:notes.length?'ready':'no_targets',profile:structuredClone(ctx.profile),complete:true,changed_source_notes:false,source_occurrence_count:notes.length,max_fret_span:settings.max_fret_span,requested_locks:structuredClone(settings.locks),beam_width:64,beam_pruned:false,explored_choices:24,objective_cost:notes.length?5:0,diagnostics:[],assignments:notes.map((note,index)=>({...note,occurrence_id:note.id,end_ms:note.start_ms+note.duration_ms,onset_index:index,string:index?1:locked?.string??2,fret:index?0:locked?.fret??1,finger:index?0:locked?.finger??1,picking_hint:index?'upstroke_suggestion':'downstroke_suggestion'}))};
 return plan;
}
async function harness(){
 const{document,window}=parseHTML(html);let ctx=context(),view;const calls=[];
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 const controller=setupGuitarFingering({getContext:()=>ctx,onChange:()=>view?.render(),api:async(path,body)=>{calls.push({path,body});return result(ctx,body);}});
 view=setupGuitarFingeringView({document,controller,getContext:()=>ctx});view.render();
 return{document,window,controller,view,calls,getContext:()=>ctx,setContext:value=>{ctx=value;view.render()},$:id=>document.getElementById(id),submit:()=>document.getElementById('guitar-lock-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))};
}

test('guitar editor labels actual tuning rows, limits, session scope and default optional views',async()=>{
 const h=await harness();assert.equal(h.calls.length,0);await h.controller.prepare();
 assert.equal(h.$('guitar-planning').dataset.status,'ready');assert.match(h.$('guitar-plan-status').textContent,/One whole-phrase route · 2/);
 assert.match(h.$('guitar-annotation-scope').textContent,/Session-only.*v1/);assert.match(h.$('guitar-annotation-scope').textContent,/transposing.*clears/);
 assert.match(h.$('guitar-lock-string').textContent,/Row 1 \(E4 tuning\)/);assert.match(h.$('guitar-lock-string').textContent,/Row 6 \(E2 tuning\)/);
 assert.deepEqual(h.view.options(),{showAlternatives:false,showPicking:false});assert.match(guitarRowLabel({tuning:[40,64],capo:2},1),/Row 1 \(E2 tuning; F♯2 capo-open\)/);
 assert.equal(h.$('guitar-plan-status').getAttribute('aria-live'),'polite');assert.equal(h.$('guitar-lock-source').getAttribute('aria-describedby'),'guitar-source-count');
});

test('source-lock editing invalidates then replans one complete phrase without changing canonical music',async()=>{
 const h=await harness(),before=structuredClone(h.getContext());await h.controller.prepare();
 h.$('guitar-lock-source').value='c4';h.$('guitar-lock-source').dispatchEvent(new h.window.Event('change'));
 h.$('guitar-lock-string').value='3';h.$('guitar-lock-fret').value='5';h.$('guitar-lock-finger').value='2';
 assert.equal(h.controller.assignment('c4@pass1').string,2,'Unapplied fields are explicitly a draft');h.submit();
 assert.equal(h.controller.assignment('c4@pass1'),null,'The old recommendation disappears before a new response');await h.controller.prepare();
 assert.equal(h.controller.assignment('c4@pass1').string,3);assert.equal(h.controller.assignment('c4@pass1').finger,2);assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls.at(-1).body.locks,[{source_note_id:'c4',string:3,fret:5,finger:2}]);assert.match(h.$('guitar-lock-list').textContent,/c4: Row 3 \(G3 tuning\).*fret 5.*finger 2/);assert.deepEqual(h.getContext(),before);
 h.$('guitar-max-span').value='5';h.$('guitar-replan').click();await h.controller.prepare();assert.equal(h.calls.at(-1).body.max_fret_span,5);
 h.$('guitar-max-span').value='';h.$('guitar-replan').click();assert.match(h.$('guitar-lock-message').textContent,/span.*unchanged/);assert.equal(h.controller.state().settings.max_fret_span,5);
 h.$('guitar-remove-lock').click();await h.controller.prepare();assert.deepEqual(h.controller.state().settings.locks,[]);assert.equal(h.controller.assignment('c4@pass1').string,2);assert.deepEqual(h.getContext(),before);
});

test('other-part locks survive selection but never enter a request for absent sources',async()=>{
 const h=await harness();await h.controller.prepare();h.controller.setSettings({max_fret_span:3,locks:[{source_note_id:'c4',finger:1}]});await h.controller.prepare();
 h.setContext({...h.getContext(),part_id:'absent'});await h.controller.prepare();assert.equal(h.calls.at(-1).body.locks.length,0);assert.equal(h.controller.state().settings.locks.length,1);assert.match(h.$('guitar-lock-list').textContent,/inactive for this selection/);assert.match(h.$('guitar-lock-count').textContent,/0 apply/);
 h.setContext({...h.getContext(),part_id:null});await h.controller.prepare();assert.equal(h.calls.at(-1).body.locks.length,1);assert.doesNotMatch(h.$('guitar-lock-list').textContent,/inactive/);
 const newContext=context();newContext.score.title='Tempo-recompiled score';h.setContext(newContext);assert.equal(h.controller.assignment('c4@pass1'),null);assert.deepEqual(h.controller.state().settings,{max_fret_span:3,locks:[]});assert.equal(h.$('guitar-lock-list').children.length,0);
});

test('source filter is bounded, exact source IDs remain reachable and source text is never HTML',async()=>{
 const h=await harness(),ctx=context();ctx.timeline.notes=Array.from({length:260},(_,i)=>({id:`occurrence-${i}`,source_note_ids:[`<source-${i}>`],midi:60,part_id:'piano',start_ms:i*500,duration_ms:500}));h.setContext(ctx);
 assert.equal(h.$('guitar-lock-source').children.length,200);assert.match(h.$('guitar-source-count').textContent,/200 of 260/);
 h.$('guitar-source-filter').value='<source-259>';h.$('guitar-source-filter').dispatchEvent(new h.window.Event('input'));assert.equal(h.$('guitar-lock-source').children.length,1);assert.equal(h.$('guitar-lock-source').value,'<source-259>');assert.equal(h.$('guitar-lock-source').querySelector('source-259'),null);
});

test('no-plan statuses distinguish proven model conflict from bounded or unavailable search and keep source diagnostics',async()=>{
 for(const[status,expected]of [['infeasible_under_model',/Proven constraint conflict/],['no_plan_found',/another route may exist/],['search_limit',/feasibility is unresolved/],['unavailable',/feasibility is unresolved/]]){
  const {document}=parseHTML(html),ctx=context();const state={phase:'unavailable',message:'',settings:{max_fret_span:3,locks:[]},plan:{...result(ctx,{max_fret_span:3,locks:[]}),status,complete:false,assignments:[],objective_cost:null,diagnostics:[{code:'guitar_fingering_incomplete',severity:'warning',message:'The declared constraints conflict.',note_id:'c4@pass1'}]}};
  const view=setupGuitarFingeringView({document,getContext:()=>ctx,controller:{state:()=>state}});view.render();assert.match(guitarPlanSummary(state),expected);assert.equal(document.getElementById('guitar-planning').dataset.status,status);assert.match(document.getElementById('guitar-plan-diagnostics').textContent,/Occurrence c4@pass1; source notes c4; onset 0.000s/);
 }
});

test('cards and fretboard use exact occurrence route; pitch alternatives and picking are separate opt-ins',async()=>{
 const h=await harness();await h.controller.prepare();const ctx=h.getContext(),plan=h.controller.state().plan,render=setupGuitarGuidance(h.document);
 for(const[string,fret,midi]of [[0,0,64],[1,1,60],[2,5,60],[3,10,60]]){const button=h.document.createElement('button');button.className='fret-button';Object.assign(button.dataset,{string:String(string),fret:String(fret),midi:String(midi)});button.append(h.document.createElement('span'));h.$('fretboard').append(button);}
 const args={notes:[ctx.timeline.notes[0]],plan};highlightGuitarRoute(h.document,args);
 assert.equal(h.document.querySelectorAll('.fret-button.playing').length,1);assert.equal(h.document.querySelector('.fret-button.playing').dataset.string,'1');assert.equal(h.document.querySelector('.fret-button.playing').dataset.fingers,'1');assert.equal(h.document.querySelectorAll('.fret-button.pitch-option').length,0);
 highlightGuitarRoute(h.document,{...args,showAlternatives:true});assert.equal(h.document.querySelectorAll('.fret-button.playing').length,1);assert.equal(h.document.querySelectorAll('.fret-button.pitch-option').length,2);
 render({timeline:ctx.timeline,parts:ctx.score.parts,plan});const card=h.document.querySelector('.guitar-target');assert.deepEqual(JSON.parse(card.dataset.route),[{string:2,fret:1,finger:1}]);assert.match(card.querySelector('.guitar-target-route').textContent,/Row 2 \(B3 tuning\).*finger 1 · index/);assert.equal(card.querySelector('.guitar-target-picking').hidden,true);
 render({timeline:ctx.timeline,parts:ctx.score.parts,plan,showPicking:true});assert.match(card.querySelector('.guitar-target-picking').textContent,/Limited picking heuristic: Downstroke suggestion.*Single-note onset parity only/);
 highlightGuitarRoute(h.document,{...args,plan:null});render({timeline:ctx.timeline,plan:null});assert.equal(h.document.querySelectorAll('.fret-button.playing,.fret-button.pitch-option').length,0);assert.equal(card.dataset.route,'[]');assert.match(card.querySelector('.guitar-target-route').textContent,/No current recommended route/);
});

test('next chosen shape has distinct text/outline, keeps held identities, and never becomes a pitch alternative',async()=>{
 const h=await harness(),ctx=h.getContext();
 ctx.timeline.notes[0].duration_ms=1000;ctx.timeline.notes[1].start_ms=500;
 const plan=result(ctx,{max_fret_span:3,locks:[]});
 for(const[string,fret,midi]of [[0,0,64],[1,1,60],[2,5,60]]){const button=h.document.createElement('button');button.className='fret-button';Object.assign(button.dataset,{string:String(string),fret:String(fret),midi:String(midi)});button.append(h.document.createElement('span'));h.$('fretboard').append(button);}
 const args={notes:[ctx.timeline.notes[0]],nextNotes:[ctx.timeline.notes[1]],plan,position:250,nextOnsetMs:500,showAlternatives:true};highlightGuitarRoute(h.document,args);
 const current=h.document.querySelector('[data-string="1"][data-fret="1"]'),next=h.document.querySelector('[data-string="0"][data-fret="0"]');
 assert.equal(h.document.querySelectorAll('.fret-button.playing').length,1);assert.equal(h.document.querySelectorAll('.fret-button.route-next').length,2);assert.equal(current.classList.contains('route-next'),true);assert.equal(next.classList.contains('pitch-option'),false);assert.equal(next.dataset.routeLabel,'Next 0');assert.equal(current.dataset.routeLabel,'Now 1 · Next 1');assert.deepEqual(JSON.parse(current.dataset.nextOccurrenceIds),['c4@pass1']);assert.match(current.getAttribute('aria-description'),/hold, no new attack/);assert.match(next.getAttribute('aria-description'),/new attack/);
 highlightGuitarRoute(h.document,{...args,nextNotes:[],nextOnsetMs:null});assert.equal(h.document.querySelectorAll('.route-next').length,0);assert.equal(next.dataset.routeLabel,'');assert.equal(current.dataset.routeLabel,'Now 1');
 highlightGuitarRoute(h.document,{...args,plan:null});assert.equal(h.document.querySelectorAll('.playing,.route-next').length,0);assert.equal(current.dataset.nextSourceIds,'[]');assert.equal(current.getAttribute('aria-description'),null);
});
