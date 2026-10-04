import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateAudioThreadRuns} from './audio-thread-rendition-proof.mjs';

// Acceptance reads retained Rust rationals directly. Never call the production
// plan builder or convert through rounded millisecond projections here.
export const VSQ_AUDIO_POLICY = 'wmh-vsq-base-note-reference-v1';
export const VSQ_AUDIO_IDENTITY = 'vsq-authored-note';
export const VSQ_TRIANGLE_RECIPE = 'wmh-vsq-bandlimited-triangle-1024-v1';
function frame(time, sampleRate, ceil = false) {
 assert.match(time.numerator,/^(0|[1-9][0-9]*)$/);assert.ok(Number.isSafeInteger(time.denominator)&&time.denominator>0);
 const numerator=BigInt(time.numerator)*BigInt(sampleRate),denominator=BigInt(time.denominator)*1000000n;
 return Number((numerator+(ceil?denominator-1n:0n))/denominator);
}
export function vsqAudioSourceNotes(response,{mode='listen',targetPart=null,mutedParts=[],soloParts=[],instrument='piano'}={}) {
 const runtime=response.runtime;assert.equal(runtime.profile,'wmh-vsq-base-note-practice-v1');assert.equal(runtime.choice,'base_notes_instrumental');assert.equal(response.reference_velocity,90);assert.ok(['piano','guitar'].includes(instrument));assert.ok(['listen','practice'].includes(mode));
 if(mode==='practice')assert.ok(runtime.parts.some(part=>part.part_id===targetPart));
 const muted=new Set(mutedParts),solo=new Set(soloParts);
 return runtime.notes.filter(note=>!muted.has(note.part_id)&&(!solo.size||solo.has(note.part_id))&&(mode!=='practice'||note.part_id!==targetPart)).map(note=>({...note,noteId:note.note_id,eventId:`vsq:${runtime.source_sha256}:t${note.source_track_index}:${note.authored_note_id}`,velocity:90,role:instrument==='piano'?2:3}));
}
export function expectedVsqAudioPlan(notes,{sourceSha256,sampleRate,sourceNotes=notes.length,endMicroseconds}) {
 assert.match(sourceSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(sampleRate)&&sampleRate>=8000&&sampleRate<=384000);
 return {protocol:'wmh-basic-key-audio-v1',policyId:VSQ_AUDIO_POLICY,identityKind:VSQ_AUDIO_IDENTITY,sourceSha256,sampleRate,durationFrames:frame(endMicroseconds,sampleRate,true),sourceNotes,notes:notes.map(note=>[note.noteId,note.eventId,frame(note.start_microseconds,sampleRate),frame(note.end_microseconds,sampleRate,true),note.key,90,note.role]).sort((a,b)=>a[2]-b[2])};
}
// Independent procedural recipe inventory: generated in verifier memory once
// per device rate. Reports retain only its SHA-256 and fixed shape, never 128
// tables for each receiver. Float32 accumulation is part of the declared recipe.
const tableHashes=new Map();
export function expectedVsqTriangleHash(sampleRate) {
 if(tableHashes.has(sampleRate))return tableHashes.get(sampleRate);
 const table=new Float32Array(128*1024);
 for(let key=0;key<128;key++){
  const frequency=440*Math.pow(2,(key-69)/12),limit=Math.min(511,Math.ceil(sampleRate/(frequency*2))-1);
  for(let harmonic=1;harmonic<=limit;harmonic+=2){
   const coefficient=8/(Math.PI*Math.PI)*(harmonic%4===1?1:-1)/(harmonic*harmonic);
   for(let point=0;point<1024;point++)table[key*1024+point]+=coefficient*Math.sin(2*Math.PI*harmonic*point/1024);
  }
 }
 const sha256=createHash('sha256').update(new Uint8Array(table.buffer)).digest('hex');tableHashes.set(sampleRate,sha256);return sha256;
}
export function validateVsqAudioThreadRuns(runs,response,options={}) {
 const notes=vsqAudioSourceNotes(response,options),runtime=response.runtime;
 const result=validateAudioThreadRuns(runs,notes,{...options,sourceSha256:runtime.source_sha256,sourceNotes:runtime.notes.length,endMicroseconds:runtime.end_microseconds,planOracle:expectedVsqAudioPlan,allowCountIn:true});
 for(const run of runs)assert.deepEqual(run.timbre,{recipe:VSQ_TRIANGLE_RECIPE,sampleRate:run.plan.sampleRate,type:'Float32Array',length:128*1024,bytes:128*1024*4,sha256:expectedVsqTriangleHash(run.plan.sampleRate),transferred:true,detached:true},'VSQ transferred table does not match the immutable recipe');
 return result;
}
