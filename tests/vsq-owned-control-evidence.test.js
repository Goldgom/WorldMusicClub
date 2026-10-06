import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVsqOwnedControls} from '../scripts/verify-vsq-owned-controls.mjs';
import {syntheticVsqOwnedControl,syntheticVsqOwnedControls} from './vsq-owned-control-fixtures.js';

const action=(sequence=1,kind='click',extra={})=>({version:1,sequence,kind,x:103.5,y:208.25,width:1280,height:720,...extra});
function fixture({actions=[action()],options={}}={}) {
 return{actions,report:{actions:actions.length,controlActions:syntheticVsqOwnedControls(actions,options)}};
}
const validate=({report,actions})=>validateVsqOwnedControls(report,{actions});
function reject(mutator,expected,options) {
 const evidence=fixture(options);mutator(evidence.report.controlActions[0],evidence);assert.throws(()=>validate(evidence),expected);
}
function addEvent(row,{event={},dispatch={}}={}) {
 const click={...structuredClone(row.clicks[0]),...event};
 row.clicks.push(click);row.dispatch.push({...structuredClone(row.dispatch[0]),...click,...dispatch});
}

test('owned evidence is a pure consumer and returns the retained receipts without an acceptance claim',()=>{
 const evidence=fixture(),before=structuredClone(evidence),rows=validate(evidence);
 assert.equal(rows,evidence.report.controlActions);assert.deepEqual(evidence,before);
 assert.equal(rows.ok,undefined);assert.equal(rows.accepted,undefined);
});

test('each pointer action binds exactly once while passive capture and physical key need no click receipt',()=>{
 const actions=[action(1),action(2,'capture',{devicePixelRatio:1}),action(3,'key-ds4'),action(4,'select-last')];
 const evidence=fixture({actions});assert.deepEqual(validate(evidence).map(row=>row.sequence),[1,4]);
 assert.deepEqual(validate(fixture({actions:[action(1,'capture',{devicePixelRatio:1}),action(2,'key-ds4')]})),[]);
 assert.deepEqual(validate(fixture({actions:[]})),[]);
 for(const kind of ['capture','key-ds4']){
  const passive=action(1,kind),report={actions:1,controlActions:[syntheticVsqOwnedControl(passive)]};
  assert.throws(()=>validateVsqOwnedControls(report,{actions:[passive]}),/Every VSQ pointer action/);
  assert.throws(()=>validateVsqOwnedControls(report),/cannot claim a pointer receipt/);
 }
});

test('missing, repeated, reversed and extra receipts cannot substitute for actual pointer actions',()=>{
 for(const change of [e=>e.report.controlActions.pop(),e=>e.report.controlActions.push(structuredClone(e.report.controlActions[0])),e=>e.report.controlActions.reverse(),e=>e.report.controlActions[0].sequence=2,e=>e.actions.pop(),e=>e.actions[1].sequence=1]){
  const evidence=fixture({actions:[action(1),action(2)]});change(evidence);assert.throws(()=>validate(evidence));
 }
 reject((row,e)=>delete e.report.controlActions,/receipts are required/);
 reject((row,e)=>e.report.actions=81,/bounded native action count/);
 reject((row,e)=>e.report.controlActions=[null]);
 reject(row=>row.error='Missing trusted Play event',/retained an error/);
 reject(row=>row.cleanupErrors=[{name:'after-dispatch-snapshot',error:'clock unavailable'}],/retained an error/);
});

test('receipt requests preserve every field of the raw native action without inventing or dropping fields',()=>{
 for(const change of [r=>r.request.sequence++,r=>r.request.kind='select-last',r=>r.request.version=2,r=>r.request.extra=true,r=>delete r.request.version])reject(change,/request/);
 const actions=[action(1,'picker',{file:'original-owned-song.zip'})];validate(fixture({actions}));
 for(const change of [r=>r.request.file='other.zip',r=>delete r.request.file])reject(change,/exactly match/,{actions});
});

test('ID-less native Mod fields and owned descendant hits retain their actual event IDs',()=>{
 for(const options of [{id:null,eventId:null},{id:'play-button',eventId:'play-icon'},{id:'play-button',eventId:null}]){
  const evidence=fixture({options});validate(evidence);assert.equal(evidence.report.controlActions[0].clicks[0].id,options.eventId);
 }
 reject(row=>delete row.id,/control ID missing/);
 reject(row=>row.id='',/control ID missing/);
});

test('stale coordinates after late Mod layout publication cannot pass from host success alone',()=>{
 reject(row=>{for(const sample of row.samples)sample.target.x+=120;},/stale prepared coordinates/);
 reject(row=>row.preDispatch.target.y+=48,/target changed since request/);
 reject(row=>row.dispatch[0].state.target.y+=48,/target changed since request/);
 reject(row=>{row.request.target.x+=48;row.request.x+=48;},/stale prepared coordinates/);
 reject(row=>{row.dispatch[0].clientY+=48;},/actual click coordinates missed/);
});

test('two final owned rendered targets and viewport must match within the bounded layout sample history',()=>{
 reject(row=>row.samples.pop(),/two to five/);
 reject(row=>row.samples=Array.from({length:6},(_,frame)=>({...row.samples[0],frame})),/two to five/);
 reject(row=>row.samples[0].target.y+=1,/did not settle/);
 reject(row=>row.samples[0].width+=1,/did not settle/);
 reject(row=>row.samples[0].hitOwned=false,/final two samples/);
 reject(row=>row.samples[1].hitOwned=false,/final two samples/);
 reject(row=>row.samples[1].frame=4,/frame sequence/);
 const evidence=fixture(),row=evidence.report.controlActions[0],original=structuredClone(row.samples[0]);
 row.samples=[{...original,target:{...original.target,y:100},hitOwned:false},{...original,frame:1},{...original,frame:2}];
 validate(evidence);
});

test('final stage viewport/status/notice budgets must be observed and committed',()=>{
 const options={options:{stage:true}};validate(fixture(options));
 for(const change of [r=>r.samples[1].committed=100,r=>r.samples[1].expected=null,r=>delete r.samples[1].zoom,r=>r.samples[1].status.committed=20,r=>r.samples[1].notice.expected=12])reject(change,/budget/,options);
 const evidence=fixture(options);evidence.report.controlActions[0].samples[0].committed=100;validate(evidence);
});

test('request center and viewport must be the exact stable painted target',()=>{
 reject(row=>row.request.x+=1,/not the target center/);
 reject(row=>row.request.y+=1,/not the target center/);
 reject(row=>row.request.width-=1,/stale prepared viewport/);
 reject(row=>row.preDispatch.height-=1,/viewport changed since request/);
 reject(row=>row.dispatch[0].state.height-=1,/viewport changed since request/);
 reject(row=>row.samples.forEach(s=>s.target.width=0),/must be visible/);
 const actions=[action(1,'click',{x:1280})];reject(()=>{},/outside viewport/,{actions});
});

test('missing primary trusted click reproduces the action-38 Play evidence gap despite successful host dispatch',()=>{
 const stream=Array.from({length:38},(_,index)=>action(index+1)),evidence=fixture({actions:stream,options:a=>({id:a.sequence===37?'song-mod-apply':'play-button'})});
 evidence.report.ok=true;evidence.report.controlActions[37].clicks=[];evidence.report.controlActions[37].dispatch=[];
 assert.throws(()=>validate(evidence),/VSQ owned action 38: bounded actual click events required/);
 reject(row=>{row.clicks=[];row.dispatch=[];},/actual click events required/);
 reject(row=>{row.clicks[0].trusted=false;row.dispatch[0].trusted=false;},/untrusted primary click/);
 reject(row=>{row.clicks[0].owned=false;row.dispatch[0].owned=false;},/missed the original control/);
 const actions=[action(1,'picker',{file:'original-owned-song.zip'})];
 reject(row=>{row.clicks.shift();row.dispatch.shift();},/primary click missing/,{actions});
});

for(const location of ['preDispatch','dispatch']){
 test(`disabled, disconnected, obscured or same-ID-replaced original control at ${location} is rejected`,()=>{
  const state=row=>location==='dispatch'?row.dispatch[0].state:row.preDispatch;
  for(const [key,value,message]of [['disabled',true,/disabled/],['connected',false,/disconnected/],['identity',false,/replaced/],['hitOwned',false,/painted hit/]])reject(row=>state(row)[key]=value,message);
 });
}

test('actual event coordinates are retained with only native integer pixel conversion tolerance',()=>{
 const evidence=fixture(),dispatch=evidence.report.controlActions[0].dispatch[0];
 dispatch.clientX=Math.round(dispatch.clientX);dispatch.clientY=Math.floor(dispatch.clientY);const before=structuredClone(dispatch);validate(evidence);assert.deepEqual(dispatch,before);
 reject(row=>delete row.dispatch[0].clientX,/actual event coordinates missing/);
 reject(row=>row.dispatch[0].clientY=NaN,/actual event coordinates missing/);
 reject(row=>row.dispatch[0].clientX+=1.01,/actual click coordinates missed/);
});

test('every dispatch row binds the same canonical click sequence, ID, trust and ownership',()=>{
 for(const change of [r=>r.dispatch=[],r=>r.dispatch.push(structuredClone(r.dispatch[0])),r=>r.dispatch[0].sequence++,r=>r.dispatch[0].id='wrong-button',r=>r.dispatch[0].trusted=false,r=>r.dispatch[0].owned=false])reject(change,/dispatch/);
 reject(row=>{row.clicks[0].sequence++;row.dispatch[0].sequence++;},/another action/);
});

test('a second click is rejected for a single click action, even if both clicks are trusted and owned',()=>{
 reject(row=>addEvent(row),/duplicate primary click/);
 reject(row=>{for(let n=0;n<4;n++)addEvent(row);},/bounded actual click events/);
});

test('select commit clicks retain their later coordinates and changed DOM state without claiming another initial pointer',()=>{
 for(const kind of ['select-first','select-second','select-last']){
  const evidence=fixture({actions:[action(1,kind)],options:{id:null,eventId:null}}),row=evidence.report.controlActions[0];
  const state={...structuredClone(row.afterDispatch),target:{x:0,y:0,width:0,height:0},connected:false,disabled:true,identity:false,hitOwned:false,hitId:'other-control'};
  addEvent(row,{dispatch:{clientX:0,clientY:0,state}});validate(evidence);
  const bad=structuredClone(evidence);bad.report.controlActions[0].dispatch[0].state.identity=false;assert.throws(()=>validate(bad),/replaced/);
 }
});

test('picker delegation is retained once while existing chooser evidence remains its authority',()=>{
 const actions=[action(1,'picker',{file:'original-owned-song.zip'})],evidence=fixture({actions}),row=evidence.report.controlActions[0];
 validate(evidence);assert.equal(row.clicks[1].id,'score-file');assert.equal(row.dispatch[1].clientX,0);
 const primaryOnly=fixture({actions,options:{pickerDelegation:false}});validate(primaryOnly);
 reject(row=>{row.clicks[1].id='other-input';row.dispatch[1].id='other-input';},/untrusted primary/,{actions});
 reject(row=>{row.clicks[1].owned=true;row.dispatch[1].owned=true;},/untrusted primary/,{actions});
 reject(row=>{row.clicks.push(structuredClone(row.clicks[1]));row.dispatch.push(structuredClone(row.dispatch[1]));},/repeated hidden-input/,{actions});
});

test('before and after snapshots retain lifecycle changes without replacing the original observed element',()=>{
 const options={before:{target:{x:0,y:-80,width:0,height:0},hitOwned:false,disabled:true},afterDispatch:{target:{x:0,y:0,width:0,height:0},connected:false,disabled:true,identity:false,hitId:null,hitOwned:false,screen:'library',scoreState:null,practiceGateHidden:null}};
 const evidence=fixture({options}),before=structuredClone(evidence);validate(evidence);assert.deepEqual(evidence,before);
 for(const change of [r=>delete r.before,r=>delete r.afterDispatch,r=>delete r.afterDispatch.identity,r=>delete r.afterDispatch.target,r=>delete r.afterDispatch.clock])reject(change,/before|after-dispatch/);
});

test('completed stage readiness waits for public assessment while ordinary clocks can advance after a click',()=>{
 const options={stage:true,state:{clock:{positionMs:4083.337,running:false,completed:true,phase:'ended'},feedbackPhase:'assessed'}};
 validate(fixture({options}));
 reject(row=>row.readiness.feedbackPhase='assessing',/awaiting assessment/,{options});
 reject(row=>row.readiness.playDisabled=true,/readiness is disabled/,{options});
 reject(row=>row.preDispatch.feedbackPhase='assessing',/assessment not rendered/,{options});
 reject(row=>row.dispatch[0].state.playDisabled=true,/not admitted/,{options});
 const evidence=fixture();evidence.report.controlActions[0].afterDispatch.clock={positionMs:50,running:true,completed:false,phase:'playing'};validate(evidence);
});

test('synthetic fixture callback binds existing action streams and creates independent snapshots',()=>{
 const actions=[action(1),action(2,'capture',{devicePixelRatio:1}),action(3,'select-last')],rows=syntheticVsqOwnedControls(actions,a=>({id:a.sequence===1?'song-mod-apply':null}));
 assert.deepEqual(rows.map(row=>row.id),['song-mod-apply',null]);
 rows[0].before.target.x=900;rows[0].clicks[0].id='changed';
 assert.equal(rows[0].request.target.x,93.5);assert.equal(rows[0].preDispatch.target.x,93.5);assert.equal(rows[0].dispatch[0].id,'song-mod-apply');assert.equal(actions[0].x,103.5);
 const report={actions:3,controlActions:rows};assert.throws(()=>validateVsqOwnedControls(report,{actions}),/same click event/);
});
