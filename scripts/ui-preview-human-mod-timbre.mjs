import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {validateHostedHumanModTimbre} from './verify-human-mod-timbre-hosted.mjs';

export const HUMAN_MOD_TIMBRE_PREVIEW_CASE=Object.freeze({
  name:'real human Mod timbres preserve shared ownership, PCM, legacy storage and interrupted controls',
  report:'worldmusichub-human-mod-timbre.json',
  screenshot:'worldmusichub-human-mod-conflict.png',
  viewport:Object.freeze({width:1440,height:1100}),
});

// Decode the bounded screenshot payload enough to reject missing/truncated PNG
// data. The pixels remain the original captured artifact; no visual claim is
// inferred from the synthetic PNGs used in verifier contract tests.
function pngSize(bytes){
  assert.ok(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'Human Mod conflict image must be PNG');
  assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.toString('ascii',12,16),'IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),channels=bytes[25]===2?3:bytes[25]===6?4:0;
  assert.ok(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=8*1024*1024,'Human Mod screenshot dimensions exceed the finite pixel budget');
  assert.equal(bytes[24],8);assert.ok(channels);for(const offset of [26,27,28])assert.equal(bytes[offset],0);
  const chunks=[];let offset=8,ended=false;
  while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);assert.ok(length<=bytes.length-offset-12);if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;if(type==='IEND'){assert.equal(length,0);ended=true;break;}}
  assert.ok(ended&&chunks.length>0);assert.equal(offset,bytes.length);
  const stride=width*channels+1,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*height});assert.equal(raw.length,stride*height);
  for(let y=0;y<height;y++)assert.ok(raw[y*stride]<=4,'Invalid PNG row filter');
  return{width,height};
}

export function verifyUiPreviewHumanModTimbre(directory,tap){
  const {name,report,screenshot}=HUMAN_MOD_TIMBRE_PREVIEW_CASE;
  const rows=tap.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)&&line.replace(/^(?:not )?ok \d+ - /,'').split(/\s+#/)[0]===name);
  assert.ok(rows.length===1&&/^ok \d+ - /.test(rows[0])&&!/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]),`Missing executed passing human-timbre preview case: ${name}`);
  const root=lstatSync(directory);assert.ok(root.isDirectory()&&!root.isSymbolicLink());
  const read=(file,limit)=>{const path=join(directory,file),stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=limit,`${file}: expected bounded ordinary evidence file`);const bytes=readFileSync(path);assert.equal(bytes.length,stat.size);return bytes;};
  const reportBytes=read(report,4*1024*1024);validateHostedHumanModTimbre(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reportBytes)));
  const screenshotBytes=read(screenshot,8*1024*1024),size=pngSize(screenshotBytes);assert.deepEqual(size,HUMAN_MOD_TIMBRE_PREVIEW_CASE.viewport,'Conflict screenshot must retain the original hosted viewport');
  const record=(name,bytes)=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  return[record(report,reportBytes),{...record(screenshot,screenshotBytes),...size}];
}
