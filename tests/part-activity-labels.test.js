import test from 'node:test';
import assert from 'node:assert/strict';
import {partActivitySourceLabels} from '../web/part-activity-labels.js';
import {captureCanonicalActivityAdmission,canonicalActivityPlayback} from '../web/part-activity-playback.js';
import {canonicalFingerprint} from '../web/canonical-audio-fingerprint.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY,CANONICAL_AUDIO_PROFILE} from '../web/canonical-audio-plan.js';

test('source labels require unique exact IDs, never positions, instruments or duplicate-name uniqueness',()=>{
 const source=[{id:'b',name:'Same name'},{id:'a',name:'Same name'},{id:'c',name:'',label:'Source label'},{id:'d',name:' \t '},{id:'e',name:42},{id:'f',name:'First'},{id:'f',name:'First'},{id:'f',name:'Third'},{id:'g',name:{toString(){throw Error('No coercion');}}},{id:'h',program:1,channel:2},{part_id:'i',name:'Wrong field'}];
 const labels=partActivitySourceLabels(source);
 assert.deepEqual([...labels],[['b','Same name'],['a','Same name'],['c','Source label']]);
 for(const id of ['missing','A',' a','d','e','f','g','h','i'])assert.equal(labels.get(id)??id,id);
 for(const value of [null,undefined,{},Array.from({length:129},(_,i)=>({id:String(i),name:'Over bound'}))])assert.equal(partActivitySourceLabels(value).size,0);
});

for(const name of ['Authored part','<img src=x onerror=alert(1)>\u202e'+'x'.repeat(500),undefined,'   '])test(`canonical facade uses source name or exact raw ID (${String(name).slice(0,30)})`,()=>{
 const {compilation,profile}=capacityEvidence({count:4}),part=compilation.score.parts[1];
 if(name===undefined)delete part.name;else part.name=name;
 profile.source_fingerprint=canonicalFingerprint('wmh-canonical-score-v1',compilation.score);
 delete profile.compiled_fingerprint;profile.compiled_fingerprint=canonicalFingerprint(CANONICAL_AUDIO_PROFILE,profile);
 const before=structuredClone(compilation),plan=buildCanonicalAudioPlan(compilation,profile,{sampleRate:48000,acceptedPolicyId:CANONICAL_AUDIO_POLICY,mode:'listen'});
 const session={compilation,plan,epoch:1,player:{running:true,context:{state:'running'}},interpretation:{sound_enabled:true}};
 captureCanonicalActivityAdmission(session);
 const value=canonicalActivityPlayback(session,{positionMs:0,transport:'running',sourceClock:{positionMs:0}});
 assert.equal(value.status,'ready');assert.equal(value.snapshot.parts[0].label,typeof name==='string'&&name.trim()?name:part.id);
 assert.equal(value.snapshot.gates.length,4);assert.equal(session.plan,plan);assert.deepEqual(compilation,before);
});
