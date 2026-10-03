import {isVsqSong,VSQ_PRACTICE_PROFILE} from './clean-song-package.js';

export const VSQ_NAVIGATION_PROFILE='wmh-vsq-practice-navigation-v1';
const admitted=new WeakSet();
export const isVsqNavigationIndex=value=>admitted.has(value);
const stable=value=>JSON.stringify(value,(_,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const rational=value=>value&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator)&&value.numerator>=0&&value.denominator>0;
const compare=(a,b)=>BigInt(a.numerator)*BigInt(b.denominator)-BigInt(b.numerator)*BigInt(a.denominator);
const sourceEnd=item=>{const length=item.duration??item.length;return{numerator:BigInt(item.at.numerator)*BigInt(length.denominator)+BigInt(length.numerator)*BigInt(item.at.denominator),denominator:BigInt(item.at.denominator)*BigInt(length.denominator)};};
const fail=()=>{throw Object.assign(new Error('The native VSQ written-note map does not match this selected package and practice clock.'),{code:'notation_followInvalid'});};

/** Separate profile: retains negative PreMeasure and the native written extent.
 * Ordinary-score navigation invariants are not changed. No tempo/offset calculation. */
export class VsqNavigationIndex {
  constructor(response,song,score,timeline){
    if(!isVsqSong(song)||!song.runtime||!song.compilation||response?.version!==1||response.profile!==VSQ_NAVIGATION_PROFILE||response.content_sha256!==song.identity||response.source_sha256!==song.runtime.source_sha256||response.runtime_profile!==VSQ_PRACTICE_PROFILE||response.runtime_profile!==song.runtime.profile||response.choice!=='base_notes_instrumental'||response.choice!==song.runtime.choice||response.practice_origin_tick!==song.runtime.practice_origin_tick||response.duration_ms!==song.runtime.end_ms||response.duration_ms!==timeline?.duration_ms||stable(score)!==stable(song.compilation.score)||!Number.isFinite(response.clock_start_ms)||response.clock_start_ms>0||!Number.isFinite(response.written_end_ms)||response.written_end_ms<=response.clock_start_ms||score.repeats?.length||response.source_measure_count!==score.measures.length||!Array.isArray(response.occurrences)||response.occurrences.length!==score.measures.length||!response.occurrences.length||response.occurrences.length>100000||!Array.isArray(response.sounding_groups)||!Array.isArray(response.diagnostics))fail();
    if(score.measures.some(measure=>!rational(measure.at)||!rational(measure.length))||score.parts.some(part=>part.notes.some(note=>!rational(note.at)||!rational(note.duration))))fail();
    this.sourceNotes=new Map(score.parts.flatMap(part=>part.notes.map(note=>[note.id,{note,partId:part.id}])));
    const runtimeNotes=new Map(song.runtime.notes.map(note=>[note.note_id,note])),compiled=new Map(timeline.notes.map(note=>[note.id,note])),originalNotes=new Map(song.compilation.timeline.notes.map(note=>[note.id,note]));
    if(runtimeNotes.size!==this.sourceNotes.size||compiled.size!==runtimeNotes.size||timeline.notes.length!==runtimeNotes.size||response.sounding_groups.length!==runtimeNotes.size)fail();
    this.soundingGroups=new Map();
    for(const group of response.sounding_groups){
      const note=runtimeNotes.get(group.occurrence_id),projection=compiled.get(group.occurrence_id),original=originalNotes.get(group.occurrence_id);
      if(!note||!projection||stable(projection)!==stable(original)||this.soundingGroups.has(group.occurrence_id)||group.part_id!==note.part_id||group.start_ms!==note.start_ms||group.end_ms!==note.end_ms||stable(group.source_note_ids)!==stable([note.note_id]))fail();
      this.soundingGroups.set(group.occurrence_id,group);
    }
    let end=response.clock_start_ms,references=0;const occurrenceIds=new Set(),starts=new Set(),members=[];
    const ids=values=>{if(!Array.isArray(values)||(references+=values.length)>1000000)fail();const seen=new Set();for(const id of values){if(!this.sourceNotes.has(id)||seen.has(id))fail();seen.add(id);}return seen;};
    for(const [index,occurrence] of response.occurrences.entries()){
      const measure=score.measures[index];
      if(occurrence.source_measure_index!==index||occurrence.measure_number!==measure.number||typeof occurrence.id!=='string'||occurrenceIds.has(occurrence.id)||!Number.isFinite(occurrence.start_ms)||!Number.isFinite(occurrence.end_ms)||occurrence.start_ms!==end||occurrence.end_ms<=end||!rational(occurrence.source_from)||!rational(occurrence.source_to)||compare(occurrence.source_from,measure.at)!==0n||compare(occurrence.source_to,sourceEnd(measure))!==0n||occurrence.repeat_region_index!==null||occurrence.repeat_pass!==null||occurrence.repeat_times!==null)fail();
      occurrenceIds.add(occurrence.id);end=occurrence.end_ms;const written=ids(occurrence.written_note_ids),continuing=ids(occurrence.continuing_note_ids);
      for(const id of written){const note=this.sourceNotes.get(id).note;if(starts.has(id)||compare(note.at,occurrence.source_from)<0n||compare(note.at,occurrence.source_to)>=0n)fail();starts.add(id);}
      for(const id of continuing){const note=this.sourceNotes.get(id).note;if(written.has(id)||compare(note.at,occurrence.source_from)>=0n||compare(sourceEnd(note),occurrence.source_from)<=0n)fail();}
      members.push(new Set([...written,...continuing]));
    }
    if(end!==response.written_end_ms||starts.size!==this.sourceNotes.size)fail();
    const cursor=response.written_cursor;
    if(cursor?.version!==1||!Array.isArray(cursor.source_note_ids)||cursor.source_note_ids.length!==this.sourceNotes.size||new Set(cursor.source_note_ids).size!==this.sourceNotes.size||cursor.source_note_ids.some(id=>!this.sourceNotes.has(id))||!Array.isArray(cursor.spans)||cursor.spans.length!==references||cursor.spans.length>1000000)fail();
    const spans=new Map([...runtimeNotes.keys()].map(id=>[id,[]]));
    for(const span of cursor.spans){
      const id=cursor.source_note_ids[span.source_note_index],note=runtimeNotes.get(id),occurrence=response.occurrences[span.measure_occurrence_index];
      if(!Number.isInteger(span.source_note_index)||!Number.isInteger(span.measure_occurrence_index)||!note||!occurrence||!members[span.measure_occurrence_index].delete(id)||span.start_ms!==(note.start_ms<occurrence.start_ms?occurrence.start_ms:note.start_ms)||span.end_ms!==(note.end_ms>occurrence.end_ms?occurrence.end_ms:note.end_ms)||span.end_ms<=span.start_ms)fail();
      spans.get(id).push(span);
    }
    if(members.some(values=>values.size))fail();
    for(const [id,segments] of spans){const note=runtimeNotes.get(id);segments.sort((a,b)=>a.start_ms-b.start_ms);if(!segments.length||segments[0].start_ms!==note.start_ms||segments.at(-1).end_ms!==note.end_ms||segments.some((span,index)=>index>0&&span.start_ms!==segments[index-1].end_ms))fail();}
    this.occurrences=response.occurrences;this.duration=response.duration_ms;this.diagnostics=response.diagnostics;admitted.add(this);
  }
  at(position){
    if(!Number.isFinite(position)||position<0||position>=this.duration)return null;
    let low=0,high=this.occurrences.length;while(low<high){const middle=(low+high)>>>1;if(this.occurrences[middle].start_ms<=position)low=middle+1;else high=middle;}
    const occurrence=this.occurrences[low-1];return occurrence&&position<occurrence.end_ms?occurrence:null;
  }
}
