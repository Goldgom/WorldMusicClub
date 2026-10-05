import assert from 'node:assert/strict';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {fingeringSource,fingeringResponse} from '../web/fingering-source.js';
import {defaultPianoSettings,validatePianoFingering} from '../web/piano-fingering.js';
import {validateGuitarFingering} from '../web/guitar-fingering.js';
import {pianoGuidanceView} from '../web/piano-fingering-view.js';
import {guitarPlanSummary} from '../web/guitar-fingering-view.js';
import {createI18n} from '../web/i18n.js';

const labels=['piano-base','piano-lock','guitar-base','guitar-lock','guitar-infeasible','guitar-restored'];
const sampleStages=[0,2,3,4,5,6];
const criticalActions=[
  ['click','piano-fingering-replan'],
  ['select-last','piano-source-hand','right'],
  ['select-last','piano-source-finger','5'],
  ['select-last','instrument','guitar'],
  ['select-last','guitar-lock-finger','4'],
  ['click','guitar-apply-lock'],
  ['select-last','guitar-lock-fret','12'],
  ['click','guitar-apply-lock'],
  ['click','guitar-clear-locks'],
];
const integer=(value,low,high)=>Number.isSafeInteger(value)&&value>=low&&value<=high;
const equal=(actual,expected,label)=>assert.deepEqual(actual,expected,`VSQ fingering ${label}`);
const equivalent=(left,right)=>{try{assert.deepEqual(left,right);return true;}catch{return false;}};

function pianoDom(plan,i18n){
  const view=pianoGuidanceView({plan,position:0,i18n});
  const seconds=ms=>i18n.formatNumber(ms/1000,{minimumFractionDigits:3,maximumFractionDigits:3});
  return {hidden:false,phase:'ready',cards:view.items.map(item=>({
    targetId:item.target_id,sourceIds:item.source_note_ids,occurrenceIds:item.source_occurrence_ids,
    hand:item.hand,label:item.label,time:item.time,
    title:i18n.t('piano.runtime.cardDescription',{
      pitch:item.pitch,hand:i18n.t('piano.runtime.'+item.hand),finger:item.finger,
      start:seconds(item.start_ms),end:seconds(item.end_ms),sources:item.source_note_ids.join(', '),
      occurrences:item.source_occurrence_ids.join(', '),parts:item.part_ids.join(', '),
    }),
  }))};
}

function guitarDom(plan,notes,i18n){
  // This original one-note part has a one-to-one physical target. Preserve the
  // admitted occurrence and clock; do not solve a route or regroup general music.
  const ready=plan.status==='ready',choices=ready?plan.assignments:[];
  return {hidden:false,status:plan.status,statusText:guitarPlanSummary({plan},i18n),choices,
    cards:notes.map(note=>({targetId:note.id,startMs:note.start_ms,durationMs:note.duration_ms,
      sourceIds:note.source_note_ids,occurrenceIds:[note.id],
      route:choices.filter(choice=>choice.occurrence_id===note.id).map(({string,fret,finger})=>({string,fret,finger})),
    })),recommended:new Set(choices.map(choice=>`${choice.string}:${choice.fret}`)).size};
}

/** Verify actual observed native responses and their rendered appendix states.
 * This is specific to the committed original VSQ acceptance fixture. Unit-only
 * synthetic reports exercise rejection paths; they are not native acceptance.
 */
export function validateVsqFingering(report,fixture){
  const evidence=report.fingering;
  assert.ok(evidence&&evidence.version===1,'VSQ fingering evidence is missing');
  assert.ok(integer(report.actions,1,80),'VSQ fingering native action bound');
  assert.ok(Array.isArray(report.requests)&&report.requests.length<=128,'VSQ fingering request bound');
  equal(report.opened?.score_json,fixture.opened.score_json,'opened notation');
  equal(report.opened?.clean_package,fixture.opened.clean_package,'opened saved package');
  equal(report.runtimeResponses,[{path:'/api/library/runtime',status:200,body:fixture.runtime}],'observed original runtime');
  const loaded=prepareCleanSong(`native:${fixture.key}`,report.opened.clean_package,JSON.parse(report.opened.score_json));
  const song=prepareVsqPractice(loaded,report.runtimeResponses[0].body);
  const partId='vsq-track-1',sourceId='vsq-t1-ID#0001';
  const context={cleanSong:song,score:song.compilation.score,timeline:song.compilation.timeline,part_id:partId};
  assert.ok(!report.requests.some(request=>/^\/api\/fingering\/(piano|guitar)$/.test(request.path)&&request.body?.score?.id===context.score.id),'VSQ fingering used a generic score-derived route');
  const notes=context.timeline.notes.filter(note=>note.part_id===partId);
  assert.ok(notes.length===1&&notes[0].id===sourceId&&notes[0].midi===63&&notes[0].start_ms===0,'VSQ fingering requires the original D-sharp fixture');
  const source=fingeringSource(context),piano={kind:'piano',key_count:61,lowest_midi:null};
  const guitar={kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0};
  const pianoSettings=locks=>({part_id:partId,profile:piano,...defaultPianoSettings(),locks});
  const guitarSettings=locks=>({part_id:partId,profile:guitar,max_fret_span:3,locks});
  const states=[
    ['piano',pianoSettings([])],
    ['piano',pianoSettings([{source_note_id:sourceId,hand:'right',finger:null}])],
    ['piano',pianoSettings([{source_note_id:sourceId,hand:'right',finger:5}])],
    ['guitar',guitarSettings([])],
    ['guitar',guitarSettings([{source_note_id:sourceId,string:null,fret:null,finger:4}])],
    ['guitar',guitarSettings([{source_note_id:sourceId,string:null,fret:12,finger:4}])],
    ['guitar',guitarSettings([])],
  ].map(([instrument,settings])=>({path:`/api/library/fingering/${instrument}`,instrument,settings}));
  assert.ok(Array.isArray(evidence.responses)&&integer(evidence.responses.length,7,12),'VSQ fingering response bound');
  assert.ok(Array.isArray(evidence.observations)&&evidence.observations.length===evidence.responses.length,'VSQ fingering consumed observations');
  const responses=new Map();let previousIndex=-1,stage=-1;
  for(const row of evidence.responses){
    assert.ok(integer(row.requestIndex,0,report.requests.length-1)&&row.requestIndex>previousIndex,'VSQ fingering response request order/identity');
    previousIndex=row.requestIndex;
    const request=report.requests[row.requestIndex];
    equal(Object.keys(request.body||{}).sort(),['settings','source'],'native-only request fields');
    equal(request.body.source,source,'request source binding');
    equal(row.path,request.path,'response request route');equal(row.status,200,'response status');
    const matches=index=>index>=0&&index<states.length&&request.path===states[index].path&&equivalent(request.body.settings,states[index].settings);
    if(!matches(stage)){assert.ok(matches(stage+1),'VSQ fingering request settings or order');stage++;}
    const expected=states[stage],ctx={...context,profile:expected.settings.profile};
    const plan=fingeringResponse(row.body,source);
    (expected.instrument==='piano'?validatePianoFingering:validateGuitarFingering)(plan,ctx,request.body.settings);
    equal(plan.status,stage===5?'infeasible_under_model':'ready','fixture plan status');
    if(stage===5){
      assert.ok(plan.diagnostics.some(item=>item.code==='guitar_fingering_no_position'&&item.note_id===sourceId),'VSQ impossible fret needs its source diagnostic');
    }
    responses.set(row.requestIndex,{...row,stage,instrument:expected.instrument,plan});
  }
  equal(stage,6,'complete request transitions');
  equal(evidence.observations,evidence.responses.map(({path,status,requestIndex})=>({path,status,state:'consumed',requestIndex})),'fully consumed response ownership');
  // The appendix observer starts at its first explicit replan. Every later
  // native fingering request must have one consumed, validated response.
  const first=evidence.responses[0].requestIndex;
  const observedIndices=report.requests.flatMap((request,index)=>index>=first&&/^\/api\/(?:library\/)?fingering\//.test(request.path)?[index]:[]);
  equal([...responses.keys()],observedIndices,'complete appendix response coverage');
  assert.ok(Array.isArray(evidence.samples),'VSQ fingering samples missing');
  equal(evidence.samples.map(sample=>sample.label),labels,'sample labels and order');
  const i18n=createI18n({locale:'en'});let priorSampleIndex=-1;
  for(const [index,sample]of evidence.samples.entries()){
    const row=responses.get(sample.requestIndex);
    assert.ok(row&&row.stage===sampleStages[index]&&sample.requestIndex>priorSampleIndex,'VSQ fingering sample response binding');
    priorSampleIndex=sample.requestIndex;
    equal(sample.instrument,row.instrument,'sample instrument');equal(sample.partId,partId,'sample selected part');equal(sample.positionMs,0,'reset sample clock');
    equal(sample.dom,row.instrument==='piano'?pianoDom(row.plan,i18n):guitarDom(row.plan,notes,i18n),'rendered native assignments');
  }
  equal(evidence.stale,{instrument:'guitar',pianoHidden:true,pianoPhase:'idle',pianoCards:0,pianoBadges:0},'instrument-change piano invalidation');
  assert.ok(Array.isArray(evidence.actions)&&evidence.actions.length===criticalActions.length,'VSQ fingering critical actions missing');
  let sequence=0;
  for(const [index,action]of evidence.actions.entries()){
    const [kind,id,value]=criticalActions[index];
    assert.ok(integer(action.sequence,1,report.actions)&&action.sequence>sequence,'VSQ fingering native action sequence');sequence=action.sequence;
    equal(action.kind,kind,'native action kind');equal(action.id,id,'native action target');
    if(kind==='select-last')equal(action.value,value,'native selected value');
    else assert.ok(action.value==null||action.value==='','VSQ fingering button value');
  }
  assert.ok(Array.isArray(report.trusted)&&report.trusted.length<=128&&report.trusted.every(event=>event.trusted===true),'VSQ fingering synthetic/unbounded events');
  const watched=new Map(criticalActions.map(([kind,id])=>[id,kind==='select-last'?'change':'click']));
  const events=report.trusted.filter(event=>watched.get(event.id)===event.type);
  equal(events.map(event=>[event.type,event.id,...(event.type==='change'?[event.value]:[])]),criticalActions.map(([kind,id,value])=>[kind==='select-last'?'change':'click',id,...(kind==='select-last'?[value]:[])]),'trusted critical action events');
  return evidence;
}
