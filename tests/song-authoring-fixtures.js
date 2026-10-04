import {createHash} from 'node:crypto';
import {cleanDescriptor} from './clean-song-fixtures.js';
import {nativeScoreServer,nativeResponse} from './native-storage-app-fixtures.js';
import {importFile,importItem,importReport} from './bulk-import-fixtures.js';
export {importFile,importItem,importReport};
export const digest=value=>createHash('sha256').update(value).digest('hex');
// Original C/E/G exercise: a conductor-only track plus one complete note track.
export function authoredConversionMidi(){
 const track=data=>{const bytes=Buffer.from(data),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return Buffer.concat([Buffer.from('MTrk'),size,bytes]);};
 return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,1,0,2,1,224]),track([0,255,81,3,7,161,32,0,255,47,0]),track([0,144,60,90,131,96,128,60,0,0,144,64,90,131,96,128,64,0,0,144,67,90,131,96,128,67,0,0,255,47,0])]);
}
export const midiFile=(name='original-ceg.mid')=>importFile(name,authoredConversionMidi());
export function authoredDraft({sourceName='original-ceg.mid',title='original-ceg',state='strict_notation_candidate'}={}){
 const descriptor=cleanDescriptor(({score,metadata,runtime})=>{score.notation.title=title;metadata.title=title;runtime.compilation.score.title=title;}),raw=authoredConversionMidi();
 const result={state,source:{format:'midi',bytes:raw.length,sha256:digest(raw)},source_name:sourceName,title,
  inventory:{ppq:480,source_tracks:2,source_events:9,key_attacks:3,key_releases:3,tracks:[{source_index:0,track_id:'track-0',name:'Original conductor',source_event_count:2,channels:[],key_attacks:0,key_releases:0,first_event_id:'t0e0',last_event_id:'t0e1',end:{numerator:0,denominator:1}},{source_index:1,track_id:'track-1',name:'Original C/E/G',source_event_count:7,channels:[{channel:0,source_event_count:6,key_attacks:3,key_releases:3}],key_attacks:3,key_releases:3,first_event_id:'t1e0',last_event_id:'t1e6',end:{numerator:3,denominator:1}}],parts:[{id:'part-1',track_id:'track-1',channel:0,notation_available:state==='strict_notation_candidate'}]},
  diagnostics:[],package:{metadata_json:descriptor.metadata_json,score_json:descriptor.score_json},draft_sha256:digest(descriptor.metadata_json+descriptor.score_json)};
 if(state==='rejected'){result.package=null;result.draft_sha256=null;result.diagnostics=[{code:'original_unsupported',message:'Original event semantics are unsupported',action:'Keep the original and inspect the source',source_event_id:null,track_index:1}];}
 return result;
}
export const packageBlob=()=>new Blob([Buffer.from('PK\x03\x04original authored transport fixture')],{type:'application/zip'});
export async function authoringServer(){
 const server=await nativeScoreServer(),drafts=new Map(),packs=new Map();let override;
 server.setRoute(async request=>{
  const custom=await override?.(request);if(custom!==undefined)return custom;
  const {path,body,options}=request;
  if(path==='/api/clean-song/draft'){
   const state=body.source_name.startsWith('held')?'rejected':body.source_name.startsWith('events')?'event_only_reference_candidate':'strict_notation_candidate',draft=authoredDraft({sourceName:body.source_name,title:body.title,state});drafts.set(body.source_name,draft);return nativeResponse(draft,state==='rejected'?422:200);
  }
  if(path==='/api/clean-song/draft/pack'){
   const draft=drafts.get(body.source_name);if(!draft||draft.draft_sha256!==body.expected_draft_sha256)return nativeResponse({code:'clean_draft_changed',error:'Conversion changed'},409);
   const zip=Buffer.concat([Buffer.from('PK\x03\x04'),Buffer.from(body.title)]);packs.set(digest(zip),{draft,zip});return nativeResponse({draft_sha256:draft.draft_sha256,zip_base64:zip.toString('base64'),filename:'complete-song.wmhpack'});
  }
  if(path==='/api/library/import/preview'||path==='/api/library/import/commit'){
   const bytes=Buffer.from(await body.arrayBuffer()),sha256=digest(bytes),pack=packs.get(sha256),mode=path.endsWith('/commit')?'commit':'preview';
   if(!pack)return nativeResponse({code:'pack_invalid',error:'Unknown test package'},422);
   const descriptor=cleanDescriptor(({score,metadata,runtime})=>{score.notation.title=pack.draft.title;metadata.title=pack.draft.title;runtime.compilation.score.title=pack.draft.title;});descriptor.content_sha256=sha256;const score=descriptor.runtime.compilation.score,key=`song-${sha256}`,existing=server.records.get(key),sameId=[...server.records.values()].find(row=>row.entry.score_id===score.id),summary={version:2,content_sha256:descriptor.content_sha256,media:[]};
   const entry={key,revision:1,title:pack.draft.title,composer:'',score_id:score.id,label:pack.draft.title,score_bytes:descriptor.score_json.length,saved_at_unix_ms:1700000000000,clean_package:summary};
   const item=importItem({title:pack.draft.title,clean_package:summary,status:existing?'duplicate':sameId?'conflict':'ready',...(existing?{entry:existing.entry}:{})});
   if(mode==='commit'&&!existing&&(!sameId||options.headers['x-wmh-conflict']==='keep-both')){server.records.set(key,{entry,score_json:JSON.stringify(score),clean_package:descriptor});item.status='saved';item.entry=entry;}
   return nativeResponse(importReport(body,{mode,sha256,items:[item]}));
  }
  if(path==='/api/library/pack/export'){const key=body.keys[0],pack=packs.get(key.slice(5));return{...nativeResponse(null),blob:async()=>new Blob([pack.zip])};}
  return undefined;
 });
 return{...server,drafts,packs,setAuthoringRoute:fn=>{override=fn;}};
}
