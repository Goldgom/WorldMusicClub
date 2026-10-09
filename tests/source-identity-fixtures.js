import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {pitchModSource} from '../web/pitch-mod.js';

/** Transport/DOM fixture only, not analyzer evidence. Compact source is the
 * committed original CC0 five-attack Rust package. Known labels below exercise
 * joining/display; Rust API and hosted checks establish GM analysis itself. */
export function identityContext(){
 const opened=basicKeyRenditionFixture(),descriptor=opened.clean_package,source=JSON.parse(descriptor.score_json);
 return {score:source.notation,compiled:descriptor.runtime.compilation,cleanSong:{libraryKey:`native:song-${descriptor.content_sha256}`,identity:descriptor.content_sha256,profile:descriptor.profile,score:source,score_json:descriptor.score_json,runtime:descriptor.runtime},opened};
}
export function identityResponse(context,{known=false,label='Acoustic Grand Piano'}={}){
 const song=context.cleanSong,performance=song.score.performance,attacks=[];
 for(const track of performance.tracks){let tick=0;for(const [event,record]of track.events.entries()){
  tick+=record[0];const bytes=record[1];if(bytes.length!==3||(bytes[0]&240)!==144||!bytes[2])continue;
  const channel=bytes[0]&15,part=performance.parts.find(part=>part.track_id===track.id&&part.channel===channel);
  attacks.push({note_id:`midi-t${track.source_index+1}-e${event+1}`,part_id:part.id,attack_coordinate:{track:track.source_index,event},tick,beat:{numerator:tick,denominator:performance.ppq},route_index:part.route,channel,epoch_index:0,classification:known?'supported':'unresolved',identity_key:known?'gm:acoustic_grand_piano':null,label:known?label:null,committed_selection:null,reason_indices:known?[]:[0]});
 }}
 return {source:pitchModSource(context),details:{revision:1,analysis_policy_id:'wmc-basic-explicit-gm-identity-v1',identity_table_revision:'wmc-reviewed-gm-subset-v1',product_policy_id:'wmc-provisional-piano-guitar-v1',source_profile:song.profile,source_binding:{domain:'wmc-basic-complete-wire-json',serialization_revision:1,digest:'a'.repeat(64)},original_bytes_verification:'declared_provenance_only',original_midi_sha256:song.score.source.sha256,routes:performance.routes.map((route,index)=>({...route,source_route_index:index,declaration_coordinates:[],admission:'sole_implicit_route'})),epochs:[{id:0,namespace:'unknown',boundary_coordinate:null,tick:0,boundary_kind:'source_start',taint_reason_indices:[]}],attacks,parts:performance.parts.map(part=>{const count=attacks.filter(attack=>attack.part_id===part.id).length;return {part_id:part.id,attack_count:count,supported_count:known?count:0,known_unsupported_count:0,unresolved_count:known?0:count,mixed:false,classification:known&&count?'supported':'unresolved',identity_counts:known&&count?[{identity_key:'gm:acoustic_grand_piano',count}]:[]};}),diagnostics:known?[]:[{code:'missing_gm_declaration',coordinate:null}]}};
}
export function numericResponse(context){
 return {source:pitchModSource(context),details:{revision:1,source_profile:context.cleanSong.profile,source_binding:{domain:'wmc-basic-complete-wire-json',serialization_revision:1,digest:'a'.repeat(64)},original_midi_sha256:context.cleanSong.score.source.sha256,parts:context.score.parts.map((part,index)=>({part_id:part.id,track_id:`t${index}`,channel_id:`c${index}`,route_id:'r0',source_attack_count:context.cleanSong.runtime.parts[index].attacks,notated_note_count:part.notes.length,key_range:{lowest:35,highest:72},selection_summary:{status:'unknown',observed_selections:[]}})),tracks:context.score.parts.map((part,index)=>({id:`t${index}`,source_track_index:index,names:[{role:'instrument_name',source_route_index:0,utf8:`File metadata ${index}`,channel_prefix_scope:'unscoped'}]})),channels:context.score.parts.map((part,index)=>({id:`c${index}`,channel:context.cleanSong.score.performance.parts[index].channel})),routes:[{id:'r0',source_route_index:0}]}};
}
