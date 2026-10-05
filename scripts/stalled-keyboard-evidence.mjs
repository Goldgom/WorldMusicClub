import assert from 'node:assert/strict';
import {fixture} from '../tests/frontend-fixtures.js';

export const STALLED_KEYS = Object.freeze([
  {id:'midtake',code:'KeyR',key:'r',midi:60,targetMs:2000},
  {id:'end',code:'KeyI',key:'i',midi:64,targetMs:5000},
]);
export function originalStalledKeyboardScore(){
  const score=structuredClone(fixture);score.id='original-stalled-keyboard';score.title='Original delayed keyboard study';
  score.provenance.attribution='Original two-note hosted input regression; no third-party song';
  score.parts[0].notes=score.parts[0].notes.map((note,index)=>({...note,id:`original-${STALLED_KEYS[index].id}`,at:{numerator:STALLED_KEYS[index].targetMs/500,denominator:1}}));
  score.measures=Array.from({length:3},(_,index)=>({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:index===2?3:4,denominator:1}}));
  return score;
}

// Serialized into hosted Chromium. Passive recorder/input observation except
// for the explicitly armed, finite main-thread block before a real app RAF.
// No timestamps, input dispatch, score clocks or scorer results are replaced.
export async function installStalledKeyboardObserver(){
  const {PracticeRecorder}=await import('/practice-recorder.js');
  const evidence={version:1,inputs:[],recorder:[],blocks:[],errors:[],restored:false};
  let sequence=0,active=true,armed=[];
  const append=(list,value)=>{if(list.length>=128){evidence.errors.push('observer_bound');return;}const row={sequence:++sequence,wall:performance.now(),...value};list.push(row);return row;};
  const clock=()=>{const raw=document.getElementById('progress')?.getAttribute('data-playback-clock');return raw?JSON.parse(raw):null;};
  const shape=pass=>pass?{id:pass.id,revision:pass.revision,assessedRevision:pass.assessedRevision,closedWall:pass.closedWall,deadline:pass.deadline,segments:structuredClone(pass.segments),inputs:structuredClone(pass.inputs),hasAssessment:Boolean(pass.assessment),inFlight:pass.inFlight}:null;
  const input=event=>{if(!active||!['KeyR','KeyI'].includes(event.code))return;append(evidence.inputs,{type:event.type,code:event.code,key:event.key,isTrusted:event.isTrusted,nativeKeyboardEvent:event instanceof KeyboardEvent,repeat:event.repeat,eventTime:event.timeStamp,clock:clock(),surface:event.target?.id||event.target?.tagName,focused:document.activeElement?.id||document.activeElement?.tagName,hidden:document.hidden,dialogOpen:Boolean(document.querySelector('dialog[open]'))});};
  document.addEventListener('keydown',input,true);document.addEventListener('keyup',input,true);
  const originals=new Map();
  for(const method of ['begin','resume','capture','closeAtEnd','submit','complete']){
    const original=PracticeRecorder.prototype[method];originals.set(method,original);
    PracticeRecorder.prototype[method]=function(...args){
      const before=shape(this.active),entered=performance.now(),result=Reflect.apply(original,this,args);
      if(active&&(method!=='closeAtEnd'||before?.closedWall!==this.active?.closedWall)){
        const row={method,entered,before,after:shape(this.active)};
        if(method==='capture'){row.input=structuredClone(args[0]);row.captured=result?.pass?{passId:result.pass.id,input:structuredClone(result.input)}:null;}
        if(method==='submit')row.job={revision:result.revision,passId:result.pass.id,inputs:structuredClone(result.inputs)};
        if(method==='complete'){row.job={revision:args[0].revision,passId:args[0].pass.id,inputs:structuredClone(args[0].inputs)};row.assessment=structuredClone(args[1]);}
        append(evidence.recorder,row);
      }
      return result;
    };
  }
  const requestFrame=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=function(callback){
    if(callback.name!=='animate')return Reflect.apply(requestFrame,this,[callback]);
    return Reflect.apply(requestFrame,this,[function(frameTime){
      const next=active&&armed[0];
      if(next&&performance.now()>=next.wall){
        armed.shift();const row=append(evidence.blocks,{id:next.id,frameTime,start:performance.now(),clockBefore:clock(),durationRequestedMs:1500});
        // Runtime binding notifies the external controller. Its commands use
        // native browser input, independent of this blocked renderer callback.
        void globalThis.__wmhStallStarted({id:next.id,start:row.start}).catch(error=>evidence.errors.push(String(error)));
        while(performance.now()-row.start<1500){} // Intentional finite test fault.
        row.end=performance.now();Reflect.apply(callback,this,[frameTime]);
        row.afterFrame=performance.now();row.clockAfter=clock();return;
      }
      return Reflect.apply(callback,this,[frameTime]);
    }]);
  };
  globalThis.__wmhStalledKeyboard={
    arm(specifications){if(armed.length||evidence.blocks.length)throw Error('Stalls may only be armed once');if(specifications.length!==2||specifications.some(row=>!Number.isFinite(row.wall)||row.wall<=performance.now()))throw Error('Two future real-clock blocks required');armed=specifications.map(row=>({...row}));},
    snapshot(){return structuredClone(evidence);},
    stop(){active=false;armed=[];globalThis.requestAnimationFrame=requestFrame;for(const[method,original]of originals)PracticeRecorder.prototype[method]=original;document.removeEventListener('keydown',input,true);document.removeEventListener('keyup',input,true);evidence.restored=true;return structuredClone(evidence);},
  };return true;
}

const close=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<0.01,`${label}: ${actual} != ${expected}`);
export function validateStalledKeyboardEvidence(report){
  assert.equal(report.kind,'original-hosted-stalled-keyboard');assert.equal(report.input_driver,'playwright-chromium-cdp');assert.equal(report.ok,true);assert.equal(report.originalFixture,true);
  assert.deepEqual(report.claims,{trusted_browser_input:true,physical_keyboard:false,physical_audio:false,synthetic_dom_input:false,timestamp_override:false,clock_override:false,injected_main_thread_block:true,production_source_changed:false});
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.trace.errors,[]);assert.equal(report.trace.restored,true);
  assert.equal(report.cleanup.status,'complete');assert.ok(report.cleanup.resources.every(row=>row.status==='closed'));
  const {trace,take,assessments,baseline}=report;
  assert.equal(take.latency_ms,0);assert.equal(take.tolerance_ms,180);assert.equal(take.passes.length,1);
  const pass=take.passes[0];assert.equal(pass.id,1);assert.equal(pass.revision,2);assert.equal(pass.assessed_revision,2);assert.equal(pass.pending,false);assert.equal(pass.error,null);assert.equal(pass.clock_segments.length,2);
  assert.equal(pass.timeline.duration_ms,5500);assert.deepEqual(pass.range,{start_ms:0,end_ms:5500});
  assert.equal(pass.inputs.length,2);assert.equal(pass.captures.length,2);assert.deepEqual(pass.timeline.notes.map(note=>[note.id,note.midi,note.start_ms,note.duration_ms]),[['original-midtake',60,2000,500],['original-end',64,5000,500]]);
  assert.equal(baseline.passes.length,1);assert.equal(baseline.passes[0].assessed_revision,0);assert.equal(baseline.passes[0].assessment.hits.length,0);assert.equal(baseline.passes[0].assessment.misses.length,2);assert.equal(baseline.passes[0].pending,false);
  assert.equal(trace.blocks.length,2);assert.equal(trace.inputs.length,4);assert.equal(trace.recorder.filter(row=>row.method==='capture').length,2);
  const completedBaseline=trace.recorder.find(row=>row.method==='complete'&&row.job.revision===0);
  const resumed=trace.recorder.find(row=>row.method==='resume');assert.ok(completedBaseline&&resumed);assert.ok(completedBaseline.wall<=resumed.wall);assert.equal(resumed.after.id,1);assert.equal(resumed.after.assessedRevision,0);
  assert.equal(assessments.length,3,'Require baseline, provisional endpoint, and corrected endpoint snapshots');
  for(const row of assessments){assert.equal(row.status,200);assert.equal(row.request.tolerance_ms,180);assert.deepEqual(row.request.timeline,pass.timeline);}
  assert.deepEqual(assessments[0].request.inputs,[]);assert.deepEqual(assessments[0].response,baseline.passes[0].assessment);
  assert.deepEqual(assessments[1].request.inputs,[pass.inputs[0]]);assert.equal(assessments[1].response.hits.length,1);assert.deepEqual(assessments[1].response.misses,['original-end']);
  assert.deepEqual(assessments[2].request.inputs,pass.inputs);assert.deepEqual(assessments[2].response,pass.assessment);
  for(const method of ['submit','complete']){const rows=trace.recorder.filter(row=>row.method===method);assert.deepEqual(rows.map(row=>row.job.revision),[0,1,2]);for(const[index,row]of rows.entries()){assert.equal(row.job.passId,1);assert.deepEqual(row.job.inputs,assessments[index].request.inputs);if(method==='complete'){assert.deepEqual(row.assessment,assessments[index].response);assert.equal(row.after.assessedRevision,index);}}}
  assert.equal(pass.assessment.hits.length,2);assert.deepEqual(pass.assessment.misses,[]);assert.deepEqual(pass.assessment.extras,[]);
  for(const expected of STALLED_KEYS){
    const commands=report.commands.filter(row=>row.blockId===expected.id);assert.deepEqual(commands.map(row=>row.type),['down','up']);assert.deepEqual(commands.map(row=>row.delayAfterNotificationMs),[300,400]);
    for(const command of commands){assert.equal(command.key,expected.key);assert.equal(command.error,undefined);for(const field of ['notificationHostNs','sentHostNs','completedHostNs'])assert.match(command[field],/^\d+$/);assert.ok(BigInt(command.sentHostNs)>=BigInt(command.notificationHostNs));assert.ok(BigInt(command.completedHostNs)>=BigInt(command.sentHostNs));}assert.ok(BigInt(commands[0].sentHostNs)<BigInt(commands[1].sentHostNs));
    const block=trace.blocks.find(row=>row.id===expected.id);assert.ok(block);assert.equal(block.durationRequestedMs,1500);assert.ok(block.end-block.start>=1500&&block.end-block.start<2200,'The actual injected block must remain ~1.5 seconds');
    assert.ok(block.clockBefore.running);assert.ok(completedBaseline.wall<block.start);
    const events=trace.inputs.filter(row=>row.code===expected.code);assert.deepEqual(events.map(row=>row.type),['keydown','keyup']);
    assert.ok(block.afterFrame>=block.end);for(const event of events){assert.equal(event.isTrusted,true);assert.equal(event.nativeKeyboardEvent,true);assert.equal(event.repeat,false);assert.equal(event.surface,'stage-title');assert.equal(event.focused,'stage-title');assert.equal(event.hidden,false);assert.equal(event.dialogOpen,false);assert.ok(event.eventTime>block.start&&event.eventTime<block.end,'Native event must actually originate inside the measured block');assert.ok(event.wall>=block.afterFrame,'Native input callback must follow the actual production frame');assert.ok(event.wall-event.eventTime>=800,'Require substantive measured queue delay');}
    const [on,off]=events;assert.ok(off.eventTime>on.eventTime);
    const capture=trace.recorder.find(row=>row.method==='capture'&&row.input.midi===expected.midi);assert.ok(capture?.captured);assert.equal(capture.captured.passId,pass.id);close(capture.input.eventWall,on.eventTime,'raw event timestamp');assert.ok(capture.input.receivedWall>=on.wall);assert.ok(capture.entered>=on.wall);
    const segment=pass.clock_segments.find(row=>on.eventTime>=row.wallStart&&on.eventTime<row.wallEnd);assert.ok(segment);const expectedAt=segment.positionStart+on.eventTime-segment.wallStart;
    close(capture.captured.input.at_ms,expectedAt,'captured score time');const recorded=pass.inputs.find(row=>row.midi===expected.midi);close(recorded.at_ms,expectedAt,'exported score time');
    const exportedCapture=pass.captures.find(row=>row.input.midi===expected.midi);assert.ok(exportedCapture);assert.deepEqual(exportedCapture.input,recorded);close(exportedCapture.event_wall_ms,on.eventTime,'exported capture event time');close(exportedCapture.received_wall_ms,capture.input.receivedWall,'exported capture receipt');
    const hit=pass.assessment.hits.find(row=>row.midi===expected.midi);assert.ok(hit);close(hit.expected_ms,expected.targetMs,'independent original target');close(hit.actual_ms,expectedAt,'actual Rust input time');close(hit.delta_ms,expectedAt-expected.targetMs,'actual Rust timing delta');assert.ok(Math.abs(hit.delta_ms)<=180);
    assert.ok(Math.abs(recorded.at_ms-(segment.positionStart+capture.input.receivedWall-segment.wallStart))>=800,'Receipt substitution must fail this proof');
    const observation=take.input_evidence.events.find(row=>row.kind==='note_on'&&row.midi===expected.midi);assert.ok(observation);assert.equal(observation.input_kind,'typing_keyboard');assert.equal(observation.timestamp_basis,'event_monotonic');close(observation.event_wall_ms,on.eventTime,'evidence event time');close(observation.raw_timestamp_ms,on.eventTime,'unmodified timestamp');close(observation.received_wall_ms,capture.input.receivedWall,'evidence receipt time');assert.equal(observation.onset_capture.pass_id,pass.id);
    const release=take.input_evidence.events.find(row=>row.kind==='note_off'&&row.source_id===observation.source_id);assert.ok(release);close(release.event_wall_ms,off.eventTime,'retained release timestamp');close(release.raw_timestamp_ms,off.eventTime,'unmodified release timestamp');assert.equal(release.timestamp_basis,'event_monotonic');assert.equal(release.input_kind,'typing_keyboard');assert.ok(release.received_wall_ms>=off.wall&&release.received_wall_ms-off.eventTime>=800);
    if(expected.id==='end'){assert.equal(block.clockAfter.completed,true);assert.equal(capture.before.hasAssessment,true);assert.ok([0,1].includes(capture.before.assessedRevision));assert.ok(capture.before.closedWall<on.wall);assert.ok(capture.before.deadline<on.wall);assert.ok(on.eventTime<capture.before.closedWall);const provisional=trace.recorder.find(row=>row.method==='submit'&&row.job.revision===1);assert.ok(provisional&&provisional.wall<=capture.entered);assert.deepEqual(provisional.job.inputs,[pass.inputs[0]]);}
  }
  return {notes:2,passes:1,provisionalRevision:0,finalRevision:2,minQueueLagMs:Math.min(...trace.inputs.map(row=>row.wall-row.eventTime)),physicalKeyboard:false};
}
