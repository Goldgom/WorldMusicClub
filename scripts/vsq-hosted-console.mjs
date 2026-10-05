// Hosted acceptance diagnostics. Repetition is counted without losing identity.
// Only exact browser resource errors backed by fulfilled, owned pending-result
// responses may be expected; application/unknown warnings are never discarded.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const PENDING_TEXT='Failed to load resource: the server responded with a status of 404 (Not Found)';
export function createVsqHostedConsole({origin,maxActionSequence=64,now=()=>performance.timeOrigin+performance.now()}={}) {
 // The VSQ Mod flow has an existing 80-action renderer/verifier contract.
 // Other hosted protocols retain their original 64-action diagnostic budget.
 assert.ok([64,80].includes(maxActionSequence),'Unsupported hosted action sequence budget');
 const evidence={version:1,max_action_sequence:maxActionSequence,total_events:0,groups:[],pending_responses:[],expected_events:0,unexpected_events:0,informational_events:0,overflow:{count:0,first:null,last:null}};
 const groups=new Map(),responses=new Map();let responseIndex=0;
 const event=()=>({index:++evidence.total_events,atMs:now()});
 function rejected(observation,reason,identity){const row={...observation,reason,identity_sha256:createHash('sha256').update(identity).digest('hex')};evidence.overflow.count++;evidence.overflow.first??=row;evidence.overflow.last=row;}
 function candidate(type,text,location){return type==='error'&&text===PENDING_TEXT&&location.lineNumber===0&&location.columnNumber===0?responses.get(location.url):null;}
 return{evidence,observe(message){
  const observation=event(),type=message.type(),text=message.text(),location=message.location(),identity=JSON.stringify([type,text,location?.url,location?.lineNumber,location?.columnNumber]);
  if(typeof type!=='string'||type.length>32||typeof text!=='string'||text.length>1024||typeof location?.url!=='string'||location.url.length>1024){rejected(observation,'console identity exceeds the finite full-value bound',identity);return;}
  let row=groups.get(identity);if(row){row.count++;row.last=observation;return;}
  const pending=candidate(type,text,location),bucket=pending?'owned-result-source':'other-source',limit=pending?maxActionSequence:32;
  if(evidence.groups.filter(row=>row.bucket===bucket).length>=limit){rejected(observation,`${bucket} distinct identity bound exceeded`,identity);return;}
  row={type,text,location:{...location},bucket,count:1,first:observation,last:observation,classification:'unconfirmed'};groups.set(identity,row);evidence.groups.push(row);
 },pendingResponse({sequence,url,method,owned,status,body}){
  assert.ok(Number.isSafeInteger(sequence)&&sequence>0&&sequence<=maxActionSequence,'VSQ pending response exceeds its declared action sequence budget');assert.equal(owned,true,'VSQ pending response must belong to its active action');assert.equal(url,`${origin}/__desktop_smoke/result/${sequence}`);assert.equal(method,'GET');assert.equal(status,404);assert.deepEqual(body,{error:'pending'});
  const observation={index:++responseIndex,atMs:now()};let row=responses.get(url);
  if(!row){row={sequence,url,method,status,body:{...body},issued:0,fulfilled:0,failed:0,first:observation,last:observation};responses.set(url,row);evidence.pending_responses.push(row);}
  row.issued++;row.last=observation;let settled=false;
  return{finish(ok){assert.equal(settled,false,'VSQ pending response receipt settled twice');settled=true;row[ok?'fulfilled':'failed']++;row.last={index:observation.index,atMs:now()};}};
 },reconcile(){
  evidence.expected_events=0;evidence.unexpected_events=evidence.overflow.count;evidence.informational_events=0;
  for(const row of evidence.groups){const pending=candidate(row.type,row.text,row.location),diagnostic=['warning','error'].includes(row.type)||/file.?chooser|file.?picker|user.?activation|gesture/i.test(row.text);row.classification=!diagnostic?'informational':row.bucket==='owned-result-source'&&pending&&pending.failed===0&&pending.issued===pending.fulfilled&&row.count<=pending.fulfilled?'owned-pending-result':'unexpected';evidence[({informational:'informational_events','owned-pending-result':'expected_events',unexpected:'unexpected_events'})[row.classification]]+=row.count;}
  return evidence;
 },assertComplete(){
  this.reconcile();assert.equal(evidence.overflow.count,0,'VSQ console full-identity diagnostic bound exceeded');
  assert.ok(evidence.pending_responses.every(row=>row.failed===0&&row.issued===row.fulfilled),'VSQ pending response accounting is incomplete or failed');
  assert.equal(evidence.unexpected_events,0,'VSQ unexpected browser console diagnostics; inspect exact type/text/location groups');assert.equal(evidence.total_events,evidence.expected_events+evidence.unexpected_events+evidence.informational_events,'VSQ console event counts do not reconcile');
 }};
}
