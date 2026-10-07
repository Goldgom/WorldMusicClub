import {PracticeAssistanceStore} from './practice-assistance.js';
import {assertPracticeAssistanceCurrent,practiceAssistanceBinding} from './practice-assistance-receipt.js';
import {validateTargetPlan} from './physical-targets.js';

const fail=message=>{throw Object.assign(new Error(message),{code:'stale_practice_assistance'});};

/** The source tokens are the actual player inputs, never a reconstructed clock. */
export function appAssistanceContext(value,profile,identity) {
  if(!value?.compiled||!value.score)return null;
  const song=value.cleanSong,mod=value.songMod||value.mod;
  const selected=mod?mod.config.parts.filter(part=>part.performer==='human').map(part=>part.partId):value.practiceSelection?.part_ids||value.score.parts.map(part=>part.id);
  const source=song?{key:song.libraryKey.replace(/^native:/,''),content_sha256:song.identity,profile:song.profile,choice:song.runtime?.choice??null,runtime_policy:song.profile==='wmh-basic-keys-midi1-v1'?'wmh-basic-key-rendition-fifo-v1':song.runtime?.profile||song.profile}:null;
  return {source,selection:{selected_part_ids:[...selected].sort(),profile},sourceToken:song||value.compiled,runtimeToken:song?song.runtime:value.compiled.timeline,score:value.compiled.score,preferenceKey:JSON.stringify([identity.songId,identity.sourceRevision.kind,identity.sourceRevision.value])};
}

/** Re-read BOTH active ownership and current source/profile/union after awaits. */
export function currentAppAssistanceBinding(controller,context) {
  const assistance=controller.current();
  if(!assistance||!context)fail('The checked note assignment is no longer active.');
  const binding={source:context.source,selection:context.selection,sourceToken:context.sourceToken,runtimeToken:context.runtimeToken,mode:assistance.plan.mode,settings:assistance.plan.settings,revision:assistance.plan.revision,receipt:assistance.receipt,expected_selection_digest:assistance.plan.selection_digest};
  assertPracticeAssistanceCurrent(assistance,binding);
  return binding;
}

/** Quota failures retain an explicit tab-only recipe across preview/stage
 * revalidation. Invalid or changed stored bytes never inherit that overlay. */
export class AppAssistanceStore extends PracticeAssistanceStore {
  constructor(options){super(options);this.session=new Map();}
  read(context){const stored=super.read(context),session=this.session.get(this.key(context));return session&&stored.status!=='invalid'&&stored.raw===session.raw?session:stored;}
  save(context,recipe,options){const saved=super.save(context,recipe,options);if(saved.status==='unsaved')this.session.set(this.key(context),saved);else this.session.delete(this.key(context));return saved;}
}

export function assistancePracticeGate(controller) {
  const state=controller.state();
  if(['default','ready','editing','prepared'].includes(state.phase)&&(state.active||state.persistence.status==='default'))return null;
  return {status:['loading','preparing','idle'].includes(state.phase)?'pending':'blocked',reason:state.error?.message||'Validate the saved note assignment in Mod before practicing.',assistance:true};
}

/** Scope checked physical targets only; original occurrence times and source
 * timeline are preserved. A loop cannot reconstruct machine notes as targets. */
export function scopedAssistanceTargets(assistance,timeline,loop=null) {
  assertPracticeAssistanceCurrent(assistance,practiceAssistanceBinding(assistance));
  const all=assistance.human_targets,windowIds=loop?new Set(loop.target_note_ids):null;
  const groups=all.groups.filter(group=>!windowIds||group.source_occurrence_ids.some(id=>windowIds.has(id)));
  const ids=new Set(groups.flatMap(group=>group.source_occurrence_ids)),targets=new Set(groups.map(group=>group.target_id));
  const sourceTimeline={...timeline,notes:timeline.notes.filter(note=>ids.has(note.id))};
  const plan={...all,groups,source_note_count:ids.size,target_count:groups.length,playable:all.playable&&groups.length>0,timeline:{...all.timeline,notes:all.timeline.notes.filter(note=>targets.has(note.id))}};
  validateTargetPlan(plan,sourceTimeline);
  return {plan,sourceTimeline,allowed:assistance.scored_mode_allowed&&plan.playable&&plan.target_count>0};
}

export function assistanceTakeIdentity(assistance) {
  if(!assistance)return null;
  assertPracticeAssistanceCurrent(assistance,practiceAssistanceBinding(assistance));
  return structuredClone({plan:assistance.plan,receipt:assistance.receipt,human_target_ids:assistance.human_targets.groups.map(group=>group.target_id),machine_occurrence_ids:assistance.machine_occurrence_ids,scored_mode_allowed:assistance.scored_mode_allowed});
}
