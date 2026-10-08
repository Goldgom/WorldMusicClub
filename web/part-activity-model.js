import {isAdmittedPartActivitySnapshot} from './part-activity-playback.js';
export const PART_ACTIVITY_LIMITS=Object.freeze({maxParts:128,maxGates:100000});
const indexes=new WeakMap(),tokenKeys=['sourceToken','runtimeToken','planToken','ownershipToken'];
const transports=new Set(['running','paused','ready','preparing','ended','stopped','unavailable']),renderers=new Set(['running','suspended','stopped','unavailable']);
const fail=message=>{throw Object.assign(new TypeError(message),{code:'part_activity_identity'});};
const finite=value=>typeof value==='number'&&Number.isFinite(value),id=value=>typeof value==='string'&&value.length>0;
function assertBinding(expected,actual){if(!actual||tokenKeys.some(key=>expected[key]==null||actual[key]!==expected[key]))fail('Current source, runtime, plan and ownership binding required');}
function partSet(values){if(values===undefined)return new Set();if(!Array.isArray(values)||values.length>128||values.some(value=>!id(value)))fail('Bounded part filters required');return new Set(values);}
function upperBound(values,value){let low=0,high=values.length;while(low<high){const mid=low+Math.floor((high-low)/2);if(values[mid]<=value)low=mid+1;else high=mid;}return low;}
export function compilePartActivity(snapshot,binding){
 if(!isAdmittedPartActivitySnapshot(snapshot))fail('Admitted playback snapshot required');assertBinding(snapshot,binding);
 if(!Array.isArray(snapshot.parts)||snapshot.parts.length>128||!Array.isArray(snapshot.gates)||snapshot.gates.length>100000||!finite(snapshot.durationMs)||snapshot.durationMs<0)fail('Activity budget exceeded');
 const parts=new Map();
 for(const part of snapshot.parts){
  if(!part||!id(part.partId)||parts.has(part.partId)||typeof part.label!=='string'||(part.sourceInstrumentSummary!=null&&typeof part.sourceInstrumentSummary!=='string')||(part.machineSubset!==undefined&&typeof part.machineSubset!=='boolean'))fail('Invalid activity part');
  parts.set(part.partId,{metadata:Object.freeze({partId:part.partId,label:part.label,sourceInstrumentSummary:part.sourceInstrumentSummary??null,machineSubset:part.machineSubset??false,owner:'machine'}),starts:[],ends:[]});
 }
 for(const gate of snapshot.gates){const part=parts.get(gate?.partId);if(!part||!id(gate.occurrenceId)||!finite(gate.startMs)||!finite(gate.endMs)||gate.startMs<0||gate.endMs<=gate.startMs||gate.endMs>snapshot.durationMs)fail('Invalid admitted machine gate');part.starts.push(gate.startMs);part.ends.push(gate.endMs);}
 for(const part of parts.values()){part.starts.sort((a,b)=>a-b);part.ends.sort((a,b)=>a-b);Object.freeze(part.starts);Object.freeze(part.ends);Object.freeze(part);}
 const model=Object.freeze({partCount:parts.size,gateCount:snapshot.gates.length});indexes.set(model,{parts,identity:Object.freeze(Object.fromEntries(tokenKeys.map(key=>[key,snapshot[key]])))});return model;
}
export function samplePartActivity(model,frame){
 const index=indexes.get(model);if(!index)fail('Unknown activity model');assertBinding(index.identity,frame?.binding);
 if(!finite(frame.positionMs)||!transports.has(frame.transport)||!renderers.has(frame.rendererState)||(frame.soundEnabled!==undefined&&typeof frame.soundEnabled!=='boolean')||(frame.countIn!==undefined&&typeof frame.countIn!=='boolean'))fail('Invalid clock or renderer state');
 const muted=partSet(frame.mutedPartIds),view=frame.view??{},hidden=partSet(view.hiddenPartIds);
 if((view.layout!==undefined&&!['complete','solo'].includes(view.layout))||(view.hideOtherParts!==undefined&&typeof view.hideOtherParts!=='boolean'))fail('Invalid view filters');
 const rows=[];
 for(const[partId,part]of index.parts){const activeGateCount=upperBound(part.starts,frame.positionMs)-upperBound(part.ends,frame.positionMs);let state;
  if(frame.transport==='unavailable')state='unavailable';else if(frame.transport==='preparing')state='preparing';else if(frame.transport==='paused')state='paused';else if(frame.transport==='ended')state='ended';else if(frame.transport==='ready'||frame.transport==='stopped')state='ready';else if(frame.soundEnabled===false||muted.has(partId))state='muted';else if(frame.rendererState!=='running')state='unavailable';else if(frame.countIn||frame.positionMs<0)state='ready';else state=activeGateCount>0?'playing':'silent';
  rows.push(Object.freeze({...part.metadata,state,activeGateCount,visible:view.layout!=='solo'&&view.hideOtherParts!==true&&!hidden.has(partId)}));
 }return Object.freeze({rows:Object.freeze(rows),positionMs:frame.positionMs});
}
