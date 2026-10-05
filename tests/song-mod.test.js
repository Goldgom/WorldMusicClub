import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SongModStore,createSongMod,defaultSongMod,songModConfigFingerprint,songModIdentity,songModOptions,validateSongMod,assertSongModSupported,songModCapabilities} from '../web/song-mod.js';
import {practiceStageNotes} from '../web/practice-stage-display.js';
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
