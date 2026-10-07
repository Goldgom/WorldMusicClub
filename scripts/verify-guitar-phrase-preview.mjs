import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {GUITAR_PHRASE_BROWSER_CASE,GUITAR_PHRASE_REPORT,assertGuitarPhraseReport} from '../tests/guitar-phrase-browser-proof.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function pngDimensions(bytes){
  assert.ok(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'Expected retained PNG pixels');
  assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.toString('ascii',12,16),'IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),channels=bytes[25]===2?3:bytes[25]===6?4:0;
  assert.ok(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=8*1024*1024,'Finite PNG pixel budget');
  assert.equal(bytes[24],8);assert.ok(channels);for(const offset of [26,27,28])assert.equal(bytes[offset],0);
  const chunks=[];let offset=8,ended=false;
  while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);assert.ok(length<=bytes.length-offset-12);if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;if(type==='IEND'){assert.equal(length,0);ended=true;break;}}
  assert.ok(ended&&chunks.length);assert.equal(offset,bytes.length);
  const stride=width*channels+1,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*height});assert.equal(raw.length,stride*height);for(let y=0;y<height;y++)assert.ok(raw[y*stride]<=4);
  return{width,height};
}

export function verifyGuitarPhrasePreview(directory,{sha,tree,serverSha256}){
  const root=lstatSync(directory);assert.ok(root.isDirectory()&&!root.isSymbolicLink());
  const read=(name,limit)=>{assert.ok(/^[a-z0-9.-]+$/.test(name));const path=join(directory,name),stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=limit,`${name}: bounded ordinary evidence required`);const bytes=readFileSync(path);assert.equal(bytes.length,stat.size);return bytes;};
  const tap=read('tests.tap',2*1024*1024).toString('utf8');
  const rows=tap.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)&&line.replace(/^(?:not )?ok \d+ - /,'').split(/\s+#/)[0]===GUITAR_PHRASE_BROWSER_CASE);
  assert.ok(rows.length===1&&/^ok \d+ - /.test(rows[0])&&!/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]),'Exactly one executed passing guitar phrase case required');
  const bytes=read(GUITAR_PHRASE_REPORT,4*1024*1024),report=assertGuitarPhraseReport(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  assert.deepEqual(report.source,{sha,tree,server_sha256:serverSha256},'Evidence must match the independently checked exact source and Rust server binary');
  const record=(name,bytes)=>({name,bytes:bytes.length,sha256:digest(bytes)}),files=[record(GUITAR_PHRASE_REPORT,bytes),record('tests.tap',Buffer.from(tap))];
  for(const shot of report.screenshots){const png=read(shot.name,8*1024*1024),actual={...record(shot.name,png),...pngDimensions(png)};assert.deepEqual(actual,shot,'Retained screenshot bytes must match the report');files.push(actual);}
  return {version:1,scope:'Actual hosted Rust/browser written-phrase controls only',source:report.source,case:GUITAR_PHRASE_BROWSER_CASE,accepted_package:false,windows_native_verified:false,physical_midi_verified:false,physical_fingering_verified:false,global_optimum_claimed:false,files};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const directory=resolve(process.argv[2]||'guitar-phrase-preview'),git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD');
  assert.equal(sha,process.env.WMH_SOURCE_SHA||process.env.GITHUB_SHA,'The focused workflow must bind its exact source SHA');
  assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Independent verification requires clean source');
  assert.ok(process.env.WMH_SERVER_BINARY,'Exact-source server binary required');
  const manifest=verifyGuitarPhrasePreview(directory,{sha,tree:git('rev-parse','HEAD^{tree}'),serverSha256:digest(readFileSync(process.env.WMH_SERVER_BINARY))});
  writeFileSync(join(directory,'worldmusichub-guitar-phrase-manifest.json'),JSON.stringify(manifest,null,2));
  console.log('Verified source-bound guitar phrase controls, unchanged Rust replies, eight cancellation races and retained pixels. Package and hardware acceptance remain separate.');
}
