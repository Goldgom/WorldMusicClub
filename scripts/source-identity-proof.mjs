// Finite independent oracles for original public CC0 source-identity fixtures.
// These validators are not analyzer output or evidence of executed native code.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const identityDigest=value=>createHash('sha256').update(value).digest('hex');
export const BASIC_PROFILE='wmh-basic-keys-midi1-v1';
export const IDENTITY_CASES=Object.freeze([
 {id:'04_gm1_piano',labels:['Acoustic Grand Piano'],classes:['supported'],counts:[1,0,0],mixed:false,reasons:[]},
 {id:'01_no_gm_program_basic_controller',labels:[],classes:['unresolved'],counts:[0,0,1],mixed:false,reasons:['missing_gm_declaration'],sha256:'6ae97dc2d8b301fe7a77b4c127f2d2593f0020c81af91344c41ea0f58ede7633'},
 {id:'14_unknown_variant',labels:[],classes:['unresolved'],counts:[0,0,1],mixed:false,reasons:['unknown_tuple']},
 {id:'31_program_changes_per_attack',labels:['Acoustic Grand Piano','Violin'],classes:['supported','known_unsupported'],counts:[1,1,0],mixed:true,reasons:[]},
 {id:'01_no_gm_program',profile:'canonical',labels:[],classes:['unresolved'],counts:[0,0,1],mixed:false,reasons:[]},
]);

// Fixture-only SMF scanner: no running status, tempo map, routing or guessing.
// Its exact finite inputs use one track and default tempo, and isolated key 60.
export function scanIdentityFixture(bytes){
 assert.ok(Buffer.isBuffer(bytes)&&bytes.length<4096);assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt32BE(4),6);assert.equal(bytes.readUInt16BE(8),0);assert.equal(bytes.readUInt16BE(10),1);
 const ppq=bytes.readUInt16BE(12);assert.ok(ppq>0&&ppq<32768);assert.equal(bytes.toString('ascii',14,18),'MTrk');assert.equal(bytes.readUInt32BE(18),bytes.length-22);
 let offset=22,tick=0;const events=[],notes=[],active=[];
 const variable=()=>{let value=0;for(let index=0;index<4;index++){assert.ok(offset<bytes.length);const b=bytes[offset++];value=value*128+(b&127);if(!(b&128))return value;}assert.fail('Invalid original fixture VLQ');};
 while(offset<bytes.length){const delta=variable(),status=bytes[offset++];let event;tick+=delta;
  if(status===255){const kind=bytes[offset++],length=variable();event=[status,kind,...bytes.subarray(offset,offset+length)];offset+=length;assert.notEqual(kind,81,'These finite fixtures use only default tempo');}
  else if(status===240||status===247){const length=variable();event=[status,...bytes.subarray(offset,offset+length)];offset+=length;}
  else{assert.ok(status>=128&&status<=239);const width=[192,208].includes(status&240)?1:2;event=[status,...bytes.subarray(offset,offset+width)];offset+=width;}
  assert.ok(offset<=bytes.length);const index=events.length;events.push([delta,event]);
  if((status&240)===144&&event[2]>0){assert.equal(event[1],60);const note={id:`midi-t1-e${index+1}`,midi:event[1],velocity:event[2],start_ms:tick*500/ppq,duration_ms:null,coordinate:{track:0,event:index},tick,channel:status&15};notes.push(note);active.push(note);}
  else if((status&240)===128||((status&240)===144&&event[2]===0)){const at=active.findIndex(note=>note.channel===(status&15)&&note.midi===event[1]);assert.ok(at>=0);const [note]=active.splice(at,1);note.duration_ms=tick*500/ppq-note.start_ms;}
 }
 assert.equal(active.length,0);assert.deepEqual(events.at(-1)[1],[255,47]);assert.ok(notes.length>=1&&notes.length<=2);return {ppq,events,notes};
}

export async function readIdentityFixtures(root,directory=null){
 const path=join(root,'crates/score-core/src/source_identity/fixtures'),manifest=JSON.parse(await readFile(join(path,'cases.json'),'utf8'));assert.match(manifest.license,/CC0-1\.0/);
 const fixtures=[];if(directory)await mkdir(directory,{recursive:true});
 for(const expected of IDENTITY_CASES){const extra=expected.id==='01_no_gm_program_basic_controller',row=extra?expected:manifest.cases.find(value=>value.id===expected.id);if(!extra)assert.equal(row.file,`fixtures/${expected.id}.mid`);const bytes=await readFile(join(extra?join(root,'tests/fixtures/source-identity'):path,`${expected.id}.mid`));assert.equal(identityDigest(bytes),row.sha256);const scanned=scanIdentityFixture(bytes);assert.equal(scanned.notes.length,expected.classes.length);const fixture={profile:BASIC_PROFILE,...expected,...scanned,filename:`${expected.id}.mid`,bytes,sha256:row.sha256,rights:{status:'original_authored',license:'CC0-1.0',source:extra?'tests/fixtures/source-identity/README.md':'crates/score-core/src/source_identity/fixtures/README.md'}};fixtures.push(fixture);if(directory)await writeFile(join(directory,fixture.filename),bytes,{flag:'wx'});}
 return fixtures;
}

// The direct importer keeps exact canonical input canonical; Basic is a fallback,
// not an effect of using the bulk picker. Keep these two response contracts distinct.
export function validateIdentityImport(report,fixture){
 assert.equal(report.format,'worldmusichub-import-report');assert.equal(report.version,1);assert.equal(report.mode,'commit');assert.equal(report.source.filename,fixture.filename);assert.equal(report.source.bytes,fixture.bytes.length);assert.equal(report.source.sha256,fixture.sha256);assert.equal(report.source.retained,true);assert.equal(report.items.length,1);
 const item=report.items[0];assert.equal(item.status,'saved');assert.equal(item.playable,true);assert.match(item.entry.key,/^song-[a-f0-9]{64}$/);
 if(fixture.profile==='canonical'){assert.equal(item.entry.library_format_version,1);assert.equal(Object.hasOwn(item,'clean_package'),false);assert.equal(Object.hasOwn(item.entry,'clean_package'),false);assert.deepEqual(item.entry.retained_source,{format:'midi-base64',filename:null,bytes:Buffer.byteLength(fixture.bytes.toString('base64')),sha256:identityDigest(fixture.bytes.toString('base64'))});}
 else{assert.ok(item.clean_package,`${fixture.id} must actually import as a complete Basic package`);assert.equal(item.clean_package.profile,BASIC_PROFILE);assert.equal(item.entry.library_format_version,2);assert.deepEqual(item.entry.clean_package,item.clean_package);assert.equal(item.entry.key,`song-${item.clean_package.content_sha256}`);if(fixture.id==='01_no_gm_program_basic_controller')assert.ok(report.warnings.some(warning=>warning.includes('MIDI controller 74 is unsupported')));}
 return item;
}
export function validateCanonicalIdentityOpened(opened,fixture){
 assert.equal(fixture.profile,'canonical');assert.equal(opened.entry.library_format_version,1);assert.equal(Object.hasOwn(opened,'clean_package'),false);assert.equal(Object.hasOwn(opened.entry,'clean_package'),false);assert.equal(opened.entry.score_sha256,identityDigest(opened.score_json));assert.equal(opened.entry.content_sha256,opened.entry.score_sha256);assert.equal(opened.entry.key,`song-${opened.entry.content_sha256}`);
 const score=JSON.parse(opened.score_json);assert.equal(score.source.format,'midi-base64');assert.equal(score.source.content,fixture.bytes.toString('base64'));assert.deepEqual(Buffer.from(score.source.content,'base64'),fixture.bytes);assert.equal(score.parts.length,1);assert.equal(score.parts[0].notes.length,fixture.notes.length);
 for(const [index,note]of score.parts[0].notes.entries()){const expected=fixture.notes[index];assert.equal(note.id,`midi-t1-c1-e${expected.coordinate.event+1}`);assert.deepEqual(note.pitch,{step:'C',alter:0,octave:4});assert.equal(note.velocity,expected.velocity);assert.equal(note.at.numerator*fixture.ppq,note.at.denominator*expected.tick);assert.equal(note.duration.numerator*500,note.duration.denominator*expected.duration_ms);}
 return score;
}
export function validateCanonicalIdentityRuntime(compiled,fixture,score){
 assert.deepEqual(compiled.score,score);assert.deepEqual(compiled.timeline.notes.map(({id,midi,velocity,start_ms,duration_ms})=>({id,midi,velocity,start_ms,duration_ms})),fixture.notes.map(({coordinate,midi,velocity,start_ms,duration_ms})=>({id:`midi-t1-c1-e${coordinate.event+1}`,midi,velocity,start_ms,duration_ms})));return compiled;
}

export function validateIdentityOpened(opened,fixture){
 assert.equal(fixture.profile,BASIC_PROFILE);const clean=opened.clean_package;assert.ok(clean,`${fixture.id} must open as complete Basic, never relabel canonical input`);assert.equal(clean.profile,BASIC_PROFILE);const score=JSON.parse(clean.score_json),metadata=JSON.parse(clean.metadata_json);
 assert.deepEqual(score.source,{format:'midi',bytes:fixture.bytes.length,sha256:fixture.sha256});assert.equal(score.performance.ppq,fixture.ppq);assert.deepEqual(score.performance.tracks.map(track=>track.events),[fixture.events]);assert.equal(score.coverage.source_events,fixture.events.length);assert.equal(score.coverage.represented_events,fixture.events.length);assert.equal(score.coverage.key_attacks,fixture.notes.length);
 const typed={format:'worldmusichub-song',version:2,id:`midi-basic-${fixture.sha256}`,title:fixture.filename,score:{path:'score.json',bytes:Buffer.byteLength(clean.score_json),sha256:identityDigest(clean.score_json)},sources:[score.source],rights:{status:'user_supplied_unverified',attribution:'User-supplied MIDI; source rights are unverified',license:null},media:[]};
 assert.deepEqual(metadata,typed,'Original raw MIDI conversion metadata must match the complete fixture contract');assert.equal(clean.content_sha256,identityDigest(JSON.stringify(typed)));assert.equal(opened.entry.key,`song-${clean.content_sha256}`);
 assert.equal(clean.runtime.profile,'wmh-basic-key-practice-v2');assert.equal(clean.runtime.source_sha256,fixture.sha256);assert.equal(clean.runtime.rendition.policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(clean.runtime.rendition.coverage.source_attacks,fixture.notes.length);
 assert.deepEqual(clean.runtime.compilation.timeline.notes.map(row=>({id:row[0],midi:row[2],velocity:row[3],start_ms:row[4],duration_ms:row[5]})),fixture.notes.map(({coordinate,tick,channel,...note})=>note),'Runtime notes and timing must preserve the independent original MIDI oracle');
 return {key:opened.entry.key,content_sha256:clean.content_sha256,profile:BASIC_PROFILE,choice:null,runtime_policy:'wmh-basic-key-rendition-fifo-v1'};
}

export function validateIdentityDisclosure(response,fixture,source){
 assert.deepEqual(response.source,source);assert.deepEqual(Object.keys(response).sort(),['details','source']);const d=response.details;
 assert.equal(d.revision,1);assert.equal(d.source_profile,BASIC_PROFILE);assert.equal(d.analysis_policy_id,'wmc-basic-explicit-gm-identity-v1');assert.equal(d.identity_table_revision,'wmc-reviewed-gm-subset-v1');assert.equal(d.product_policy_id,'wmc-provisional-piano-guitar-v1');assert.equal(d.original_bytes_verification,'declared_provenance_only');assert.equal(d.original_midi_sha256,fixture.sha256);assert.equal(d.source_binding.domain,'wmc-basic-complete-wire-json');assert.equal(d.source_binding.serialization_revision,1);assert.match(d.source_binding.digest,/^[a-f0-9]{64}$/);assert.notEqual(d.source_binding.digest,source.content_sha256,'Core compact-wire binding is separate from package metadata identity');
 assert.equal(d.attacks.length,fixture.notes.length);assert.deepEqual(d.attacks.map(a=>a.classification),fixture.classes);assert.deepEqual([...new Set(d.attacks.map(a=>a.label).filter(Boolean))],fixture.labels);
 for(const [index,a]of d.attacks.entries()){const note=fixture.notes[index];assert.equal(a.note_id,note.id);assert.deepEqual(a.attack_coordinate,note.coordinate);assert.equal(a.tick,note.tick);assert.equal(a.channel,note.channel);assert.equal(a.beat.numerator*fixture.ppq,a.beat.denominator*note.tick);if(a.classification==='unresolved'){assert.equal(a.label,null);assert.equal(a.identity_key,null);assert.ok(a.reason_indices.length);}}
 assert.equal(d.parts.length,1);const p=d.parts[0];assert.equal(p.attack_count,fixture.notes.length);assert.deepEqual([p.supported_count,p.known_unsupported_count,p.unresolved_count],fixture.counts);assert.equal(p.mixed,fixture.mixed);assert.equal(p.classification,fixture.mixed?'unresolved':fixture.classes[0]);assert.equal(p.identity_counts.reduce((count,value)=>count+value.count,0),fixture.notes.length-fixture.counts[2]);
 for(const reason of fixture.reasons)assert.ok(d.diagnostics.some(value=>value.code===reason));return d;
}

export function validateIdentityUi(ui,fixture,{faultStatus=null}={}){
 assert.equal(ui.parts.length,1);const part=ui.parts[0];assert.equal(part.collapsed,true,'Summary must be inspected with source details collapsed');assert.equal(part.collapsedBodyRows,0,'Collapsed source details must remain lazy');assert.equal(ui.startDisabled,false);assert.equal(ui.configureDisabled,false);
 const text=part.pages.flat().map(row=>row.join(': ')).join('\n');assert.match(text,/MIDI channel \(1–16\): 1/);assert.match(text,/Source note attacks \/ notated notes:/);assert.match(text,/MIDI program/);assert.match(text,/Informational only: these classifications do not decide practice support/);
 if(fixture.profile==='canonical'){assert.match(part.summary,/Original instrument: not identified/);assert.doesNotMatch(part.summary,/Analyzed original instrument:/);assert.match(text,/Available only for Basic MIDI sources/);assert.doesNotMatch(text,/Identity analysis classification:|Analyzed original identity:|Identity analysis could not be loaded/);return ui;}
 if(faultStatus){assert.match(text,/Identity analysis could not be loaded/);assert.doesNotMatch(part.summary,/Analyzed original instrument:/);for(const label of fixture.labels)assert.ok(!part.summary.includes(label));return ui;}
 assert.match(part.summary,/Analyzed original instrument:/);assert.match(part.summary,/Informational only/);const [supported,unsupported,unresolved]=fixture.counts;assert.ok(part.summary.includes(`${supported} supported · ${unsupported} known unsupported · ${unresolved} unresolved`));assert.ok(text.includes(`${supported} supported · ${unsupported} known unsupported · ${unresolved} unresolved`));
 for(const label of fixture.labels){assert.ok(part.summary.includes(label));assert.ok(part.pages.flat().some(([key,value])=>key==='Analyzed original identity'&&value.includes(label)));}
 if(!fixture.labels.length){assert.match(part.summary,/not identified/);assert.ok(part.pages.flat().some(([key])=>key==='Unresolved identity reason'));}
 if(fixture.mixed){assert.match(part.summary,/Mixed/);assert.match(text,/Identity analysis classification: Mixed · Unresolved/);}
 if(fixture.id==='01_no_gm_program_basic_controller')assert.match(text,/No admitted General MIDI declaration/);
 if(fixture.id==='14_unknown_variant')assert.match(text,/outside the reviewed identity subset/);
 return ui;
}
