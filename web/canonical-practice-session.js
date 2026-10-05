import {resolvePracticeSelection} from './practice-selection.js';
import {windowNotes} from './practice-settings.js';

/** The legacy single-part control is only a display/navigation anchor. The
 * explicit selection remains the owner of every human target and export. */
export function canonicalPracticeOptions(parts,{practiceSelection,practiceLayout='solo',showOthers=true,part=null}={}) {
  const selection=resolvePracticeSelection(parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]}));
  return {practiceSelection:selection,practiceLayout,showOthers,part:selection.kind==='all'?null:selection.part_ids[0]};
}

/** Machine display follows the same half-open range as the audio renderer.
 * Clip copies only; source occurrence IDs and tie references remain intact. */
export function canonicalDisplayNotes(timeline,loop=null) {
  return loop?windowNotes(timeline.notes,loop.start_ms,loop.end_ms):timeline.notes;
}
