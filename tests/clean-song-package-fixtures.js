// Original media and Rust-converted exercises only. No private supplied music.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {storedZip} from './native-import-driver-fixtures.js';
export const digest=value=>createHash('sha256').update(value).digest('hex');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function chunk(name,data){const type=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([head,type,data,tail])}
export function originalGradient({width=96,height=64,variant=0}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512)throw Error('Bounded original image dimensions required');
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const pixels=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*3+1)+1+x*3;pixels[p]=24+Math.floor(80*x/width);pixels[p+1]=24+Math.floor(110*y/height);pixels[p+2]=100+((x+y+variant*19)%140)}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
export function authoredCleanPackage({long=true,media=true}={}){
 const folder=long?'clean-song-v2-long':'clean-song-v2';
 const scoreBytes=readFileSync(new URL(`./fixtures/${folder}/score.json`,import.meta.url)),metadata=JSON.parse(readFileSync(new URL(`./fixtures/${folder}/metadata.json`,import.meta.url)));
 if(metadata.score.sha256!==digest(scoreBytes)||metadata.score.bytes!==scoreBytes.length)throw Error('Core fixture metadata no longer matches exact score bytes');
 const score=JSON.parse(scoreBytes);if(score.notation.source!==null)throw Error('Clean fixture must not embed original source content');
 const files=new Map([['score.json',scoreBytes]]);metadata.media=[];
 if(media){
  const rights={status:'original_authored',attribution:'WorldMusicHub original generated test media',license:'CC0-1.0'};
  const provenance=JSON.parse(readFileSync(new URL('./fixtures/clean-media-provenance.json',import.meta.url)));
  const pv=Buffer.from(readFileSync(new URL('./fixtures/clean-pv.webm.base64',import.meta.url),'utf8').trim(),'base64');
  if(pv.length!==provenance.pv.decoded_bytes||digest(pv)!==provenance.pv.sha256)throw Error('Original PV fixture digest mismatch');
  for(const [id,role,path,mime,bytes,offset]of[
   ['cover','cover','media/cover.png','image/png',originalGradient({variant:0}),null],
   ['background','background','media/background.png','image/png',originalGradient({width:160,height:90,variant:1}),null],
   ['pv','pv','media/pv.webm','video/webm',pv,0]
  ]){files.set(path,bytes);metadata.media.push({id,role,path,mime,bytes:bytes.length,sha256:digest(bytes),rights,...(offset===null?{}:{offset_ms:offset})})}
 }
 files.set('metadata.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n'));
 const entries=[...files].map(([p,bytes])=>[`原创完整曲包/songs/exercise/${p}`,bytes]);entries.push(['原创完整曲包/manifest.json',Buffer.from(JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder:'songs/exercise'}]}))]);
 return{filename:media?'原创完整练习_封面背景PV.zip':'原创完整练习_无媒体.zip',bytes:storedZip(entries),files,metadata,score};
}
// Authored native exports only: inspect in memory, never extract paths.
export function inspectAuthoredZip(bytes){
 const script='import sys,io,zipfile,json,hashlib\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nn=z.namelist()\nassert len(n)==len(set(n))\nassert len(n)<=64\nr={}\nfor i in z.infolist():\n assert not i.is_dir() and i.file_size<=2*1024*1024\n b=z.read(i)\n r[i.filename]={"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}\nprint(json.dumps(r))\n';
 return JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',script],{input:bytes,maxBuffer:128*1024,encoding:'utf8'}));
}
export function assertCleanExportInventory(inventory,fixture,key){
 const expected=new Map([...fixture.files].map(([name,bytes])=>[`songs/${key}/${name}`,{bytes:bytes.length,sha256:digest(bytes)}]));
 if(Object.keys(inventory).length!==expected.size+1||!inventory['manifest.json'])throw Error('Clean export must contain only one manifest and the complete declared song');
 for(const [name,item]of expected)if(inventory[name]?.bytes!==item.bytes||inventory[name]?.sha256!==item.sha256)throw Error(`Clean export changed or omitted ${name}`);
 for(const name of Object.keys(inventory))if(name!=='manifest.json'&&!expected.has(name))throw Error(`Undeclared exported file ${name}`);return true;
}
