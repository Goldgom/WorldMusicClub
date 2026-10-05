import {validateLiveToneEvidence} from './live-tone-proof.mjs';
import assert from 'node:assert/strict';

export function validateVsqNativeKey(result,host) {
 assert.equal(result.client_click,undefined,'Timed VSQ key must not click');const key=result.native_key;
 assert.ok(Number.isSafeInteger(key?.app_hwnd)&&key.app_hwnd>0);assert.equal(key.foreground,key.app_hwnd);assert.equal(key.app_process_id,host.process_id);assert.equal(key.app_enabled,true);
 assert.equal(key.code,'KeyU');assert.equal(key.virtual_key,0x55);assert.equal(key.hold_ms,40);assert.equal(key.focus_reacquired,false);assert.equal(key.pointer_clicked,false);return key;
}
export function validateVsqHumanScore(report,fixture) {
 validateLiveToneEvidence(report.humanLiveAudio,{keyCode:'KeyU',midi:63,transport:report.transportAdmission});
 const p=report.keyPreparation;assert.ok(p,'VSQ count-in focus evidence required');assert.equal(p.focused,true);assert.equal(p.activeElement,'stage-title');assert.equal(p.readyCue,'countdown');assert.equal(p.readyPositionMs,0);assert.equal(p.mapping,'U');
 for(const key of ['readyWallMs','dispatchWallMs','dispatchPositionMs','countInMs'])assert.ok(Number.isFinite(p[key])&&p[key]>=0);assert.equal(p.countInMs,4*60000/fixture.runtime.compilation.score.tempo[0].bpm);assert.ok(Number.isFinite(p.timeOrigin)&&p.timeOrigin>0);assert.ok(p.readyWallMs<p.dispatchWallMs);assert.ok(p.dispatchPositionMs>0&&p.dispatchPositionMs<120);assert.ok(Number.isSafeInteger(p.playAction)&&p.playAction>0&&p.keyAction===p.playAction+1&&p.keyAction<=report.actions);
 const rows=report.transportAdmission.rows,ready=rows.findIndex(row=>row.kind==='key-focus-ready'),onset=rows.findIndex(row=>row.event?.type==='keydown'&&row.event.code==='KeyU');assert.ok(ready>=0&&onset>ready);assert.equal(rows[ready].state.cue,'countdown');
 for(const row of rows.slice(ready,onset+1)){assert.equal(row.state.focused,true);assert.equal(row.state.activeElement,'stage-title');assert.equal(row.state.hidden,false);assert.deepEqual(row.state.openDialogs,[]);assert.ok(!['pointerdown','pointerup','click','blur','focusout'].includes(row.event?.type),'VSQ timed input must preserve already-prepared focus');}
 assert.equal(rows[onset].event.trusted,true);assert.equal(rows[onset].event.surface,'stage-title');assert.equal(rows[onset].state.phase,'capturing');
 assert.equal(report.humanThread.length,2);assert.equal(report.humanThread[0].started.positionMs,-p.countInMs);assert.equal(report.humanThread[0].terminals[0].record.type,'canceled');assert.equal(report.humanThread[1].terminals[0].record.type,'ended');assert.ok(report.humanThread[1].started.positionMs>0);assert.ok(Math.abs(report.humanThread[1].started.positionMs-report.transportAdmission.current.positionMs)<=.501,'Resume changed the captured source position');
 const expected=fixture.runtime.compilation.timeline.notes.find(note=>note.part_id==='vsq-track-2');assert.equal(expected.midi,63);assert.equal(expected.start_ms,0);
 assert.equal(report.assessmentRequests.length,1);assert.equal(report.assessmentResponses.length,1);const request=report.assessmentRequests[0],response=report.assessmentResponses[0];
 assert.equal(request.tolerance_ms,180);assert.deepEqual(request.timeline.notes,[expected]);assert.equal(request.inputs.length,1);assert.equal(request.inputs[0].midi,63);assert.ok(Math.abs(request.inputs[0].at_ms)<=180);
 assert.deepEqual(report.requests.filter(row=>row.path==='/api/assess').map(row=>row.body),report.assessmentRequests);assert.equal(report.requests[response.requestIndex]?.path,'/api/assess');assert.equal(response.path,'/api/assess');assert.equal(response.status,200);assert.deepEqual(report.assessmentObservations,[{path:'/api/assess',status:200,state:'consumed',requestIndex:response.requestIndex}]);
 const assessment=response.body;assert.equal(assessment.accuracy_percent,100);assert.deepEqual(assessment.misses,[]);assert.deepEqual(assessment.extras,[]);assert.equal(assessment.hits.length,1);const hit=assessment.hits[0];assert.equal(hit.note_id,expected.id);assert.equal(hit.midi,63);assert.equal(hit.expected_ms,0);assert.equal(hit.actual_ms,request.inputs[0].at_ms);assert.equal(hit.delta_ms,hit.actual_ms);assert.ok(Math.abs(hit.delta_ms)<=180);
 assert.deepEqual(report.completePractice,{accuracy:'100%',positionMs:fixture.runtime.runtime.end_ms,captured:'1'});return assessment;
}
