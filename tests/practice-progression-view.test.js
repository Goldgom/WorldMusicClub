import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {setupPracticeProgressionView} from '../web/practice-progression-view.js';
import {admitPracticeProgression} from '../web/practice-progression-receipt.js';
import {practiceAssistanceBinding} from '../web/practice-assistance-receipt.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';

const vectors=Object.fromEntries(['canonical','native-basic','native-vsq'].map(kind=>[kind,JSON.parse(readFileSync(new URL(`./fixtures/progression-${kind}.json`,import.meta.url),'utf8'))]));
test('real Rust canonical, Basic and VSQ wrappers admit every stage, including equal and empty stages',()=>{
  for(const [kind,fixture]of Object.entries(vectors))for(const response of [...Object.values(fixture.layers).map(layer=>layer.response),fixture.empty,fixture.narrow_scope].filter(Boolean)){
    const plan=response.checked.plan,binding={source:fixture.source??null,score:fixture.score,sourceToken:{},runtimeToken:{},selection:plan.selection,layer:plan.layer};
    const checked=admitPracticeProgression(response,binding);assert.deepEqual(checked.plan,plan);assert.equal(checked.assistance.coverage.human_target_count,checked.layers.find(row=>row.layer===plan.layer).human_target_count);
    if(!checked.assistance.coverage.human_target_count)assert.equal(checked.assistance.scored_mode_allowed,false,kind);
  }
});
test('bilingual stage summaries show actual equal/empty sets and clear all stale counts',()=>{
  const {document,window}=parseHTML('<html><body></body></html>');Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  const i18n={locale:'en'},changes=[],view=setupPracticeProgressionView({document,parent:document.body,i18n,onLayer:layer=>changes.push(layer)}),summary=document.getElementById('song-mod-progression-summary');
  view.render({visible:true,layer:'balanced',checked:vectors['native-vsq'].layers.balanced.response.checked});assert.equal(summary.children.length,3);assert.match(summary.textContent,/Same targets as the previous stage/);assert.match(document.body.textContent,/not musical grades or an optimal arrangement/);assert.equal(summary.querySelector('[aria-current="step"]').dataset.layer,'balanced');
  view.render({visible:true,layer:'single',checked:vectors['native-vsq'].empty.checked});assert.match(summary.textContent,/0 human targets/);assert.match(summary.textContent,/Empty stage · scoring unavailable/);
  i18n.locale='zh-CN';view.render({visible:true,checked:vectors['native-vsq'].empty.checked});assert.match(summary.textContent,/空阶段 · 无法评分/);assert.match(document.body.textContent,/并非音乐等级或最优编配/);
  view.render({visible:true});assert.doesNotMatch(summary.textContent,/0|真人目标|human targets/);view.render({visible:false});assert.equal(summary.textContent,'');
});
for(const kind of ['native-basic','native-vsq'])test(`real ${kind} stages feed the full-source machine complement without changing any original audio gate`,()=>{
  const fixture=vectors[kind],old=JSON.parse(readFileSync(new URL(`./fixtures/assistance-${kind}.json`,import.meta.url),'utf8'));
  const opened=kind==='native-basic'?old.opened:JSON.parse(readFileSync(new URL('./fixtures/vsq-clean-v1-native-open.json',import.meta.url),'utf8'));
  let song=prepareCleanSong(`native:${fixture.source.key}`,opened.clean_package,JSON.parse(opened.score_json));if(kind==='native-vsq')song=prepareVsqPractice(song,old.selected_runtime);
  const build=kind==='native-basic'?buildBasicKeyAudioPlan:buildVsqAudioPlan,before=JSON.stringify(song),full=build(song,{sampleRate:48000});
  for(const response of [...Object.values(fixture.layers).map(layer=>layer.response),fixture.empty,fixture.narrow_scope].filter(Boolean)){
    const {selection,layer}=response.checked.plan,checked=admitPracticeProgression(response,{source:fixture.source,sourceToken:song,runtimeToken:song.runtime,selection,layer});
    const plan=build(song,{sampleRate:48000,mode:'practice',practiceSelection:{kind:'parts',part_ids:selection.selected_part_ids},assistance:checked.assistance,assistanceContext:practiceAssistanceBinding(checked.assistance)});
    assert.deepEqual(plan.notes,full.notes.filter(row=>checked.assistance.machine_occurrence_ids.includes(row[0])));assert.equal(plan.durationFrames,full.durationFrames);assert.equal(plan.sourceNotes,full.sourceNotes);assert.equal(JSON.stringify(song),before);
  }
});
