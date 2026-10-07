import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {SongModStore,createSongMod,defaultSongMod,songModIdentity,songModOptions,songModConfigFingerprint,normalizeSongMod} from '../web/song-mod.js';
import {createPartInstrumentPolicy,resolvePartInstrumentInput} from '../web/part-instrument-policy.js';

function original(){
 const score=structuredClone(fixture);score.parts.push({...structuredClone(score.parts[0]),id:'machine-part',name:'Violin'});
 return {score,compiled:{timeline:{notes:[]}},mode:'practice',part:score.parts[0].id};
}
function sidecar(context){
 const base=defaultSongMod(context),config=structuredClone(base.config);
 config.parts[0].liveInstrument='guitar';config.parts[0].instrument='triangle';
 config.parts[1].liveInstrument='piano';config.parts[1].instrument='reed';
 return createSongMod(base,config);
}

test('unknown or failed source evidence cannot change human ownership or machine-only synthesis overrides',()=>{
 const context=original(),mod=sidecar(context),source=JSON.stringify(context.score);
 const binding={identity:songModIdentity(context),parts:context.score.parts,performanceInstrument:'piano',mode:'practice'};
 const before=createPartInstrumentPolicy(mod,binding);
 for(const metadata of [
  {sourceInstrumentDetailsStatus:'loading'},
  {sourceInstrumentDetailsStatus:'error',sourceInstrumentDetailsError:'Unavailable source metadata'},
  {sourceInstrumentDetailsStatus:'ready',sourceInstrumentDetails:{instrument_namespace:'unknown',parts:context.score.parts.map(part=>({part_id:part.id,selection_summary:{status:'unknown'}}))}},
 ]){
  const after=createPartInstrumentPolicy(mod,{...binding,...metadata});
  assert.deepEqual(after,before);
  assert.deepEqual(after.machineInstrumentOverrides,{'machine-part':'reed'});
  assert.deepEqual(resolvePartInstrumentInput(after,{kind:'shared'}),{status:'ready',ownership:'single-part',partIds:[context.score.parts[0].id],instrument:'guitar'});
  assert.deepEqual(songModOptions(mod).practiceSelection,{kind:'parts',part_ids:[context.score.parts[0].id]});
  assert.equal(resolvePartInstrumentInput(after,{kind:'part',partId:'machine-part'}).reason,'part_is_machine');
 }
 assert.equal(JSON.stringify(context.score),source);
});

test('pitch-view reload binds a saved legacy tone to original source and never writes it into score labels',()=>{
 const context=original(),mod=sidecar(context),saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 new SongModStore({storage}).save(context,mod);
 const shifted=structuredClone(context.score);shifted.parts[0].notes[0].pitch.octave+=1;
 const pitchContext={...context,score:shifted,pitchView:{sourceView:context}};
 assert.deepEqual(songModIdentity(pitchContext),songModIdentity(context));
 const reopened=new SongModStore({storage}).read(pitchContext);
 assert.equal(reopened.status,'saved');assert.deepEqual(reopened.mod,mod);
 assert.equal(reopened.mod.config.parts[0].liveInstrument,'guitar');
 assert.equal(reopened.mod.config.parts[1].instrument,'reed');
 assert.deepEqual(context.score.parts.map(part=>part.instrument),original().score.parts.map(part=>part.instrument));
 assert.deepEqual(new SongModStore({storage}).read(context).mod,mod);
});

test('v1 migration fills follow without erasing dormant machine settings and never mutates the saved envelope',()=>{
 const context=original(),legacy=structuredClone(sidecar(context));legacy.version=1;
 for(const part of legacy.config.parts)delete part.liveInstrument;
 legacy.configFingerprint=songModConfigFingerprint(legacy.config,1);
 const before=JSON.stringify(legacy),migrated=normalizeSongMod(legacy,{identity:songModIdentity(context),parts:context.score.parts});
 assert.equal(JSON.stringify(legacy),before);assert.equal(migrated.version,2);
 assert.deepEqual(migrated.config.parts.map(part=>part.liveInstrument),['follow','follow']);
 assert.deepEqual(migrated.config.parts.map(part=>part.instrument),['triangle','reed']);
 assert.deepEqual(songModOptions(migrated).instrumentOverrides,{'machine-part':'reed'});
});
