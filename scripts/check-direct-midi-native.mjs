// Production application DOM + real Rust stdin. No browser, GUI or listener.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {directMidiFixtures,directMidiDigest} from './prepare-direct-midi-fixtures.mjs';
import {validateDirectMidiImport,validateDirectMidiOpened,validateDirectMidiTake} from './direct-midi-proof.mjs';

export async function checkDirectMidiNative({binary=process.env.WMH_NATIVE_IMPORT_DRIVER,output=process.env.WMH_DIRECT_MIDI_REPORT}={}){
 assert.ok(binary,'Build the exact-source native_import_driver and set WMH_NATIVE_IMPORT_DRIVER');
 const directory=await mkdtemp(join(tmpdir(),'wmc-direct-midi-')),fixtures=directMidiFixtures(),saved=new Map(),storageValues=new Map();
 const report={version:1,kind:'original-direct-midi-production-dom-rust-stdio',source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),driver_sha256:directMidiDigest(await readFile(binary)),driver_build_source:process.env.WMH_DIRECT_MIDI_DRIVER_SOURCE||null,browser:false,native_window:false,physical_audio:false,network_listener:false,cases:[],api:[],process_ids:[],ok:false};
 let driver,app,wall=1000;
 const open=()=>{driver=startVsqNativeDriver({binary:resolve(binary),directory:join(directory,'Scores'),requestTimeoutMs:30000});report.process_ids.push(driver.pid);};
 const transport={requests:[],async fetcher(path,options={}){
  const body=options.body===undefined?undefined:typeof options.body==='string'||Buffer.isBuffer(options.body)?options.body:options.body instanceof ArrayBuffer||ArrayBuffer.isView(options.body)?Buffer.from(options.body instanceof ArrayBuffer?options.body:options.body.buffer,options.body.byteOffset||0,options.body.byteLength):Buffer.from(await options.body.arrayBuffer());
  const response=await driver.fetcher(path,{...options,body}),bytes=await response.bytes(),row={path,status:response.status,request_sha256:directMidiDigest(body??Buffer.alloc(0)),response_sha256:directMidiDigest(bytes),body:typeof body==='string'?JSON.parse(body):null};transport.requests.push(row);report.api.push(row);
  return{...response,url:'https://wmh.localhost'+path,redirected:false,headers:new Headers({'Content-Type':response.contentType}),json:async()=>JSON.parse(bytes),text:async()=>bytes.toString(),blob:async()=>new Blob([bytes],{type:response.contentType})};
 }};
 const request=async(path,body,status=200,type='application/json')=>{const response=await transport.fetcher(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':type},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);return result;};
 const importRaw=async(fixture,mode='commit')=>{const response=await transport.fetcher(`/api/library/import/${mode}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-wmh-filename':encodeURIComponent(fixture.filename)},body:fixture.bytes});assert.equal(response.status,200);return response.json();};
 async function startDom(){app=await nativeStorageApp(transport,{now:()=>wall,storageValues});await app.click('home-single-player');}
 async function take(){
  await app.until(()=>!app.$('start-performance').disabled,'Saved MIDI must expose existing Start');app.$('count-in').checked=false;
  await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');wall+=120;app.renderAudioTo((wall-1000)/1000);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);const result=await app.exported('export-takes');validateDirectMidiTake(result,fixtures.boundary);return result;
 }
 try{
  open();await startDom();
  const raw=fixtures.boundary,file=new Blob([raw.bytes],{type:'audio/midi'});Object.defineProperty(file,'name',{value:raw.filename});
  Object.defineProperty(app.$('score-file'),'files',{configurable:true,value:[file]});const requestStart=transport.requests.length;app.emit(app.$('score-file'),'change');
  await app.until(()=>app.$('song-lobby').dataset.previewId?.startsWith('native:song-')&&!app.$('start-performance').disabled,'Raw picker fallback should save and select a complete native song');
  const key=app.$('song-lobby').dataset.previewId.slice('native:'.length),opened=validateDirectMidiOpened(await request('/api/library/load',{key}),raw);saved.set('boundary',opened);
  const paths=transport.requests.slice(requestStart).map(row=>row.path);for(const path of ['/api/import/midi','/api/library/import/preview','/api/library/import/commit','/api/library/load'])assert.ok(paths.includes(path),`Actual picker omitted ${path}`);assert.equal(transport.requests.slice(requestStart).find(row=>row.path==='/api/import/midi').status,400);assert.equal(app.audio().contexts,0,'Import must not auto-start sound');
  report.cases.push({name:'raw-picker-save-selection-start-full-targets',key,take:await take(),ok:true});await app.close();app=null;
  for(const kind of ['boundary','layered','tracks','range']){
   const fixture=fixtures[kind];assert.match((await request('/api/import/midi',fixture.bytes,400,'audio/midi')).error,/overlapping/i);const preview=await importRaw(fixture,'preview');validateDirectMidiImport(preview,fixture,{mode:'preview',status:kind==='boundary'?'duplicate':'ready'});
   const committed=await importRaw(fixture);const item=validateDirectMidiImport(committed,fixture,{status:kind==='boundary'?'duplicate':'saved'}),opened=validateDirectMidiOpened(await request('/api/library/load',{key:item.entry.key}),fixture);saved.set(kind,opened);
   const exported=await transport.fetcher('/api/library/import/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({archive_key:committed.source.archive_key})});assert.equal(exported.status,200);assert.deepEqual(await exported.bytes(),fixture.bytes,'Retained original must be byte-for-byte raw SMF');
   const repeated=await importRaw(fixture);validateDirectMidiImport(repeated,fixture,{status:'duplicate'});assert.equal(repeated.items[0].entry.key,item.entry.key);
   report.cases.push({name:`native-${kind}-events-metadata-raw-duplicate`,key:item.entry.key,raw_sha256:fixture.manifest.sha256,ok:true});
  }
  await request('/api/import/midi',fixtures.canonical.bytes,200,'audio/midi');report.cases.push({name:'canonical-import-contract-unchanged',ok:true});
  const range=saved.get('range'),song=prepareCleanSong(`native:${range.entry.key}`,range.clean_package,JSON.parse(range.clean_package.score_json).notation),rangeReport=await request('/api/instrument-check',{timeline:song.compilation.timeline,profile:{kind:'piano',key_count:88,lowest_midi:21}});
  assert.equal(rangeReport.changed_source_notes,false);assert.ok(rangeReport.note_options.some(note=>note.midi===12&&note.playable===false),'Out-of-range target must be diagnosed after successful parsing');assert.equal(song.compilation.timeline.notes.length,4);report.cases.push({name:'range-diagnostic-independent-of-valid-parser',range:rangeReport,ok:true});
  const before=(await request('/api/library/list')).entries.map(entry=>entry.key).sort();
  for(const fixture of fixtures.invalid){await request('/api/import/midi',fixture.bytes,400,'audio/midi');const preview=await importRaw(fixture,'preview');assert.ok(preview.items.every(item=>!item.playable&&!item.clean_package&&!item.entry&&['error','retained_nonplayable'].includes(item.status)));report.cases.push({name:fixture.filename,report:preview,ok:true});}
  assert.deepEqual((await request('/api/library/list')).entries.map(entry=>entry.key).sort(),before,'Rejected preview must not create a partial saved song');
  await driver.close();driver=null;open();
  for(const [kind,opened]of saved){const after=await request('/api/library/load',{key:opened.entry.key});assert.deepEqual(after,opened,'A new native process must load byte-identical metadata, score, tracks and runtime');validateDirectMidiOpened(after,fixtures[kind]);}
  await startDom();await app.until(()=>app.savedButton(saved.get('boundary').entry.key));app.savedButton(saved.get('boundary').entry.key).click();report.cases.push({name:'fresh-native-process-reload-start-full-targets',take:await take(),ok:true});assert.equal(new Set(report.process_ids).size,2);report.ok=true;
 }catch(error){report.error=String(error.stack||error);throw error;}finally{
  const cleanup=[];for(const [name,close]of [['app',()=>app?.close()],['driver',()=>driver?.close()],['directory',()=>rm(directory,{recursive:true,force:true})]])try{await close();}catch(error){cleanup.push({name,error:String(error)});}
  if(cleanup.length){report.cleanup_errors=cleanup;report.ok=false;}if(output){await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}if(cleanup.length)throw Error(JSON.stringify(cleanup));
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=await checkDirectMidiNative();console.log(JSON.stringify({ok:report.ok,source_sha:report.source_sha,cases:report.cases.map(row=>row.name)}));}
