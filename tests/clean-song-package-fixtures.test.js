import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {authoredCleanPackage,inspectAuthoredZip,digest} from './clean-song-package-fixtures.js';
test('complete UI fixture keeps exact core music and only declared runtime media',()=>{
 const f=authoredCleanPackage(),inventory=inspectAuthoredZip(f.bytes);
 assert.equal(f.score.coverage.source_tracks,3);assert.equal(f.score.coverage.pitched_notes,30);assert.equal(f.score.notation.source,null);assert.equal(f.metadata.media.length,3);
 assert.deepEqual(f.files.get('score.json'),readFileSync(new URL('./fixtures/clean-song-v2-long/score.json',import.meta.url)));
 assert.equal(Object.keys(inventory).length,6);for(const [name,bytes]of f.files)assert.deepEqual(inventory[`原创完整曲包/songs/exercise/${name}`],{bytes:bytes.length,sha256:digest(bytes)});
 assert.ok(Object.keys(inventory).every(n=>!/(source|original|debug|\.mid$|base64)/i.test(n)));
 const r=JSON.parse(readFileSync(new URL('./fixtures/clean-song-v2-long-runtime.json',import.meta.url)));assert.equal(r.duration_ms,32000);assert.equal(new Set(r.notes.filter(n=>n.start_ms<1000).map(n=>n.part_id)).size,2);assert.equal(new Set(r.notes.filter(n=>n.start_ms>=28000).map(n=>n.part_id)).size,2);
});
test('authored PNG data has complete scanlines and absent optional media is valid',()=>{
 const f=authoredCleanPackage();for(const name of ['media/cover.png','media/background.png']){const b=f.files.get(name),w=b.readUInt32BE(16),h=b.readUInt32BE(20),idat=[];let p=8;while(p<b.length){const n=b.readUInt32BE(p),kind=b.toString('ascii',p+4,p+8);if(kind==='IDAT')idat.push(b.subarray(p+8,p+8+n));p+=12+n;}assert.equal(p,b.length);assert.equal(inflateSync(Buffer.concat(idat)).length,(w*3+1)*h);assert.ok(w>=96&&h>=64);}
 const plain=authoredCleanPackage({media:false});assert.equal(plain.metadata.media.length,0);assert.equal(plain.files.size,2);assert.deepEqual(plain.files.get('score.json'),f.files.get('score.json'));
});
