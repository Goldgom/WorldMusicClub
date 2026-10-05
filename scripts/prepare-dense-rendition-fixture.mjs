// Original arithmetic MIDI stream; CC0-1.0. No borrowed or private music.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,statfs} from 'node:fs/promises';
import {join} from 'node:path';
export const DENSE_STREAM=Object.freeze({name:'original-dense-rendition.mid',title:'Original dense rendition scheduling exercise',parts:4,ppq:96,bpm:120,measures:24,measuresPerPage:8,attacksPerPart:1536,attacks:6144,attacksPerPage:2048,durationMs:48000,intervalMs:31.25,gateMs:15.625,allocationVoices:16,rights:'CC0-1.0'});
export const denseDigest=value=>createHash('sha256').update(value).digest('hex');
export async function denseDiskGuard(directory){const disk=await statfs(directory);assert.ok(disk.bavail*disk.bsize>=200*1024*1024,'Dense original acceptance requires at least 200 MiB free disk');}
const vlq=value=>{assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=0xfffffff);const bytes=[value&127];while(value>>=7)bytes.unshift((value&127)|128);return bytes;};
const be16=value=>[value>>8,value&255],be32=value=>[value>>>24,(value>>>16)&255,(value>>>8)&255,value&255];
const track=bytes=>Buffer.from([...Buffer.from('MTrk'),...be32(bytes.length),...bytes]);
export function originalDenseRenditionMidi(){
 const end=24*4*96,tracks=[track([0,255,81,3,7,161,32,0,255,88,4,4,2,24,8,0,255,89,2,0,0,...vlq(end),255,47,0])];
 for(let part=0;part<4;part++){
  const name=Buffer.from(`Original arithmetic part ${part+1}`),events=[0,255,3,name.length,...name,0,192+part,0];let tick=0;
  for(let index=0;index<1536;index++){const at=index*6,key=48+part*7+[0,2,4,5,7,9,11,12][index%8];events.push(...vlq(at-tick),144+part,key,72+part*4,3,128+part,key,0);tick=at+3;}
  events.push(...vlq(end-tick),255,47,0);tracks.push(track(events));
 }
 return Buffer.concat([Buffer.from([...Buffer.from('MThd'),...be32(6),...be16(1),...be16(5),...be16(96)]),...tracks]);
}
// Track 1 contains tempo/meter/key/EOT. Music tracks 2–5 begin with
// track-name event 1 and program event 2; on/off pairs start at events 3/4.
// Notation IDs use one-based coordinates; raw event IDs retain zero-based SMF coordinates.
export function expectedDenseAttacks(sourceSha){return Array.from({length:1536},(_,index)=>Array.from({length:4},(_,part)=>({id:`midi-t${part+2}-e${index*2+3}`,eventId:`midi:${sourceSha}:t${part+1}:e${index*2+2}`,part:`midi-t${part+2}-c${part+1}-r0`,key:48+part*7+[0,2,4,5,7,9,11,12][index%8],velocity:72+part*4,startMs:index*31.25,durationMs:15.625}))).flat();}
export async function prepareDenseRenditionFixture(driver,directory,{retainPages=false}={}){
 await denseDiskGuard(directory);await mkdir(directory,{recursive:true});const source=originalDenseRenditionMidi(),sourceSha=denseDigest(source),expected=expectedDenseAttacks(sourceSha),pages=[];
 const request=async(path,body,raw=false)=>{const response=await driver.fetcher(path,{method:'POST',headers:raw?{'Content-Type':'application/zip','X-WMH-Filename':'original-dense-rendition.zip'}:{'Content-Type':'application/json'},body:raw?body:JSON.stringify(body)}),bytes=await response.bytes();assert.equal(response.status,200,bytes.toString().slice(0,2000));return{body:JSON.parse(bytes),bytes};};
 const input={source_base64:source.toString('base64'),source_name:DENSE_STREAM.name,title:DENSE_STREAM.title,intent:'basic_keys'};
 const draft=(await request('/api/clean-song/draft',input)).body;assert.equal(draft.state,'basic_key_candidate');
 const packed=(await request('/api/clean-song/draft/pack',{...input,expected_draft_sha256:draft.draft_sha256})).body,zip=Buffer.from(packed.zip_base64,'base64');assert.equal(packed.draft_sha256,draft.draft_sha256);
 const saved=(await request('/api/library/import/commit',zip,true)).body;assert.equal(saved.summary.saved,1);const key=saved.items[0].entry.key,opened=(await request('/api/library/load',{key})).body,p=opened.clean_package,r=p.runtime;
 assert.ok(p.score_json===draft.package.score_json,'Native score bytes differ from the original prepared package');assert.ok(p.metadata_json===draft.package.metadata_json,'Native metadata bytes differ from the original prepared package');assert.equal(r.source_sha256,sourceSha);assert.equal(r.profile,'wmh-basic-key-practice-v2');assert.equal(r.rendition.policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(r.rendition.duration_ms,48000);assert.equal(r.rendition.coverage.source_attacks,6144);assert.equal(r.rendition.policy.allocation_lookahead_ms,100);
 assert.equal(r.compilation.timeline.notes.length,expected.length);for(const [index,n]of expected.entries())assert.deepEqual(r.compilation.timeline.notes[index].slice(0,6),[n.id,n.part,n.key,n.velocity,n.startMs,n.durationMs],`Original native target ${index} differs`);
 const identity={key,content_sha256:p.content_sha256,profile:p.profile};
 for(const first_measure of [0,8,16])for(let part=1;part<=4;part++){
  await denseDiskGuard(directory);const body={source:identity,settings:{part_id:`midi-t${part+1}-c${part}-r0`,first_measure,measure_count:8,display_meter:null,rendition_policy_id:r.rendition.policy_id}},response=await request('/api/library/basic-keys/notation',body),page=response.body.page;
  assert.deepEqual(response.body.source,identity);assert.equal(page.source_sha256,sourceSha);assert.equal(page.status,'ready');assert.equal(page.first_measure,first_measure);assert.equal(page.measure_count,8);assert.equal(page.total_measures,24);assert.equal(page.source_start_ms,first_measure*2000);assert.equal(page.follow_end_ms,(first_measure+8)*2000);assert.equal(page.interpreted_notes.length,512);assert.equal(page.score.parts[0].notes.length,512);assert.equal(page.musicxml.note_id_map.segments.length,512);
  const wanted=expected.filter(n=>n.part===body.settings.part_id&&n.startMs>=page.source_start_ms&&n.startMs<page.follow_end_ms);assert.equal(page.interpreted_notes.length,wanted.length);for(const[index,note]of wanted.entries())assert.equal(page.interpreted_notes[index].note_id,note.id,`Original page ${first_measure}, part ${part}, target ${index} differs`);
  const filename=`native-page-${first_measure}-${part}.json`;if(retainPages)await writeFile(join(directory,filename),response.bytes);pages.push({request:body,status:200,sha256:denseDigest(response.bytes),bytes:response.bytes.length,filename:retainPages?filename:null,attacks:512,first_measure,source_start_ms:page.source_start_ms,follow_end_ms:page.follow_end_ms,written_ids:page.musicxml.note_id_map.segments.map(note=>[note.xml_note_id,note.source_note_id])});
 }
 await denseDiskGuard(directory);if(retainPages)await writeFile(join(directory,'native-open.json'),JSON.stringify({score_json:opened.score_json,clean_package:p}));await writeFile(join(directory,DENSE_STREAM.name),source);await writeFile(join(directory,'original-dense-rendition.zip'),zip);
 const manifest={version:1,fixture:DENSE_STREAM,source_sha256:sourceSha,source_bytes:source.length,key,content_sha256:p.content_sha256,zip_sha256:denseDigest(zip),zip_bytes:zip.length,score_sha256:denseDigest(p.score_json),metadata_sha256:denseDigest(p.metadata_json),open_sha256:denseDigest(JSON.stringify({score_json:opened.score_json,clean_package:p})),pages};await writeFile(join(directory,'fixture.json'),JSON.stringify(manifest,null,2)+'\n');return{manifest,opened,expected};
}
