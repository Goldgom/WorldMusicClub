// Synthetic verifier records only; never native or browser acceptance.
import {vsqAudioSourceNotes,expectedVsqAudioPlan,expectedVsqTriangleHash,VSQ_TRIANGLE_RECIPE} from '../scripts/vsq-audio-thread-proof.mjs';
import {syntheticAudioThreadRun} from './audio-thread-proof-fixtures.js';
export function syntheticVsqAudioThreadRun(response,options={}) {
 const notes=vsqAudioSourceNotes(response,options),sampleRate=options.sampleRate||48000;
 const run=syntheticAudioThreadRun(notes,{sourceSha256:response.runtime.source_sha256,durationMs:response.runtime.end_ms,sourceNotes:response.runtime.notes.length,endMicroseconds:response.runtime.end_microseconds,planOracle:expectedVsqAudioPlan,...options});
 run.timbre={recipe:VSQ_TRIANGLE_RECIPE,sampleRate,type:'Float32Array',length:128*1024,bytes:128*1024*4,sha256:expectedVsqTriangleHash(sampleRate),transferred:true,detached:true};return run;
}
