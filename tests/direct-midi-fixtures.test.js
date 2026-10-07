import test from 'node:test';
import assert from 'node:assert/strict';
import {directMidiFixtures,directMidiDigest} from '../scripts/prepare-direct-midi-fixtures.mjs';

// Independent fixture-only SMF scanner. It does not use the Rust parser or
// application runtime as an oracle and deliberately accepts no running status.
function scan(bytes){
 assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt32BE(4),6);const format=bytes.readUInt16BE(8),count=bytes.readUInt16BE(10),ppq=bytes.readUInt16BE(12),tracks=[];let position=14;
 const variable=()=>{let value=0;for(let i=0;i<4;i++){assert.ok(position<bytes.length);const byte=bytes[position++];value=value*128+(byte&127);if(!(byte&128))return value;}assert.fail('Invalid fixture VLQ');};
 for(let track=0;track<count;track++){
  assert.equal(bytes.toString('ascii',position,position+4),'MTrk');const length=bytes.readUInt32BE(position+4);position+=8;const end=position+length;assert.ok(end<=bytes.length,'Declared track bytes must exist');const events=[];
  while(position<end){const delta=variable(),status=bytes[position++];let event;
   if(status===255){const kind=bytes[position++],length=variable();event=[status,kind,...bytes.subarray(position,position+length)];position+=length;}
   else{assert.ok(status>=128&&status<=239,'Original fixture uses only channel/meta events');const width=[192,208].includes(status&240)?1:2;event=[status,...bytes.subarray(position,position+width)];position+=width;}
   assert.ok(position<=end);events.push([delta,event]);
  }
  assert.deepEqual(events.at(-1),[0,[255,47]]);tracks.push(events);
 }
 assert.equal(position,bytes.length);return{format,ppq,tracks};
}

test('original direct MIDI fixtures retain bounded full tracks, metadata and exact same-tick source order',()=>{
 const fixtures=directMidiFixtures();
 for(const key of ['boundary','layered','tracks','range','canonical']){
  const f=fixtures[key],scanned=scan(f.bytes);assert.equal(scanned.format,f.manifest.format);assert.equal(scanned.ppq,384);assert.deepEqual(scanned.tracks,f.tracks);assert.equal(f.manifest.sha256,directMidiDigest(f.bytes));assert.equal(f.manifest.source_events,f.tracks.flat().length);assert.equal(f.manifest.rights.license,'CC0-1.0');assert.equal(f.expectedNotes.length,4);assert.equal(f.bytes.length<1024,true);assert.deepEqual(f.bytes,directMidiFixtures()[key].bytes);
 }
 assert.deepEqual(fixtures.boundary.tracks[0].slice(6,10),[[0,[144,60,91]],[192,[144,60,73]],[0,[128,60,19]],[192,[128,60,27]]]);
 assert.equal(fixtures.tracks.tracks.length,3);assert.equal(fixtures.tracks.tracks[1].some(([,e])=>e[0]===144),false);assert.deepEqual(fixtures.tracks.tracks[2],[[0,[255,47]]]);
 assert.equal(fixtures.range.expectedNotes.at(-1).midi,12);assert.equal(fixtures.layered.expectedNotes[0].duration_ms,375);assert.equal(fixtures.boundary.expectedNotes.at(-1).start_ms+fixtures.boundary.expectedNotes.at(-1).duration_ms,2000);
});
test('malformed and truncated controls cannot be parsed into a shortened exercise',()=>{
 for(const fixture of directMidiFixtures().invalid)assert.throws(()=>scan(fixture.bytes));
});
