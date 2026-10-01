import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {retainedSourceArchive,inspectRetainedSourceFile} from '../web/source-archive.js';
const edition=JSON.parse(readFileSync(new URL('../catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json',import.meta.url),'utf8'));
test('complete edition archive exposes inert exact originals, compatible copy, MIDI and license',async()=>{
 const before=JSON.stringify(edition),archive=retainedSourceArchive(edition);assert.equal(archive.files.length,6);
 const envelope=JSON.parse(edition.source.content);
 for(const[name,original]of Object.entries(envelope.files)){
  const descriptor=archive.files.find(file=>file.id===`edition:${name}`),result=await inspectRetainedSourceFile(descriptor);
  assert.equal(result.checksumMatches,true);assert.equal(result.sizeMatches,true);assert.equal(result.mime,'application/octet-stream');
  assert.deepEqual(Buffer.from(result.bytes),Buffer.from(original.content,original.encoding==='base64'?'base64':'utf8'));
 }
 const raw=await inspectRetainedSourceFile(archive.files[0]);assert.equal(new TextDecoder().decode(raw.bytes),edition.source.content);
 assert.equal((await inspectRetainedSourceFile(archive.files.at(-1))).checksumMatches,true);
 assert.equal(JSON.stringify(edition),before);
});
test('source views preserve BOM/CRLF and never infer rights or execute file contents',async()=>{
 const text='\uFEFF<score>\r\n原稿</score>',archive=retainedSourceArchive({source:{format:'musicxml',filename:'../CON.xml',content:text}});
 assert.equal(archive.files[0].filename,'source-CON.xml');const result=await inspectRetainedSourceFile(archive.files[0]);
 assert.deepEqual(Buffer.from(result.bytes),Buffer.from(text));assert.equal(result.checksumMatches,null);
 const unknown=retainedSourceArchive({source:{format:'unknown',filename:'run.exe',content:'inert bytes'}});assert.equal(unknown.files[0].filename,'run.exe.txt');
 assert.match(archive.warnings.join(' '),/not proof of rights/);
});
test('unknown envelope versions keep the entire original and do not invent individual files',()=>{
 const score=structuredClone(edition),content=JSON.stringify({version:2,files:{}});score.source.content=content;
 const archive=retainedSourceArchive(score);assert.equal(archive.files.length,1);assert.equal(archive.files[0].content,content);assert.match(archive.warnings[0],/Unknown archive version/);
});
test('checksum mismatches stay visible and invalid encoded bytes are not normalized',async()=>{
 const source=retainedSourceArchive(edition).files.find(file=>file.id==='edition:reference.mid');
 const mismatch=await inspectRetainedSourceFile({...source,declaredSha256:'0'.repeat(64),declaredBytes:1});assert.equal(mismatch.checksumMatches,false);assert.equal(mismatch.sizeMatches,false);
 await assert.rejects(inspectRetainedSourceFile({...source,content:'AQ==\n'}),/not canonical/);
 const unverified=await inspectRetainedSourceFile(source,{crypto:null});assert.equal(unverified.sha256,null);assert.equal(unverified.checksumMatches,null);
});
