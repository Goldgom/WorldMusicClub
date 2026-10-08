import {withMockBasicEligibility} from './basic-human-admission-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding} from '../web/practice-assistance-receipt.js';
// Native-generated override fixtures are tested verbatim. Committed legacy
// Basic fixture policy additions are explicitly mocked for consumer coverage.
const root=process.env.WMC_ASSISTANCE_FIXTURE_DIR||fileURLToPath(new URL('./fixtures/',import.meta.url));
for(const name of ['native-basic','native-vsq','canonical'])test(`${name} receipt consumer boundary admits without changing source clocks, gates, IDs or coverage`,()=>{
 const original=JSON.parse(readFileSync(join(root,`assistance-${name}.json`),'utf8'));
 const fixture=process.env.WMC_ASSISTANCE_FIXTURE_DIR?original:withMockBasicEligibility(original);
 for(const [label,response] of Object.entries(fixture)){
  if(!response?.checked)continue;const {plan}=response.checked,before=structuredClone(response),sourceToken={},runtimeToken={};
  const binding={source:name==='canonical'?null:response.source,selection:plan.selection,mode:plan.mode,settings:plan.settings,revision:plan.revision,sourceToken,runtimeToken};
  const admitted=admitPracticeAssistance(response,binding);assert.deepEqual(admitted,response.checked,label);assert.deepEqual(response,before,label);assert.equal(assertPracticeAssistanceCurrent(admitted,practiceAssistanceBinding(admitted)),admitted);
  assert.throws(()=>assertPracticeAssistanceCurrent(admitted,{...binding,runtimeToken:{}}),/stale/);
  assert.equal(admitted.coverage.human_occurrence_count+admitted.machine_occurrence_ids.length,admitted.coverage.occurrence_count);
  if(!admitted.human_targets.target_count)assert.equal(admitted.scored_mode_allowed,false);
 }
});
