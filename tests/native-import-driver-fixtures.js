import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {authoredImportScore} from './bulk-import-fixtures.js';

/** Newly authored test music and envelopes. No delivered/private source bytes. */
export function authoredLegacyPack(){
 const first=authoredImportScore('authored-pack-first','原创批量练习一'),second=authoredImportScore('authored-pack-second','Original batch exercise two');
 first.tempo[0].bpm=30;second.tempo[0].bpm=30;
 const track=Buffer.from('00ff51031e848000903c5a60803c000090405a6080400000ff2f00','hex'),trackHeader=Buffer.alloc(8);trackHeader.write('MTrk');trackHeader.writeUInt32BE(track.length,4);const midi=Buffer.concat([Buffer.from('4d54686400000006000000010060','hex'),trackHeader,track]);
 const source=Buffer.from('{"format":"authored-unsupported-events-v1","events":[{"kind":"unknown-pedal","at":{"numerator":1,"denominator":3},"raw":255}]}\r\n');
 const entries=[];
 for(const [index,score]of [first,second].entries()){
  const folder=`原创曲包/songs/00${index+1}-original/`;
  const metadata={format:'private-complete-midi-source-folder',version:1,title:score.title,source_files:[{path:'source/original.mid',bytes:midi.length,sha256:createHash('sha256').update(midi).digest('hex')}],imports:{canonical_score:'score.wmhscore.json'}};
  entries.push([`${folder}metadata.json`,JSON.stringify(metadata)],[''+folder+'source/original.mid',midi],[folder+'score.wmhscore.json',`\n${JSON.stringify(score,null,2)}\r\n`]);
 }
 const folder='原创曲包/songs/003-original-events/';
 entries.push([folder+'metadata.json',JSON.stringify({format:'private-complete-midi-source-folder',version:1,title:'Original unsupported event source',source_files:[{path:'source/events.json',bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')}],imports:{canonical_score:null,canonical_error:'Original authored events preserved; not a playable score'}})],[folder+'source/events.json',source]);
 entries.push(['原创曲包/一键导入曲库.json',JSON.stringify({format:'worldmusichub-library-backup',version:1,entries:[{label:null,score:first},{label:null,score:second}]})]);
 return{filename:'原创曲包_日本語.zip',bytes:streamingZip(entries),scores:[first,second],entries};
}

/** Python's streaming local ZIP64 header matches the delivered envelope style.
 * The central directory remains ordinary; content is newly authored above. */
export function streamingZip(entries){
 const script='import sys,json,io,zipfile,base64\nsource=json.load(sys.stdin)\noutput=io.BytesIO()\nwith zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED) as archive:\n for name,encoded in source:\n  info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED\n  with archive.open(info,"w",force_zip64=True) as member: member.write(base64.b64decode(encoded))\nsys.stdout.buffer.write(output.getvalue())\n';
 return execFileSync(process.platform==='win32'?'python':'python3',['-c',script],{input:JSON.stringify(entries.map(([name,value])=>[name,Buffer.from(value).toString('base64')])),maxBuffer:8*1024*1024});
}

/** Minimal stored ZIP fixture writer with UTF-8 paths; never unpacks user input. */
export function storedZip(entries){
 const local=[],central=[];let offset=0;
 for(const [name,value]of entries){
  const filename=Buffer.from(name),data=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x0800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,filename,data);central.push(directory,filename);offset+=header.length+filename.length+data.length;
 }
 const table=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,table,end]);
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}

/** Real native Rust backend over stdin; creates no network listener or GUI. */
export function startNativeImportDriver({binary,directory,cwd}={}){
 if(!binary||!directory)throw Error('An explicit native-import driver and test-owned directory are required.');
 const child=spawn(binary,[directory],{cwd,stdio:['pipe','pipe','pipe']}),pending=[];let output='',stderr='',ended=false;
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32768)});
 child.stdout.on('data',chunk=>{output+=chunk;for(;;){const end=output.indexOf('\n');if(end<0)break;const line=output.slice(0,end);output=output.slice(end+1);const task=pending.shift();if(!task)continue;try{const response=JSON.parse(line),bytes=Buffer.from(response.body_base64,'base64');task.resolve({ok:response.status>=200&&response.status<300,status:response.status,url:'https://wmh.localhost'+task.path,redirected:false,headers:new Headers({'Content-Type':response.content_type}),json:async()=>JSON.parse(bytes.toString()),text:async()=>bytes.toString(),blob:async()=>new Blob([bytes],{type:response.content_type}),bytes:async()=>bytes,contentType:response.content_type})}catch(error){task.reject(error)}}});
 const fail=error=>{ended=true;for(const task of pending.splice(0))task.reject(error)};child.on('error',fail);child.on('exit',code=>fail(Error(`Native import driver exited (${code}): ${stderr}`)));
 async function fetcher(path,options={}){
  if(ended)throw Error(`Native import driver is closed: ${stderr}`);
  const body=options.body===undefined?Buffer.alloc(0):typeof options.body==='string'||Buffer.isBuffer(options.body)?Buffer.from(options.body):Buffer.from(await options.body.arrayBuffer());
  options.signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{pending.push({resolve,reject,path});child.stdin.write(JSON.stringify({method:options.method||'GET',path,headers:options.headers||{},body_base64:body.toString('base64')})+'\n',error=>{if(error)fail(error)})});
 }
 return{fetcher,requests:[],close:async()=>{if(ended)return;child.stdin.end();await new Promise(resolve=>child.once('exit',resolve))},stderr:()=>stderr};
}
