import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalProbeScore,validateCanonicalHostedCase} from '../scripts/canonical-hosted-proof.mjs';

function evidence({seconds=2,practice=false,stall=false}={}){
 const sampleRate=48000,anchorFrame=2400,parts=practice?[1,2]:[0,1,2],rows=[];
 for(const p of parts)for(let n=0;n<seconds*16;n++)rows.push({partId:`original-part-${p}`,sourceNoteIds:[`original-${p}-${n}`],startFrame:n*3000,endFrame:(n+1)*3000,actualStartFrame:anchorFrame+n*3000,actualEndFrame:anchorFrame+(n+1)*3000});
 const pcm=Array.from({length:Math.ceil((seconds*sampleRate+anchorFrame)/4096)},(_,n)=>({firstFrame:n*4096,frames:4096,trusted:true,nativeMessage:true,energy:1,peak:.1,nonzeroSamples:4094,maxZeroRun:1}));
 return {ok:true,errors:[],seconds,practice,sampleRate,clockEndMs:seconds*1000,compiledNotes:seconds*48,rows,terminal:{started:rows.length,ended:rows.length,skipped:0},anchorFrame,messages:['started','ended'].map(type=>({type,trusted:true,nativeMessage:true,nativePort:true})),graph:{nativeNode:true,nativeContext:true,connectedToDestination:true},pcm,stalls:stall?[{wallStart:5000,wallEnd:6200,audioStart:5,audioEnd:6.2},{wallStart:25000,wallEnd:26200,audioStart:25,audioEnd:26.2}]:[],assessmentRequests:0,physicalListening:false};
}
test('authored probe has complete distinct three-part C/E/G timing and no source files',()=>{
 const s=canonicalProbeScore();assert.equal(s.parts.length,3);assert.equal(s.parts.flatMap(p=>p.notes).length,2304);assert.equal(s.measures.length,24);assert.equal(s.source,null);assert.equal(s.provenance.kind,'original');assert.equal(s.provenance.license,'CC0-1.0');assert.equal(new Set(s.parts.flatMap(p=>p.notes.map(n=>n.id))).size,2304);assert.throws(()=>canonicalProbeScore({seconds:49}));
});
test('probe verifier independently requires complete source gates and continuous genuine PCM',()=>{
 const spec={seconds:48,practice:true,stall:true},good=evidence(spec);assert.equal(validateCanonicalHostedCase(good,spec).machineNotes,1536);
 for(const mutate of [r=>r.rows.pop(),r=>r.rows[0].actualStartFrame++,r=>r.rows[0].sourceNoteIds=['original-0-0'],r=>r.terminal.skipped++,r=>r.pcm.splice(10,1),r=>r.pcm.splice(0,3),r=>r.pcm.splice(-2,2),r=>r.pcm[10].frames=4095,r=>r.pcm[10].energy=0,r=>r.pcm[10].nonzeroSamples=1,r=>r.pcm[10].maxZeroRun=9,r=>r.messages[0].trusted=false,r=>r.assessmentRequests++,r=>r.stalls[0].wallEnd=1000,r=>r.stalls[0].audioEnd=r.stalls[0].audioStart+.001,r=>{r.stalls[0].audioStart=-2;r.stalls[0].audioEnd=-.8;}]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateCanonicalHostedCase(bad,spec));}
 const base={seconds:2,practice:false,stall:false};assert.equal(validateCanonicalHostedCase(evidence(base),base).machineNotes,96);
});
