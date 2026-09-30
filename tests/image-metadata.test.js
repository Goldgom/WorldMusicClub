import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {imageMetadata,IMAGE_LIMITS} from '../web/image-metadata.js';

test('original still PNG fixture dimensions are readable before any pixel decoding',async()=>{
 const bytes=await readFile(new URL('./fixtures/omr-original-scale.png',import.meta.url));
 const result=imageMetadata(bytes);assert.equal(result.format,'png');assert.ok(result.width>0&&result.height>0);assert.ok(result.width*result.height<=IMAGE_LIMITS.pixels);
 assert.deepEqual(imageMetadata(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),result);
});
function jpegFrame(marker=0xc0){return Uint8Array.from([255,216,255,224,0,4,0,0,255,marker,0,17,8,0,120,0,240,3,1,17,0,2,17,1,3,17,1,255,217]);}
test('baseline and progressive JPEG frame metadata handles ordinary application segments',()=>{
 for(const marker of[0xc0,0xc1,0xc2])assert.deepEqual(imageMetadata(jpegFrame(marker)),{format:'jpeg',width:240,height:120});
});
test('incomplete headers and unsupported image formats give useful errors',()=>{
 for(const bytes of [new Uint8Array(),new TextEncoder().encode('<svg></svg>'),jpegFrame().slice(0,18)]) assert.throws(()=>imageMetadata(bytes));
 assert.throws(()=>imageMetadata(jpegFrame(0xc3)),/unsupported/);
});
test('dimension policy is enforced from metadata before decoding',()=>{
 const frame=jpegFrame();frame[13]=0;frame[14]=0;assert.throws(()=>imageMetadata(frame),/positive/);
 frame[13]=0x40;frame[14]=1;assert.throws(()=>imageMetadata(frame),/16,384/);
});
