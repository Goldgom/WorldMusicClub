import {fixture} from './frontend-fixtures.js';

/** Original dense notation forces real later systems at the unchanged viewport.
 * Six measures still take twelve seconds; source timing is compiled by Rust. */
export function originalPaneRevealStudy(){
  const score=structuredClone(fixture),beat=numerator=>({numerator,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-pane-reveal-study';score.title='Original pane reveal study';score.tempo=[{at:beat(0),bpm:120}];score.repeats=[];
  score.provenance={kind:'original_exercise',attribution:'WorldMusicHub original multi-system scrolling regression',source_url:null,license:'CC0-1.0'};
  score.measures=Array.from({length:6},(_,index)=>({number:7,at:beat(index*4),length:beat(4)}));
  score.parts[0].notes=score.measures.flatMap((_,measure)=>Array.from({length:32},(_,step)=>({...structuredClone(seed),id:`reveal-note-${measure}-${step}`,at:{numerator:measure*32+step,denominator:8},duration:{numerator:1,denominator:8},pitch:{step:['C','D','E','G'][step%4],alter:0,octave:4},tie_start:false,tie_stop:false})));
  return score;
}

/** Join observed offscreen glyphs to independent Rust timing; neither measure
 * labels nor a hard-coded source-measure ordinal imply a scrolling target. */
export function choosePaneRevealTarget(compilation,geometry){
  const timeline=compilation.timeline,notes=new Map(timeline.notes.flatMap(note=>note.source_note_ids.map(id=>[id,note])));
  return geometry.markers.filter(marker=>Number.isInteger(marker.measure)&&marker.measure>=3&&marker.height>0&&marker.top>geometry.viewport.bottom+12).flatMap(marker=>{
    const note=notes.get(marker.sourceNoteId);
    return note&&note.start_ms>=timeline.duration_ms/2&&note.start_ms<=timeline.duration_ms-1000?[{...marker,startMs:note.start_ms,endMs:note.start_ms+note.duration_ms}]:[];
  }).sort((a,b)=>a.startMs-b.startMs||a.sourceNoteId.localeCompare(b.sourceNoteId))[0]??null;
}

export function paneRevealSourceIdsAt(compilation,positionMs){
  return [...new Set(compilation.timeline.notes.filter(note=>note.start_ms<=positionMs&&positionMs<note.start_ms+note.duration_ms).flatMap(note=>note.source_note_ids))].sort();
}
