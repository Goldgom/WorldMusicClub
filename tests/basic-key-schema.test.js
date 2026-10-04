import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const ajv = new Ajv2020({strict:true,allErrors:true});
ajv.addSchema(json('../schema/worldmusichub-score-v1.schema.json'));
const validate=ajv.compile(json('../schema/worldmusichub-basic-keys-midi1-v1.schema.json'));
const fixture=json('./fixtures/basic-keys/score.json');

test('original mixed fixture retains complete events and independent partial projection',()=>{
 assert.equal(validate(fixture),true,ajv.errorsText(validate.errors));
 assert.equal(fixture.performance.profile,'wmh-basic-keys-midi1-v1');
 assert.equal(fixture.coverage.key_attacks,4);
 assert.equal(fixture.coverage.zero_length_attacks,1);
 assert.equal(fixture.coverage.unresolved_ends,1);
 assert.equal(fixture.coverage.notation_notes,2);
 assert.equal(fixture.performance.tracks.length,3);
 assert.equal(fixture.performance.tracks.reduce((n,t)=>n+t.events.length,0),15);
 assert.equal('notes' in fixture.performance,false);
 assert.equal(fixture.notation.tempo[0].bpm,120);
 assert.equal(fixture.performance.timing.smf_default_tempo_used,false);
 const unspecified=structuredClone(fixture);unspecified.notation.tempo=[];
 assert.equal(validate(unspecified),true,ajv.errorsText(validate.errors));
 assert.equal(fixture.notation.source,null);
});

test('profile schema rejects raw files, duplicate derived attacks and invented flags',()=>{
 for(const change of [
  s=>{s.original_midi='TVRoZA==';},
  s=>{s.performance.notes=[];},
  s=>{s.performance.profile='unknown';},
  s=>{s.performance.tracks[0].events[0].push(false);},
  s=>{s.performance.tracks[0].events[0][0]=-1;},
  s=>{s.performance.tracks[0].events[0][1].push(256);},
  s=>{s.notation.source={format:'midi',content:'original'};},
  s=>{s.capabilities.source_rendition='source_sound_verified';},
 ]){const altered=structuredClone(fixture);change(altered);assert.equal(validate(altered),false);}
});

test('retained source omission and invalid program byte are structurally explicit',()=>{
 const s=structuredClone(fixture);
 s.performance.tracks[0].events=[[0,[192,128]],[0,[144,60,90]],[96,[128,60,0],true],[0,[255,47]]];
 s.performance.timing.invalid_program_events=1;
 assert.equal(validate(s),true,ajv.errorsText(validate.errors));
 // Rust additionally checks the source status, complete derived clocks,
 // ownership and coverage; this structure alone is not package acceptance.
});
