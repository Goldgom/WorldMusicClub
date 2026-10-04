// Preserve the existing strict console accounting. The only additional expected
// diagnostic is the actual Rust 422 for the finite unsupported-controller MIDI.
import assert from 'node:assert/strict';
import {createVsqHostedConsole} from './vsq-hosted-console.mjs';
export function createAuthoringHostedConsole({origin}={}){
 const base=createVsqHostedConsole({origin}),rejected=[],events=[];
 const evidence={version:1,base:base.evidence,rejected_responses:rejected,rejected_console_events:events};
 return{evidence,pendingResponse:value=>base.pendingResponse(value),rejectedResponse(value){
  assert.equal(value.path,'/api/clean-song/draft');assert.equal(value.method,'POST');assert.equal(value.status,422);assert.equal(value.source_name,'authoring-original-blocked.mid');assert.equal(value.state,'rejected');assert.match(value.source_sha256,/^[a-f0-9]{64}$/);assert.equal(rejected.length,0,'Only one original blocked draft is expected');rejected.push({...value,fulfilled:false});return{finish(ok){assert.equal(ok,true);rejected.at(-1).fulfilled=true;}};
 },observe(message){const location=message.location();if(message.type()==='error'&&message.text()==='Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)'&&location.url===`${origin}/api/clean-song/draft`&&location.lineNumber===0&&location.columnNumber===0&&rejected.length===1){assert.ok(events.length<2);events.push({type:message.type(),text:message.text(),location:{...location}});}else base.observe(message);},reconcile(){base.reconcile();return evidence;},assertComplete(){base.assertComplete();assert.ok(rejected.every(row=>row.fulfilled));assert.ok(events.length<=rejected.length,'More rejection console errors than owned Rust responses');}};
}
