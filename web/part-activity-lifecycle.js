import {songModChanges} from './song-mod.js';

/** Bounded, cached display-retirement policy identity, never audio admission.
 * Mod/selection are replaced at application boundaries. Only their display
 * fields may change without rotating this token; reverting an audio policy
 * still rotates it, so an older retired snapshot cannot become current again.
 */
export function createPartActivityPolicyStamp(){
 let previousMod,previousSelection,stamp={};
 return (mod,selection)=>{
  if(mod===previousMod&&selection===previousSelection)return stamp;
  let displayOnly=false;
  try{
   const changes=songModChanges(previousMod,mod);
   displayOnly=previousMod.songId===mod.songId&&previousMod.sourceRevision.kind===mod.sourceRevision.kind&&previousMod.sourceRevision.value===mod.sourceRevision.value&&
    !changes.ownership&&!changes.instruments&&!changes.mix&&
    previousMod.config.parts.length===mod.config.parts.length&&previousMod.config.parts.every((part,i)=>part.partId===mod.config.parts[i].partId)&&
    previousSelection.kind===selection.kind&&previousSelection.part_ids.length===selection.part_ids.length&&previousSelection.part_ids.every((id,i)=>id===selection.part_ids[i]);
  }catch{/* Missing or invalid policy evidence invalidates retained display. */}
  if(!displayOnly)stamp={};
  previousMod=mod;previousSelection=selection;return stamp;
 };
}
