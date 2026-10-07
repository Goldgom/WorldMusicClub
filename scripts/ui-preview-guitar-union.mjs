import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {GUITAR_UNION_BROWSER_CASE,GUITAR_UNION_REPORT,assertGuitarUnionReport} from '../tests/guitar-union-browser-proof.js';

export {GUITAR_UNION_BROWSER_CASE};
// Bounded decoding rejects a renamed/truncated image, including a header-only
// PNG. Pixel evidence is a retained browser capture, never generated here.
function pngSize(bytes){
  assert.ok(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'Guitar union screenshot must be PNG');
  assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.toString('ascii',12,16),'IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),channels=bytes[25]===2?3:bytes[25]===6?4:0;
  assert.ok(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=8*1024*1024,'Screenshot exceeds the finite pixel budget');
  assert.equal(bytes[24],8);assert.ok(channels);for(const offset of [26,27,28])assert.equal(bytes[offset],0);
  const chunks=[];let offset=8,ended=false;
  while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);assert.ok(length<=bytes.length-offset-12);if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;if(type==='IEND'){assert.equal(length,0);ended=true;break;}}
  assert.ok(ended&&chunks.length);assert.equal(offset,bytes.length);
  const stride=width*channels+1,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*height});assert.equal(raw.length,stride*height);
  for(let y=0;y<height;y++)assert.ok(raw[y*stride]<=4);return{width,height};
}

export function verifyUiPreviewGuitarUnion(directory,tap){
  const rows=tap.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)&&line.replace(/^(?:not )?ok \d+ - /,'').split(/\s+#/)[0]===GUITAR_UNION_BROWSER_CASE);
  assert.ok(rows.length===1&&/^ok \d+ - /.test(rows[0])&&!/\s+#\s*(?:SKIP|TODO)\b/i.test(rows[0]),`Missing executed passing guitar-union preview case: ${GUITAR_UNION_BROWSER_CASE}`);
  const root=lstatSync(directory);assert.ok(root.isDirectory()&&!root.isSymbolicLink());
  const read=(name,limit)=>{const path=join(directory,name),stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=limit,`${name}: expected bounded ordinary evidence file`);const bytes=readFileSync(path);assert.equal(bytes.length,stat.size);return bytes;};
  const record=(name,bytes)=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  const bytes=read(GUITAR_UNION_REPORT,4*1024*1024),report=assertGuitarUnionReport(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),files=[record(GUITAR_UNION_REPORT,bytes)];
  for(const {screenshot}of report.snapshots){
    const png=read(screenshot.name,8*1024*1024),entry={...record(screenshot.name,png),...pngSize(png)};
    assert.deepEqual(entry,screenshot,`${screenshot.name}: retained screenshot bytes or viewport changed`);files.push(entry);
  }
  return files;
}
