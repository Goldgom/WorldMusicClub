import {canonicalFingerprint} from '../web/canonical-audio-fingerprint.js';
import {CANONICAL_AUDIO_PROFILE,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
// Synthetic capacity models validate host/processor algorithms. They are not
// claims about Rust compilation, device scheduling or arbitrary source import.
export function capacityEvidence({count=100000,references=count,voices=1}={}){
 const score={parts:[{id:'human',notes:[]},{id:'machine',notes:[]}],fixture:'original algorithm capacity model'};
 const source_note_ids=Array.from({length:count},(_,i)=>`原${i}`);score.parts[1].notes=source_note_ids.map(id=>({id}));
 const occurrences=Array.from({length:count},(_,i)=>({id:`次${i}`,part_index:1,source_indices:Array.from({length:Math.floor(references/count)+(i<references%count?1:0)},()=>i),midi:60,velocity:90,start_ms:Math.floor(i/voices)*2,duration_ms:1}));
 const notes=occurrences.map(o=>({id:o.id,part_id:'machine',source_note_id:source_note_ids[o.source_indices[0]],source_note_ids:o.source_indices.map(i=>source_note_ids[i]),midi:60,velocity:90,start_ms:o.start_ms,duration_ms:o.duration_ms}));
 const duration_ms=(Math.floor((count-1)/voices)+1)*2,profile={profile:CANONICAL_AUDIO_PROFILE,policy_id:CANONICAL_AUDIO_POLICY,source_fingerprint:canonicalFingerprint('wmh-canonical-score-v1',score),duration_ms,part_ids:['human','machine'],source_note_ids,source_references:references,occurrences};
 profile.compiled_fingerprint=canonicalFingerprint(CANONICAL_AUDIO_PROFILE,profile);return {compilation:{score,timeline:{duration_ms,notes}},profile};
}
