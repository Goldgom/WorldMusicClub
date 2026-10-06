// Shared original-fixture acceptance contract. The frozen compilation was
// produced by the existing socket-free Rust example, not a JS target planner.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {humanModTimbreFixture,HUMAN_MOD_TIMBRE_PARTS} from './prepare-human-mod-timbre-fixtures.mjs';
import {validateHumanModLiveTone} from './human-mod-live-tone-proof.mjs';
import {validateLiveToneReleasedCheckpoint} from './live-tone-proof.mjs';
import {validateTargetPlan} from '../web/physical-targets.js';
import {validateSongMod,songModIdentity,songModOptions} from '../web/song-mod.js';
import {createPartInstrumentPolicy,resolvePartInstrumentInput} from '../web/part-instrument-policy.js';

const oracle=JSON.parse(readFileSync(new URL('../tests/fixtures/human-mod-timbre-compilation.json',import.meta.url),'utf8'));
export function humanModFixtureCompilation(){
 const fixture=humanModTimbreFixture();assert.equal(oracle.version,1);assert.equal(oracle.kind,'rust-generated-original-fixture-compilation');assert.equal(oracle.fixture_sha256,createHash('sha256').update(fixture.bytes).digest('hex'));assert.deepEqual(oracle.compilation.score,fixture.score);return structuredClone(oracle.compilation);
}
export function humanModFixtureTargets(performanceInstrument){
 const expected=oracle.target_profiles?.[performanceInstrument];assert.ok(expected&&['piano','guitar'].includes(performanceInstrument),'A closed original performance profile is required');
 const profile=performanceInstrument==='piano'?{kind:'piano',key_count:61,lowest_midi:null}:{kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0};assert.deepEqual(expected.profile,profile);
 const compilation=humanModFixtureCompilation();validateTargetPlan(expected.plan,compilation.timeline);return structuredClone(expected.plan);
}
export function validateHumanModFixtureSample(sample,{take,compilation,expectedLiveInstrument}={}){
 const original=humanModFixtureCompilation(),fixture=humanModTimbreFixture();
 assert.deepEqual(compilation,original,'Observed Rust compilation must contain every original occurrence, field and exact source clock');
 assert.ok(['follow','piano','guitar'].includes(expectedLiveInstrument),'The stage live choice is required independently of the claimed PCM recipe');
 assert.ok(['piano','guitar'].includes(sample.performanceInstrument),'The actual performance control is required to resolve Follow');
 assert.equal(take.score_id,fixture.score.id);assert.equal(take.practice_part,null);
 const binding={identity:songModIdentity({score:original.score}),parts:original.score.parts};validateSongMod(take.song_mod,binding);assert.equal(take.song_mod.version,2);
 const config=take.song_mod.config;assert.equal(config.layout,'complete');assert.equal(config.showOtherParts,true);assert.ok(config.parts.every(part=>part.muted===false&&part.visible===true));assert.deepEqual(config.parts.map(part=>part.partId),HUMAN_MOD_TIMBRE_PARTS);assert.deepEqual(config.parts.map(part=>part.instrument),['reed','triangle']);
 assert.ok(config.parts.every(part=>part.performer==='human'&&part.liveInstrument===expectedLiveInstrument),'Every original human owner must retain the chosen live preference');
 const options=songModOptions(take.song_mod);assert.deepEqual(take.practice_selection,options.practiceSelection);assert.equal(options.mode,'practice');
 const policy=createPartInstrumentPolicy(take.song_mod,{...binding,performanceInstrument:sample.performanceInstrument,mode:options.mode}),route=resolvePartInstrumentInput(policy);assert.equal(route.status,'ready');assert.equal(route.instrument,sample.expectedInstrument,'Mod and the actual performance control must resolve to the observed recipe');assert.deepEqual(route.partIds,HUMAN_MOD_TIMBRE_PARTS);
 const expectedTargetPlan=humanModFixtureTargets(sample.performanceInstrument);
 validateTargetPlan(take.target_plan,original.timeline);assert.deepEqual(take.target_plan,expectedTargetPlan,'Every target, source owner and diagnostic must match the exact Rust performance-profile oracle');assert.equal(take.target_plan.playable,true);assert.equal(take.target_plan.source_note_count,4);assert.equal(take.target_plan.timeline.duration_ms,64000);assert.deepEqual(take.passes[0].timeline,take.target_plan.timeline);assert.deepEqual(take.passes[0].range,{start_ms:0,end_ms:64000});
 validateHumanModLiveTone(sample.audio,{take,transport:sample.transport,expectedInstrument:sample.expectedInstrument,expectedPartIds:HUMAN_MOD_TIMBRE_PARTS,expectedTargetPlan});
 validateLiveToneReleasedCheckpoint(sample.audio);
 return sample;
}
