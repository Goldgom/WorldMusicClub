import assert from 'node:assert/strict';

const pointerKinds=new Set(['click','picker','select-first','select-second','select-last']);
const nonPointerKinds=new Set(['capture','key-ds4']);
const phases=new Set(['unavailable','preparing','playing','paused','ready','ended']);
const completedFeedback=new Set(['listen','assessed','review','empty']);
const rectKeys=['x','y','width','height'];
const own=(value,key)=>Object.hasOwn(value,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=512;
const finite=Number.isFinite;

function rectangle(value,label,{visible=false}={}) {
 assert.ok(record(value)&&rectKeys.every(key=>finite(value[key])),`${label}: actual target rectangle required`);
 assert.ok(value.width>=0&&value.height>=0,`${label}: negative target size`);
 if(visible)assert.ok(value.width>0&&value.height>0,`${label}: target must be visible`);
 return value;
}

function viewport(value,label) {
 assert.ok(finite(value.width)&&value.width>0&&finite(value.height)&&value.height>0,`${label}: actual viewport required`);
}

function inside(x,y,target) {
 return x>=target.x&&x<target.x+target.width&&y>=target.y&&y<target.y+target.height;
}

function snapshot(value,label,{actionable=false}={}) {
 assert.ok(record(value),`${label}: retained state required`);
 rectangle(value.target,label,{visible:actionable});viewport(value,label);
 for(const key of ['connected','disabled','identity','hitOwned','playDisabled'])assert.equal(typeof value[key],'boolean',`${label}: ${key} must be observed`);
 assert.ok(value.practiceGateHidden===null||typeof value.practiceGateHidden==='boolean',`${label}: practice gate visibility must be observed`);
 assert.ok(id(value.hitId),`${label}: actual hit ID required (null is valid)`);
 assert.ok(typeof value.screen==='string'&&value.screen.length>0,`${label}: screen missing`);
 for(const key of ['scoreState','feedbackPhase'])assert.ok(id(value[key]),`${label}: ${key} missing`);
 const clock=value.clock;
 assert.ok(record(clock)&&finite(clock.positionMs)&&clock.positionMs>=0&&phases.has(clock.phase),`${label}: observed playback clock required`);
 assert.equal(typeof clock.running,'boolean',`${label}: running clock flag missing`);
 assert.equal(typeof clock.completed,'boolean',`${label}: completed clock flag missing`);
 assert.equal(clock.running,clock.phase==='playing',`${label}: running clock phase differs`);
 assert.equal(clock.completed,clock.phase==='ended',`${label}: completed clock phase differs`);
 if(actionable){
  assert.equal(value.connected,true,`${label}: original control disconnected`);
  assert.equal(value.disabled,false,`${label}: original control disabled`);
  assert.equal(value.identity,true,`${label}: original control replaced`);
  assert.equal(value.hitOwned,true,`${label}: target does not own the painted hit`);
 }
 return value;
}

function layoutSample(value,index,label) {
 assert.ok(record(value),`${label}: layout sample missing`);
 assert.equal(value.frame,index,`${label}: rendered frame sequence differs`);
 rectangle(value.target,label);viewport(value,label);
 assert.equal(typeof value.hitOwned,'boolean',`${label}: sample ownership missing`);
 assert.ok(id(value.hitId)&&id(value.modalOwner),`${label}: sample hit/modal identity missing`);
}

function settledBudget(sample,label) {
 const keys=['committed','expected','laneHeight','transportBottom','viewportBottom','zoom'];
 if(!keys.some(key=>own(sample,key))){
  assert.ok(!own(sample,'status')&&!own(sample,'notice'),`${label}: incomplete stage layout budget`);
  return false;
 }
 assert.ok(keys.every(key=>finite(sample[key])),`${label}: stage layout budget missing`);
 assert.ok(sample.zoom>0&&sample.laneHeight>=0&&Math.abs(sample.committed-sample.expected)<=.02,`${label}: stage lane budget is not committed`);
 for(const key of ['status','notice'])if(own(sample,key)){
  const row=sample[key];
  assert.ok(record(row)&&finite(row.committed)&&finite(row.expected)&&row.committed===row.expected,`${label}: ${key} budget is not committed`);
 }
 return true;
}

function requestedState(state,request,label) {
 assert.deepEqual(state.target,request.target,`${label}: target changed since request preparation`);
 assert.deepEqual([state.width,state.height],[request.width,request.height],`${label}: viewport changed since request preparation`);
}

function requestedPoint(event,state,request,label,kind) {
 assert.ok(finite(event.clientX)&&finite(event.clientY),`${label}: actual event coordinates missing`);
 // Windows dispatch rounds client coordinates; keep the observed coordinates
 // while allowing only its integer CSS conversion around the requested center.
 assert.ok(inside(event.clientX,event.clientY,state.target)&&event.clientX>0&&event.clientX<state.width&&event.clientY>0&&event.clientY<state.height&&Math.abs(event.clientX-request.x)<=1&&Math.abs(event.clientY-request.y)<=1,`${label}: actual ${kind} coordinates missed the requested target center`);
}

function progressRange(control) {
 return record(control)&&control.id==='progress'&&control.tag==='INPUT'&&control.type==='range';
}

function completedState(state,stage,label) {
 if(stage&&state.clock.completed){
  assert.equal(state.playDisabled,false,`${label}: completed stage controls were not admitted`);
  assert.ok(completedFeedback.has(state.feedbackPhase),`${label}: completed stage assessment not rendered`);
 }
}

/** Check retained DOM/pointer receipts only. This does not establish browser,
 * native-window, audio, picker, scoring, or release acceptance. No evidence is
 * rewritten, inferred from host success, or repaired by this pure consumer. */
export function validateVsqOwnedControls(report,{actions}={}) {
 assert.ok(record(report)&&Number.isSafeInteger(report.actions)&&report.actions>=0&&report.actions<=80,'VSQ owned controls need the bounded native action count');
 assert.ok(Array.isArray(report.controlActions)&&report.controlActions.length<=report.actions,'VSQ owned control receipts are required');
 if(actions!==undefined){
  assert.ok(Array.isArray(actions)&&actions.length===report.actions,'VSQ owned controls need the complete actual action stream');
  for(const [index,action]of actions.entries()){
   assert.ok(record(action),`VSQ native action ${index+1} missing`);
   assert.equal(action.sequence,index+1,'VSQ native actions must remain in order');
   assert.ok(pointerKinds.has(action.kind)||nonPointerKinds.has(action.kind),'VSQ native action kind is unsupported');
  }
  assert.deepEqual(report.controlActions.map(row=>row.sequence),actions.filter(action=>pointerKinds.has(action.kind)).map(action=>action.sequence),'Every VSQ pointer action needs exactly one receipt; capture and key actions need none');
 }
 let previous=0;
 for(const row of report.controlActions){
  assert.ok(record(row)&&Number.isSafeInteger(row.sequence)&&row.sequence>previous&&row.sequence<=report.actions,'VSQ owned receipts must follow actual action order');previous=row.sequence;
  const label=`VSQ owned action ${row.sequence}`;
  assert.ok(pointerKinds.has(row.kind),`${label}: passive capture or physical key cannot claim a pointer receipt`);
  assert.ok(id(row.id),`${label}: control ID missing (null is valid)`);
  assert.ok(!own(row,'error')&&!own(row,'cleanupErrors'),`${label}: failed control action or cleanup retained an error`);
  snapshot(row.before,`${label} before`);
  const ready=row.readiness;
  assert.ok(record(ready)&&typeof ready.screen==='string'&&ready.screen.length>0&&typeof ready.completed==='boolean'&&id(ready.feedbackPhase)&&typeof ready.playDisabled==='boolean',`${label}: public control readiness required`);
  assert.ok(Array.isArray(row.samples)&&row.samples.length>=2&&row.samples.length<=5,`${label}: two to five actual layout samples required`);
  row.samples.forEach((value,index)=>layoutSample(value,index,`${label} frame ${index}`));
  const final=row.samples.at(-1),penultimate=row.samples.at(-2);
  for(const value of [penultimate,final]){
   assert.equal(value.hitOwned,true,`${label}: final two samples must own the painted hit`);
   rectangle(value.target,label,{visible:true});
  }
  assert.deepEqual([penultimate.width,penultimate.height,penultimate.target],[final.width,final.height,final.target],`${label}: final two painted targets/viewport did not settle`);
  const stage=settledBudget(final,label);
  if(stage&&ready.completed){assert.equal(ready.playDisabled,false,`${label}: completed readiness is disabled`);assert.ok(completedFeedback.has(ready.feedbackPhase),`${label}: completed readiness is awaiting assessment`);}
  const request=row.request;
  assert.ok(record(request),`${label}: actual action request missing`);
  assert.equal(request.version,1,`${label}: request version differs`);
  assert.equal(request.sequence,row.sequence,`${label}: request sequence differs`);
  assert.equal(request.kind,row.kind,`${label}: request kind differs`);
  viewport(request,label);rectangle(request.target,label,{visible:true});
  assert.deepEqual(request.target,final.target,`${label}: request used stale prepared coordinates`);
  assert.deepEqual([request.width,request.height],[final.width,final.height],`${label}: request used stale prepared viewport`);
  assert.equal(request.x,request.target.x+request.target.width/2,`${label}: request X is not the target center`);
  assert.equal(request.y,request.target.y+request.target.height/2,`${label}: request Y is not the target center`);
  assert.ok(request.x>0&&request.x<request.width&&request.y>0&&request.y<request.height,`${label}: request center is outside viewport`);
  if(actions!==undefined){const {target,...action}=request;assert.deepEqual(action,actions[row.sequence-1],`${label}: request must exactly match its actual native action`);}
  const before=snapshot(row.preDispatch,`${label} pre-dispatch`,{actionable:true});
  requestedState(before,request,`${label} pre-dispatch`);completedState(before,stage,`${label} pre-dispatch`);
  // The action can navigate, close a dialog, disable or replace its own control.
  // Retain the real after-state; do not require it to equal the dispatch state.
  snapshot(row.afterDispatch,`${label} after-dispatch`);
  assert.ok(Array.isArray(row.pointerDown)&&row.pointerDown.length===1,`${label}: exactly one actual pointerdown admission required`);
  const down=row.pointerDown[0],downLabel=`${label} pointerdown`;
  assert.ok(record(down)&&id(down.id),`${downLabel}: actual event identity missing`);
  assert.equal(down.sequence,row.sequence,`${downLabel}: event belongs to another action`);
  assert.equal(down.owned,true,`${downLabel}: event missed the original control`);
  assert.equal(down.trusted,true,`${downLabel}: untrusted admission`);
  assert.equal(down.order,0,`${downLabel}: admission must precede every click`);
  assert.equal(down.button,0,`${downLabel}: primary mouse button required`);
  assert.equal(down.buttons,1,`${downLabel}: pressed primary mouse button required`);
  assert.equal(down.isPrimary,true,`${downLabel}: primary pointer required`);
  assert.equal(down.pointerType,'mouse',`${downLabel}: native mouse pointer required`);
  assert.ok(Number.isSafeInteger(down.pointerId)&&down.pointerId>=0,`${downLabel}: actual pointer ID required`);
  const control=down.control;
  assert.ok(record(control)&&id(control.id)&&typeof control.tag==='string'&&control.tag.length>0&&control.tag.length<=512&&id(control.type),`${downLabel}: actual original control descriptor required`);
  assert.equal(control.id,row.id,`${downLabel}: original control ID differs`);
  const admitted=snapshot(down.state,downLabel,{actionable:true});
  requestedState(admitted,request,downLabel);completedState(admitted,stage,downLabel);requestedPoint(down,admitted,request,downLabel,'pointerdown');
  assert.ok(Array.isArray(row.clicks)&&row.clicks.length>=1&&row.clicks.length<=4,`${label}: bounded actual click events required`);
  assert.ok(Array.isArray(row.dispatch)&&row.dispatch.length===row.clicks.length,`${label}: every click needs its original dispatch snapshot`);
  let primary=0,delegated=0,previousOrder=down.order;
  for(const [index,event]of row.clicks.entries()){
   assert.ok(record(event)&&id(event.id)&&typeof event.owned==='boolean'&&typeof event.trusted==='boolean',`${label}: click event identity/ownership/trust missing`);
   assert.equal(event.sequence,row.sequence,`${label}: click belongs to another action`);
   const dispatch=row.dispatch[index];
   assert.ok(record(dispatch),`${label}: dispatch snapshot missing`);
   assert.deepEqual(Object.fromEntries(['sequence','id','owned','trusted'].map(key=>[key,dispatch[key]])),event,`${label}: dispatch must bind the same click event in order`);
   assert.ok(Number.isSafeInteger(dispatch.order)&&dispatch.order>previousOrder,`${label}: click dispatch order must follow pointerdown and prior clicks`);previousOrder=dispatch.order;
   assert.ok(finite(dispatch.clientX)&&finite(dispatch.clientY),`${label}: actual event coordinates missing`);
   if(!event.trusted){
    assert.ok(row.kind==='picker'&&event.id==='score-file'&&!event.owned,`${label}: untrusted primary click`);
    delegated++;snapshot(dispatch.state,`${label} delegated dispatch`);
    continue;
   }
   assert.equal(event.owned,true,`${label}: trusted click missed the original control`);primary++;
   const state=snapshot(dispatch.state,`${label} dispatch ${index}`,{actionable:primary===1});
   // Opening a native select can produce another owned click when Enter
   // commits the option. Its coordinates/state remain actual observations,
   // and need not repeat the initial pointer geometry.
   if(primary>1)continue;
   const dispatchLabel=`${label} dispatch ${index}`;
   // Native range input runs before click and can change the stage geometry.
   // Only the separately validated seek on the observed original range gets
   // this exception; its actual down admission and click point stay strict.
   const rangeSeek=report.phase==='vsq-restart'&&row.kind==='click'&&row.id==='progress'&&report.seek?.pointerAction===row.sequence&&progressRange(report.seek?.before?.control)&&progressRange(control)&&down.id==='progress'&&event.id==='progress';
   if(rangeSeek)assert.deepEqual([state.width,state.height],[request.width,request.height],`${dispatchLabel}: viewport changed since request preparation`);
   else requestedState(state,request,dispatchLabel);
   completedState(state,stage,dispatchLabel);requestedPoint(dispatch,state,request,dispatchLabel,'click');
  }
  assert.ok(primary>=1,`${label}: trusted owned primary click missing`);
  if(row.kind==='click')assert.equal(primary,1,`${label}: duplicate primary click`);
  assert.ok(delegated<=1,`${label}: repeated hidden-input delegation`);
 }
 return report.controlActions;
}
