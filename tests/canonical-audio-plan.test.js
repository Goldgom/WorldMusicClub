import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CanonicalSha256,canonicalFingerprint,canonicalUtf8} from '../web/canonical-audio-fingerprint.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY,CANONICAL_AUDIO_PROFILE,CANONICAL_AUDIO_BYTES_PER_NOTE,canonicalGateFrames,canonicalIdentity,createCanonicalAudioTransfer,openCanonicalAudioTransfer,validateCanonicalAudioPlan} from '../web/canonical-audio-plan.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const options={sampleRate:48000,mode:'practice',practiceSelection:{kind:'parts',part_ids:['人 手 🎹']},acceptedPolicyId:CANONICAL_AUDIO_POLICY};
const build=(f=fixture(),o={})=>buildCanonicalAudioPlan(f.compilation,f.profile,{...options,...o});

test('portable streaming SHA and Rust binary fingerprint share independent vectors',()=>{
 for(const n of [0,1,55,56,63,64,128,100000]){const b=Buffer.alloc(n,97),h=new CanonicalSha256();for(let i=0;i<n;i+=37)h.update(b.subarray(i,i+37));assert.equal(h.hex(),createHash('sha256').update(b).digest('hex'));}
 assert.equal(canonicalFingerprint('test',{'a':['x|y','z',1.25,-0],'🎼':'声\0部'}),'21449e031a49f3a7acfe1b2bbe1f4833711bd49e7bac3bc59623028c5d06d945');
 for(const s of ['abc','人 手 🎹','\0\u007f\u0080\u07ff\u0800\uffff\u{10ffff}'])assert.deepEqual(canonicalUtf8(s),new TextEncoder().encode(s));
 assert.throws(()=>canonicalUtf8('\ud800'));assert.throws(()=>canonicalFingerprint('a',['x'.repeat(100)],{maxBytes:20}));
 assert.notEqual(canonicalFingerprint('test',['a|b','c']),canonicalFingerprint('test',['a','b|c']));
});
test('Rust evidence preserves UTF8 identities, ties/repeat references and cross-part unisons',()=>{
 const f=fixture(),unchanged=JSON.stringify(f),p=build(f);
 assert.equal(p.sourceOccurrences,8);assert.equal(p.count,6);assert.equal(p.sourceNotes,7);assert.equal(p.durationFrames,192000);
 assert.equal(p.mapping.length,8);assert.ok(p.partIds.includes('空声部'));assert.ok(p.partIds.includes('休止声部'));
 const human=f.profile.occurrences.find(o=>o.part_index===0);assert.equal(human.source_indices.length,2);assert.equal(f.profile.source_note_ids[human.source_indices[0]],'起|\0');
 assert.equal(p.notes.filter(n=>n[1]===0&&n[3]===60).length,2,'Same-key machine parts are separate sounding voices');
 assert.deepEqual(canonicalIdentity(p,0).sourceNoteIds,['同音:一']);assert.equal(JSON.stringify(f),unchanged);
 assert.throws(()=>{p.notes[0][1]=42;},TypeError);assert.throws(()=>validateCanonicalAudioPlan(structuredClone(p)));
});
test('explicit one/many/all human ownership is separate from full source clock',()=>{
 const f=fixture();assert.throws(()=>build(f,{practiceSelection:undefined}));
 const many=build(f,{practiceSelection:{kind:'parts',part_ids:['机 器/一','人 手 🎹']}});assert.equal(many.count,2);
 const reordered=build(f,{practiceSelection:{kind:'parts',part_ids:['人 手 🎹','机 器/一']}});assert.equal(many.planFingerprint,reordered.planFingerprint);
 const all=build(f,{practiceSelection:{kind:'all'}});assert.equal(all.count,0);assert.equal(all.durationFrames,build(f).durationFrames);assert.equal(all.sourceOccurrences,8);
 const silent=build(f,{practiceSelection:{kind:'parts',part_ids:['空声部','休止声部']}});assert.equal(silent.count,8);
 assert.equal(build(f,{mode:'listen',practiceSelection:undefined}).count,8);
 assert.notEqual(build(f).selectionFingerprint,all.selectionFingerprint);
});
test('sample quantization is explicitly compiled milliseconds and every positive gate survives',()=>{
 assert.deepEqual(canonicalGateFrames(1000,0.0005,48000),[48000,48001]);assert.deepEqual(canonicalGateFrames(0.001,0.001,8000),[0,1]);
 for(const args of [[-1,1,48000],[0,0,48000],[1e20,1,48000],[0,1,7]])assert.throws(()=>canonicalGateFrames(...args));
 const p=build();assert.equal(p.notes.filter(n=>n[2]-n[1]===1).length,2);
});
test('full source, timing, opaque identity, selection, and policy mismatches fail before transfer',()=>{
 for(const mutate of [f=>f.compilation.score.title+='changed',f=>f.compilation.timeline.notes[0].duration_ms++,f=>f.profile.occurrences[0].id+='changed',f=>f.profile.source_note_ids.reverse(),f=>f.profile.duration_ms++,f=>f.profile.source_references++]){const f=fixture();mutate(f);assert.throws(()=>build(f));}
 assert.throws(()=>build(fixture(),{acceptedPolicyId:undefined}),{code:'reference_policy_required'});
 assert.throws(()=>build(fixture(),{practiceSelection:{kind:'parts',part_ids:['absent']}}));
 const packed=createCanonicalAudioTransfer(build());assert.throws(()=>openCanonicalAudioTransfer(packed.wire,44100));
 assert.equal(packed.transfer.reduce((n,b)=>n+b.byteLength,0),CANONICAL_AUDIO_BYTES_PER_NOTE*6);
 const aliased={...packed.wire,buffers:{...packed.wire.buffers,ends:packed.wire.buffers.starts}};assert.throws(()=>openCanonicalAudioTransfer(aliased,48000));
 assert.throws(()=>openCanonicalAudioTransfer({...packed.wire,count:100001},48000));
});

test('128-voice frame budget is whole-plan admission, never a dropped unison',()=>{
 const f=capacityEvidence({count:129,voices:129});assert.throws(()=>build(f,{practiceSelection:{kind:'parts',part_ids:['human']}}),{code:'voice_budget_exceeded'});
 const all=build(f,{practiceSelection:{kind:'all'}});assert.equal(all.count,0);assert.equal(all.sourceOccurrences,129);
});

test('100k complete source and occurrence rows and 1m references are admitted without truncation',()=>{
 const before=process.memoryUsage().heapUsed;
 for(const references of [100000,1000000]){
  const f=capacityEvidence({count:100000,references}),p=build(f,{practiceSelection:{kind:'parts',part_ids:['human']}});
  assert.equal(p.count,100000);assert.equal(p.sourceOccurrences,100000);assert.equal(p.sourceReferences,references);assert.equal(p.mapping.length,100000);
  const packed=createCanonicalAudioTransfer(p);assert.equal(packed.transfer.reduce((sum,b)=>sum+b.byteLength,0),100000*CANONICAL_AUDIO_BYTES_PER_NOTE);
  const wire=openCanonicalAudioTransfer(packed.wire,48000);assert.equal(wire.occurrences[99999],99999);
  f.profile.source_references=1000001;assert.throws(()=>build(f,{practiceSelection:{kind:'all'}}),{code:'canonical_audio_budget'});
 }
 console.log(JSON.stringify({evidence:'canonical-host-capacity-development',heapBefore:before,heapAfter:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss,wireBytes:100000*CANONICAL_AUDIO_BYTES_PER_NOTE}));
});

test('per-part synthetic overrides bind renderer selection while preserving source and gate identity',()=>{
 const f=fixture(),before=JSON.stringify(f),baseline=build(f),empty=build(f,{instrumentOverrides:{},mutedPartIds:[]});
 assert.equal(baseline.planFingerprint,'533bd691f576646ac8571a587340c522ea34c0843d9aed142029ad811cfc9612','Unmodified canonical reference retains its established fingerprint');
 assert.equal(empty.planFingerprint,baseline.planFingerprint);assert.equal(empty.synthesisPolicyId,undefined);assert.equal(createCanonicalAudioTransfer(empty).wire.buffers.instruments,undefined);
 const overrides={'机器二':'reed','机 器/一':'triangle','人 手 🎹':'sine'},p=build(f,{instrumentOverrides:overrides});
 const reordered=build(f,{instrumentOverrides:{'人 手 🎹':'sine','机 器/一':'triangle','机器二':'reed'}});
 assert.equal(p.planFingerprint,reordered.planFingerprint);assert.notEqual(p.selectionFingerprint,baseline.selectionFingerprint);assert.notEqual(p.planFingerprint,baseline.planFingerprint);
 assert.deepEqual(p.notes,baseline.notes);assert.deepEqual(p.mapping,baseline.mapping);assert.equal(p.sourceFingerprint,baseline.sourceFingerprint);assert.equal(p.compiledFingerprint,baseline.compiledFingerprint);assert.equal(p.policyId,baseline.policyId);
 assert.deepEqual(p.instruments,p.notes.map((_,i)=>canonicalIdentity(p,i).partId==='机 器/一'?1:2));
 const packed=createCanonicalAudioTransfer(p),wire=openCanonicalAudioTransfer(packed.wire,48000);assert.deepEqual([...wire.instruments],p.instruments);assert.equal(packed.transfer.reduce((n,b)=>n+b.byteLength,0),(CANONICAL_AUDIO_BYTES_PER_NOTE+1)*p.count);
 overrides['机器二']='sine';assert.equal(p.instrumentOverrides['机器二'],'reed');assert.throws(()=>{p.instruments[0]=0;},TypeError);assert.equal(JSON.stringify(f),before);
});

test('muted machine parts leave source clock, human selection, identities and audible subset independent',()=>{
 const f=fixture(),base=build(f),muted=build(f,{mutedPartIds:['机器二']}),listen=build(f,{mode:'listen',audiblePartIds:['人 手 🎹','机器二'],mutedPartIds:['机器二']});
 assert.equal(muted.count,4);assert.equal(listen.count,2);assert.ok(muted.notes.every((_,i)=>canonicalIdentity(muted,i).partId==='机 器/一'));assert.ok(listen.notes.every((_,i)=>canonicalIdentity(listen,i).partId==='人 手 🎹'));
 assert.deepEqual(muted.selection,base.selection);assert.equal(muted.durationFrames,base.durationFrames);assert.equal(muted.sourceOccurrences,base.sourceOccurrences);assert.equal(muted.sourceFingerprint,base.sourceFingerprint);assert.notEqual(muted.selectionFingerprint,base.selectionFingerprint);
 const all=build(f,{mutedPartIds:f.profile.part_ids});assert.equal(all.count,0);assert.equal(all.durationFrames,base.durationFrames);
 const reordered=build(f,{mutedPartIds:[...f.profile.part_ids].reverse()});assert.equal(all.planFingerprint,reordered.planFingerprint);
});

test('unknown instrument or mute selections and unsupported transfer policy fail explicitly',()=>{
 for(const instrumentOverrides of [null,[],{absent:'sine'},{'机 器/一':'source'},{'机 器/一':'piano'},{'机 器/一':0},Object.create({'机 器/一':'reed'}),Object.defineProperty({},'机 器/一',{get:()=>{throw Error('Do not invoke a selection getter');},enumerable:true})])assert.throws(()=>build(fixture(),{instrumentOverrides}),{code:'invalid_canonical_audio_plan'});
 for(const mutedPartIds of [null,'机器二',['absent'],['机器二','机器二'],Array(1)])assert.throws(()=>build(fixture(),{mutedPartIds}),{code:'invalid_canonical_audio_plan'});
 const packed=createCanonicalAudioTransfer(build(fixture(),{instrumentOverrides:{'机 器/一':'reed'}}));
 for(const synthesisPolicyId of [undefined,null,'unknown'])assert.throws(()=>openCanonicalAudioTransfer({...packed.wire,synthesisPolicyId},48000),{code:'invalid_canonical_audio_plan'});
 const noInstruments={...packed.wire,buffers:{...packed.wire.buffers}};delete noInstruments.buffers.instruments;assert.throws(()=>openCanonicalAudioTransfer(noInstruments,48000));
 for(const field of ['timbres','triangles','instrumentOverrides'])assert.throws(()=>openCanonicalAudioTransfer({...packed.wire,[field]:new Uint8Array(packed.wire.count)},48000),{code:'invalid_canonical_audio_plan'});
});
