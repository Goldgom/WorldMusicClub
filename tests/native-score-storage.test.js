import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openScoreLibrary} from '../web/local-library.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {fixture} from './frontend-fixtures.js';

const origin='https://wmh.localhost',key=`song-${'a'.repeat(64)}`;
const score=()=>({...structuredClone(fixture),source:{format:'authored-assets-v1',filename:'../Original.cmd',content:'\uFEFF{"original":"AAEC/w==","license":"CC0-1.0"}\r\n'}});
const row=(overrides={})=>({key,revision:1,title:fixture.title,composer:fixture.composer,score_id:fixture.id,label:fixture.title,score_bytes:1234,saved_at_unix_ms:1700000000000,...overrides});
const reply=(value,{status=200,url=`${origin}/api/health`,redirected=false}={})=>({ok:status<400,status,url,redirected,json:async()=>value});
function service({network='native-protocol-no-listener',handle}={}){
 const calls=[];
 const fetcher=async(path,options)=>{calls.push({path,options});if(path==='/api/health')return reply({name:'WorldMusicHub',engine:'rust',network,score_format_version:1});if(handle)return handle(path,options);throw Error(`Unexpected ${path}`)};
 return{calls,fetcher};
}
test('authoritative health chooses native and saves an exact immutable source snapshot without opening IDB',async()=>{
 let opened=0,release,validated,submitted;const validation=new Promise(resolve=>release=resolve),original=score(),expected=structuredClone(original);
 const s=service({handle:async(path,options)=>{assert.equal(path,'/api/library/save');submitted=JSON.parse(options.body);return reply(row())}});
 const storage=await openScoreStorage({origin,fetcher:s.fetcher,openBrowserLibrary:async()=>{opened++;throw Error('No IDB')},validateScore:async value=>{validated=value;await validation;return true}});
 const pending=storage.save(original);original.source.content='Later unsaved edit';original.title='Later title';release();
 const saved=await pending;assert.deepEqual(validated,expected);assert.deepEqual(JSON.parse(submitted.score_json),expected);assert.equal(saved.libraryKey,`native:${key}`);assert.equal(opened,0);assert.equal(storage.info.storage,'native-filesystem');
 for(const {options}of s.calls){assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin')}
});
test('native save errors and lost responses stay explicit and never fall back to browser storage',async()=>{
 for(const mode of ['failure','lost','malformed']){
  let opened=0;const s=service({handle:async()=>{if(mode==='lost')throw Error('Lost response');return mode==='failure'?reply({code:'library_io',error:'Disk write failed'},{status:500}):reply({not_an_entry:true})}});
  const storage=await openScoreStorage({origin,fetcher:s.fetcher,validateScore:async()=>true,openBrowserLibrary:async()=>{opened++}});
  await assert.rejects(storage.save(score()),error=>{assert.equal(error.persistence,mode==='failure'?'not-saved':'unknown');assert.equal(error.code,mode==='failure'?'library_io':mode==='lost'?'library_commit_uncertain':'library_invalid_response');return true});assert.equal(opened,0);
 }
});
test('unknown health, redirect, wrong engine and foreign response refuse both native and fallback',async()=>{
 for(const response of [reply({name:'WorldMusicHub',engine:'rust',score_format_version:1,network:'future-unknown'}),reply({name:'WorldMusicHub',engine:'javascript',score_format_version:1,network:'loopback-only'}),reply({},{redirected:true}),reply({},{url:'https://other.example/api/health'})]){
  let opened=0;await assert.rejects(openScoreStorage({origin,fetcher:async()=>response,openBrowserLibrary:async()=>{opened++}}),error=>error.code==='library_environment_unknown');assert.equal(opened,0);
 }
});
test('browser contract uses explicitly identified IndexedDB and keeps existing backup schema',async()=>{
 const library=await openScoreLibrary({factory:new IDBFactory()}),s=service({network:'loopback-only'});let validations=0;
 const storage=await openScoreStorage({origin,fetcher:s.fetcher,openBrowserLibrary:async()=>library,validateScore:async()=>{validations++;return true}});
 try{const original=score(),saved=await storage.save(original),inventory=await storage.list();assert.equal(inventory.storage,'indexeddb');assert.equal(inventory.directory,null);assert.equal(inventory.entries[0].libraryKey,saved.libraryKey);assert.match(saved.libraryKey,/^browser:/);assert.deepEqual((await storage.load(saved.libraryKey)).score,original);assert.equal(validations,2);const backup=JSON.parse((await storage.exportBackup()).text);assert.equal(backup.format,'worldmusichub-library-backup');assert.equal(backup.version,1);assert.deepEqual(backup.entries[0].score,original);assert.equal(s.calls.length,1)}finally{storage.close()}
});
test('default canonical validation calls Rust before any save and rejects an unconfirmed validation result',async()=>{
 const s=service({handle:async(path,options)=>{if(path==='/api/compile')return reply({score:JSON.parse(options.body),timeline:{notes:[]}});assert.equal(path,'/api/library/save');return reply(row())}});
 const storage=await openScoreStorage({origin,fetcher:s.fetcher});await storage.save(score());assert.deepEqual(s.calls.map(call=>call.path),['/api/health','/api/compile','/api/library/save']);
 const other=service();const unconfirmed=await openScoreStorage({origin,fetcher:other.fetcher,validateScore:async()=>undefined});await assert.rejects(unconfirmed.save(score()),error=>error.code==='library_validation_required');assert.equal(other.calls.length,1);
});
test('native inventory keys distinguish editions and complete exports restore through the existing browser backup schema',async()=>{
 const original=score(),second={...score(),title:'Second authored edition'},rows=[row(),row({key:`song-${'b'.repeat(64)}`,title:second.title})];
 const s=service({handle:async(path,options)=>{
  if(path==='/api/library/list')return reply({storage:'native-filesystem',library_format_version:1,directory:'C:\\Users\\Example\\AppData\\Local\\WorldMusicHub\\Scores',entries:rows,issues:[]});
  const {key:requested}=JSON.parse(options.body),i=rows.findIndex(item=>item.key===requested);assert.equal(path,'/api/library/export');return reply({format:'worldmusichub-native-score-backup',version:1,entry:rows[i],score_json:JSON.stringify(i?second:original)});
 }});
 const storage=await openScoreStorage({origin,fetcher:s.fetcher,validateScore:async()=>true}),inventory=await storage.list();assert.equal(inventory.entries[0].score_id,inventory.entries[1].score_id);assert.notEqual(inventory.entries[0].libraryKey,inventory.entries[1].libraryKey);
 const exported=await storage.exportBackup(),parsed=JSON.parse(exported.text);assert.deepEqual(Object.keys(parsed).sort(),['entries','exported_at','format','version']);assert.deepEqual(parsed.entries.map(item=>item.score),[original,second]);
 const browser=await openScoreLibrary({factory:new IDBFactory()});try{await browser.restoreBackup(exported.text,{validate:async()=>true});assert.equal((await browser.list()).length,2)}finally{browser.close()}
});
test('native duplicate/conflict responses retain stable existing identities and explicit edition choice',async()=>{
 let body;const s=service({handle:async(path,options)=>{body=JSON.parse(options.body);return reply({code:body.allow_conflicting_id?'library_duplicate':'library_id_conflict',error:'Existing edition',existing:row()},{status:409})}});
 const storage=await openScoreStorage({origin,fetcher:s.fetcher,validateScore:async()=>true});
 await assert.rejects(storage.save(score()),error=>error.code==='library_id_conflict'&&error.existing.libraryKey===`native:${key}`);assert.equal(body.allow_conflicting_id,false);
 await assert.rejects(storage.save(score(),{allowConflictingId:true}),error=>error.code==='library_duplicate'&&error.existing.storageKey===key);assert.equal(body.allow_conflicting_id,true);
});
test('invalid cross-storage keys, incomplete inventory and cancelled validation cannot issue a save',async()=>{
 const s=service({handle:async()=>reply({storage:'native-filesystem',entries:[]})});const storage=await openScoreStorage({origin,fetcher:s.fetcher,validateScore:async()=>true});
 await assert.rejects(storage.load('browser:local-id'),error=>error.code==='library_invalid_key');assert.equal(s.calls.length,1);
 const controller=new AbortController();controller.abort();await assert.rejects(storage.save(score(),{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(s.calls.length,1);
 await assert.rejects(storage.list(),error=>error.code==='library_invalid_response');
});

test('encoded native request limits reject whole-source overflow without sending a partial save',async()=>{
 const s=service(),storage=await openScoreStorage({origin,fetcher:s.fetcher,validateScore:async()=>true}),large=score();large.source.content='"'.repeat(2.2*1024*1024);
 await assert.rejects(storage.save(large),error=>error.code==='library_request_limit');assert.deepEqual(s.calls.map(call=>call.path),['/api/health']);assert.equal(large.source.content.length,Math.trunc(2.2*1024*1024));
});
