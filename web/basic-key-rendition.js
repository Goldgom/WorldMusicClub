import {assistanceAudioMask, emptyAssistedListen} from './practice-assistance-audio.js';

export const BASIC_KEY_RUNTIME_PROFILE='wmh-basic-key-practice-v2';
export const BASIC_KEY_RENDITION='wmh-basic-key-rendition-fifo-v1';
export const BASIC_KEY_MAX_VOICES=128;
export const BASIC_KEY_TIMELINE_COLUMNS=Object.freeze(['id','part_id','midi','velocity','start_ms','duration_ms']);
export function decodeBasicKeyRuntime(runtime,fail){
  const timeline=runtime.compilation?.timeline;
  if(!timeline||JSON.stringify(timeline.note_columns)!==JSON.stringify(BASIC_KEY_TIMELINE_COLUMNS)||!Array.isArray(timeline.notes)||timeline.notes.some(row=>!Array.isArray(row)||row.length!==6))fail('The compact basic-key target timeline has unknown or incomplete columns.');
  const notes=timeline.notes.map(([id,part_id,midi,velocity,start_ms,duration_ms])=>({id,part_id,midi,velocity,start_ms,duration_ms,source_note_id:id,source_note_ids:[id],voice:'1',staff:1}));
  return{...runtime,compilation:{...runtime.compilation,timeline:{duration_ms:timeline.duration_ms,notes}}};
}
/** Receiver envelopes end at the derived gate (no release tail beyond it).
 * Scheduling may allocate each voice lookAheadMs before onset. Count that
 * entire allocation interval, releasing ended voices before equal-time starts. */
export function basicKeyAllocationBudget(notes,{lookAheadMs=100,include=()=>true}={}){
  const edges=[];for(const note of notes)if(include(note)){edges.push([note.start_ms-lookAheadMs,1],[note.start_ms+note.duration_ms,-1]);}
  edges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,maximum=0;for(const[,delta]of edges){active+=delta;maximum=Math.max(maximum,active);}return maximum;
}
const previewBudgets=new WeakMap();
export function referencePreviewBudget(notes,targetPart=null,rendition=null,{assistance,assistanceContext,sourceToken,mutedParts=[],soloParts=[]}={}){
  if(!previewBudgets.has(notes))previewBudgets.set(notes,new Map());const cache=previewBudgets.get(notes);
  const selection=targetPart!==null&&typeof targetPart==='object'?targetPart:null;
  if(selection&&!emptyAssistedListen(assistance,'listen',selection)&&(!['all','parts'].includes(selection.kind)||!Array.isArray(selection.part_ids)||!selection.part_ids.length||new Set(selection.part_ids).size!==selection.part_ids.length||selection.part_ids.some(id=>typeof id!=='string'||!id)||selection.kind==='all'&&notes.some(note=>!selection.part_ids.includes(note.part_id))))throw new TypeError('Resolve the human practice selection before checking accompaniment capacity.');
  const humanParts=new Set(selection?selection.part_ids:targetPart===null?[]:[targetPart]),muted=new Set(mutedParts),solo=new Set(soloParts);
  if(assistance!=null&&(sourceToken?.compilation?.timeline?.notes!==notes||sourceToken?.runtime?.rendition!==rendition&&!(rendition==null&&sourceToken?.runtime?.profile==='wmh-vsq-base-note-practice-v1')))throw new TypeError('Assistance capacity must use the admitted complete runtime.');
  const mask=assistanceAudioMask(assistance,assistanceContext,{sourceToken,runtimeToken:sourceToken?.runtime,sourceProfile:sourceToken?.profile,runtimePolicy:rendition?.policy_id??sourceToken?.runtime?.profile,choice:sourceToken?.runtime?.choice??null,savedPackageSha256:sourceToken?.identity,partIds:[...humanParts],notes});
  const key=JSON.stringify({human:[...humanParts].sort(),assistance:mask?.fingerprint??null,muted:[...muted].sort(),solo:[...solo].sort()});
  if(!cache.has(key)){const included=new Set(notes.filter(note=>(mask?mask.isMachine(note.id):!humanParts.has(note.part_id))&&!muted.has(note.part_id)&&(!solo.size||solo.has(note.part_id))).map(note=>note.id));cache.set(key,rendition?exactBasicKeyAllocationBudget(rendition,{include:id=>included.has(id)}):basicKeyAllocationBudget(notes,{include:note=>included.has(note.id)}));}return cache.get(key);
}
export function exactBasicKeyAllocationBudget(rendition,{include=()=>true}={}){
  const edges=[],lead=BigInt(rendition.policy.allocation_lookahead_ms)*1000n;
  for(const row of rendition.notes)if(include(row[0])){const n=BigInt(row[6][0]),d=BigInt(row[6][1]),allocation=n-lead*d;edges.push([allocation<0n?0n:allocation,d,1],[BigInt(row[7][0]),BigInt(row[7][1]),-1]);}
  edges.sort((a,b)=>{const difference=a[0]*b[1]-b[0]*a[1];return difference<0n?-1:difference>0n?1:a[2]-b[2];});let active=0,maximum=0;for(const[,,delta]of edges){active+=delta;maximum=Math.max(maximum,active);}return maximum;
}
export const BASIC_KEY_NOTE_COLUMNS=Object.freeze(['note_id','attack','release','route','channel','role','start','end','source_end_tick','receiver_end_tick','source_release_status','end_reason','synthetic_gate']);
export function* basicKeyRenditionNotes(rendition){
  for(const row of rendition.notes){
    const [note_id,attack,release,route,channel,role,start,end,source_end_tick,receiver_end_tick,source_release_status,end_reason,synthetic_gate]=row;
    yield{note_id,attack:{track:attack[0],event:attack[1]},release:release===null?null:{track:release[0],event:release[1]},route,channel,role,start:{numerator:start[0],denominator:start[1]},end:{numerator:end[0],denominator:end[1]},source_end_tick,receiver_end_tick,source_release_status,end_reason,synthetic_gate};
  }
}
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
export const basicKeyExactMilliseconds=value=>{
  if(!value||typeof value.numerator!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value.numerator)||!integer(value.denominator,1,65535))return NaN;
  const n=BigInt(value.numerator),d=BigInt(value.denominator)*1000n;
  return Number(n/d)+Number(n%d)/Number(d);
};
const exactMs=basicKeyExactMilliseconds;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.001;
const releaseStatuses=new Set(['unique_release','equivalent_release_time','ambiguous_release_time','missing_release','possibly_unreleased','unresolved_route_ownership','route_invariant_release_time']);

/** Admission checks provenance and joins native timing. This does not derive a
 * tempo map, select release owners or turn source commands into a new score. */
export function validateBasicKeyRendition(score,runtime,fail){
  const rendition=runtime.rendition,compilation=runtime.compilation;
  if(!rendition||rendition.policy_id!==BASIC_KEY_RENDITION||rendition.source_sha256!==score.source.sha256||!compilation||!Array.isArray(rendition.notes)||!Array.isArray(compilation.timeline?.notes)||rendition.notes.length!==score.coverage.key_attacks||compilation.timeline.notes.length!==rendition.notes.length||!Number.isFinite(rendition.source_duration_ms)||rendition.source_duration_ms<0||!Number.isFinite(rendition.duration_ms)||rendition.duration_ms<rendition.source_duration_ms||!close(rendition.duration_ms,compilation.timeline.duration_ms))fail('The complete basic-key rendition has inconsistent coverage or timing.');
  const coverage=rendition.coverage;
  if(rendition.source_clock_available!==score.performance.timing.relative_clock_available||!coverage||Object.values(coverage).some(value=>!integer(value,0,Number.MAX_SAFE_INTEGER))||coverage.source_events!==score.coverage.source_events||coverage.source_attacks!==score.coverage.key_attacks||coverage.derived_voices!==rendition.notes.length||coverage.practice_targets!==rendition.notes.length||coverage.melodic_targets+coverage.percussion_selectors!==rendition.notes.length||!integer(coverage.maximum_simultaneous_voices,0,rendition.notes.length)||!rendition.policy||rendition.policy.event_order!=='tick_track_index_event_index'||['routes','tempo','repeated_keys','missing_release','instantaneous','melodic_sound','percussion_sound','controls','mixing','transport','scoring'].some(key=>typeof rendition.policy[key]!=='string'||!rendition.policy[key]))fail('The complete basic-key interpretation omits its policy or event coverage.');
  if(['synthetic_gates','source_end_cleanups','source_silence_controller_events','maximum_allocated_voices','paired_releases','unmatched_releases','source_releases','control_ended_voices'].some(key=>!integer(coverage[key],0,Number.MAX_SAFE_INTEGER))||coverage.source_releases!==score.coverage.key_releases||coverage.paired_releases+coverage.unmatched_releases!==coverage.source_releases)fail('The basic-key release and interpretation coverage is incomplete.');
  const coordinate=value=>Array.isArray(value)&&value.length===2&&value.every(item=>integer(item,0,Number.MAX_SAFE_INTEGER));
  if(JSON.stringify(rendition.note_columns)!==JSON.stringify(BASIC_KEY_NOTE_COLUMNS)||rendition.notes.some(row=>!Array.isArray(row)||row.length!==BASIC_KEY_NOTE_COLUMNS.length||!coordinate(row[1])||row[2]!==null&&!coordinate(row[2])||![row[6],row[7]].every(value=>Array.isArray(value)&&value.length===2)))fail('The compact basic-key rendition has unknown or incomplete columns.');
  if(rendition.policy.allocation_lookahead_ms!==100||rendition.policy.voice_limit!==BASIC_KEY_MAX_VOICES||rendition.policy.receiver_gate_tail_ms!==0)fail('The basic-key runtime requires another receiver allocation policy.');
  const parts=new Map(score.performance.parts.map(part=>[part.id,part])),attacks=new Map(),events=new Map();
  for(const track of score.performance.tracks){let tick=0;for(const[index,record]of track.events.entries()){
    tick+=record[0];const bytes=record[1],eventId=`midi:${score.source.sha256}:t${track.source_index}:e${index}`;
    events.set(eventId,{tick,bytes});
    if(bytes[0]>>4===9&&bytes[2]>0)attacks.set(`midi-t${track.source_index+1}-e${index+1}`,{eventId,track,tick,channel:bytes[0]&15,key:bytes[1],velocity:bytes[2]});
  }}
  if(attacks.size!==rendition.notes.length)fail('The complete basic-key rendition omits or adds source attacks.');
  const evidence=new Map();
  for(const note of basicKeyRenditionNotes(rendition)){
    const source=attacks.get(note.note_id),release=note.release===null?null:events.get(`midi:${score.source.sha256}:t${note.release?.track}:e${note.release?.event}`);
    if(!source||evidence.has(note.note_id)||note.attack?.track!==source.track.source_index||note.note_id!==`midi-t${note.attack?.track+1}-e${note.attack?.event+1}`||note.channel!==source.channel||!integer(note.route,0,score.performance.routes.length-1)||note.role!==(source.channel===9?'percussion_selector':'melodic_key')||!integer(note.receiver_end_tick,source.tick,score.performance.end_tick)||note.source_end_tick!==null&&!integer(note.source_end_tick,source.tick,score.performance.end_tick)||!releaseStatuses.has(note.source_release_status)||!['fifo_release','source_end_cleanup','all_sound_off','all_notes_off'].includes(note.end_reason)||typeof note.synthetic_gate!=='boolean')fail('A basic-key interpretation changed its source identity or role.');
    if(note.end_reason==='source_end_cleanup'?(note.release!==null||note.receiver_end_tick!==score.performance.end_tick):(!release||release.tick!==note.receiver_end_tick||(release.bytes[0]&15)!==source.channel|| (note.end_reason==='fifo_release'?(release.bytes[1]!==source.key||!((release.bytes[0]>>4===8)||(release.bytes[0]>>4===9&&release.bytes[2]===0))):(release.bytes[0]>>4!==11||release.bytes[1]!==({all_sound_off:120,all_notes_off:123})[note.end_reason]))))fail('A basic-key interpretation has invalid release evidence.');
    const start=exactMs(note.start),end=exactMs(note.end);
    if(!Number.isFinite(start)||start<0||!Number.isFinite(end)||end<=start||end>rendition.duration_ms+0.001||note.synthetic_gate&&!close(end-start,20))fail('A basic-key interpretation has invalid exact timing.');
    evidence.set(note.note_id,{note,source,start,end});
  }
  let prior=-Infinity;const seen=new Set();
  for(const target of compilation.timeline.notes){
    const item=evidence.get(target.id),part=parts.get(target.part_id);
    if(!item||!part||seen.has(target.id)||target.source_note_id!==target.id||target.source_note_ids?.length!==1||target.source_note_ids[0]!==target.id||part.track_id!==item.source.track.id||part.channel!==item.note.channel||part.route!==item.note.route||target.midi!==item.source.key||target.velocity!==item.source.velocity||!close(target.start_ms,item.start)||!close(target.duration_ms,item.end-item.start)||target.duration_ms<=0||target.start_ms<prior)fail('A basic-key target is not the same complete native rendition.');
    prior=target.start_ms;seen.add(target.id);
  }
  if(coverage.maximum_allocated_voices!==exactBasicKeyAllocationBudget(rendition))fail('The basic-key allocation capacity disagrees with the exact interpreted gates.');
  for(const[field,select]of [['synthetic_gates',row=>row[12]],['source_end_cleanups',row=>row[11]==='source_end_cleanup'],['paired_releases',row=>row[11]==='fifo_release'],['control_ended_voices',row=>['all_sound_off','all_notes_off'].includes(row[11])],['percussion_selectors',row=>row[5]==='percussion_selector']])if(coverage[field]!==rendition.notes.filter(select).length)fail('The basic-key note evidence disagrees with its interpretation counts.');
}
