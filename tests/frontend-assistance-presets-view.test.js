import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setupPracticeAssistanceView} from '../web/practice-assistance-view.js';
import {createPracticeAssistanceController,PracticeAssistanceStore} from '../web/practice-assistance.js';
import {assistancePresets,assistancePresetSettings,defaultAssistanceSettings} from '../web/practice-assistance-receipt.js';
import {assistanceContext,assistanceResponse,memoryStorage,deferred} from './practice-assistance-fixtures.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fields=['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones'];
function fixture({storage=memoryStorage(),api,where='preview',hasTakes=false,binding=assistanceContext()}={}){
  const {document,window}=parseHTML('<html><body><main></main></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  // LinkeDOM does not implement browser focus; retain the active control so
  // rerender behavior and editable numeric input can be exercised in Node.
  let focused=null;Object.defineProperty(document,'activeElement',{get:()=>focused});
  window.HTMLElement.prototype.focus=function(){focused=this;};
  const $=id=>document.getElementById(id),calls=[],i18n={locale:'en'};
  const controller=createPracticeAssistanceController({getContext:()=>binding,store:new PracticeAssistanceStore({storage}),api:async(path,body,signal)=>{
    calls.push({path,body,signal});return api?api(path,body,signal):assistanceResponse(binding,{mode:path.endsWith('/original')?'original':'automatic',settings:body.settings??null,selection:body.selection});
  }});
  const view=setupPracticeAssistanceView({document,parent:document.querySelector('main'),i18n});view.open(controller,{where,hasTakes});
  const change=(suffix,value,type='change')=>{const node=$('song-mod-assistance-'+suffix);if(typeof value==='boolean')node.checked=value;else node.value=String(value);node.dispatchEvent(new window.Event(type,{bubbles:true}));};
  return{$,document,window,i18n,controller,view,calls,storage,change,get binding(){return binding;},set binding(value){binding=value;},automatic(){change('mode','automatic');},preset(id){change('preset',id);},edit(field,value){const input=$('song-mod-assistance-'+field);input.focus();change(field,value,'input');},reopen(){view.open(controller,{where,hasTakes});}};
}
function assertUnchecked(f){
  assert.equal(f.$('song-mod-assistance-preview').dataset.state,'unchecked');
  assert.equal(f.$('song-mod-assistance-units').hidden,true);
  assert.equal(f.$('song-mod-assistance-units').textContent,'');
  assert.doesNotMatch(f.$('song-mod-assistance-status').textContent,/\d+ human targets/);
}

test('the native preset select exposes exact numeric configurations and leaves Original defaults untouched',()=>{
  const f=fixture(),select=f.$('song-mod-assistance-preset');
  assert.equal(f.$('song-mod-assistance-mode').value,'original');assert.equal(f.view.changed(),false);
  assert.equal(f.$('song-mod-assistance-preset-label').hidden,true);assert.equal(f.$('song-mod-assistance-limits').hidden,true);
  assert.equal(select.tagName,'SELECT');assert.equal(select.value,'balanced');assert.deepEqual([...select.options].map(option=>option.value),['single','balanced','dense','custom']);
  assert.equal(select.options[3].disabled,true);assert.equal(f.$(select.getAttribute('aria-labelledby')).textContent,'Keyboard configuration');
  assert.match(f.$(select.getAttribute('aria-describedby')).textContent,/selections need not contain one another/);
  assert.match(f.$(select.getAttribute('aria-describedby')).textContent,/replace or reduce human targets/);
  assert.match(f.$(select.getAttribute('aria-describedby')).textContent,/Single can still make large pitch jumps/);
  f.automatic();assert.equal(f.$('song-mod-assistance-preset-label').hidden,false);assert.equal(f.$('song-mod-assistance-limits').hidden,false);
  for(const [index,{settings}] of assistancePresets().entries()){
    const text=select.options[index].textContent;
    assert.match(text,new RegExp(`max ${settings.max_targets_per_onset}/onset`));assert.match(text,new RegExp(`min ${settings.min_onset_interval_ms} ms`));
    assert.match(text,new RegExp(`max ${settings.max_simultaneous_keys} held keys`));assert.match(text,new RegExp(`${settings.max_held_span_semitones} semitone span`));
  }
  for(const field of fields){const input=f.$('song-mod-assistance-'+field);assert.equal(input.type,'number');assert.equal(input.disabled,false);assert.equal(input.value,String(defaultAssistanceSettings()[field]));assert.ok(input.closest('label').querySelector('span').textContent);}
  assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);assertUnchecked(f);
});

test('preset selection is draft-only; numeric edits derive Custom and exact matches without normalization',()=>{
  const f=fixture();f.automatic();
  for(const id of ['single','dense','balanced']){f.preset(id);assert.deepEqual(f.controller.state().draft.settings,assistancePresetSettings(id));for(const field of fields)assert.equal(f.$('song-mod-assistance-'+field).value,String(assistancePresetSettings(id)[field]));}
  f.edit('min_onset_interval_ms',251);assert.equal(f.$('song-mod-assistance-preset').value,'custom');assert.equal(f.controller.state().draft.settings.min_onset_interval_ms,251);
  f.edit('min_onset_interval_ms',250);assert.equal(f.$('song-mod-assistance-preset').value,'balanced');
  f.edit('max_targets_per_onset','');assert.equal(f.$('song-mod-assistance-preset').value,'custom');assert.equal(f.$('song-mod-assistance-max_targets_per_onset').value,'');assert.ok(Number.isNaN(f.controller.state().draft.settings.max_targets_per_onset));
  assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);assert.equal(f.controller.current(),null);assertUnchecked(f);
  f.view.close();f.reopen();assert.equal(f.$('song-mod-assistance-mode').value,'original');assert.equal(f.view.changed(),false);
});

test('complete-song preview uses admitted counts for each configuration and never infers them from density',async()=>{
  const f=fixture();f.automatic();
  for(const {id} of assistancePresets()){
    f.preset(id);assertUnchecked(f);await f.view.prepare();
    const call=f.calls.at(-1);assert.equal(call.path,'/api/library/assistance/generate');assert.deepEqual(call.body.settings,assistancePresetSettings(id));
    assert.equal(f.$('song-mod-assistance-preview').dataset.state,'checked');assert.equal(f.$('song-mod-assistance-preview-title').textContent,'Assignment preview · complete song');
    assert.equal(f.$('song-mod-assistance-status').textContent,'2 human targets · 2 machine occurrences');
    assert.equal(f.$('song-mod-assistance-units').textContent,'2 human source units + 2 machine source units = 4 retained source units');
    assert.equal(f.view.checked(),f.controller.state().prepared);assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);
  }
});

test('editing or replacing a preset discards checked counts and fences a late check response',async()=>{
  const gates=[],f=fixture({api:()=>{const gate=deferred();gates.push(gate);return gate.promise;}});f.automatic();f.preset('single');
  const first=f.view.prepare();await tick();assert.equal(f.$('song-mod-assistance-preview').dataset.state,'checking');
  f.preset('dense');assert.equal(f.calls[0].signal.aborted,true);assertUnchecked(f);
  const second=f.view.prepare();await tick();gates[0].resolve(assistanceResponse(f.binding,{settings:f.calls[0].body.settings}));assert.equal(await first,null);assert.equal(f.controller.state().prepared,null);
  gates[1].resolve(assistanceResponse(f.binding,{settings:f.calls[1].body.settings}));await second;assert.equal(f.$('song-mod-assistance-preview').dataset.state,'checked');
  f.edit('max_simultaneous_keys',5);assertUnchecked(f);assert.equal(f.$('song-mod-assistance-preset').value,'custom');assert.equal(f.storage.values.size,0);
});

test('failed checking clears the preview and blocks Apply until an explicit successful retry',async()=>{
  let fail=false;const f=fixture({api:(_path,body)=>{if(fail)throw Error('Native check unavailable');return assistanceResponse(f.binding,{settings:body.settings});}});f.automatic();await f.view.prepare();
  f.preset('dense');fail=true;await assert.rejects(f.view.prepare(),/Native check unavailable/);
  assertUnchecked(f);assert.equal(f.view.checked(),null);assert.equal(f.view.canApply(),false);assert.match(f.$('song-mod-assistance-status').textContent,/current song and applied ownership are unchanged/);
  fail=false;await f.view.prepare();assert.equal(f.view.canApply(),true);assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);
  f.edit('max_targets_per_onset','');await assert.rejects(f.view.prepare(),/numeric density/);assert.equal(f.calls.length,3);assertUnchecked(f);assert.equal(f.view.canApply(),false);
});

test('Cancel during Check aborts the request and preserves the applied plan and saved bytes',async()=>{
  const f=fixture();f.automatic();f.preset('balanced');await f.view.prepare();const active=f.view.commit(),saved=[...f.storage.values];
  f.reopen();f.preset('dense');f.view.close();assert.equal(f.controller.current(),active);assert.deepEqual([...f.storage.values],saved);
  const gate=deferred(),pending=fixture({storage:f.storage,api:()=>gate.promise});pending.preset('single');const check=pending.view.prepare();await tick();pending.view.close();assert.equal(pending.calls[0].signal.aborted,true);
  gate.resolve(assistanceResponse(pending.binding,{settings:pending.calls[0].body.settings}));assert.equal(await check,null);assert.equal(pending.controller.state().draft,null);assert.equal(pending.controller.current(),null);assert.deepEqual([...pending.storage.values],saved);
});

test('saved recipes contain only exact numeric settings and reopen with derived matching or Custom labels',async()=>{
  for(const custom of [false,true]){
    const f=fixture();f.automatic();f.preset('single');if(custom)f.edit('min_onset_interval_ms',501);await f.view.prepare();f.view.commit();
    const saved=[...f.storage.values],recipe=JSON.parse(saved[0][1]);assert.equal(recipe.version,1);assert.equal(recipe.revision,1);assert.equal(recipe.planner_revision,1);assert.equal(Object.hasOwn(recipe,'preset'),false);assert.equal(Object.hasOwn(recipe,'preset_id'),false);assert.equal(Object.hasOwn(recipe.settings,'preset_revision'),false);
    assert.deepEqual(recipe.settings,{...assistancePresetSettings('single'),min_onset_interval_ms:custom?501:500});
    const restored=fixture({storage:f.storage});assert.equal(restored.$('song-mod-assistance-preset').value,custom?'custom':'single');assert.equal(restored.$('song-mod-assistance-min_onset_interval_ms').value,custom?'501':'500');assertUnchecked(restored);
    assert.equal(restored.calls.length,0);assert.deepEqual([...f.storage.values],saved);restored.view.close();assert.deepEqual([...f.storage.values],saved);
  }
});

test('stage preset changes require fresh reset acknowledgement and never reset on selection or Cancel',async()=>{
  const f=fixture({where:'stage',hasTakes:true});f.automatic();f.change('reset',true);assert.equal(f.view.canApply(),true);
  f.preset('single');assert.equal(f.$('song-mod-assistance-reset-label').hidden,false);assert.equal(f.$('song-mod-assistance-reset').checked,false);assert.equal(f.view.canApply(),false);
  await f.view.prepare();assert.equal(f.view.canApply(),false);f.change('reset',true);assert.equal(f.view.canApply(),true);f.preset('dense');assert.equal(f.$('song-mod-assistance-reset').checked,false);
  f.view.close();assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);
});

test('new controls retain focus and native keyboard semantics across renders and locale changes',()=>{
  const f=fixture();f.automatic();const select=f.$('song-mod-assistance-preset');select.focus();f.preset('dense');assert.equal(f.document.activeElement,select);assert.equal(f.$('song-mod-assistance-preset'),select);
  assert.equal(select.hasAttribute('tabindex'),false);assert.equal(select.hasAttribute('role'),false);
  f.i18n.locale='zh-CN';f.view.render();assert.equal(f.document.activeElement,select);assert.equal(select.value,'dense');assert.equal(f.$(select.getAttribute('aria-labelledby')).textContent,'键盘配置');assert.match(select.options[2].textContent,/密集.*4.*125.*6.*12/);assert.match(f.$('song-mod-assistance-model').textContent,/不一定互相包含/);assert.match(f.$('song-mod-assistance-model').textContent,/单音配置仍可能连续大跳/);
  assert.equal(f.$('song-mod-assistance-preview-title').textContent,'分配预览 · 完整歌曲');assert.match(f.$('song-mod-assistance-legend').textContent,/● 真人.*◆ 机器/);
  const input=f.$('song-mod-assistance-min_onset_interval_ms');f.edit('min_onset_interval_ms',126);f.view.render();assert.equal(f.document.activeElement,input);assert.equal(f.$('song-mod-assistance-preset').value,'custom');assert.match(select.options[3].textContent,/自定义/);
  assert.equal(f.$('song-mod-assistance-status').getAttribute('role'),'status');assert.equal(f.$('song-mod-assistance-status').getAttribute('aria-live'),'polite');assert.equal(f.$('song-mod-assistance-status').getAttribute('aria-atomic'),'true');
});

test('source replacement removes old preview counts and disables stale preset interaction',async()=>{
  const f=fixture();f.automatic();await f.view.prepare();assert.equal(f.$('song-mod-assistance-preview').dataset.state,'checked');
  f.binding={...f.binding,sourceToken:{}};f.view.render();assertUnchecked(f);assert.equal(f.view.checked(),null);assert.equal(f.$('song-mod-assistance-preset').disabled,true);assert.equal(f.$('song-mod-assistance-off').disabled,true);assert.equal(f.view.canApply(),false);assert.match(f.$('song-mod-assistance-status').textContent,/Close and reopen Mod/);
});

test('Original and explicit Off retain compatibility and recovery paths with presets hidden',async()=>{
  const guitar=assistanceContext();guitar.selection.profile={kind:'guitar',tuning:[64,59,55,50,45,40],frets:20,capo:0};
  const original=fixture({binding:guitar});assert.equal(original.$('song-mod-assistance-preset-label').hidden,true);assert.equal(original.$('song-mod-assistance-mode').options[1].disabled,true);assert.equal(original.view.changed(),false);original.view.finishUnchanged();assert.equal(original.calls.length,0);assert.equal(original.storage.values.size,0);
  const f=fixture();f.automatic();f.preset('single');await f.view.prepare();f.view.commit();f.reopen();f.$('song-mod-assistance-off').click();
  assert.equal(f.$('song-mod-assistance-preset-label').hidden,true);assert.equal(f.$('song-mod-assistance-limits').hidden,true);assert.equal(f.$('song-mod-assistance-preview').dataset.state,'off-draft');assert.equal(f.view.checked(),null);f.view.commit();
  assert.equal(f.calls.length,1);assert.equal(f.controller.current(),null);assert.equal(JSON.parse([...f.storage.values][0][1]).format,'wmc-practice-assistance-off');
  f.reopen();assert.equal(f.$('song-mod-assistance-mode').value,'original');f.automatic();assertUnchecked(f);assert.match(f.$('song-mod-assistance-status').textContent,/Check the assignment/);assert.equal(f.$('song-mod-assistance-preset').value,'balanced');
});
