import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateDirectMidiMachineIsolation} from '../scripts/hosted-midi-direct-import-check.mjs';
test('hosted machine-only audio cannot pass with human input, a scored take or assessment',()=>{
 const good={mode:'listen',captured:'0',export_disabled:true,assess_disabled:true,assessment_requests:0};
 assert.deepEqual(validateDirectMidiMachineIsolation(good),good);
 for(const [field,value] of [['mode','practice'],['captured','1'],['export_disabled',false],['assess_disabled',false],['assessment_requests',1]])assert.throws(()=>validateDirectMidiMachineIsolation({...good,[field]:value}));
});
test('hosted native driver checks its compiled source and its own executable hash',async()=>{
 const source=await readFile(new URL('../scripts/hosted-midi-direct-import-check.mjs',import.meta.url),'utf8');
 assert.match(source,/build_identity\.compiled\.source_sha,head/);assert.match(source,/build_identity\.compiled\.source_tree,report\.source_tree/);assert.match(source,/build_identity\.native\.executable_sha256,report\.driver_sha256/);
 assert.ok(source.indexOf('machineApiStart=session.profile.api.length')<source.indexOf("await startSongModPerformance(session.page,{performers:'none'"));
 assert.match(source,/api\.slice\(machineApiStart\)\.filter\(row=>row\.path==='\/api\/assess'\)/);
});
