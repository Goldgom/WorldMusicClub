import {fixture} from './frontend-fixtures.js';
import {defaultPianoSettings} from '../web/piano-fingering.js';

export function pianoContext(){
  const score=structuredClone(fixture);score.parts[0].notes.push({...structuredClone(score.parts[0].notes[0]),id:'tie-end'});
  score.parts.push({id:'other',name:'Other voice',instrument:'piano',notes:[{...structuredClone(score.parts[0].notes[0]),id:'unison'}]});
  return{score,part_id:null,profile:{kind:'piano',key_count:61,lowest_midi:null},dirty:false,timeline:{duration_ms:4000,notes:[
    {id:'c4@1',source_note_ids:['c4','tie-end'],part_id:'piano',midi:60,start_ms:500/3,duration_ms:1000},
    {id:'unison@1',source_note_ids:['unison'],part_id:'other',midi:60,start_ms:500/3,duration_ms:250},
    {id:'e4@1',source_note_ids:['e4'],part_id:'piano',midi:64,start_ms:1500,duration_ms:500},
    {id:'c4@2',source_note_ids:['c4','tie-end'],part_id:'piano',midi:60,start_ms:2500,duration_ms:1000},
  ]}};
}
export function pianoResult(context,settings=defaultPianoSettings()){
  const notes=context.timeline.notes.filter(note=>context.part_id===null||note.part_id===context.part_id),groups=new Map(),onsets=[...new Set(notes.map(note=>note.start_ms))].sort((a,b)=>a-b);
  for(const note of notes){const key=`${note.start_ms}:${note.midi}`;let target=groups.get(key);if(!target){target={target_id:note.id,source_occurrence_ids:[],source_note_ids:[],part_ids:[],midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms,onset_index:onsets.indexOf(note.start_ms)};groups.set(key,target);}target.source_occurrence_ids.push(note.id);target.source_note_ids.push(...note.source_note_ids);if(!target.part_ids.includes(note.part_id))target.part_ids.push(note.part_id);target.end_ms=Math.max(target.end_ms,note.start_ms+note.duration_ms);}
  const targets=[...groups.values()].map(target=>({...target,part_ids:target.part_ids.sort()}));
  return{version:1,algorithm:'deterministic_piano_beam_v1',score_id:context.score.id,part_id:context.part_id,profile:structuredClone(context.profile),...structuredClone({left_hand:settings.left_hand,right_hand:settings.right_hand}),status:notes.length?'ready':'no_targets',complete:true,changed_source_notes:false,source_occurrence_count:notes.length,physical_target_count:targets.length,beam_width:64,max_expansions:2000000,explored_choices:45,beam_pruned:false,objective_cost:notes.length?12:0,targets,assignments:targets.map(target=>({...structuredClone(target),hand:'right',finger:target.midi===60?1:3})),requested_locks:structuredClone(settings.locks),diagnostics:[],issues:[]};
}

/** Frontend-only harnesses do not pretend to run Rust or return a solved phrase. */
export function unavailablePianoResult(request,timeline){
  return{version:1,algorithm:'deterministic_piano_beam_v1',score_id:request.score.id,part_id:request.part_id,profile:request.profile,left_hand:request.left_hand,right_hand:request.right_hand,status:'unavailable',complete:false,changed_source_notes:false,source_occurrence_count:timeline.notes.filter(note=>request.part_id===null||note.part_id===request.part_id).length,physical_target_count:null,beam_width:64,max_expansions:2000000,explored_choices:0,beam_pruned:false,objective_cost:null,targets:[],assignments:[],requested_locks:request.locks,issues:[],diagnostics:[{severity:'warning',code:'frontend_fixture_no_piano_solver',message:'Piano planning is unavailable in this frontend-only fixture. The Rust planner is tested separately.',note_id:null}]};
}
