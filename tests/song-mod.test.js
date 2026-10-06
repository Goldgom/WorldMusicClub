import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SongModStore,createSongMod,defaultSongMod,songModConfigFingerprint,songModIdentity,songModOptions,validateSongMod,assertSongModSupported,songModCapabilities} from '../web/song-mod.js';
import {ScorePreview} from '../web/score-preview.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {practiceStageNotes} from '../web/practice-stage-display.js';
import {createPartInstrumentPolicy,resolvePartInstrumentInput,PART_INSTRUMENT_POLICY} from '../web/part-instrument-policy.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {fixture} from './frontend-fixtures.js';
const context=()=>{const score=structuredClone(fixture);score.parts=[...score.parts,{...structuredClone(score.parts[0]),id:'other',name:'Other',notes:[]}];return {score,compiled:{timeline:{notes:[]}},practiceSelection:{kind:'parts',part_ids:[score.parts[0].id]},practiceLayout:'complete',showOthers:true};};
test('song Mod retains source order, original bytes and shared performer ownership independently of mute/display',()=>{
 const value=context(),before=JSON.stringify(value),base=defaultSongMod(value),config=structuredClone(base.config);config.parts[0].muted=true;config.parts[0].visible=false;config.parts[1].instrument='triangle';const mod=createSongMod(base,config),options=songModOptions(mod);
 assert.deepEqual(options.practiceSelection.part_ids,[value.score.parts[0].id]);assert.deepEqual(options.mutedPartIds,[value.score.parts[0].id]);assert.deepEqual(options.hiddenPartIds,[value.score.parts[0].id]);assert.deepEqual(options.instrumentOverrides,{other:'triangle'});assert.equal(JSON.stringify(value),before);assert.equal(validateSongMod(mod,{identity:songModIdentity(value),parts:value.score.parts}),mod);
 for(const performer of ['human','machine']){const all=createSongMod(base,{...config,parts:config.parts.map(part=>({...part,performer}))});assert.equal(songModOptions(all).mode,performer==='human'?'practice':'listen');assert.equal(songModOptions(all).practiceSelection.kind,'all');}
});
test('portable Mod fingerprint matches native golden vector and standard SHA-256 preimage',()=>{
 const config={layout:'complete',showOtherParts:true,parts:[{partId:'midi-t2-c1',performer:'human',instrument:'source',muted:false,visible:true},{partId:'midi-t3-c2',performer:'machine',instrument:'source',muted:false,visible:true}]};assert.equal(songModConfigFingerprint(config),'d532e0a13635c824c646d08f27ad62ecfdf13bc6d4fcc310637bb2fd6e32a366');
 config.parts[0].partId='声部🎵"\\\n';const tuple=[config.layout,config.showOtherParts,config.parts.map(p=>[p.partId,p.performer,p.instrument,p.muted,p.visible])];assert.equal(songModConfigFingerprint(config),createHash('sha256').update('wmc-song-mod-config-v1\n'+JSON.stringify(tuple)).digest('hex'));
});
test('closed Mod envelope rejects wrong source revisions, corrupt hashes and invented part IDs',()=>{
 const value=context(),base=defaultSongMod(value);for(const change of [m=>m.version++,m=>m.config.parts[0].partId='missing',m=>m.config.parts.reverse(),m=>m.config.parts[0].visible=false,m=>m.sourceRevision.value='0'.repeat(64),m=>m.config.parts[0].extra='script',m=>m.config.parts[0].performer='remote-player']){const mod=structuredClone(base);change(mod);assert.throws(()=>validateSongMod(mod,{identity:songModIdentity(value),parts:value.score.parts}),{code:'invalid_song_mod'});}
});
test('per-song storage restores explicit choices, isolates source revisions, and keeps original defaults recoverable',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},value=context(),store=new SongModStore({storage}),base=store.read(value),config=structuredClone(base.mod.config);config.parts[1].instrument='reed';const changed=createSongMod(base.mod,config);assert.equal(store.save(value,changed).status,'saved');const reopened=new SongModStore({storage}).read(value);assert.deepEqual(reopened.mod,changed);assert.deepEqual(reopened.original,base.original);const newSource=structuredClone(value);newSource.score.title+=' changed';assert.equal(new SongModStore({storage}).read(newSource).status,'default');assert.equal(values.size,1);store.save(value,base.original);assert.deepEqual(new SongModStore({storage}).read(value).mod,base.original);
});
test('unavailable storage cannot erase an old Mod or interrupt current configuration',()=>{
 const value=context(),store=new SongModStore({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}}),base=store.read(value);assert.equal(base.status,'unavailable');const config=structuredClone(base.mod.config);config.parts[1].muted=true;const changed=createSongMod(base.mod,config);assert.equal(store.save(value,changed).status,'unsaved');assert.deepEqual(store.read(value).mod,changed);
});
test('machine/human display is independent and shared physical targets remain visible if any owning human part is visible',()=>{
 const human={id:'same-key',part_id:'one'},machine={id:'machine',part_id:'machine'};const result=practiceStageNotes({humanNotes:[human],sourceNotes:[human,machine],humanPartIds:new Set(['one','two']),hiddenPartIds:new Set(['one']),targetGroups:new Map([['same-key',{part_ids:['one','two']}]])});assert.deepEqual(result.map(n=>n.id),['machine','same-key']);assert.equal(result[0].practice_role,'machine');assert.equal(result[1].practice_role,'human');assert.deepEqual(practiceStageNotes({humanNotes:[human],sourceNotes:[human,machine],mode:'listen',hiddenPartIds:new Set(['one','machine'])}),[]);
});
test('unsupported renderer cannot silently consume a requested instrument',()=>{const value=context(),mod=defaultSongMod(value);mod.config.parts[1].instrument='reed';const changed=createSongMod(mod,mod.config);assert.throws(()=>assertSongModSupported(changed,{performers:true,instruments:false,audio:true}),/does not support/);assert.equal(songModCapabilities(value).instruments,true);});

test('stored machine instruments stay dormant on human parts and reactivate only with machine ownership',()=>{
 const value=context(),base=defaultSongMod(value),config=structuredClone(base.config);config.parts[0].instrument='reed';
 const human=createSongMod(base,config),snapshot=JSON.stringify(human);
 assert.deepEqual(songModOptions(human).instrumentOverrides,{});
 assert.doesNotThrow(()=>assertSongModSupported(human,{performers:true,instruments:false,audio:true}));
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 new SongModStore({storage}).save(value,human);assert.deepEqual(new SongModStore({storage}).read(value).mod,human);
 config.parts[0].performer='machine';const machine=createSongMod(base,config);
 assert.deepEqual(songModOptions(machine).instrumentOverrides,{[value.score.parts[0].id]:'reed'});
 assert.throws(()=>assertSongModSupported(machine,{performers:true,instruments:false,audio:true}),/does not support/);
 assert.equal(JSON.stringify(human),snapshot,'Projecting active sound does not rewrite saved choices');
});

test('source-bound input policy keeps the complete human group and explicitly refuses ambiguous or unsupported routes',()=>{
 const value=context(),base=defaultSongMod(value),config=structuredClone(base.config);
 for(const part of config.parts){part.performer='human';part.instrument='reed';part.muted=true;part.visible=false;}
 const mod=createSongMod(base,config),policy=createPartInstrumentPolicy(mod,{identity:songModIdentity(value),parts:value.score.parts});
 assert.equal(policy.policyId,PART_INSTRUMENT_POLICY);assert.equal(policy.configFingerprint,mod.configFingerprint);assert.deepEqual(policy.sourceRevision,mod.sourceRevision);
 assert.equal(policy.human.kind,'shared-group');assert.deepEqual(policy.human.partIds,config.parts.map(part=>part.partId));assert.deepEqual(policy.machineInstrumentOverrides,{});
 assert.deepEqual(resolvePartInstrumentInput(policy),{status:'ready',ownership:'shared-group',partIds:config.parts.map(part=>part.partId),instrument:'piano'});
 assert.equal(resolvePartInstrumentInput(policy,{kind:'part',partId:config.parts[0].partId}).reason,'ambiguous_shared_human_input');
 assert.equal(resolvePartInstrumentInput(policy,{kind:'part',partId:'invented'}).reason,'unknown_source_part');
 for(const request of [null,{kind:'midi',channel:0},{kind:'part'},{kind:'shared',midi:60},{kind:'shared',source_note_id:'deduplicated-representative'},{kind:'part',partId:config.parts[0].partId,instrument:'guitar'},Object.create({kind:'shared'}),{kind:'shared',[Symbol('channel')]:0},Object.defineProperty({},'kind',{get(){throw Error('Do not invoke routing getters');},enumerable:true})])assert.equal(resolvePartInstrumentInput(policy,request).reason,'unsupported_input_route');
 assert.throws(()=>{policy.human.partIds.pop();},TypeError);assert.throws(()=>{policy.sourceRevision.value='0'.repeat(64);},TypeError);
 assert.throws(()=>resolvePartInstrumentInput(structuredClone(policy)),{code:'invalid_part_instrument_policy'});
 assert.throws(()=>createPartInstrumentPolicy(mod,{identity:{...songModIdentity(value),songId:'different'}}),{code:'invalid_song_mod'});
 config.parts[1].performer='machine';const single=createPartInstrumentPolicy(createSongMod(base,config));
 assert.equal(resolvePartInstrumentInput(single,{kind:'part',partId:config.parts[0].partId}).ownership,'single-part');
 assert.equal(resolvePartInstrumentInput(single,{kind:'part',partId:config.parts[1].partId}).reason,'part_is_machine');
 assert.deepEqual(single.machineInstrumentOverrides,{[config.parts[1].partId]:'reed'});
 config.parts[0].performer='machine';const listen=createPartInstrumentPolicy(createSongMod(base,config));
 assert.equal(resolvePartInstrumentInput(listen).reason,'no_human_parts');
 assert.deepEqual(policy.human.partIds,value.score.parts.map(part=>part.id),'Later draft edits do not rewrite an admitted policy');
});

test('canonical, Basic and VSQ plans ignore dormant human recipes while retaining source timing and identity',()=>{
 const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url))),canonical=read('canonical-audio-evidence'),basic=basicKeySong(),opened=read('vsq-clean-v1-native-open');
 const vsq=prepareVsqPractice(prepareCleanSong(`native:song-${opened.clean_package.content_sha256}`,opened.clean_package,JSON.parse(opened.score_json)),read('vsq-clean-v1-runtime'));
 for(const [name,value,build] of [
  ['canonical',{score:canonical.compilation.score,compiled:canonical.compilation},options=>buildCanonicalAudioPlan(canonical.compilation,canonical.profile,{sampleRate:48000,acceptedPolicyId:CANONICAL_AUDIO_POLICY,...options})],
  ['Basic',{score:basic.notation,compiled:basic.compilation,cleanSong:basic},options=>buildBasicKeyAudioPlan(basic,{sampleRate:48000,...options})],
  ['VSQ',{score:vsq.notation,compiled:vsq.compilation,cleanSong:vsq},options=>buildVsqAudioPlan(vsq,{sampleRate:48000,...options})],
 ]){
  const sourceBefore=JSON.stringify(value),base=defaultSongMod(value),baseline=build(songModOptions(base)),config=structuredClone(base.config);config.parts[0].instrument='reed';config.parts[0].liveInstrument='guitar';
  const human=createSongMod(base,config),policy=createPartInstrumentPolicy(human,{identity:songModIdentity(value),parts:value.score.parts});
  assert.deepEqual(build(songModOptions(human)),baseline,`${name}: exact source plan retained, with no dormant synthesis identity`);
  assert.equal(policy.human.kind,'single-part');assert.equal(policy.parts[0].storedMachineInstrument,'reed');assert.equal(policy.parts[0].sound,'guitar');
  config.parts[0].performer='machine';const machine=createSongMod(base,config),machinePlan=build(songModOptions(machine));
  assert.ok(machinePlan.synthesisPolicyId||machinePlan.timbreProfile,`${name}: saved machine recipe activates`);
  assert.equal(machinePlan.durationFrames,baseline.durationFrames);assert.equal(machinePlan.sourceNotes,baseline.sourceNotes);
  assert.equal(JSON.stringify(value),sourceBefore,`${name}: complete source and retained program/timing metadata stay immutable`);
 }
});

/** Synthetic admission fixture: one human note and 129 overlapping machine
 * notes. This tests preview admission only, not a native compiler or audio. */
function overBudgetVsqSong(){
 const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url))),descriptor=read('vsq-clean-v1-native-open').clean_package,response=read('vsq-clean-v1-runtime'),source=JSON.parse(descriptor.score_json);
 const original=source.notation.parts[1].notes[0],authored=source.authoring.tracks[1].notes[0],runtime=response.runtime.notes[1],target=response.compilation.timeline.notes[1],ids=Array.from({length:129},(_,index)=>`ID#${String(index+1).padStart(4,'0')}`);
 source.notation.parts[1].notes=ids.map(id=>({...structuredClone(original),id:`vsq-t2-${id}`}));source.authoring.tracks[1].notes=ids.map(id=>({...structuredClone(authored),id}));descriptor.score_json=JSON.stringify(source);response.compilation.score=structuredClone(source.notation);
 response.compilation.timeline.notes=[response.compilation.timeline.notes[0],...ids.map(id=>({...structuredClone(target),id:`vsq-t2-${id}`,source_note_id:`vsq-t2-${id}`,source_note_ids:[`vsq-t2-${id}`]}))];response.runtime.notes=[response.runtime.notes[0],...ids.map(id=>({...structuredClone(runtime),note_id:`vsq-t2-${id}`,authored_note_id:id}))];
 return prepareVsqPractice(prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,source.notation),response);
}

for(const fails of [false,true])test(`pending preview ${fails?'failure':'success'} retains a current Mod mute and its bounded machine budget`,async()=>{
 const cleanSong=overBudgetVsqSong(),value={cleanSong,score:cleanSong.compilation.score,practiceSelection:{kind:'parts',part_ids:['vsq-track-1']}},store=new SongModStore({storage:null});store.save(value,store.read(value).mod);
 let entered,release,checks=0;const checking=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const preview=new ScorePreview({resolveOptions:context=>{const {mod}=store.read(context);return{...songModOptions(mod),songMod:mod};},check:async()=>{checks++;entered();await gate;if(fails)throw Error('Unavailable check');return{status:'ready'};}});
 const work=preview.select(cleanSong.libraryKey,async()=>({score:cleanSong.notation,cleanSong}));await checking;assert.equal(preview.canStart('listen'),false,'130 unmuted voices exceed the machine budget');
 const current=store.read(value).mod,config=structuredClone(current.config);config.parts[1].muted=true;config.parts[1].visible=false;const mod=createSongMod(current,config);store.save(value,mod);
 // Same-source stage mix/display edits retain this in-flight target check.
 const controller=preview.controller;preview.publish({...preview.value,...songModOptions(mod),songMod:mod});assert.equal(preview.canStart('listen'),true,'The current mute leaves one audible voice');release();await work;
 assert.equal(controller.signal.aborted,false);assert.equal(checks,1);assert.deepEqual(preview.value.songMod,mod);assert.deepEqual(preview.value.practiceSelection.part_ids,['vsq-track-1']);assert.equal(preview.value.compatibility.status,fails?'error':'ready');assert.equal(preview.canStart('listen'),true);assert.equal(preview.canStart('practice'),!fails);
});
