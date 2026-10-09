import test from 'node:test';
import assert from 'node:assert/strict';
import {basicKeyRenditionFixture,basicKeySong} from './basic-key-rendition-fixtures.js';
import {withMockBasicEligibility,mockBasicPracticeAdmission} from './basic-human-admission-fixtures.js';
import {createBasicPracticeAdmissionBinding,createBasicPracticeAdmissionRequest,admitBasicPractice,assertBasicPracticeCurrent} from '../web/basic-practice-admission.js';
import {runtimeReceiptFields,sourceEligibilitySummary} from '../web/source-practice-eligibility.js';
import {basicKeysParts,prepareCleanSong} from '../web/clean-song-package.js';
import {ScorePreview} from '../web/score-preview.js';
import {defaultSongMod,SongModStore,createSongMod} from '../web/song-mod.js';

// Deliberately mocked transport DTOs around the real consumer. This exercises
// renderer admission, not Rust execution, instrument inference or browser QA.
function setup(){
  const opened=withMockBasicEligibility(basicKeyRenditionFixture()),d=opened.clean_package,song=prepareCleanSong(`native:song-${d.content_sha256}`,d,JSON.parse(d.score_json).notation);
  const value={cleanSong:song,compiled:song.compilation,score:song.compilation.score};
  const options={selection:{kind:'all',part_ids:song.notation.parts.map(p=>p.id)},profile:{kind:'piano',key_count:88,lowest_midi:21},intentToken:{},sessionToken:{}};
  const request=createBasicPracticeAdmissionRequest(value,options),response=mockBasicPracticeAdmission(request.body,opened);
  return {opened,value,options,request,response};
}
test('Basic Human admission binds native source, explicit pitch, device and every original attack',()=>{
  const {value,options,request,response}=setup();
  assert.equal(request.path,'/api/library/practice-admission');assert.deepEqual(Object.keys(request.body).sort(),['pitch_mod','selection','source']);
  assert.deepEqual(request.body.pitch_mod,{format:'wmc-pitch-mod',version:1,semitones:0});assert.deepEqual(request.body.selection.profile,options.profile);
  const admission=admitBasicPractice(response,request.binding);assert.ok(Object.isFrozen(admission));assert.ok(Object.isFrozen(admission.checked));
  assert.equal(admission.checked.coverage.source_unit_count,value.cleanSong.coverage.key_attacks);assert.equal(assertBasicPracticeCurrent(admission,createBasicPracticeAdmissionRequest(value,options).binding),admission);
  assert.throws(()=>assertBasicPracticeCurrent(structuredClone(admission),request.binding),/missing or stale/);
  for(const change of [{intentToken:{}},{sessionToken:{}},{profile:{kind:'piano',key_count:61,lowest_midi:36}},{selection:{kind:'parts',part_ids:[value.score.parts[0].id]}}])assert.throws(()=>assertBasicPracticeCurrent(admission,createBasicPracticeAdmissionRequest(value,{...options,...change}).binding),/missing or stale/);
  assert.throws(()=>createBasicPracticeAdmissionRequest({...value,compiled:structuredClone(value.compiled)},options),/current saved Basic/);
});
test('missing, stale, wrong-domain or incomplete native Basic receipt never grants Human authority',()=>{
  const {request,response}=setup();
  for(const change of [
    r=>delete r.checked.receipt.source_eligibility,
    r=>r.checked.receipt.source_eligibility.identity_table_revision='future',
    r=>r.checked.receipt.source_eligibility.source_binding.domain='wmc-basic-complete-serde-json',
    r=>r.checked.receipt.source_eligibility.fingerprint='e'.repeat(64),
    r=>r.checked.source_ownership.pop(),
    r=>r.checked.human_targets.timeline.notes[0].midi++,
    r=>r.source.content_sha256='f'.repeat(64),
  ]){const copy=structuredClone(response);change(copy);assert.throws(()=>admitBasicPractice(copy,request.binding));}
  const old=structuredClone(response.checked.receipt);delete old.source_eligibility;assert.equal(runtimeReceiptFields(old,'wmh-basic-keys-midi1-v1'),false);
});
test('source occurrence inventory remains separate from grouped physical strike count',()=>{
  const {request,response}=setup();
  assert.equal(response.checked.coverage.source_unit_count,5);
  assert.equal(response.checked.coverage.occurrence_count,5);
  // Coverage is checked against source units, never against target/group count.
  const missing=structuredClone(response);missing.checked.coverage.source_unit_count=missing.checked.human_targets.target_count-1;
  assert.throws(()=>admitBasicPractice(missing,request.binding));
});
function blockedSong({all=false,unavailable=false}={}){
  return basicKeySong(d=>{
    if(unavailable){d.runtime.source_eligibility={status:'unavailable',code:'practice_source_eligibility_unavailable',message:'Unavailable'};return;}
    const summary=d.runtime.source_eligibility;
    for(const [index,part]of summary.parts.entries())if(all||index===0){part.known_unsupported_count=part.attack_count;part.unresolved_count=0;}
    summary.known_unsupported_count=summary.parts.reduce((n,p)=>n+p.known_unsupported_count,0);summary.unresolved_count=summary.parts.reduce((n,p)=>n+p.unresolved_count,0);
  });
}
test('fresh Basic defaults choose first wholly eligible part in source order; unknown-only remains eligible',async()=>{
  const song=blockedSong(),preview=new ScorePreview({compile:()=>assert.fail(),check:async()=>({status:'ready'})});
  await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}));
  assert.equal(preview.value.part,basicKeysParts(song).find(part=>part.original_practice_available).id);assert.equal(preview.value.defaultListen,false);
  assert.ok(basicKeysParts(song).filter(p=>p.original_practice_available).every(p=>p.source_eligibility.unresolved_count>0));
});
test('fresh blocked or unavailable Basic defaults to all-Machine Listen without changing notes',async()=>{
  for(const options of [{all:true},{unavailable:true}]){
    const song=blockedSong(options),before=song.score_json,preview=new ScorePreview({compile:()=>assert.fail(),check:async()=>({status:'blocked'})});
    await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}));
    assert.equal(preview.value.defaultListen,true);assert.equal(preview.canStart('practice'),false);assert.equal(preview.canStart('listen'),true);
    assert.ok(defaultSongMod(preview.value).config.parts.every(part=>part.performer==='machine'));assert.equal(song.score_json,before);assert.equal(song.compilation.timeline.notes.length,song.coverage.key_attacks);
  }
});
test('incompatible saved preferences survive new safe defaults unchanged',async()=>{
  const song=blockedSong({all:true}),value={score:song.notation,compiled:song.compilation,cleanSong:song,defaultListen:true},values=new Map(),store=new SongModStore({storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
  const base=store.read(value),human=createSongMod(base.mod,{...base.mod.config,parts:base.mod.config.parts.map(p=>({...p,performer:'human'}))});store.save(value,human);
  const before=[...values],freshStore=new SongModStore({storage:{getItem:key=>values.get(key)??null}}),entry=freshStore.read(value);
  assert.deepEqual(entry.mod,human);assert.equal(entry.explicit,true);assert.ok(entry.original.config.parts.every(part=>part.performer==='machine'));assert.deepEqual([...values],before);
});
test('summary validation fails closed on partial counts but never mutates listening runtime',()=>{
  const {value}=setup(),song=value.cleanSong;assert.ok(sourceEligibilitySummary(song.runtime,song.score.performance.parts));
  for(const mutate of [r=>delete r.source_eligibility,r=>r.source_eligibility.parts.pop(),r=>r.source_eligibility.known_unsupported_count++,r=>r.source_eligibility.receipt.revision++]){const runtime=structuredClone(song.runtime),timeline=JSON.stringify(runtime.compilation.timeline);mutate(runtime);assert.equal(sourceEligibilitySummary(runtime,song.score.performance.parts),null);assert.equal(JSON.stringify(runtime.compilation.timeline),timeline);}
});

test('optional summary size fallback does not invalidate an otherwise exact native pitch projection',async()=>{
  const {readFileSync}=await import('node:fs'),{preparePitchModView}=await import('../web/pitch-mod.js');
  const vector=withMockBasicEligibility(JSON.parse(readFileSync(new URL('./fixtures/pitch-mod-handler-vectors.json',import.meta.url),'utf8'))).vectors.basic;
  for(const omit of ['original','projected']){
    const v=structuredClone(vector),d=v.original.opened.clean_package;
    if(omit==='original')delete d.runtime.source_eligibility;else delete v.plus2.runtime.source_eligibility;
    const song=prepareCleanSong(`native:song-${d.content_sha256}`,d,JSON.parse(d.score_json).notation),value={score:song.compilation.score,compiled:song.compilation,cleanSong:song};
    const view=await preparePitchModView(value,2,{api:async()=>v.plus2});
    assert.equal(view.receipt.source_eligibility.eligibility_policy_id,'wmc-basic-known-unsupported-human-exclusion-v1');
    assert.deepEqual(view.cleanSong.runtime.source_eligibility,song.runtime.source_eligibility);assert.equal(view.cleanSong.score_json,song.score_json);
  }
});


test('hot-path current bindings do not serialize or clone complete checked assignment plans',()=>{
  const {value,options,request,response}=setup(),admission=admitBasicPractice(response,request.binding),clone=globalThis.structuredClone;
  try{
    globalThis.structuredClone=(value,...args)=>{assert.notEqual(value,admission.checked.plan,'The input path must not clone the complete assignment');return clone(value,...args);};
    const binding=createBasicPracticeAdmissionBinding(value,{...options,assistance:admission.checked});assert.equal(binding.assistance,admission.checked);
  }finally{globalThis.structuredClone=clone;}
});

test('a complete archived v1 response remains usable when the same saved source receives fresh native proof',async()=>{
  const {readFileSync}=await import('node:fs'),read=name=>JSON.parse(readFileSync(new URL(`./fixtures/song-authoring/${name}.json`,import.meta.url),'utf8'));
  const draft=read('basic-key-response'),score=JSON.parse(draft.package.score_json),identity='a'.repeat(64);
  const opened=withMockBasicEligibility({clean_package:{...draft.package,version:2,content_sha256:identity,profile:'wmh-basic-keys-midi1-v1',capabilities:score.capabilities,coverage:score.coverage,notation_available:true,media:[],runtime:read('basic-key-runtime')}});
  const descriptor=opened.clean_package,song=prepareCleanSong(`native:song-${identity}`,descriptor,score.notation),value={score:song.compilation.score,compiled:song.compilation,cleanSong:song};
  const current=withMockBasicEligibility({...opened,clean_package:{...descriptor,runtime:read('basic-key-rendition-runtime')}});
  assert.equal(song.runtime.profile,'wmh-basic-key-practice-v1');assert.equal(current.clean_package.runtime.profile,'wmh-basic-key-practice-v2');assert.equal(current.clean_package.score_json,song.score_json);
  const request=createBasicPracticeAdmissionRequest(value,{selection:{kind:'all',part_ids:score.notation.parts.map(p=>p.id)},profile:{kind:'piano',key_count:88,lowest_midi:21},intentToken:{},sessionToken:{}});
  const admission=admitBasicPractice(mockBasicPracticeAdmission(request.body,current),request.binding);
  assert.equal(admission.checked.coverage.source_unit_count,3);assert.equal(admission.checked.scored_mode_allowed,true);assert.equal(song.score_json,opened.clean_package.score_json);
});
