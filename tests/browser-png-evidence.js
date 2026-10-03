import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Decode actual Chromium screenshots for paint evidence. This never creates,
// composites, repaints or alters the screenshots delivered as evidence.
export function readScreenshotPixels(bytes) {
  assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  let width,height,channels;const chunks=[];
  for(let offset=8;offset<bytes.length;){
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);offset+=length+12;
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));assert.equal(data[12],0);channels=data[9]===6?4:3;}
    if(type==='IDAT')chunks.push(data);
    if(type==='IEND')break;
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(width*height*4);let previous=Buffer.alloc(stride),offset=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.from(raw.subarray(offset,offset+stride));offset+=stride;assert.ok(filter<=4);
    for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;row[x]=(row[x]+([0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]))&255;}
    for(let x=0;x<width;x++){const source=x*channels,target=(y*width+x)*4;pixels[target]=row[source];pixels[target+1]=row[source+1];pixels[target+2]=row[source+2];pixels[target+3]=channels===4?row[source+3]:255;}
    previous=row;
  }
  assert.equal(offset,raw.length);return {width,height,pixels,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function compareScreenshotPixels(aBytes,bBytes,{threshold=12}={}) {
  const a=readScreenshotPixels(aBytes),b=readScreenshotPixels(bBytes);assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let changed=0,totalDelta=0,maxDelta=0;
  for(let offset=0;offset<a.pixels.length;offset+=4){const delta=Math.max(...[0,1,2].map(channel=>Math.abs(a.pixels[offset+channel]-b.pixels[offset+channel])));totalDelta+=delta;maxDelta=Math.max(maxDelta,delta);if(delta>=threshold)changed++;}
  return {width:a.width,height:a.height,pixels:a.width*a.height,changed,fraction:changed/(a.width*a.height),meanDelta:totalDelta/(a.width*a.height),maxDelta,sha256:[a.sha256,b.sha256]};
}
