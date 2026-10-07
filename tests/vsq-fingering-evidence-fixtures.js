// Unit-only invented planner outputs for verifier rejection tests. These are
// never real browser/native evidence and never used by the acceptance scenario.
import {defaultPianoSettings} from '../web/piano-fingering.js';
import {pianoGuidanceView} from '../web/piano-fingering-view.js';
import {guitarPlanSummary} from '../web/guitar-fingering-view.js';
import {createI18n} from '../web/i18n.js';

export function syntheticVsqFingering(fixture){
  const note=fixture.runtime.compilation.timeline.notes.find(note=>note.part_id==='vsq-track-1');
  const part_id=note.part_id,id=note.id,score_id=fixture.runtime.compilation.score.id;
  const source={key:fixture.key,content_sha256:fixture.opened.clean_package.content_sha256,profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'};
  const piano={kind:'piano',key_count:61,lowest_midi:null},guitar={kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0};
  const stages=[
    ['piano',[]],['piano',[{source_note_id:id,hand:'right',finger:null}]],['piano',[{source_note_id:id,hand:'right',finger:5}]],
    ['guitar',[]],['guitar',[{source_note_id:id,string:null,fret:null,finger:4}]],
    ['guitar',[{source_note_id:id,string:null,fret:12,finger:4}]],['guitar',[]],
  ];
  const requests=[{path:'/api/library/runtime',body:{key:fixture.key,profile:fixture.score.profile,choice:'base_notes_instrumental'}}];
  const responses=stages.map(([kind,locks],index)=>{
    const profile=kind==='piano'?piano:guitar,settings={part_id:kind==='piano'?part_id:null,profile,...(kind==='piano'?defaultPianoSettings():{selected_part_ids:[part_id],max_fret_span:3}),locks};
    const path=`/api/library/fingering/${kind}`;requests.push({path,body:{source:structuredClone(source),settings:structuredClone(settings)}});
    const common={version:1,algorithm:`deterministic_${kind}_beam_v1`,score_id,part_id,profile:structuredClone(profile),status:'ready',complete:true,changed_source_notes:false,source_occurrence_count:1,beam_width:64,explored_choices:4,beam_pruned:false,objective_cost:0,requested_locks:structuredClone(locks),diagnostics:[]};
    let plan;
    if(kind==='piano'){
      const target={target_id:id,source_occurrence_ids:[id],source_note_ids:[id],part_ids:[part_id],midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,onset_index:0};
      plan={...common,left_hand:structuredClone(settings.left_hand),right_hand:structuredClone(settings.right_hand),max_expansions:2000000,physical_target_count:1,targets:[target],assignments:[{...structuredClone(target),hand:'right',finger:locks[0]?.finger||3}],issues:[]};
    }else{
      const choice={occurrence_id:id,source_note_ids:[id],part_id,midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,onset_index:0,string:2,fret:4,finger:locks[0]?.finger||1,picking_hint:'downstroke_suggestion'};
      plan={...common,part_id:null,selected_part_ids:[part_id],max_fret_span:3,assignments:[choice]};
      if(index===5)Object.assign(plan,{status:'infeasible_under_model',complete:false,assignments:[],objective_cost:null,diagnostics:[{code:'guitar_fingering_no_position',severity:'warning',message:'Unit-only impossible fret fixture; not a native planner result.',note_id:id}]});
    }
    return {path,status:200,body:{source:structuredClone(source),plan},requestIndex:index+1};
  });
  const i18n=createI18n({locale:'en'}),seconds=ms=>i18n.formatNumber(ms/1000,{minimumFractionDigits:3,maximumFractionDigits:3});
  const names=['piano-base','piano-lock','guitar-base','guitar-lock','guitar-infeasible','guitar-restored'];
  const samples=[0,2,3,4,5,6].map((stage,index)=>{
    const row=responses[stage],plan=row.body.plan,instrument=stages[stage][0];let dom;
    if(instrument==='piano'){
      dom={hidden:false,phase:'ready',cards:pianoGuidanceView({plan,position:0,i18n}).items.map(item=>({
        targetId:item.target_id,sourceIds:item.source_note_ids,occurrenceIds:item.source_occurrence_ids,hand:item.hand,label:item.label,time:item.time,
        title:i18n.t('piano.runtime.cardDescription',{pitch:item.pitch,hand:i18n.t('piano.runtime.'+item.hand),finger:item.finger,start:seconds(item.start_ms),end:seconds(item.end_ms),sources:item.source_note_ids.join(', '),occurrences:item.source_occurrence_ids.join(', '),parts:item.part_ids.join(', ')}),
      }))};
    }else{
      dom={hidden:false,status:plan.status,statusText:guitarPlanSummary({plan},i18n),choices:structuredClone(plan.assignments),cards:[{targetId:id,startMs:note.start_ms,durationMs:note.duration_ms,sourceIds:[id],occurrenceIds:[id],route:plan.assignments.map(({string,fret,finger})=>({string,fret,finger}))}],recommended:plan.assignments.length};
    }
    return {label:names[index],requestIndex:row.requestIndex,instrument,positionMs:0,partId:part_id,dom};
  });
  const actions=[['click','piano-fingering-replan'],['select-last','piano-source-hand','right'],['select-last','piano-source-finger','5'],['select-last','instrument','guitar'],['select-last','guitar-lock-finger','4'],['click','guitar-apply-lock'],['select-last','guitar-lock-fret','12'],['click','guitar-apply-lock'],['click','guitar-clear-locks']].map(([kind,id,value],index)=>({sequence:index+11,kind,id,value:value??null}));
  const trusted=actions.map(({kind,id,value})=>({type:kind==='select-last'?'change':'click',trusted:true,id,value}));
  return {requests,trusted,fingering:{version:1,responses,observations:responses.map(({path,status,requestIndex})=>({path,status,state:'consumed',requestIndex})),samples,actions,stale:{instrument:'guitar',pianoHidden:true,pianoPhase:'idle',pianoCards:0,pianoBadges:0}}};
}
