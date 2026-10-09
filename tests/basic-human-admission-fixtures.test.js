import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMockBasicEligibility,mockBasicPracticeAdmission} from './basic-human-admission-fixtures.js';
import {validSourceEligibilityReceipt,sourceEligibilitySummary} from '../web/source-practice-eligibility.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {nativeScoreServer} from './native-storage-app-fixtures.js';
import {createBasicPracticeAdmissionRequest,admitBasicPractice} from '../web/basic-practice-admission.js';

const legacy=()=>JSON.parse(readFileSync(new URL('./fixtures/assistance-native-basic.json',import.meta.url),'utf8'));
const fixture=()=>withMockBasicEligibility(legacy());
function request(f){
  const descriptor=f.opened.clean_package,song=prepareCleanSong(`native:${f.source.key}`,descriptor,JSON.parse(f.opened.score_json));
  return createBasicPracticeAdmissionRequest({score:song.compilation.score,compiled:song.compilation,cleanSong:song},{selection:{part_ids:f.original.checked.plan.selection.selected_part_ids},profile:f.original.checked.plan.selection.profile,intentToken:{},sessionToken:{}});
}

test('mock Basic policy migration preserves legacy bytes and adds matching unresolved protocol fields',()=>{
  const original=legacy(),before=structuredClone(original),adapted=withMockBasicEligibility(original),summary=adapted.opened.clean_package.runtime.source_eligibility;
  assert.deepEqual(original,before,'The legacy Rust golden DTO is not mutated');
  assert.equal(adapted.opened.clean_package.score_json,original.opened.clean_package.score_json);
  assert.deepEqual(adapted.opened.clean_package.runtime.compilation,original.opened.clean_package.runtime.compilation);
  assert.ok(validSourceEligibilityReceipt(summary.receipt));
  assert.equal(sourceEligibilitySummary(adapted.opened.clean_package.runtime,adapted.opened.clean_package.runtime.parts),summary);
  assert.equal(summary.known_unsupported_count,0);assert.equal(summary.unresolved_count,summary.complete_attack_count);
  for(const key of ['original','automatic','explicit']){
    assert.deepEqual(adapted[key].checked.receipt.source_eligibility,summary.receipt);
    const {source_eligibility,...receipt}=adapted[key].checked.receipt;
    assert.deepEqual(receipt,original[key].checked.receipt);
    assert.notEqual(source_eligibility.source_binding.digest,receipt.source_binding.digest);
    assert.notEqual(source_eligibility.fingerprint,source_eligibility.source_binding.digest);
  }
});

test('mock migration preserves an explicit unavailable or malformed policy field instead of repairing it',()=>{
  const input=legacy();input.opened.clean_package.runtime.source_eligibility={status:'unavailable'};input.original.checked.receipt.source_eligibility={revision:99};
  const result=withMockBasicEligibility(input);
  assert.deepEqual(result.opened.clean_package.runtime.source_eligibility,{status:'unavailable'});
  assert.deepEqual(result.original.checked.receipt.source_eligibility,{revision:99});
  assert.equal(sourceEligibilitySummary(result.opened.clean_package.runtime,result.opened.clean_package.runtime.parts),null);
});

test('mock strict native admission supplies complete checked ownership to the production consumer',()=>{
  const f=fixture(),r=request(f),response=mockBasicPracticeAdmission(r.body,f.opened),admitted=admitBasicPractice(response,r.binding);
  assert.deepEqual(admitted.checked,response.checked);
  assert.equal(response.checked.coverage.occurrence_count,f.opened.clean_package.runtime.rendition.coverage.source_attacks);
  assert.deepEqual(response.checked.receipt.source_eligibility,f.opened.clean_package.runtime.source_eligibility.receipt);
  assert.deepEqual(response.checked.human_targets.timeline.notes,f.original.checked.human_targets.timeline.notes);
});

test('mock native route rejects extra frontend authority, invalid descriptors and unchecked saved plans',()=>{
  const f=fixture(),r=request(f);
  for(const mutate of [body=>body.timeline={},body=>body.score={},body=>body.source.key='song-'+'0'.repeat(64),body=>delete body.pitch_mod,body=>body.pitch_mod.semitones=13,body=>body.selection.selected_part_ids=['foreign'],body=>body.plan=f.original.checked.plan]){
    const body=structuredClone(r.body);mutate(body);assert.throws(()=>mockBasicPracticeAdmission(body,f.opened));
  }
  const body={...r.body,plan:f.original.checked.plan},response=mockBasicPracticeAdmission(body,f.opened,{checkedResponses:[f.original]});
  assert.deepEqual(response,f.original,'Only a prior explicitly supplied mock checked plan can be replayed');
  const unavailable=structuredClone(f.opened);unavailable.clean_package.runtime.source_eligibility={status:'unavailable'};assert.throws(()=>mockBasicPracticeAdmission(r.body,unavailable),/unavailable/);
  const known=structuredClone(f.opened);known.clean_package.runtime.source_eligibility.known_unsupported_count=1;assert.throws(()=>mockBasicPracticeAdmission(r.body,known),/must not authorize/);
});


test('native transport fixture checks POST and supports explicit absent-field rejection scenarios',async()=>{
  const original=legacy(),server=await nativeScoreServer({mockLegacyBasicEligibility:false});server.records.set(original.source.key,original.opened);
  const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const loaded=await(await server.fetcher('/api/library/load',post({key:original.source.key}))).json();
  assert.equal(Object.hasOwn(loaded.clean_package.runtime,'source_eligibility'),false,'The missing-field scenario remains untouched');
  assert.equal((await server.fetcher('/api/library/practice-admission')).status,405);
  const f=fixture(),body=request(f).body;
  const response=await server.fetcher('/api/library/practice-admission',post(body));assert.equal(response.status,200);assert.ok(validSourceEligibilityReceipt((await response.json()).checked.receipt.source_eligibility));
  const malformed=await server.fetcher('/api/library/practice-admission',post({...body,timeline:{notes:[]}}));assert.equal(malformed.status,422);
  assert.deepEqual(server.records.get(original.source.key),original.opened,'The in-memory saved source also stays unchanged');
});
