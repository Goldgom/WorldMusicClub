import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {chooseRaw,observeDirectMidiControls,validateDirectMidiMachineIsolation,validateDirectMidiPickerChange} from '../scripts/hosted-midi-direct-import-check.mjs';
import {directMidiFixtures,prepareDirectMidiFixtures} from '../scripts/prepare-direct-midi-fixtures.mjs';

// Unit-only collaborators: no browser/server is started, and these synthetic
// records are never acceptance evidence for real Chromium event trust.
function pickerPage(){
 const calls=[];let open=false,resolveChooser=null;
 const page={
  locator(selector){
   assert.ok(['#import-tools-dialog','#import-tools-button','#import-button'].includes(selector),'Only visible import controls may select a source');
   return{
    async evaluate(callback){assert.equal(selector,'#import-tools-dialog');calls.push('dialog-open');return callback({open});},
    async click(){calls.push(selector);if(selector==='#import-tools-button'){open=true;return;}assert.equal(selector,'#import-button');assert.equal(open,true);assert.equal(typeof resolveChooser,'function','Arm the filechooser before clicking');resolveChooser({async setFiles(path){calls.push(['setFiles',path]);assert.equal(typeof path,'string','FilePayload would synthesize untrusted input/change');}});resolveChooser=null;},
   };
  },
  waitForEvent(event){assert.equal(event,'filechooser');assert.equal(resolveChooser,null);calls.push('filechooser');return new Promise(resolve=>{resolveChooser=resolve;});},
 };
 return{page,calls};
}
async function diskFixtures(t){
 const directory=await mkdtemp(join(tmpdir(),'hosted-midi-picker-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 return{directory,fixtures:await prepareDirectMidiFixtures(directory)};
}
test('hosted machine-only audio cannot pass with human input, a scored take or assessment',()=>{
 const good={mode:'listen',captured:'0',export_disabled:true,assess_disabled:true,assessment_requests:0};
 assert.deepEqual(validateDirectMidiMachineIsolation(good),good);
 for(const [field,value] of [['mode','practice'],['captured','1'],['export_disabled',false],['assess_disabled',false],['assessment_requests',1]])assert.throws(()=>validateDirectMidiMachineIsolation({...good,[field]:value}));
});
test('hosted native driver checks its compiled source and its own executable hash',async()=>{
 const source=await readFile(new URL('../scripts/hosted-midi-direct-import-check.mjs',import.meta.url),'utf8');
 assert.match(source,/build_identity\.compiled\.source_sha,head/);assert.match(source,/build_identity\.compiled\.source_tree,report\.source_tree/);assert.match(source,/build_identity\.native\.executable_sha256,report\.driver_sha256/);
 assert.ok(source.indexOf('machineApiStart=session.profile.api.length')<source.indexOf("await startSongModPerformance(session.page,{performers:'none'"));
 assert.match(source,/api\.slice\(machineApiStart\)\.filter\(row=>row\.path==='\/api\/assess'\)/);
});
test('hosted visible picker selects exact authored disk paths and reuses the open rejection dialog',async t=>{
 const {directory,fixtures}=await diskFixtures(t),{page,calls}=pickerPage();
 for(const raw of [fixtures.boundary,...fixtures.invalid]){
  await chooseRaw(page,directory,raw);
  assert.deepEqual(calls.at(-1),['setFiles',resolve(directory,raw.filename)]);
  assert.deepEqual(await readFile(calls.at(-1)[1]),raw.bytes);
 }
 assert.deepEqual(calls.filter(call=>typeof call==='string'),['dialog-open','#import-tools-button','filechooser','#import-button','dialog-open','filechooser','#import-button','dialog-open','filechooser','#import-button']);
});
test('hosted picker rejects missing or changed disk bytes and false digests before opening controls',async t=>{
 const {directory,fixtures}=await diskFixtures(t),raw=fixtures.boundary,path=join(directory,raw.filename),{page,calls}=pickerPage();
 await assert.rejects(chooseRaw(page,directory,{...raw,filename:'missing.mid'}),/ENOENT/);
 await assert.rejects(chooseRaw(page,directory,{...raw,filename:`../${raw.filename}`}),/original basename/);
 await assert.rejects(chooseRaw(page,directory,{...raw,manifest:{...raw.manifest,sha256:'0'.repeat(64)}}),/authored digest/);
 await assert.rejects(chooseRaw(page,directory,{...raw,manifest:{...raw.manifest,bytes:raw.bytes.length-1}}));
 const changed=Buffer.from(raw.bytes);changed[changed.length-1]^=1;await writeFile(path,changed);
 await assert.rejects(chooseRaw(page,directory,raw),/exact authored bytes/);
 await writeFile(path,raw.bytes.subarray(0,-1));await assert.rejects(chooseRaw(page,directory,raw),/exact authored bytes/);
 for(const invalid of fixtures.invalid){await writeFile(join(directory,invalid.filename),Buffer.alloc(invalid.bytes.length));await assert.rejects(chooseRaw(page,directory,invalid),/exact authored bytes/);}
 assert.deepEqual(calls,[],'Disk validation must precede visible actions and picker admission');
});
test('hosted control capture preserves browser trust without synthesizing input or change',()=>{
 const listeners=new Map(),context={document:{addEventListener(type,listener,capture){assert.equal(capture,true);listeners.set(type,listener);}}};
 runInNewContext(`(${observeDirectMidiControls.toString()})()`,context);
 assert.deepEqual([...listeners.keys()],['click','input','change']);
 const raw=directMidiFixtures().boundary,target={id:'score-file',files:[{name:raw.filename,size:raw.bytes.length}]};
 for(const trusted of [true,false,undefined])for(const type of ['input','change'])listeners.get(type)({target,isTrusted:trusted});
 const evidence=JSON.parse(JSON.stringify(context.__directMidiControls));
 assert.deepEqual(evidence.events.map(event=>[event.type,event.trusted,event.files]),[true,false,false].flatMap(trusted=>['input','change'].map(type=>[type,trusted,[{name:raw.filename,bytes:raw.bytes.length}]])));
 assert.equal(evidence.overflow,false);
});
test('hosted picker acceptance rejects untrusted, reordered or inexact original-file changes',()=>{
 const raw=directMidiFixtures().boundary,good={overflow:false,events:[{id:'import-button',type:'click',trusted:true},{id:'score-file',type:'click',trusted:false,files:[]},{id:'score-file',type:'input',trusted:true,files:[{name:raw.filename,bytes:raw.bytes.length}]},{id:'score-file',type:'change',trusted:true,files:[{name:raw.filename,bytes:raw.bytes.length}]}]};
 assert.equal(validateDirectMidiPickerChange(good,raw),good);
 for(const mutate of [v=>v.overflow=true,v=>v.events[0].trusted=false,v=>v.events[0].id='other-button',v=>v.events.at(-1).trusted=false,v=>v.events.at(-1).trusted='true',v=>v.events.at(-1).id='other-file',v=>v.events.at(-1).type='input',v=>v.events.at(-1).files=[],v=>v.events.at(-1).files[0].name='replacement.mid',v=>v.events.at(-1).files[0].bytes--,v=>v.events.at(-1).files.push(v.events.at(-1).files[0]),v=>v.events.reverse()]){
  const changed=structuredClone(good);mutate(changed);assert.throws(()=>validateDirectMidiPickerChange(changed,raw));
 }
 const payload=structuredClone(good);for(const event of payload.events)if(['input','change'].includes(event.type))event.trusted=false;
 assert.throws(()=>validateDirectMidiPickerChange(payload,raw),/trusted change/,'Exact filename and 212 bytes cannot excuse untrusted FilePayload events');
});
test('hosted runner binds raw and invalid imports to verified paths and keeps the trusted-change gate',async()=>{
 const source=await readFile(new URL('../scripts/hosted-midi-direct-import-check.mjs',import.meta.url),'utf8');
 const picker=source.slice(source.indexOf('export async function chooseRaw('),source.indexOf('export function validateDirectMidiPickerChange('));
 assert.match(picker,/await\(await chooser\)\.setFiles\(path\)/);assert.doesNotMatch(picker,/setFiles\(\{|setInputFiles|dispatchEvent\(/);
 assert.ok(picker.indexOf('await readFile(path)')<picker.indexOf("page.waitForEvent('filechooser')"));
 assert.ok(picker.indexOf('directMidiDigest(bytes)')<picker.indexOf("page.waitForEvent('filechooser')"));
 assert.match(source,/await chooseRaw\(session\.page,join\(output,'fixtures'\),fixture\)/);assert.match(source,/await chooseRaw\(session\.page,join\(output,'fixtures'\),invalid\)/);
 assert.match(source,/validateDirectMidiPickerChange\(report\.profiles\[0\]\.controls,fixture\);report\.ok=true/);
});
