/** A repair action is guidance from an already checked target set, never an
 * admission override. Applying it still runs the ordinary Rust target checks. */
export function practiceRangeRepair({mode,compatibility,profile,targets}={}) {
  if(mode!=='practice'||compatibility?.status!=='blocked'||compatibility.reasonCode!=='instrument_unplayable'||!(compatibility.reasonParams?.outside>0))return null;
  const valid=Array.isArray(targets)&&targets.length>0&&targets.every(note=>Number.isInteger(note.midi)&&note.midi>=0&&note.midi<=127);
  const fits88=profile?.kind==='piano'&&!compatibility.reasonParams.conflict&&valid&&targets.every(note=>note.midi>=21&&note.midi<=108);
  const already88=profile?.key_count===88&&(profile.lowest_midi==null||profile.lowest_midi===21);
  return {kind:fits88&&!already88?'piano88':'setup',outside:compatibility.reasonParams.outside};
}
