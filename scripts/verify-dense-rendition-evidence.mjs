import {readPlaybackClock} from '../web/playback-clock-view.js';
import {validateRendererOrigin,validateHostedAssetEvidence,NATIVE_PROTOCOL_ORIGIN} from './hosted-worklet-assets.mjs';
import assert from 'node:assert/strict';
import {validateAudioThreadRuns,validateAudioThreadStatus} from './audio-thread-rendition-proof.mjs';
import {DENSE_STREAM,expectedDenseAttacks} from './prepare-dense-rendition-fixture.mjs';
export function denseTimingMetrics(trace){
 const end=trace.listeningEnded||trace.current,max=values=>values.length?Math.max(...values):null,min=values=>values.length?Math.min(...values):null;
 return{maxAnimationFrameMs:max((trace.frames||[]).map(row=>row.durationMs)),maxPumpGapMs:max(trace.pumps.map(row=>row.gapMs).filter(Number.isFinite)),maxPumpDurationMs:max(trace.pumps.map(row=>row.durationMs)),maxSynchronousRendererMs:max(trace.renders.map(row=>row.durationMs)),maxRenderMs:max(trace.renders.filter(row=>row.method==='render').map(row=>row.durationMs)),maxLoadCallMs:max(trace.renders.filter(row=>row.method==='load').map(row=>row.durationMs)),maxLoadSettledMs:max(trace.renders.map(row=>row.settledMs).filter(Number.isFinite)),maxNativeBatchMs:max(trace.scope.map(row=>row.loadMs).filter(Number.isFinite)),minScheduledLeadMs:min(trace.schedules.map(row=>(row.start-row.audioNow)*1000)),maxLongTaskMs:trace.version===3?trace.longTaskObservation?.maxDurationMs:max(trace.longTasks.map(row=>row.duration)),...(trace.version===3?{longTaskObservation:structuredClone(trace.longTaskObservation)}:{}),audioElapsedMs:trace.listeningStarted&&end.audioTime!==null?(end.audioTime-trace.listeningStarted.audioTime)*1000:null,wallElapsedMs:trace.listeningStarted?end.wall-trace.listeningStarted.wall:null,lateEvents:trace.errors.filter(row=>['clean_late_scheduler','late_scheduler'].includes(row.code)),scheduled:trace.schedules.length,processorStarted:(trace.audioThread||[]).reduce((sum,run)=>sum+(run.terminals?.[0]?.record.started||0),0),processorEnded:(trace.audioThread||[]).reduce((sum,run)=>sum+(run.terminals?.[0]?.record.ended||0),0),minStartAckLeadMs:min((trace.audioThread||[]).filter(run=>run.started).map(run=>(run.started.anchorTime-run.started.observedAudioTime)*1000))};
}
/** Version 2 retains its historical raw-only schema and fatal overflow rule.
 * Version 3 explicitly distinguishes all observed entries from retained samples.
 * This validates diagnostic accounting; the independent audio proof is unchanged.
 */
export function validateDenseLongTaskObservation(trace){
 if(trace.version===2){assert.equal(trace.longTaskObservation,undefined,'Version 2 cannot claim summarized long-task evidence');return;}
 assert.equal(trace.version,3);const summary=trace.longTaskObservation,rows=trace.longTasks;
 assert.ok(summary&&typeof summary==='object','Version 3 requires long-task observation accounting');
 assert.deepEqual(Object.keys(summary).sort(),['version','sampleLimit','observedCount','retainedCount','omittedCount','totalDurationMs','maxDurationMs','firstStartTimeMs','lastEndTimeMs'].sort());
 assert.equal(summary.version,1);assert.equal(summary.sampleLimit,256);
 for(const key of ['observedCount','retainedCount','omittedCount'])assert.ok(Number.isSafeInteger(summary[key])&&summary[key]>=0,`Invalid long-task ${key}`);
 assert.ok(Array.isArray(rows)&&rows.length<=summary.sampleLimit);assert.equal(summary.retainedCount,rows.length);
 assert.equal(summary.retainedCount,Math.min(summary.observedCount,summary.sampleLimit));
 assert.ok(Number.isSafeInteger(summary.retainedCount+summary.omittedCount));assert.equal(summary.observedCount,summary.retainedCount+summary.omittedCount);
 assert.equal(typeof trace.longTaskSupported,'boolean');if(!trace.longTaskSupported)assert.equal(summary.observedCount,0,'Unsupported observation cannot claim long tasks');
 assert.ok(Number.isFinite(summary.totalDurationMs)&&summary.totalDurationMs>=0);
 for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['duration','startTime']);assert.ok(Number.isFinite(row.startTime)&&row.startTime>=0&&Number.isFinite(row.duration)&&row.duration>=0&&Number.isFinite(row.startTime+row.duration),'Invalid retained long-task timing');}
 if(!summary.observedCount){assert.equal(summary.totalDurationMs,0);for(const key of ['maxDurationMs','firstStartTimeMs','lastEndTimeMs'])assert.equal(summary[key],null);return summary;}
 for(const key of ['maxDurationMs','firstStartTimeMs','lastEndTimeMs'])assert.ok(Number.isFinite(summary[key])&&summary[key]>=0,`Invalid long-task ${key}`);
 assert.ok(Number.isFinite(trace.current?.wall)&&summary.lastEndTimeMs<=trace.current.wall,'Observed long tasks must end by the snapshot');
 assert.ok(summary.firstStartTimeMs<=summary.lastEndTimeMs&&Number.isFinite(summary.firstStartTimeMs+summary.maxDurationMs)&&summary.firstStartTimeMs+summary.maxDurationMs<=summary.lastEndTimeMs,'Invalid observed long-task timestamp bounds');
 const retainedTotal=rows.reduce((sum,row)=>sum+row.duration,0),retainedMax=Math.max(...rows.map(row=>row.duration)),retainedFirst=Math.min(...rows.map(row=>row.startTime)),retainedLast=Math.max(...rows.map(row=>row.startTime+row.duration));
 assert.ok(Number.isFinite(retainedTotal)&&retainedTotal<=summary.totalDurationMs&&retainedMax<=summary.maxDurationMs);
 assert.ok(summary.firstStartTimeMs<=retainedFirst&&retainedLast<=summary.lastEndTimeMs);
 // Sequential non-negative floating-point additions and subtraction of the
 // retained subtotal can differ by roundoff. This bound scales with the number
 // of observed additions; it is not a browser duration/performance allowance.
 const roundoffMs=Number.EPSILON*Math.max(1,summary.totalDurationMs,retainedTotal,summary.maxDurationMs)*Math.max(4,summary.observedCount);
 assert.ok(Number.isFinite(roundoffMs),'Long-task arithmetic must remain finite');
 const durationAtMost=(left,right,divisor=1)=>left<=right||left-right<=roundoffMs/divisor;
 assert.ok(summary.maxDurationMs<=summary.totalDurationMs&&durationAtMost(summary.totalDurationMs/summary.observedCount,summary.maxDurationMs,summary.observedCount),'Invalid observed long-task duration bounds');
 const omittedDuration=summary.totalDurationMs-retainedTotal;
 if(summary.omittedCount){
  assert.ok(durationAtMost(omittedDuration/summary.omittedCount,summary.maxDurationMs,summary.omittedCount),'Omitted long-task duration cannot exceed the observed maximum');
  if(summary.maxDurationMs>retainedMax)assert.ok(Number.isFinite(retainedTotal+summary.maxDurationMs)&&summary.totalDurationMs>=retainedTotal+summary.maxDurationMs,'An unretained maximum needs its full duration in the observed total');
 }else{assert.equal(summary.totalDurationMs,retainedTotal);assert.equal(summary.maxDurationMs,retainedMax);assert.equal(summary.firstStartTimeMs,retainedFirst);assert.equal(summary.lastEndTimeMs,retainedLast);}
 return summary;
}
/** A ready source page must own the exact DOM objects produced by an observed
 * load/render pair. Rendering may precede the visible range label: readiness is
 * adoption, not an instruction to run OSMD again. Tokens are private WeakMap
 * object identities assigned by the passive observer, never DOM attributes.
 */
export function validateDenseEngravingOwnership(trace,fixture,frame,first,wanted){
 assert.deepEqual(trace.engravingOwnership,{version:1,overflow:false},'Bounded renderer ownership observation is required');
 assert.ok(Array.isArray(frame.renderOwners)&&frame.renderOwners.length===4,'Every visible part needs its own actual renderer');
 const svgNodes=new Set(),renderIds=new Set();
 for(const [index,owner]of frame.renderOwners.entries()){
  assert.equal(owner.version,1);assert.equal(owner.partId,frame.parts[index]);
  for(const[key,max]of [['rendererId',64],['loadId',128],['renderId',256]])assert.ok(Number.isInteger(owner[key])&&owner[key]>0&&owner[key]<=max,`Invalid observed ${key}`);
  assert.ok(Array.isArray(owner.svgNodes)&&owner.svgNodes.length>0&&owner.svgNodes.length<=16);
  for(const id of owner.svgNodes){assert.ok(Number.isInteger(id)&&id>0&&id<=512&&!svgNodes.has(id),'SVG object ownership must be unique');svgNodes.add(id);}
  assert.ok(!renderIds.has(owner.renderId),'Parts cannot borrow the same render');renderIds.add(owner.renderId);
  const renders=trace.renders.filter(row=>row.method==='render'&&!row.error&&row.ownership?.renderId===owner.renderId);
  assert.equal(renders.length,1,'Visible adopted nodes require one actual shipped render call');const render=renders[0];
  const loads=trace.renders.filter(row=>row.method==='load'&&!row.error&&row.ownership?.loadId===owner.loadId&&row.ownership.rendererId===owner.rendererId);
  assert.equal(loads.length,1,'Rendered output requires its own actual load call');const load=loads[0];
  assert.ok(Number.isFinite(load.wall)&&Number.isFinite(render.wall)&&Number.isFinite(frame.wall)&&load.wall<=render.wall&&render.wall<=frame.wall,'Load, render and visible adoption must be ordered');
  assert.equal(render.ownership.rendererId,owner.rendererId);assert.equal(render.ownership.loadId,owner.loadId);
  assert.deepEqual(render.ownership.svgNodes,owner.svgNodes,'Adoption must retain the same observed SVG objects');
  assert.deepEqual(render.ownership.xmlNoteIds,owner.xmlNoteIds);assert.deepEqual(load.ownership.xmlNoteIds,owner.xmlNoteIds,'Model and rendered source cannot come from another load');
  if(first)assert.equal(render.renderer,'playing','Each upcoming part must have actually rendered during playback');
  const page=fixture.pages.find(page=>page.first_measure===first&&page.request?.settings?.part_id===owner.partId);
  assert.ok(page&&Array.isArray(page.written_ids)&&page.written_ids.length===512,'Independent native written/source identities are required');
  const expected=wanted.filter(note=>note.part===owner.partId).map(note=>note.id).sort(),written=page.written_ids;
  assert.ok(written.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(id=>typeof id==='string'&&id.length>0&&id.length<=512)));
  assert.equal(new Set(written.map(pair=>pair[0])).size,512);assert.deepEqual(written.map(pair=>pair[1]).sort(),expected);
  assert.ok(Array.isArray(owner.xmlNoteIds)&&owner.xmlNoteIds.length===512);assert.deepEqual([...owner.xmlNoteIds].sort(),written.map(pair=>pair[0]).sort());
  assert.ok(Array.isArray(owner.bindings)&&owner.bindings.length===512);assert.deepEqual([...owner.bindings].sort((a,b)=>a[0].localeCompare(b[0])),[...written].sort((a,b)=>a[0].localeCompare(b[0])),'Visible source cues must bind this exact loaded XML');
 }
 assert.equal(svgNodes.size,frame.svg,'Every visible SVG must be covered by the adopted owners');
}
export function validateDenseRenditionEvidence(report,{expectedOrigin=NATIVE_PROTOCOL_ORIGIN}={}){
 validateRendererOrigin(expectedOrigin);assert.equal(report.origin,expectedOrigin);
 const hosted=expectedOrigin!==NATIVE_PROTOCOL_ORIGIN;if(hosted){validateHostedAssetEvidence(report.asset_server,{origin:expectedOrigin,sourceSha:report.source_sha});assert.equal(report.native_bridge?.drain?.status,'complete');}
 assert.equal(report.cleanup?.status,'complete','Dense cleanup must finish before acceptance');assert.deepEqual(report.cleanup.errors,[]);assert.deepEqual(report.cleanup.writeErrors,[]);assert.deepEqual(report.cleanup.resources.map(row=>[row.name,row.status]),[['context','closed'],['browser','closed'],...(hosted?[['native-requests','closed']]:[]),['driver','closed'],...(hosted?[['asset-server','closed']]:[])]);
 const fail=report.error||report.trace?.errors?.map(error=>`${error.code}: ${error.message} ${error.eventId}`).join('; ');assert.equal(report.ok,true,`Dense native rendition failed: ${fail||'missing completion'}`);
 assert.equal(report.locale,'zh-CN');const {trace,fixture}=report,expected=expectedDenseAttacks(fixture.source_sha256);assert.ok([2,3].includes(trace.version),'Legacy main-thread schedules cannot establish actual AudioWorklet completion');validateDenseLongTaskObservation(trace);assert.equal(fixture.fixture.attacks,DENSE_STREAM.attacks);assert.equal(fixture.pages.length,12);assert.equal(trace.cleanup.restored,true);assert.deepEqual(trace.cleanup.errors,[]);assert.equal(trace.cleanup.stopped,true);assert.equal(trace.cleanup.players,1);assert.equal(trace.cleanup.contexts,1);assert.deepEqual(trace.cleanup.receiver,{restored:true,overflow:false,errors:[],cleanupErrors:[]});assert.deepEqual(trace.errors,[]);assert.deepEqual(trace.overflow,[]);
 assert.equal(trace.audioThread.length,1,'Uninterrupted dense Listen must use one prepared generation');assert.equal(trace.audioThread[0].positionFrame,0);validateAudioThreadRuns(trace.audioThread,expected,{sourceSha256:fixture.source_sha256,durationMs:48000,sourceNotes:6144});validateAudioThreadStatus(trace.receiver,{quiet:true});assert.equal(trace.receiver.completed,1);
 for(const [label,sample]of [['listeningEnded',trace.listeningEnded],['current',trace.current]]){
  const clock=readPlaybackClock({getAttribute:()=>JSON.stringify(sample?.clock)});
  assert.equal(clock.available,true,`${label}: source clock must be available`);assert.equal(clock.durationMs,48000,`${label}: complete source duration`);
  assert.equal(clock.rangeStartMs,0,`${label}: full source range start`);assert.equal(clock.rangeEndMs,48000,`${label}: full source range end`);
  assert.equal(clock.completed,true,`${label}: actual source completion`);assert.equal(clock.phase,'ended',`${label}: actual source End`);
  assert.equal(clock.positionMs,sample.position,`${label}: legacy position must match the exact published clock`);
 }
 assert.equal(trace.listeningEnded.renderer,'ended');assert.equal(trace.listeningEnded.position,48000);assert.equal(trace.current.renderer,'ended');assert.equal(trace.current.position,48000);assert.equal(trace.current.captured,'0');assert.equal(trace.current.audioState,'running');assert.ok(trace.states.length>0&&trace.states.every(row=>row.state==='running'),'AudioContext suspended during the stream');assert.equal(trace.audio.overflow,false);assert.equal(trace.audio.created,0);assert.equal(trace.audio.sourceStarts,0);assert.equal(trace.audio.oscillatorStarts,0);assert.equal(trace.audio.activeSources,0);assert.equal(trace.audio.pendingSources,0);assert.deepEqual(trace.pumps,[]);assert.deepEqual(trace.schedules,[]);assert.equal(trace.counts.pumps,0);assert.equal(trace.counts.schedules,0);
 assert.ok(trace.frames.length>0&&trace.frames.length<=4096);let previousAudio=-Infinity;for(const frame of trace.frames){assert.equal(frame.audioState,'running');assert.ok(frame.audioTime>=previousAudio,'AudioContext clock reversed');assert.ok(frame.durationMs>=0);assert.notEqual(frame.renderer,'paused','Dense playback paused');previousAudio=frame.audioTime;}
 assert.ok(trace.current.audioTime>trace.listeningStarted.audioTime);assert.equal(report.assessmentRequests,0);assert.deepEqual(report.results,{historyHidden:true,passOptions:[''],exportDisabled:true,assessmentDisabled:true});assert.ok(report.actions.length>=8&&report.actions.length<=64&&report.actions.every(row=>row.completed));assert.deepEqual(report.pageErrors,[]);
 const parts=Array.from({length:4},(_,part)=>`midi-t${part+2}-c${part+1}-r0`);
 for(const first of [0,8,16]){const from=first+1,frame=trace.scope.find(row=>row.status==='ready'&&Number(row.range.match(/\d+/)?.[0])===from&&row.sourceIds&&row.parts.length===4);assert.ok(frame,`Native page ${from} never had all four actual mounts`);assert.equal(frame.scope,'all');assert.deepEqual(frame.parts,parts);assert.ok(frame.svg>=4&&frame.heads>=2048);const ids=new Set(frame.sourceIds),wanted=expected.filter(note=>note.startMs>=first*2000&&note.startMs<(first+8)*2000);assert.equal(ids.size,2048);for(const note of wanted)assert.ok(ids.has(note.id),`Missing displayed source ${note.id}`);if(first)assert.equal(frame.renderer,'playing',`Page ${from} did not paint during playback`);validateDenseEngravingOwnership(trace,fixture,frame,first,wanted);}
 assert.deepEqual(report.metrics,denseTimingMetrics(trace));assert.equal(report.claims.physical_audio,false);assert.equal(report.claims.synthetic_clock,false);assert.equal(report.claims.production_behavior_changed,false);return report;
}
