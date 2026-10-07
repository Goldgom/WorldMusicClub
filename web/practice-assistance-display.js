import {practiceAssistanceBinding} from './practice-assistance-receipt.js';

const indexes = new WeakMap(), receipts = new WeakMap();
const fail = message => {throw Object.assign(new TypeError(message), {code:'practice_assistance_display_identity'});};

/** One complete join per admitted immutable receipt. The caller supplies the
 * current receipt and its original native/compiled timeline, never a viewport,
 * selected-part timeline, or a deduplicated physical target list. */
export function createPracticeAssistanceDisplayIndex({assistance,sourceNotes}={}) {
  const cached=indexes.get(assistance);
  if(cached){if(cached.sourceNotes!==sourceNotes)fail('The display receipt belongs to another complete timeline.');return cached.index;}
  const binding=practiceAssistanceBinding(assistance); // Reject caller-made DTOs.
  const boundNotes=binding.source===null?binding.runtimeToken?.notes:binding.sourceToken?.compilation?.timeline?.notes;
  if(boundNotes!==sourceNotes)fail('Display ownership needs the timeline retained by its admitted runtime.');
  if(!Array.isArray(sourceNotes)||sourceNotes.length>100000)fail('Display ownership needs the complete bounded source timeline.');
  const units=new Map(assistance.source_ownership.map(unit=>[unit.source_id,unit]));
  const machineParts=new Set(assistance.source_ownership.filter(unit=>unit.owner==='machine').map(unit=>unit.part_id));
  const occurrences=new Map(),human=new Set(),machine=new Set(assistance.machine_occurrence_ids),seenUnits=new Set(),atoms=new Map();
  const targets=new Map(assistance.human_targets.groups.map(group=>[group.target_id,group]));
  const targetParts=new Map(assistance.human_targets.groups.map(group=>[group.target_id,new Set(group.part_ids)]));
  for(const group of targets.values())for(const id of group.source_occurrence_ids){if(human.has(id)||machine.has(id))fail('A display occurrence has conflicting owners.');human.add(id);}
  for(const note of sourceNotes){
    if(!note||occurrences.has(note.id)||human.has(note.id)===machine.has(note.id)||!Array.isArray(note.source_note_ids)||!note.source_note_ids.length)fail('Every source occurrence needs exactly one checked display owner.');
    const role=human.has(note.id)?'human':'machine';
    for(const id of note.source_note_ids){const unit=units.get(id);if(!unit||unit.part_id!==note.part_id||unit.owner!==role)fail('The source-unit and occurrence display identities disagree.');seenUnits.add(id);}
    if(assistance.plan.selection.profile.kind==='piano'){
      const key=`${note.start_ms}:${note.midi}`,previous=atoms.get(key);
      if(previous&&previous!==role)fail('A physical keyboard unison cannot have two display owners.');atoms.set(key,role);
    }
    occurrences.set(note.id,Object.freeze({role,partId:note.part_id,midi:note.midi,sourceIds:new Set(note.source_note_ids)}));
  }
  if(occurrences.size!==human.size+machine.size||occurrences.size!==assistance.coverage.occurrence_count||seenUnits.size!==units.size)fail('Display ownership does not cover the complete source.');
  for(const group of targets.values()){
    const sources=new Set();for(const id of group.source_occurrence_ids){const occurrence=occurrences.get(id);if(!occurrence||occurrence.role!=='human')fail('A physical target references a missing human occurrence.');for(const sourceId of occurrence.sourceIds)sources.add(sourceId);}
    if(sources.size!==group.source_note_ids.length||group.source_note_ids.some(id=>!sources.has(id)))fail('A physical target lost a tied or repeated source identity.');
  }
  const sourceRole=(id,partId)=>{const unit=units.get(id);return unit&&(partId==null||unit.part_id===partId)?unit.owner:null;};
  const index=Object.freeze({assistance,sourceRole,isHumanSource:(id,partId)=>sourceRole(id,partId)==='human',hasMachinePart:id=>machineParts.has(id),
    occurrenceRole:id=>occurrences.get(id)?.role??null,
    sourceNoteRole(note){const row=occurrences.get(note.id);if(!row||row.partId!==note.part_id||row.midi!==note.midi)fail('A displayed occurrence belongs to another source.');return row.role;},
    isHumanTarget:note=>Boolean(targetParts.get(note.id)?.has(note.part_id)&&occurrences.get(note.id)?.midi===note.midi),
  });
  receipts.set(index,assistance);indexes.set(assistance,{sourceNotes,index});return index;
}

/** The app owns the live source/selection fence; this boundary prevents a
 * previous receipt's cached index being reused after that fence changes. */
export function assertPracticeAssistanceDisplay(assistance,ownershipIndex){
  if(assistance==null){if(ownershipIndex!=null)fail('A display index requires its current assistance receipt.');return null;}
  if(receipts.get(ownershipIndex)!==assistance)fail('Display ownership is missing or stale for the current receipt.');
  return ownershipIndex;
}
