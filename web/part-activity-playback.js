import {validateCanonicalAudioPlan,CANONICAL_AUDIO_PROFILE} from './canonical-audio-plan.js';
import {canonicalFingerprint} from './canonical-audio-fingerprint.js';
import {isBasicKeysSong,isVsqSong} from './clean-song-package.js';
import {humanPracticePartIds} from './practice-selection.js';
import {assertAssistanceAudioCurrent,emptyAssistedListen} from './practice-assistance-audio.js';

const admitted=new WeakSet(),handles=new WeakMap(),cache=new WeakMap(),selections=new WeakMap(),canonicalAdmissions=new WeakMap(),cleanAdmissions=new WeakMap(),retirementRevisions=new WeakMap();
export function invalidatePartActivityRetirement(owner){retirementRevisions.set(owner,(retirementRevisions.get(owner)||0)+1);}
const token=value=>{if(!value||typeof value!=='object')throw new TypeError('Missing activity identity');if(!handles.has(value))handles.set(value,Object.freeze({}));return handles.get(value);};
export const isAdmittedPartActivitySnapshot=value=>admitted.has(value);
export function rememberCleanActivityOptions(player,options={}){
 invalidatePartActivityRetirement(player);
 const selection=options.practiceSelection;
 selections.set(player,Object.freeze({mode:options.mode,targetPart:options.targetPart,practiceSelection:selection?Object.freeze({...selection,part_ids:selection.part_ids?Object.freeze([...selection.part_ids]):undefined}):undefined,mutedParts:Object.freeze([...(options.mutedParts||[])]),soloParts:Object.freeze([...(options.soloParts||[])])}));
}
const unavailable=reason=>Object.freeze({status:'unavailable',reason});
const requireThat=value=>{if(!value)throw new TypeError('Activity join unavailable or ambiguous');};
const ownershipBinding=context=>typeof context==='function'?context():context;
function ownershipStamp(context){const b=ownershipBinding(context);return b?Object.freeze({sourceToken:b.sourceToken,runtimeToken:b.runtimeToken,digest:b.expected_selection_digest,revision:b.revision??1,pitchMod:b.pitchMod}):null;}
function ownershipCurrent(stamp,context){const b=ownershipBinding(context);return stamp?Boolean(b&&b.sourceToken===stamp.sourceToken&&b.runtimeToken===stamp.runtimeToken&&b.expected_selection_digest===stamp.digest&&(b.revision??1)===stamp.revision&&b.pitchMod===stamp.pitchMod):!b;}
function snapshotFor({owner,source,runtime,plan,parts,timeline,canonical,human,assistance,assistanceContext}){
 const prior=cache.get(owner);
 if(prior?.plan===plan&&prior.source===source&&prior.runtime===runtime&&prior.checked===(assistance??null)){requireThat(!assistance||ownershipCurrent(prior.ownership,assistanceContext));return prior.snapshot;}
 const checked=assertAssistanceAudioCurrent(assistance,assistanceContext,source,runtime);
 if(checked){const {plan:ownership,receipt}=checked;requireThat(plan.assistanceFingerprint===canonicalFingerprint('wmc-assistance-audio-ownership-v1',{receipt,revision:ownership.revision,planner_revision:ownership.planner_revision,selection:ownership.selection,mode:ownership.mode,settings:ownership.settings,selection_digest:ownership.selection_digest}));}
 else requireThat(!plan.assistanceFingerprint);
 requireThat(Array.isArray(parts)&&parts.length<=128&&Array.isArray(timeline)&&timeline.length<=100000);
 const partIds=new Set(),byId=new Map();
 for(const p of parts){requireThat(typeof p.id==='string'&&!partIds.has(p.id));partIds.add(p.id);}
 for(const n of timeline){requireThat(typeof n.id==='string'&&!byId.has(n.id)&&partIds.has(n.part_id));byId.set(n.id,n);}
 if(canonical){
  validateCanonicalAudioPlan(plan);requireThat(plan.sourceFingerprint===canonicalFingerprint('wmh-canonical-score-v1',source.score));
  const occurrences=timeline.map((n,i)=>{const m=plan.mapping[i];requireThat(m&&m.id===n.id&&m.partId===n.part_id&&n.source_note_ids?.length===m.sourceIndices.length&&m.sourceIndices.every((s,j)=>plan.sourceIds[s]===n.source_note_ids[j]));return{id:n.id,part_index:plan.partIds.indexOf(n.part_id),source_indices:[...m.sourceIndices],midi:n.midi,velocity:n.velocity,start_ms:n.start_ms,duration_ms:n.duration_ms};});
  requireThat(plan.mapping.length===timeline.length&&plan.compiledFingerprint===canonicalFingerprint(CANONICAL_AUDIO_PROFILE,{profile:CANONICAL_AUDIO_PROFILE,policy_id:plan.policyId,source_fingerprint:plan.sourceFingerprint,duration_ms:source.timeline.duration_ms,part_ids:[...plan.partIds],source_note_ids:[...plan.sourceIds],source_references:plan.sourceReferences,occurrences}));
 }else requireThat(plan.sourceSha256===source.score.source.sha256&&plan.sourceNotes===timeline.length&&Object.isFrozen(plan));
 const machines=checked?new Set(checked.machine_occurrence_ids):new Set(timeline.filter(n=>!human.has(n.part_id)).map(n=>n.id));
 requireThat([...machines].every(id=>byId.has(id)));
 const machineParts=new Set([...machines].map(id=>byId.get(id).part_id)),gates=[];
 for(const row of plan.notes){
  if(canonical&&row[4]===0)continue;
  const id=canonical?plan.mapping[row[0]]?.id:row[0],n=byId.get(id);requireThat(n&&machines.has(id));
  let start=canonical?row[1]:row[2],end=canonical?row[2]:row[3];
  if(canonical&&plan.rangeMode){start=Math.max(start,plan.rangeStartFrame);end=Math.min(end,plan.rangeEndFrame);if(end<=start)continue;}
  requireThat(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start);
  gates.push(Object.freeze({partId:n.part_id,occurrenceId:id,startMs:start*1000/plan.sampleRate,endMs:end*1000/plan.sampleRate}));
 }
 const binding=Object.freeze({sourceToken:token(source),runtimeToken:token(runtime),planToken:token(plan),ownershipToken:token(checked||plan)});
 const snapshot=Object.freeze({...binding,parts:Object.freeze(parts.filter(p=>machineParts.has(p.id)).map(p=>Object.freeze({partId:p.id,label:typeof p.name==='string'?p.name:typeof p.label==='string'?p.label:p.id,machineSubset:human.has(p.id)}))),gates:Object.freeze(gates),durationMs:plan.durationFrames*1000/plan.sampleRate});
 admitted.add(snapshot);cache.set(owner,{source,runtime,plan,checked,snapshot,ownership:assistance?ownershipStamp(assistanceContext):null});return snapshot;
}
function result(snapshot,{positionMs,transport='stopped',countIn=false,soundEnabled=true,view},player,{epoch,preparing=false,mutedPartIds=[],clock=null}={}){
 const binding=Object.freeze({sourceToken:snapshot.sourceToken,runtimeToken:snapshot.runtimeToken,planToken:snapshot.planToken,ownershipToken:snapshot.ownershipToken});
 const rendererState=player.context?.state==='suspended'?'suspended':player.context?.state==='running'&&player.running?'running':player.context?.state==='closed'?'unavailable':'stopped';
 const effective=preparing?'preparing':clock?.ended?'ended':transport==='running'&&!player.running&&soundEnabled?'unavailable':transport;
 return Object.freeze({status:'ready',snapshot,binding,epoch,frame:Object.freeze({binding,positionMs:Number.isFinite(positionMs)?positionMs:clock?.positionMs,transport:effective,rendererState,countIn:Boolean(clock?.inCountIn||clock?.phase==='scheduled'||countIn),soundEnabled,mutedPartIds:Object.freeze(mutedPartIds.filter(id=>snapshot.parts.some(p=>p.partId===id))),...(view?{view}:{})})});
}
export function captureCleanActivityAdmission(player){
 cleanAdmissions.delete(player);
 try{
  const source=player.song;if(!isBasicKeysSong(source)&&!isVsqSong(source))return;
  const active=isVsqSong(source)?player.vsq:player.basicKeys,plan=active.plan,options=selections.get(player);if(!plan||!options||active.preparing)return;
  const parts=source.runtime.parts.map(p=>({...p,id:p.id??p.part_id}));
  const human=emptyAssistedListen(active.assistance,options.mode,options.practiceSelection)?new Set():humanPracticePartIds(parts,{...options,mode:active.assistance?'practice':options.mode||'listen'});
  const snapshot=snapshotFor({owner:active,source,runtime:source.runtime,plan,parts,timeline:source.compilation.timeline.notes,human,assistance:active.assistance,assistanceContext:active.assistanceContext});
  cleanAdmissions.set(player,{source,runtime:source.runtime,active,plan,snapshot,options,epoch:active.epoch,assistance:active.assistance,assistanceContext:active.assistanceContext,ownership:active.assistance?ownershipStamp(active.assistanceContext):null,mutedPartIds:[...new Set([...options.mutedParts,...(options.soloParts.length?parts.filter(p=>!options.soloParts.includes(p.id)).map(p=>p.id):[])])]});
 }catch{/* Display failure cannot reject audio admission. */}
}
export function cleanActivityPlayback(player,frame={}){
 try{const r=cleanAdmissions.get(player),active=r?.active;
  if(!r||r.source!==player.song||r.runtime!==player.song.runtime||r.plan!==active.plan||r.epoch!==active.epoch||r.options!==selections.get(player)||active.preparing||r.assistance!==active.assistance||!ownershipCurrent(r.ownership,active.assistanceContext))return unavailable('no_current_activity_admission');
  return result(r.snapshot,frame,active,{epoch:active.epoch,mutedPartIds:r.mutedPartIds});
 }catch{return unavailable('activity_join_unavailable');}
}
export function clearCanonicalActivityAdmission(session){canonicalAdmissions.delete(session);cache.delete(session);}
export function captureCanonicalActivityAdmission(session,{assistance,assistanceContext}={}){
 canonicalAdmissions.delete(session);
 try{const source=session.compilation,plan=session.plan;
  const snapshot=snapshotFor({owner:session,source,runtime:source.timeline,plan,parts:source.score.parts,timeline:source.timeline.notes,canonical:true,human:new Set(plan.selection.part_ids),assistance,assistanceContext});
  canonicalAdmissions.set(session,{snapshot,source,runtime:source.timeline,plan,epoch:session.epoch,playerEpoch:session.player.epoch,assistance,assistanceContext,ownership:assistance?ownershipStamp(assistanceContext):null});
 }catch{/* Display failure cannot reject audio admission. */}
}
export function canonicalActivityPlayback(session,frame={}){
 try{const receipt=canonicalAdmissions.get(session),source=session.compilation,plan=session.plan,player=session.player;
  if(!plan)return unavailable(session.preparing?'preparing':'no_admitted_plan');
  if(!receipt||receipt.source!==source||receipt.runtime!==source.timeline||receipt.plan!==plan||receipt.epoch!==session.epoch||receipt.playerEpoch!==player.epoch||session.preparing)return unavailable('no_current_activity_admission');
  if(receipt.assistance&&!ownershipCurrent(receipt.ownership,receipt.assistanceContext)||session.interpretation?.sound_enabled&&player.assistance!==receipt.assistance)return unavailable('stale_activity_ownership');
  const clock=Object.hasOwn(frame,'sourceClock')?frame.sourceClock:Number.isFinite(frame.now)?session.sourceClock(frame.now):null;
  if(frame.transport==='running'&&session.interpretation?.sound_enabled&&!clock)return unavailable('source_clock_unavailable');
  return result(receipt.snapshot,{...frame,soundEnabled:session.interpretation?.sound_enabled===true},player,{epoch:session.epoch,preparing:session.preparing,mutedPartIds:plan.mutedPartIds,clock});
 }catch{return unavailable('activity_join_unavailable');}
}

/** Display-only retirement never satisfies live epoch/plan admission. */
export function retirePartActivityAdmission(owner,{clean=false}={}){
 const r=clean?cleanAdmissions.get(owner):canonicalAdmissions.get(owner);if(!r)return null;
 const live=clean?cleanActivityPlayback(owner,{positionMs:0,transport:'paused'}):canonicalActivityPlayback(owner,{positionMs:0,transport:'paused',sourceClock:null});
 if(live.status!=='ready')return null;
 const active=clean?r.active:owner.player,source=r.source,runtime=r.runtime,context=r.assistanceContext,revision=retirementRevisions.get(owner)||0;
 return Object.freeze({snapshot:live.snapshot,binding:live.binding,current(){
  try{return revision===(retirementRevisions.get(owner)||0)&&(clean?owner.song===source&&source.runtime===runtime:owner.compilation===source&&source.timeline===runtime)&&!active.running&&!active.preparing&&!owner.preparing&&!(clean?active.plan:owner.plan)&&ownershipCurrent(r.ownership,context);}catch{return false;}
 }});
}
