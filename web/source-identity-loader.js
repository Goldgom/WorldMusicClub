import {originalPitchContext,pitchModSource} from './pitch-mod.js';

const PROFILE='wmh-basic-keys-midi1-v1',MAX_EVENTS=250000,MAX_BYTES=32*1024*1024;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value,max=MAX_EVENTS)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const array=(value,max=MAX_EVENTS)=>Array.isArray(value)&&value.length<=max;
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max;
const fields=(token,status,index=null,error=null)=>({sourceIdentityToken:token,sourceIdentityStatus:status,sourceIdentityIndex:index,sourceIdentityError:error});
const fail=()=>{throw Object.assign(new Error('Original instrument identity does not match the complete saved source.'),{code:'source_identity_binding'});};
const require=value=>{if(!value)fail();};
const descriptorKeys=['key','content_sha256','profile','choice','runtime_policy'];
const sameSource=(a,b)=>a&&b&&Object.keys(a).length===descriptorKeys.length&&descriptorKeys.every(key=>Object.hasOwn(a,key)&&a[key]===b[key]);
const reasonCodes=new Set(['missing_gm_declaration','gm_off','missing_program','missing_explicit_bank','unknown_tuple','explicit_routing_out_of_scope','targeted_sysex','fragment_or_escape','opaque_sound_boundary','cross_track_order_uncertain','invalid_program','optional_drum_channel_behavior']);
const classifications=new Set(['supported','known_unsupported','unresolved']);
const coordinateKey=value=>`${value.track}:${value.event}`;
const equalBytes=(a,b)=>a===b||array(a,MAX_BYTES)&&array(b,MAX_BYTES)&&a.length===b.length&&a.every((value,index)=>value===b[index]);

/** One source-event inventory per request. This verifies references and coverage,
 * not GM meaning, release pairing, receiver behavior or practice eligibility. */
function sourceInventory(song,score){
  const source=song.score,performance=source?.performance;
  require(performance?.profile===PROFILE&&hash(source?.source?.sha256)&&integer(source.coverage?.source_events)&&integer(source.coverage?.key_attacks)&&array(performance.tracks,128)&&array(performance.parts)&&array(performance.routes));
  const parts=new Map(),tracks=new Map(),events=new Map(),attacks=new Map(),routeNames=new Map(),routes=new Map(),partRoutes=new Map();
  const nameId=bytes=>{if(bytes===null)return null;const key=JSON.stringify(bytes);if(!routeNames.has(key))routeNames.set(key,routeNames.size);return routeNames.get(key);};
  performance.routes.forEach((route,index)=>{routes.set(`${route.port}:${nameId(route.device_name_bytes)}`,index);});
  for(const part of performance.parts){require(text(part.id)&&!parts.has(part.id)&&integer(part.route,performance.routes.length-1)&&integer(part.channel,15));parts.set(part.id,part);const key=`${part.track_id}:${part.channel}:${part.route}`;require(!partRoutes.has(key));partRoutes.set(key,part.id);}
  require(array(score?.parts)&&score.parts.length===parts.size&&new Set(score.parts.map(part=>part.id)).size===parts.size&&score.parts.every(part=>parts.has(part.id)));
  for(const track of performance.tracks){
    require(integer(track.source_index,127)&&!tracks.has(track.source_index)&&array(track.events));tracks.set(track.source_index,track);
    let tick=0,port=null,device=null;
    for(const [event,record]of track.events.entries()){
      require(array(record,3)&&integer(record[0],1000000000)&&array(record[1],MAX_BYTES));tick+=record[0];require(integer(tick,1000000000));
      const bytes=record[1],at={track:track.source_index,event},key=coordinateKey(at),entry={bytes,tick};events.set(key,entry);require(events.size<=MAX_EVENTS);
      if(bytes[0]===255&&bytes[1]===33)port=bytes[2];
      if(bytes[0]===255&&bytes[1]===9)device=nameId(bytes.slice(2));
      if(bytes.length===3&&(bytes[0]&240)===144&&bytes[2]>0){
        const route=routes.get(`${port}:${device}`),channel=bytes[0]&15,part_id=partRoutes.get(`${track.id}:${channel}:${route}`);
        require(part_id!==undefined);attacks.set(key,{...entry,at,route,channel,part_id,note_id:`midi-t${at.track+1}-e${event+1}`});
      }
    }
  }
  require(events.size===source.coverage.source_events&&attacks.size===source.coverage.key_attacks);
  return {parts,events,attacks,routes:performance.routes,ppq:performance.ppq,originalSha:source.source.sha256};
}

/** Admit only a current Rust-produced Basic disclosure and index it once.
 * The core digest is in its own domain. It is never equated to package content
 * identity or recomputed by serializing rounded JavaScript musical numbers. */
export function validateSourceIdentity(details,inventory){
  const binding=details?.source_binding;
  require(details?.revision===1&&details.analysis_policy_id==='wmc-basic-explicit-gm-identity-v1'&&details.identity_table_revision==='wmc-reviewed-gm-subset-v1'&&details.product_policy_id==='wmc-provisional-piano-guitar-v1'&&details.source_profile===PROFILE&&details.original_bytes_verification==='declared_provenance_only'&&details.original_midi_sha256===inventory.originalSha);
  require(binding&&Object.keys(binding).length===3&&binding.domain==='wmc-basic-complete-wire-json'&&binding.serialization_revision===1&&hash(binding.digest));
  require(array(details.attacks)&&details.attacks.length===inventory.attacks.size&&array(details.parts)&&details.parts.length===inventory.parts.size&&array(details.routes)&&details.routes.length>=inventory.routes.length&&array(details.epochs,MAX_EVENTS+1)&&details.epochs.length>0&&array(details.diagnostics));
  // Bound hostile or incompatible optional responses before retaining an index.
  require(new TextEncoder().encode(JSON.stringify(details)).byteLength<=MAX_BYTES);
  const eventAt=(at,nullable=false)=>{if(nullable&&at===null)return null;require(at&&Object.keys(at).length===2&&integer(at.track,127)&&integer(at.event));const event=inventory.events.get(coordinateKey(at));require(event);return event;};
  const references=(values,max)=>{require(array(values)&&new Set(values).size===values.length&&values.every(index=>integer(index,max-1)));};
  for(const diagnostic of details.diagnostics){require(reasonCodes.has(diagnostic?.code));eventAt(diagnostic.coordinate,true);}
  details.routes.forEach((route,index)=>{
    require(route&&['sole_implicit_route','explicit_routing_out_of_scope'].includes(route.admission)&&array(route.declaration_coordinates));
    if(index<inventory.routes.length){const expected=inventory.routes[index];require(route.source_route_index===index&&route.port===expected.port&&equalBytes(route.device_name_bytes,expected.device_name_bytes));}
    else require(route.source_route_index===null);
    for(const at of route.declaration_coordinates){const bytes=eventAt(at).bytes;require(bytes[0]===255&&(bytes[1]===9||bytes[1]===33));}
  });
  details.epochs.forEach((epoch,index)=>{
    require(epoch?.id===index&&['gm1','gm2','unknown'].includes(epoch.namespace)&&integer(epoch.tick,1000000000)&&['source_start','gm_on','gm_off'].includes(epoch.boundary_kind));
    const event=eventAt(epoch.boundary_coordinate,true);require(index===0?event===null&&epoch.tick===0&&epoch.boundary_kind==='source_start':event&&event.tick===epoch.tick&&epoch.boundary_kind!=='source_start');references(epoch.taint_reason_indices,details.diagnostics.length);
  });
  const counts=new Map([...inventory.parts].map(([id])=>[id,{supported:0,known_unsupported:0,unresolved:0,identities:new Map(),reasons:new Map()}])),seen=new Set(),labels=new Map();
  for(const attack of details.attacks){
    eventAt(attack?.attack_coordinate);const key=coordinateKey(attack.attack_coordinate),expected=inventory.attacks.get(key),count=counts.get(attack.part_id);
    require(expected&&!seen.has(key)&&count&&attack.note_id===expected.note_id&&attack.part_id===expected.part_id&&attack.tick===expected.tick&&attack.route_index===expected.route&&attack.channel===expected.channel&&integer(attack.epoch_index,details.epochs.length-1)&&classifications.has(attack.classification));seen.add(key);
    require(attack.beat&&integer(attack.beat.numerator,1000000000)&&integer(attack.beat.denominator,1000000)&&attack.beat.denominator>0&&BigInt(attack.beat.numerator)*BigInt(inventory.ppq)===BigInt(expected.tick)*BigInt(attack.beat.denominator));
    references(attack.reason_indices,details.diagnostics.length);
    if(attack.classification==='unresolved')require(attack.identity_key===null&&attack.label===null&&attack.reason_indices.length>0);
    else{
      require(text(attack.identity_key,128)&&text(attack.label,256)&&attack.reason_indices.length===0);
      const previous=labels.get(attack.identity_key);require(!previous||previous.label===attack.label&&previous.classification===attack.classification);labels.set(attack.identity_key,{label:attack.label,classification:attack.classification});
      count.identities.set(attack.identity_key,(count.identities.get(attack.identity_key)||0)+1);
    }
    if(attack.committed_selection!==null){
      const selection=attack.committed_selection;require(selection&&integer(selection.program,255));const program=eventAt(selection.program_coordinate).bytes;require(program.length===2&&(program[0]&240)===192&&(program[0]&15)===attack.channel&&program[1]===selection.program);
      for(const [field,controller]of [['bank_msb',0],['bank_lsb',32]]){const value=selection[field],coordinate=selection[`${field}_coordinate`];if(value===null)require(coordinate===null);else{require(integer(value,127));const bytes=eventAt(coordinate).bytes;require(bytes.length===3&&(bytes[0]&240)===176&&(bytes[0]&15)===attack.channel&&bytes[1]===controller&&bytes[2]===value);}}
      eventAt(selection.namespace_coordinate,true);
    }
    count[attack.classification]++;
    const reasons=new Set(attack.reason_indices.map(index=>details.diagnostics[index].code));for(const reason of reasons)count.reasons.set(reason,(count.reasons.get(reason)||0)+1);
  }
  const parts=new Map();
  for(const part of details.parts){
    const count=counts.get(part?.part_id);require(count&&!parts.has(part.part_id));
    const total=count.supported+count.known_unsupported+count.unresolved,states=[count.supported,count.known_unsupported,count.unresolved].filter(Boolean).length;
    require(part.attack_count===total&&part.supported_count===count.supported&&part.known_unsupported_count===count.known_unsupported&&part.unresolved_count===count.unresolved&&part.mixed===(states>1||count.identities.size>1)&&part.classification===(total>0&&count.supported===total?'supported':total>0&&count.known_unsupported===total?'known_unsupported':'unresolved')&&array(part.identity_counts)&&part.identity_counts.length===count.identities.size);
    const identities=[],keys=new Set();for(const item of part.identity_counts){require(item&&count.identities.has(item.identity_key)&&!keys.has(item.identity_key)&&item.count===count.identities.get(item.identity_key));keys.add(item.identity_key);identities.push(Object.freeze({...item,label:labels.get(item.identity_key).label}));}
    parts.set(part.part_id,Object.freeze({part_id:part.part_id,attack_count:total,supported_count:count.supported,known_unsupported_count:count.known_unsupported,unresolved_count:count.unresolved,mixed:part.mixed,classification:part.classification,identities:Object.freeze(identities),reasons:Object.freeze([...count.reasons].map(([code,count])=>Object.freeze({code,count})))}));
  }
  return Object.freeze({parts,sourceBinding:Object.freeze({...binding})});
}

/** Optional Basic-only metadata, independently cached from numeric disclosure.
 * Late requests update their original entry, never whichever song is open now. */
export class SourceIdentityLoader {
  constructor({api,onChange=()=>{}}){this.api=api;this.onChange=onChange;this.entries=new WeakMap();}
  read(context,{load=true}={}){
    const original=originalPitchContext(context),song=original?.cleanSong,score=original?.score,token=song||score;
    if(!token||!score)return fields(null,'absent');
    const cached=this.entries.get(token);if(cached)return cached.value;
    if(!song||song.profile!==PROFILE){const value=fields(token,'unsupported');this.entries.set(token,{value});return value;}
    if(!load)return fields(token,'idle');
    const entry={value:fields(token,'loading')};this.entries.set(token,entry);
    entry.pending=Promise.resolve().then(async()=>{
      const source=pitchModSource(original),request=JSON.stringify({source}),wire=song.score_json,sourceScore=song.score,sourceSnapshot=JSON.stringify(sourceScore),inventory=sourceInventory(song,score);
      const response=await this.api('/api/library/source-identity',JSON.parse(request));
      require(original.score===score&&song.score===sourceScore&&song.score_json===wire&&JSON.stringify(song.score)===sourceSnapshot&&JSON.stringify({source:pitchModSource(original)})===request&&sameSource(response?.source,source));
      entry.value=fields(token,'ready',validateSourceIdentity(response?.details,inventory));
    }).catch(error=>{entry.value=fields(token,['unsupported_source_profile','non_basic_profile'].includes(error?.code)?'unsupported':'error',null,error);}).then(()=>this.onChange());
    return entry.value;
  }
}
