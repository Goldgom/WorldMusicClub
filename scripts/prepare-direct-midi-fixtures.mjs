// CC0-1.0: newly authored isolated key events, never copied from private music.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const DIRECT_MIDI_POLICY='wmh-basic-key-rendition-fifo-v1';
export const directMidiDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const variable=value=>{assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=0x0fffffff);const bytes=[value&127];while((value>>>=7)>0)bytes.unshift((value&127)|128);return bytes;};
const meta=(kind,text)=>[255,kind,...Buffer.from(text)];
const encodeEvent=([delta,event])=>[...variable(delta),...(event[0]===255?[255,event[1],...variable(event.length-2),...event.slice(2)]:event)];
function smf(tracks,{format=tracks.length===1?0:1,division=384}={}){
 const header=Buffer.alloc(14);header.write('MThd');header.writeUInt32BE(6,4);header.writeUInt16BE(format,8);header.writeUInt16BE(tracks.length,10);header.writeUInt16BE(division,12);
 return Buffer.concat([header,...tracks.flatMap(events=>{const bytes=Buffer.from(events.flatMap(encodeEvent)),header=Buffer.alloc(8);header.write('MTrk');header.writeUInt32BE(bytes.length,4);return[header,bytes];})]);
}
function authored({layered=false,multitrack=false,outOfRange=false,canonical=false}={}){
 const tracks=[[
  [0,meta(3,'Original direct MIDI overlap exercise')],
  [0,meta(2,'CC0-1.0 original regression events')],
  [0,[255,81,7,161,32]],[0,[255,88,4,2,24,8]],
  [0,[192,0]],[0,[176,7,100]],
  [0,[144,60,91]],
  // At a boundary, the next attack occurs before the preceding release in
  // source order. Strict canonical notation must not invent a pairing.
  ...(canonical?[[192,[128,60,19]],[0,[144,60,73]],[192,[128,60,27]]]:[
   [192,[144,60,73]],[layered?96:0,[128,60,19]],[layered?96:192,[128,60,27]],
  ]),
  [192,[144,67,83]],[192,[128,67,35]],
  [384,[144,outOfRange?12:72,87]],[384,[128,outOfRange?12:72,43]],
  [0,meta(1,'End marker retained after the final release')],[0,[255,47]],
 ]];
 if(multitrack)tracks.push([[0,meta(3,'Original metadata-only track')],[0,meta(1,'No note content on this retained track')],[0,[255,47]]],[[0,[255,47]]]);
 const bytes=smf(tracks),filename=`original-direct-midi-${canonical?'canonical':outOfRange?'range':multitrack?'tracks':layered?'layered':'boundary'}.mid`;
 const expectedNotes=[
  {id:'midi-t1-e7',midi:60,velocity:91,start_ms:0,duration_ms:layered?375:250},
  {id:canonical?'midi-t1-e9':'midi-t1-e8',midi:60,velocity:73,start_ms:250,duration_ms:250},
  {id:'midi-t1-e11',midi:67,velocity:83,start_ms:750,duration_ms:250},
  {id:'midi-t1-e13',midi:outOfRange?12:72,velocity:87,start_ms:1500,duration_ms:500},
 ];
 return{filename,bytes,tracks,expectedNotes,manifest:{filename,bytes:bytes.length,sha256:directMidiDigest(bytes),format:tracks.length===1?0:1,ppq:384,source_tracks:tracks.length,source_events:tracks.flat().length,source_attacks:4,source_releases:4,duration_ms:2000,rights:{status:'original_authored',license:'CC0-1.0',attribution:'Newly authored isolated regression events; no private score or melody'}}};
}
export function directMidiFixtures(){
 const boundary=authored(),layered=authored({layered:true}),tracks=authored({multitrack:true}),range=authored({outOfRange:true}),canonical=authored({canonical:true});
 const invalid=[{filename:'original-direct-midi-malformed.mid',bytes:Buffer.from('Original deliberately invalid MIDI regression fixture')},{filename:'original-direct-midi-truncated.mid',bytes:boundary.bytes.subarray(0,-3)}];
 return{boundary,layered,tracks,range,canonical,invalid};
}
export async function prepareDirectMidiFixtures(directory){
 const fixtures=directMidiFixtures();await mkdir(directory,{recursive:true});
 for(const fixture of [...['boundary','layered','tracks','range','canonical'].map(key=>fixtures[key]),...fixtures.invalid])await writeFile(join(directory,fixture.filename),fixture.bytes,{flag:'wx'});
 await writeFile(join(directory,'direct-midi-fixtures.json'),JSON.stringify(Object.fromEntries(['boundary','layered','tracks','range','canonical'].map(key=>[key,fixtures[key].manifest])),null,2)+'\n',{flag:'wx'});return fixtures;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,3,'Usage: prepare-direct-midi-fixtures.mjs <fresh-directory>');await prepareDirectMidiFixtures(resolve(process.argv[2]));}
