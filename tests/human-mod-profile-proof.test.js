import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticFixture,addSyntheticReleasedCheckpoint} from './human-mod-proof-fixtures.js';
import {humanModFixtureCompilation,humanModFixtureTargets,validateHumanModFixtureSample} from '../scripts/human-mod-timbre-sample-proof.mjs';
import {defaultSongMod,createSongMod,songModOptions} from '../web/song-mod.js';

// Synthetic native-looking observations exercise verifier contracts only. The
// independent target plans are the retained output of the real Rust endpoint.
function sampleFixture(performanceInstrument,liveInstrument='follow',{late=true}={}){
 const compilation=humanModFixtureCompilation(),sound=liveInstrument==='follow'?performanceInstrument:liveInstrument,f=syntheticFixture({instrument:sound,late}),take=f.options.take;
 const base=defaultSongMod({score:compilation.score,mode:'practice',practiceSelection:{kind:'all'}}),config=structuredClone(base.config);
 config.parts.forEach((part,index)=>Object.assign(part,{instrument:index?'triangle':'reed',liveInstrument}));take.song_mod=createSongMod(base,config);take.score_id=compilation.score.id;take.practice_part=null;take.practice_selection=songModOptions(take.song_mod).practiceSelection;
 take.target_plan=humanModFixtureTargets(performanceInstrument);take.passes[0].timeline=structuredClone(take.target_plan.timeline);take.passes[0].range={start_ms:0,end_ms:64000};
 const hit=take.passes[0].assessment.hits[0];if(hit){const target=take.target_plan.timeline.notes.find(note=>note.midi===60);hit.note_id=target.id;hit.expected_ms=target.start_ms;hit.delta_ms=hit.actual_ms-hit.expected_ms;}
 take.passes[0].assessment.misses=take.target_plan.timeline.notes.filter(note=>note.id!==hit?.note_id).map(note=>note.id);
 return{sample:{label:'synthetic-profile-contract',performanceInstrument,expectedInstrument:sound,audio:addSyntheticReleasedCheckpoint(f.e),transport:f.options.transport},options:{take,compilation,expectedLiveInstrument:liveInstrument}};
}
const verify=f=>validateHumanModFixtureSample(f.sample,f.options);
for(const profile of ['piano','guitar'])for(const live of ['follow','piano','guitar'])test(`exact ${profile} target oracle is independent of ${live} live recipe`,()=>{
 const f=sampleFixture(profile,live);verify(f);const p=f.options.take.target_plan;assert.equal(p.source_note_count,4);assert.equal(p.target_count,profile==='piano'?2:4);assert.equal(f.options.take.passes[0].inputs.length,1);assert.equal(f.sample.audio.calls.length,1);
 assert.deepEqual(p.diagnostics.map(d=>d.code),profile==='piano'?['piano_unison_targets']:['guitar_fingering_advisory','guitar_pitch_only_targets']);
 for(const group of p.groups)assert.equal(group.part_ids.length,profile==='piano'?2:1);
});
for(const profile of ['piano','guitar'])for(const [name,mutate]of [
 ['other profile grouping',f=>{f.options.take.target_plan=humanModFixtureTargets(profile==='piano'?'guitar':'piano');f.options.take.passes[0].timeline=structuredClone(f.options.take.target_plan.timeline);}],
 ['missing diagnostic',f=>f.options.take.target_plan.diagnostics.pop()],
 ['altered diagnostic disclosure',f=>{f.options.take.target_plan.diagnostics[0].message='Unqualified physical ownership';}],
 ['lost original owner',f=>{f.options.take.target_plan.groups[0].part_ids=['unknown'];}],
 ['invented source occurrence',f=>{f.options.take.target_plan.groups[0].source_occurrence_ids=['fake'];}],
 ['changed note clock',f=>{f.options.take.target_plan.timeline.notes[0].start_ms=1;f.options.take.passes[0].timeline.notes[0].start_ms=1;}],
 ['duplicate recorded event',f=>{f.options.take.passes[0].inputs.push(structuredClone(f.options.take.passes[0].inputs[0]));}],
])test(`${profile} profile proof rejects ${name}`,()=>{const f=sampleFixture(profile);mutate(f);assert.throws(()=>verify(f));});

test('one physical guitar input cannot be credited to two retained same-pitch string targets',()=>{
 const f=sampleFixture('guitar','follow',{late:false});verify(f);const pass=f.options.take.passes[0],second=f.options.take.target_plan.timeline.notes.filter(n=>n.midi===60)[1];pass.assessment.hits.push({...pass.assessment.hits[0],note_id:second.id});pass.assessment.misses=pass.assessment.misses.filter(id=>id!==second.id);assert.throws(()=>verify(f));
});
