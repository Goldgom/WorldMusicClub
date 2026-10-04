// Finite, wholly original MIDI inputs. This generator never reads user music,
// synthesizes a Rust response, or treats conversion as receiver acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export {validateAuthoringDraft,authoringDraftFingerprint} from './song-authoring-fixture-contract.mjs';

export const AUTHORING_PAIR_ALIAS='authoring-original-pair';
export const AUTHORING_FIXTURE_FILENAMES=Object.freeze({
  strict:'authoring-original-strict.mid',
  events:'authoring-original-events.mid',
  blocked:'authoring-original-blocked.mid',
});
const PPQ=480,END=1920;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const vlq=value=>{assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=0x0fffffff);const bytes=[value&127];while((value=Math.floor(value/128)))bytes.unshift((value&127)|128);return bytes;};
const event=(tick,bytes,command)=>({tick,bytes,command});
const name=text=>event(0,[255,3,...vlq(Buffer.byteLength(text)),...Buffer.from(text)],{kind:'text',role:'track_name',text});
const end=()=>event(END,[255,47,0],{kind:'track_end'});
const program=channel=>event(0,[0xc0|channel,0],{kind:'instrument_program',channel,program:0});
const attack=(tick,channel,key,velocity=90)=>event(tick,[0x90|channel,key,velocity],{kind:'key_attack',channel,key,velocity});
const release=(tick,channel,key,velocity=17)=>event(tick,[0x80|channel,key,velocity],{kind:'key_release',channel,key,velocity});
function encodeTrack(events){
  let previous=0;const body=Buffer.concat(events.map(({tick,bytes})=>{assert.ok(tick>=previous&&tick<=END);const encoded=Buffer.from([...vlq(tick-previous),...bytes]);previous=tick;return encoded;}));
  const header=Buffer.alloc(8);header.write('MTrk');header.writeUInt32BE(body.length,4);return Buffer.concat([header,body]);
}
function encodeMidi(tracks){const header=Buffer.from([77,84,104,100,0,0,0,6,0,1,0,0,1,224]);header.writeUInt16BE(tracks.length,10);return Buffer.concat([header,...tracks.map(encodeTrack)]);}
function tracksFor(id){
  const conductor=[name('Original conductor'),event(0,[255,81,3,7,161,32],{kind:'tempo',microseconds_per_quarter:500000}),event(0,[255,88,4,4,2,24,8],{kind:'meter',numerator:4,denominator:4,clocks_per_click:24,thirty_seconds_per_quarter:8}),end()];
  const melody=id==='events'
    ?[attack(0,0,60),attack(240,0,60,75),release(480,0,60),release(720,0,60,23),attack(960,0,64),release(1440,0,64),attack(1440,0,67),release(1920,0,67)]
    :[attack(0,0,60),release(480,0,60),attack(480,0,64),release(960,0,64),attack(960,0,67),release(1440,0,67),attack(1440,0,60),release(1920,0,60)];
  const tracks=[conductor,[name('Original C E G'),...(id==='events'?[]:[event(0,[0xb0,0,1],{kind:'bank_select',channel:0,component:'most_significant',value:1})]),program(0),...melody,end()],
    [name('Original wide C E'),program(1),attack(0,1,24,70),release(960,1,24,19),attack(960,1,100,80),release(1920,1,100,21),end()]];
  if(id==='blocked')tracks.push([name('Original unsupported controller'),event(0,[0xb2,2,93],{kind:'unsupported_controller',channel:2,controller:2,value:93}),end()]);
  return tracks;
}
const rational=tick=>{let a=tick,b=PPQ;while(b)[a,b]=[b,a%b];return{numerator:tick/a,denominator:PPQ/a};};
function expectedInventory(tracks,sha256){
  const result=tracks.map((events,index)=>{
    const channels=[...new Set(events.flatMap(e=>e.command.channel===undefined?[]:[e.command.channel]))].sort().map(channel=>{
      const routed=events.filter(e=>e.command.channel===channel);return{channel,source_event_count:routed.length,key_attacks:routed.filter(e=>e.command.kind==='key_attack').length,key_releases:routed.filter(e=>e.command.kind==='key_release').length};
    });
    return{source_index:index,track_id:`track-${index+1}`,name:events[0].command.text,source_event_count:events.length,channels,key_attacks:channels.reduce((n,c)=>n+c.key_attacks,0),key_releases:channels.reduce((n,c)=>n+c.key_releases,0),first_event_id:`midi:${sha256}:t${index}:e0`,last_event_id:`midi:${sha256}:t${index}:e${events.length-1}`,end:rational(events.at(-1).tick)};
  });
  return{source_tracks:result.length,source_events:result.reduce((n,t)=>n+t.source_event_count,0),ppq:PPQ,key_attacks:result.reduce((n,t)=>n+t.key_attacks,0),key_releases:result.reduce((n,t)=>n+t.key_releases,0),tracks:result};
}
export function authoringAcceptanceFixtures(){
  return Object.entries(AUTHORING_FIXTURE_FILENAMES).map(([id,filename])=>{
    const tracks=tracksFor(id),bytes=encodeMidi(tracks),sha256=digest(bytes),title=`Original C/E/G ${id} · 原创`,expectedState=id==='strict'?'strict_notation_candidate':id==='events'?'event_only_reference_candidate':'rejected',expectedProfile=id==='strict'?'wmh-semantic-midi1-v1':id==='events'?'wmh-performance-midi1-v1':null;
    const inventory=expectedInventory(tracks,sha256),sourceEvents=tracks.flatMap((events,track)=>events.map((e,index)=>({...e,at:rational(e.tick),origin:{track,event:index},event_id:`midi:${sha256}:t${track}:e${index}`})));
    const manifest={id,filename,title,sha256,bytes:bytes.length,expected_state:expectedState,expected_profile:expectedProfile,source_tracks:inventory.source_tracks,source_events:inventory.source_events,key_attacks:inventory.key_attacks,key_releases:inventory.key_releases,pitches:[...new Set(sourceEvents.filter(e=>e.command.kind==='key_attack').map(e=>e.command.key))].sort((a,b)=>a-b),end_tick:END,ppq:PPQ};
    return{id,filename,bytes,title,expectedState,expectedProfile,manifest,inventory,sourceEvents,request:{source_base64:bytes.toString('base64'),source_name:filename,title}};
  });
}
export async function prepareSongAuthoringFixtures(directory){
  const fixtures=authoringAcceptanceFixtures(),manifest={version:1,generator:'scripts/prepare-song-authoring-fixtures.mjs',rights:{status:'original_authored',attribution:'WorldMusicHub original C/E/G acceptance exercise',license:'CC0-1.0'},aliases:{[AUTHORING_PAIR_ALIAS]:[AUTHORING_FIXTURE_FILENAMES.strict,AUTHORING_FIXTURE_FILENAMES.events]},fixtures:fixtures.map(f=>f.manifest)};
  await mkdir(directory,{recursive:true});
  for(const f of fixtures)await writeFile(join(directory,f.filename),f.bytes,{flag:'wx'});
  await writeFile(join(directory,'authoring-fixtures.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: node scripts/prepare-song-authoring-fixtures.mjs <fresh-directory>');console.log(JSON.stringify(await prepareSongAuthoringFixtures(resolve(process.argv[2]))));}
