// Independent original-event oracles shared by stdio and hosted acceptance.
import assert from 'node:assert/strict';
import {DIRECT_MIDI_POLICY,directMidiDigest} from './prepare-direct-midi-fixtures.mjs';

export function validateDirectMidiImport(report,fixture,{mode='commit',status='saved'}={}){
 assert.equal(report.format,'worldmusichub-import-report');assert.equal(report.version,1);assert.equal(report.mode,mode);assert.equal(report.source.filename,fixture.filename);assert.equal(report.source.bytes,fixture.bytes.length);assert.equal(report.source.sha256,fixture.manifest.sha256);assert.equal(report.source.retained,mode==='commit');assert.equal(report.items.length,1);
 const item=report.items[0];assert.equal(item.status,status);assert.equal(item.clean_package.profile,'wmh-basic-keys-midi1-v1');assert.equal(item.clean_package.coverage.key_attacks,4);assert.ok(report.warnings.some(warning=>/FIFO|fifo/.test(warning)),'Named interpretation must be disclosed');
 if(mode==='commit'){assert.match(item.entry.key,/^song-[a-f0-9]{64}$/);assert.equal(item.entry.key,`song-${item.clean_package.content_sha256}`);assert.ok(report.source.archive_key);}
 return item;
}
export function validateDirectMidiOpened(opened,fixture){
 const clean=opened.clean_package;assert.equal(clean.profile,'wmh-basic-keys-midi1-v1');assert.equal(opened.entry.key,`song-${clean.content_sha256}`);
 const score=JSON.parse(clean.score_json),metadata=JSON.parse(clean.metadata_json),runtime=clean.runtime;
 assert.deepEqual(score.source,{format:'midi',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256});assert.equal(metadata.score.bytes,Buffer.byteLength(clean.score_json));assert.equal(metadata.score.sha256,directMidiDigest(clean.score_json));assert.deepEqual(metadata.sources,[score.source]);
 assert.equal(score.performance.source_format,fixture.manifest.format);assert.equal(score.performance.ppq,384);assert.deepEqual(score.performance.tracks.map(track=>track.events),fixture.tracks,'Every ordered raw channel/meta event and metadata-only/empty track must survive');assert.deepEqual(score.performance.tracks.map(track=>track.source_index),fixture.tracks.map((_,index)=>index));
 for(const coverage of [score.coverage,clean.coverage]){assert.equal(coverage.source_tracks,fixture.manifest.source_tracks);assert.equal(coverage.source_events,fixture.manifest.source_events);assert.equal(coverage.represented_events,fixture.manifest.source_events);assert.equal(coverage.key_attacks,4);assert.equal(coverage.key_releases,4);}
 assert.equal(runtime.profile,'wmh-basic-key-practice-v2');assert.equal(runtime.source_sha256,fixture.manifest.sha256);assert.equal(runtime.rendition.policy_id,DIRECT_MIDI_POLICY);assert.equal(runtime.rendition.coverage.source_attacks,4);assert.equal(runtime.rendition.duration_ms,2000);
 assert.deepEqual(runtime.compilation.timeline.notes.map(row=>({id:row[0],midi:row[2],velocity:row[3],start_ms:row[4],duration_ms:row[5]})),fixture.expectedNotes,'The final source attack and both independent same-key FIFO targets must be present');
 assert.equal(runtime.rendition.notes.length,4);return opened;
}
export function validateDirectMidiTake(take,fixture){
 assert.ok(take.passes.length>=1);const pass=take.passes.at(-1);assert.deepEqual(pass.inputs,[],'Machine playback must never manufacture a user hit');assert.deepEqual(pass.captures,[]);assert.equal(pass.interpretation.policy_id,DIRECT_MIDI_POLICY);assert.deepEqual(pass.timeline.notes.map(note=>({id:note.id,midi:note.midi,velocity:note.velocity,start_ms:note.start_ms,duration_ms:note.duration_ms})),fixture.expectedNotes);assert.equal(take.target_plan.source_note_count,4);assert.equal(take.target_plan.target_count,4);assert.deepEqual(take.target_plan.timeline.notes.map(note=>note.id),fixture.expectedNotes.map(note=>note.id));return take;
}
export function directMidiAudioOracle(fixture){return fixture.expectedNotes.map(note=>({...note,noteId:note.id,eventId:`midi:${fixture.manifest.sha256}:t0:e${Number(note.id.split('-e')[1])-1}`,key:note.midi,startMs:note.start_ms,durationMs:note.duration_ms,role:'melodic_key'}));}
