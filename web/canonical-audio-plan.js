import {assistanceAudioMask, emptyAssistedListen} from './practice-assistance-audio.js';
import {resolvePracticeSelection} from './practice-selection.js';
import {CanonicalFingerprint,canonicalFingerprint,canonicalUtf8} from './canonical-audio-fingerprint.js';
import {BasicKeyAudioError,basicKeySampleRate} from './basic-key-audio-plan.js';

export const CANONICAL_AUDIO_PROFILE='wmh-canonical-compiled-audio-v1';
export const CANONICAL_AUDIO_PROTOCOL='wmh-canonical-audio-v1';
export const CANONICAL_AUDIO_POLICY='wmh-canonical-sine-ms-v1';
export const CANONICAL_SYNTHESIS_POLICY='wmh-canonical-additive-timbres-v1';
export const CANONICAL_SYNTHETIC_INSTRUMENTS=Object.freeze(['sine','triangle','reed']);
export const CANONICAL_LOOP_POLICY='wmh-canonical-clip-rearticulate-v1';
export const CANONICAL_AUDIO_IDENTITY='canonical-occurrence-index';
export const CANONICAL_AUDIO_LIMITS=Object.freeze({maxNotes:100000,maxSourceNotes:100000,maxReferences:1000000,maxParts:128,maxBytes:16*1024*1024,maxProfileBytes:32*1024*1024,maxEncodingBytes:64*1024*1024,maxVoices:128,maxGeneration:0x7fffffff,maxFrame:2**48,maxAuditRows:256,maxPauses:4096,maxPasses:4096,maxGateRecords:500000});
const L=CANONICAL_AUDIO_LIMITS, admitted=new WeakSet();
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const fail=(message,code='invalid_canonical_audio_plan',details={})=>{throw new BasicKeyAudioError(code,message,details);};
const id=s=>typeof s==='string'&&s.length>0&&canonicalUtf8(s).length<=128;
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);

/** These are Rust-derived binary64 milliseconds, NOT exact rational micros.
 * Floor the attack, ceil the end. Preserve every positive representable gate,
 * including a subframe gate; reject unrepresentable/oversized timing. */
export function canonicalGateFrames(startMs,durationMs,sampleRate){
  basicKeySampleRate(sampleRate);const endMs=startMs+durationMs;
  if(!Number.isFinite(startMs)||startMs<0||!Number.isFinite(durationMs)||durationMs<=0||!Number.isFinite(endMs)||endMs<=startMs)fail('Compiled milliseconds cannot represent a positive canonical gate.','canonical_audio_timing');
  const start=Math.floor(startMs*sampleRate/1000),end=Math.ceil(endMs*sampleRate/1000);
  if(!int(start,0,L.maxFrame)||!int(end,start+1,L.maxFrame))fail('Canonical gate exceeds the sample-frame budget.','canonical_audio_timing');
  return [start,end];
}

/** Verify the separate Rust evidence against the selected canonical Compilation.
 * This never compiles notation or calls the physical-input target deduper. */
export function buildCanonicalAudioPlan(compilation,profile,{sampleRate,mode='practice',practiceSelection,acceptedPolicyId,audiblePartIds,instrumentOverrides,mutedPartIds,range,countInMs,loop=false,resumePositionMs,assistance,assistanceContext}={}){
  basicKeySampleRate(sampleRate);
  if(acceptedPolicyId!==CANONICAL_AUDIO_POLICY)fail('Accept the disclosed sine interpretation of compiled canonical notes before playback.','reference_policy_required');
  if(!compilation?.score||!Array.isArray(compilation.timeline?.notes)||!profile||profile.profile!==CANONICAL_AUDIO_PROFILE||profile.policy_id!==CANONICAL_AUDIO_POLICY||!hash(profile.source_fingerprint)||!hash(profile.compiled_fingerprint))fail('A canonical compilation and matching Rust audio profile are required.');
  if(!['practice','listen'].includes(mode))fail('Unknown canonical playback mode.');
  const {score,timeline}=compilation;
  if(!Array.isArray(score.parts)||!int(score.parts.length,1,L.maxParts)||!Array.isArray(profile.part_ids)||!same(profile.part_ids,score.parts.map(p=>p.id))||profile.part_ids.some(p=>!id(p))||new Set(profile.part_ids).size!==profile.part_ids.length)fail('The canonical part table does not match the selected score.');
  const sourceIds=score.parts.flatMap(p=>p.notes.map(n=>n.id));
  if(sourceIds.length>L.maxSourceNotes||timeline.notes.length>L.maxNotes||!Array.isArray(profile.occurrences)||profile.occurrences.length!==timeline.notes.length||!same(sourceIds,profile.source_note_ids)||sourceIds.some(s=>!id(s))||new Set(sourceIds).size!==sourceIds.length||!int(profile.source_references,0,L.maxReferences))fail('The canonical source or occurrence table exceeds its complete-score budget.','canonical_audio_budget');
  if(!Number.isFinite(profile.duration_ms)||profile.duration_ms<0||profile.duration_ms!==timeline.duration_ms)fail('The canonical source duration does not match.');
  const profileKeys=['profile','policy_id','source_fingerprint','compiled_fingerprint','duration_ms','part_ids','source_note_ids','source_references','occurrences'];
  if(!same(Object.keys(profile).sort(),profileKeys.sort()))fail('Unknown canonical profile fields.');
  if(canonicalUtf8(JSON.stringify(profile)).length>L.maxProfileBytes)fail('The complete canonical profile exceeds 32 MiB.','canonical_audio_budget');
  if(canonicalFingerprint('wmh-canonical-score-v1',score)!==profile.source_fingerprint)fail('The canonical profile belongs to a different full score.');
  const {compiled_fingerprint,...unsigned}=profile;
  if(canonicalFingerprint(CANONICAL_AUDIO_PROFILE,unsigned)!==compiled_fingerprint)fail('The compiled canonical fingerprint is inconsistent.');
  const selection=emptyAssistedListen(assistance,mode,practiceSelection)?{kind:'parts',part_ids:[]}:mode==='practice'||assistance!=null?resolvePracticeSelection(score.parts,practiceSelection):{kind:'listen',part_ids:[]};
  const mask=assistanceAudioMask(assistance,assistanceContext,{sourceToken:compilation,runtimeToken:timeline,sourceProfile:'wmc-canonical-score-v1',runtimePolicy:'wmc-canonical-practice-v1',partIds:selection.part_ids,notes:timeline.notes});
  if(instrumentOverrides!==undefined&&(!instrumentOverrides||![Object.prototype,null].includes(Object.getPrototypeOf(instrumentOverrides))||Reflect.ownKeys(instrumentOverrides).some(partId=>{const descriptor=Object.getOwnPropertyDescriptor(instrumentOverrides,partId);return !profile.part_ids.includes(partId)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||!CANONICAL_SYNTHETIC_INSTRUMENTS.includes(descriptor.value);})))fail('Synthetic instrument overrides must name existing parts and sine, triangle, or reed.');
  if(mutedPartIds!==undefined&&(!Array.isArray(mutedPartIds)||mutedPartIds.length>L.maxParts||new Set(mutedPartIds).size!==mutedPartIds.length||[...mutedPartIds].some(partId=>!profile.part_ids.includes(partId))))fail('Muted parts must be a unique list of existing canonical parts.');
  const overrides=Object.freeze(Object.fromEntries(profile.part_ids.filter(partId=>instrumentOverrides&&Object.hasOwn(instrumentOverrides,partId)).map(partId=>[partId,instrumentOverrides[partId]])));
  const muted=Object.freeze(profile.part_ids.filter(partId=>mutedPartIds?.includes(partId))),mutedSet=new Set(muted),hasInstruments=Object.keys(overrides).length>0;
  let audible=null;
  if(audiblePartIds!==undefined){if(mode!=='listen'||!Array.isArray(audiblePartIds)||!audiblePartIds.length||new Set(audiblePartIds).size!==audiblePartIds.length||audiblePartIds.some(id=>!profile.part_ids.includes(id)))fail('The explicit Listen part mix is invalid.');audible=profile.part_ids.filter(id=>audiblePartIds.includes(id));}
  const audibleSet=audible&&new Set(audible),human=new Set(selection.part_ids),notes=[],mapping=[],seen=new Set();let refs=0,durationFrames=Math.ceil(profile.duration_ms*sampleRate/1000);
  for(let i=0;i<profile.occurrences.length;i++){
    const o=profile.occurrences[i],n=timeline.notes[i];
    if(!o||!same(Object.keys(o).sort(),['id','part_index','source_indices','midi','velocity','start_ms','duration_ms'].sort())||!id(o.id)||seen.has(o.id)||o.id!==n.id||!int(o.part_index,0,profile.part_ids.length-1)||profile.part_ids[o.part_index]!==n.part_id||!Array.isArray(o.source_indices)||!o.source_indices.length||!Array.isArray(n.source_note_ids)||o.source_indices.length!==n.source_note_ids.length||!int(o.midi,0,127)||!int(o.velocity,0,127)||o.midi!==n.midi||o.velocity!==n.velocity||o.start_ms!==n.start_ms||o.duration_ms!==n.duration_ms)fail('A canonical occurrence no longer matches its compiler evidence.');
    seen.add(o.id);refs+=o.source_indices.length;
    if(refs>L.maxReferences||o.source_indices.some((s,j)=>!int(s,0,sourceIds.length-1)||sourceIds[s]!==n.source_note_ids[j])||n.source_note_id!==n.source_note_ids[0])fail('The canonical tie/repeat source references do not match.');
    const [start,end]=canonicalGateFrames(o.start_ms,o.duration_ms,sampleRate);durationFrames=Math.max(durationFrames,end);
    mapping.push(Object.freeze({id:o.id,partId:n.part_id,sourceIndices:Object.freeze([...o.source_indices])}));
    if((mask?mask.isMachine(o.id):!human.has(n.part_id))&&!mutedSet.has(n.part_id)&&(!audibleSet||audibleSet.has(n.part_id))){
      if(440*2**((o.midi-69)/12)>sampleRate*.45)fail('This sample rate cannot represent every retained canonical pitch.','unsupported_audio_sample_rate');
      notes.push(Object.freeze([i,start,end,o.midi,o.velocity]));
    }
  }
  if(refs!==profile.source_references||!int(durationFrames,0,L.maxFrame))fail('The canonical duration or source-reference count is inconsistent.');
  notes.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  const rangeMode=range!==undefined||countInMs!==undefined||loop!==false;
  const loopEnabled=loop===true||loop?.enabled===true;
  if(loop!==false&&loop!==true&&(!loop||typeof loop!=='object'||loop.enabled!==true))fail('The canonical loop option is invalid.');
  const requestedPasses=loopEnabled?(loop.maxPasses??L.maxPasses):1;
  if(!int(requestedPasses,1,L.maxPasses)||loopEnabled&&requestedPasses<2)fail('A loop requests 2–4096 complete passes.');
  if(range!==undefined&&(!range||!Number.isFinite(range.startMs)||!Number.isFinite(range.endMs)||range.startMs<0||range.endMs<range.startMs||range.endMs>durationFrames*1000/sampleRate))fail('The canonical A/B range is invalid.');
  const rangeStartFrame=range?Math.round(range.startMs*sampleRate/1000):0,rangeEndFrame=range?Math.round(range.endMs*sampleRate/1000):durationFrames;
  const countInFrames=Math.round((countInMs??0)*sampleRate/1000);
  if(!int(countInFrames,0,600*sampleRate)||!int(rangeStartFrame,0,durationFrames)||!int(rangeEndFrame,rangeStartFrame,durationFrames)||loopEnabled&&rangeEndFrame===rangeStartFrame)fail('The range or count-in frame budget is invalid.');
  const rangeOrder=[];for(let i=0;i<notes.length;i++)if(notes[i][2]>rangeStartFrame&&notes[i][1]<rangeEndFrame)rangeOrder.push(i);
  const explicitPosition=rangeMode&&resumePositionMs!=null;
  const requestedPositionFrame=explicitPosition?Math.round(resumePositionMs*sampleRate/1000):rangeStartFrame-countInFrames;
  if(!int(requestedPositionFrame,rangeStartFrame-countInFrames,rangeEndFrame))fail('A range resume must remain within its A/count-in through B bounds.');
  const initialPositionFrame=Math.max(rangeStartFrame,requestedPositionFrame),initialCountInFrames=initialPositionFrame-requestedPositionFrame;
  const firstRangeOrder=rangeOrder.filter(i=>initialPositionFrame<rangeEndFrame&&notes[i][2]>initialPositionFrame),firstGateCount=firstRangeOrder.length,rangeGateCount=rangeOrder.length;
  // Budget includes the full immutable wire, complete actual gate ledger,
  // per-pass anchors and fixed pause spans. No repeated source-note copies.
  const byRecords=rangeGateCount?1+Math.floor((L.maxGateRecords-firstGateCount)/rangeGateCount):L.maxPasses;
  const byBytes=1+Math.floor((L.maxBytes-notes.length*(CANONICAL_AUDIO_BYTES_PER_NOTE+Number(hasInstruments))-L.maxPauses*16-rangeGateCount*4-firstGateCount*16-8)/(rangeGateCount*16+8));
  const maxPasses=rangeMode?Math.min(requestedPasses,byRecords,byBytes):1,recordCapacity=rangeMode?firstGateCount+rangeGateCount*(maxPasses-1):0;
  if(maxPasses<1||!int(initialCountInFrames+rangeEndFrame-initialPositionFrame+(maxPasses-1)*(countInFrames+rangeEndFrame-rangeStartFrame),0,L.maxFrame))fail('The complete range/pass ledger cannot fit its audio budget.','canonical_audio_budget');
  // Validate the actual quantized range mix. Out-of-range source data stays in
  // the full plan and fingerprint but never consumes a sounding voice.
  const edges=[];for(const i of rangeMode?rangeOrder:notes.keys()){const n=notes[i];edges.push([rangeMode?Math.max(n[1],rangeStartFrame):n[1],1],[rangeMode?Math.min(n[2],rangeEndFrame):n[2],-1]);}edges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let voices=0;
  for(const [,delta]of edges){voices+=delta;if(voices>L.maxVoices)fail('Canonical playback exceeds 128 simultaneous voices; the whole plan is held.','voice_budget_exceeded');}
  const plan={protocol:CANONICAL_AUDIO_PROTOCOL,policyId:CANONICAL_AUDIO_POLICY,identityKind:CANONICAL_AUDIO_IDENTITY,sourceFingerprint:profile.source_fingerprint,compiledFingerprint:profile.compiled_fingerprint,selectionFingerprint:canonicalFingerprint('wmh-canonical-human-selection-v1',{mode,selection,audiblePartIds:audible}),sampleRate,durationFrames,rangeMode,rangePolicyId:rangeMode?CANONICAL_LOOP_POLICY:null,rangeStartFrame,rangeEndFrame,countInFrames,loopEnabled,requestedPasses,maxPasses,budgetLimited:maxPasses<requestedPasses,rangeGateCount,firstGateCount,initialPositionFrame,initialCountInFrames,recordCapacity,rangeOrder:Object.freeze(rangeOrder),firstRangeOrder:Object.freeze(firstRangeOrder),audiblePartIds:audible&&Object.freeze(audible),sourceDurationMs:profile.duration_ms,sourceNotes:sourceIds.length,sourceReferences:refs,sourceOccurrences:mapping.length,count:notes.length,selection:Object.freeze({kind:selection.kind,part_ids:Object.freeze([...selection.part_ids])}),notes:Object.freeze(notes),mapping:Object.freeze(mapping),sourceIds:Object.freeze(sourceIds),partIds:Object.freeze([...profile.part_ids])};
  // Empty options preserve the original source policy, selection and frame-plan
  // fingerprints. Only renderer choices extend the selection identity.
  plan.instrumentOverrides=overrides;plan.mutedPartIds=muted;
  if(hasInstruments||muted.length)plan.selectionFingerprint=canonicalFingerprint('wmh-canonical-human-selection-v1',{mode,selection,audiblePartIds:audible,instrumentOverrides:overrides,mutedPartIds:muted});
  if(mask){plan.assistanceFingerprint=mask.fingerprint;plan.selectionFingerprint=canonicalFingerprint('wmc-assisted-canonical-selection-v1',{selectionFingerprint:plan.selectionFingerprint,assistanceFingerprint:mask.fingerprint});}
  if(hasInstruments){plan.synthesisPolicyId=CANONICAL_SYNTHESIS_POLICY;plan.instruments=Object.freeze(notes.map(n=>{const partId=mapping[n[0]].partId;return CANONICAL_SYNTHETIC_INSTRUMENTS.indexOf(Object.hasOwn(overrides,partId)?overrides[partId]:'sine');}));}
  const h=canonicalPlanHasher(plan);for(let i=0;i<notes.length;i++){h.gate(...notes[i]);if(hasInstruments)h.number(plan.instruments[i]);}plan.planFingerprint=h.hex();
  Object.freeze(plan);admitted.add(plan);return plan;
}
export function validateCanonicalAudioPlan(plan){if(!admitted.has(plan))fail('Canonical plans must be built from matching immutable Rust compilation evidence.');return plan;}
export function canonicalPlanHasher(p){const h=new CanonicalFingerprint('wmh-canonical-frame-plan-v1').value([p.protocol,p.policyId,p.identityKind,p.sourceFingerprint,p.compiledFingerprint,p.selectionFingerprint,p.sampleRate,p.durationFrames,p.sourceDurationMs,p.sourceNotes,p.sourceReferences,p.sourceOccurrences,p.count,p.rangeMode,p.rangePolicyId,p.rangeStartFrame,p.rangeEndFrame,p.countInFrames,p.loopEnabled,p.requestedPasses,p.maxPasses,p.rangeGateCount,p.firstGateCount,p.initialPositionFrame,p.initialCountInFrames,p.recordCapacity]);if(p.synthesisPolicyId!==undefined)h.string(p.synthesisPolicyId);return h;}
export function canonicalIdentity(plan,index){const n=plan.notes[index],m=plan.mapping[n[0]];return {occurrenceIndex:n[0],noteId:m.id,partId:m.partId,sourceNoteIds:m.sourceIndices.map(i=>plan.sourceIds[i])};}
const FIELDS=Object.freeze({occurrences:Uint32Array,starts:Float64Array,ends:Float64Array,keys:Uint8Array,velocities:Uint8Array,roles:Uint8Array,idOrder:Uint32Array,playOrder:Uint32Array,seen:Uint8Array,steps:Float64Array,actualStarts:Float64Array,actualEnds:Float64Array});
const WIRE_FIELDS=Object.freeze(['protocol','policyId','identityKind','sourceFingerprint','compiledFingerprint','selectionFingerprint','planFingerprint','sampleRate','durationFrames','sourceDurationMs','sourceNotes','sourceReferences','sourceOccurrences','count','rangeMode','rangePolicyId','rangeStartFrame','rangeEndFrame','countInFrames','loopEnabled','requestedPasses','maxPasses','rangeGateCount','firstGateCount','initialPositionFrame','initialCountInFrames','recordCapacity']);
export const CANONICAL_AUDIO_BYTES_PER_NOTE=Object.values(FIELDS).reduce((n,T)=>n+T.BYTES_PER_ELEMENT,0);
const transferFields=p=>({...FIELDS,...(p.synthesisPolicyId!==undefined?{instruments:Uint8Array}:{}),...(p.rangeMode?{loopStarts:Float64Array,loopEnds:Float64Array,passFrames:Float64Array,rangeOrder:Uint32Array}:{})});
const transferLength=(p,k)=>k==='rangeOrder'?p.rangeGateCount:k==='passFrames'?p.maxPasses:k==='loopStarts'||k==='loopEnds'?p.recordCapacity:p.count;
export function createCanonicalAudioTransfer(input){
  const p=validateCanonicalAudioPlan(input),arrays={},buffers={};
  if(p.count*CANONICAL_AUDIO_BYTES_PER_NOTE>L.maxBytes)fail('Canonical transfer exceeds 16 MiB.','canonical_audio_budget');
  for(const [k,T]of Object.entries(transferFields(p))){arrays[k]=new T(transferLength(p,k));buffers[k]=arrays[k].buffer;}
  for(let i=0;i<p.count;i++){const n=p.notes[i];arrays.occurrences[i]=n[0];arrays.starts[i]=n[1];arrays.ends[i]=n[2];arrays.keys[i]=n[3];arrays.velocities[i]=n[4];}
  if(p.synthesisPolicyId!==undefined)arrays.instruments.set(p.instruments);
  arrays.idOrder.set(Array.from({length:p.count},(_,i)=>i).sort((a,b)=>arrays.occurrences[a]-arrays.occurrences[b]));
  const wire={buffers};for(const k of WIRE_FIELDS)wire[k]=p[k];
  if(p.synthesisPolicyId!==undefined)wire.synthesisPolicyId=p.synthesisPolicyId;
  if(Object.values(buffers).reduce((bytes,b)=>bytes+b.byteLength,0)+L.maxPauses*16>L.maxBytes)fail('The complete canonical transfer and pause storage exceed 16 MiB.','canonical_audio_budget');
  return {wire,transfer:Object.values(buffers)};
}
export function openCanonicalAudioTransfer(wire,sampleRate){
  // Reject alternate shared-core synthesis fields instead of allowing an
  // unvalidated renderer recipe to bypass this profile's fingerprint.
  if(wire&&Object.keys(wire).some(k=>k!=='buffers'&&k!=='synthesisPolicyId'&&!WIRE_FIELDS.includes(k)))fail('Unknown canonical transferable fields.');
  if(!wire||wire.protocol!==CANONICAL_AUDIO_PROTOCOL||wire.policyId!==CANONICAL_AUDIO_POLICY||wire.identityKind!==CANONICAL_AUDIO_IDENTITY||!['sourceFingerprint','compiledFingerprint','selectionFingerprint','planFingerprint'].every(k=>hash(wire[k]))||wire.sampleRate!==sampleRate||!int(wire.sourceNotes,0,L.maxSourceNotes)||!int(wire.sourceOccurrences,0,L.maxNotes)||!int(wire.count,0,wire.sourceOccurrences)||!int(wire.sourceReferences,wire.sourceOccurrences,L.maxReferences)||!int(wire.durationFrames,0,L.maxFrame)||!Number.isFinite(wire.sourceDurationMs)||wire.sourceDurationMs<0||!wire.buffers)fail('The canonical transferable envelope is invalid.');
  if(wire.rangePolicyId!==(wire.rangeMode?CANONICAL_LOOP_POLICY:null)||typeof wire.rangeMode!=='boolean'||typeof wire.loopEnabled!=='boolean'||!int(wire.rangeStartFrame,0,wire.durationFrames)||!int(wire.rangeEndFrame,wire.rangeStartFrame,wire.durationFrames)||!int(wire.countInFrames,0,600*sampleRate)||!int(wire.requestedPasses,1,L.maxPasses)||!int(wire.maxPasses,1,wire.requestedPasses)||!int(wire.rangeGateCount,0,wire.count)||!int(wire.recordCapacity,0,L.maxGateRecords)||wire.recordCapacity!==(wire.rangeMode?wire.firstGateCount+wire.rangeGateCount*(wire.maxPasses-1):0)||!int(wire.firstGateCount,0,wire.rangeGateCount)||!int(wire.initialPositionFrame,wire.rangeStartFrame,wire.rangeEndFrame)||!int(wire.initialCountInFrames,0,wire.countInFrames)||wire.loopEnabled&&(!wire.rangeMode||wire.rangeStartFrame===wire.rangeEndFrame)||!wire.rangeMode&&(wire.maxPasses!==1||wire.countInFrames!==0))fail('The canonical range/pass envelope is invalid.');
  if(wire.synthesisPolicyId!==undefined?wire.synthesisPolicyId!==CANONICAL_SYNTHESIS_POLICY:Object.hasOwn(wire.buffers,'instruments'))fail('The canonical synthetic instrument policy is missing or unsupported.');
  basicKeySampleRate(sampleRate);const arrays={},unique=new Set();let bytes=L.maxPauses*16;
  for(const [k,T]of Object.entries(transferFields(wire))){const b=wire.buffers[k];if(!(b instanceof ArrayBuffer)||b.byteLength!==transferLength(wire,k)*T.BYTES_PER_ELEMENT||unique.has(b))fail('The canonical transfer buffers are invalid or aliased.');unique.add(b);bytes+=b.byteLength;arrays[k]=new T(b);}
  if(bytes>L.maxBytes)fail('Canonical transfer exceeds 16 MiB.','canonical_audio_budget');
  return {...wire,buffers:undefined,...arrays};
}
