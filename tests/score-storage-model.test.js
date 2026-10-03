import test from 'node:test';
import assert from 'node:assert/strict';
import {ScoreStorageModel,createImportPersistenceTicket,buildSongList,filterSongList,loadSongListItem} from '../web/score-storage-model.js';
import {fixture} from './frontend-fixtures.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const row=(key='one')=>({key,libraryKey:`native:${key}`,storageKey:key,storageKind:'native',title:fixture.title,score_id:fixture.id,composer:fixture.composer});
function setup(overrides={}){
 const calls={open:0,list:0,save:0,close:0},adapter={info:{kind:'native',storage:'native-filesystem',origin:'https://wmh.localhost',capabilities:{rescan:true,backup:true,chooseDirectory:false,openFolder:false}},async list(){calls.list++;return{directory:'C:\\NativeScores',entries:[],issues:[]}},async save(){calls.save++;return row()},close(){calls.close++},...overrides};
 return{calls,adapter,model:new ScoreStorageModel({openStorage:async()=>{calls.open++;return adapter}})};
}
test('startup reads persistent inventory without saving or adopting a score',async()=>{
 const f=setup({list:async()=>({directory:'C:\\NativeScores',entries:[row('first'),row('second')],issues:[]})});assert.equal(await f.model.start(),true);assert.equal(f.model.snapshot().entries.length,2);assert.equal(f.calls.save,0);assert.equal(f.calls.open,1);assert.equal(f.model.snapshot().directory,'C:\\NativeScores');f.model.destroy();
});
test('one accepted import ticket saves its immutable snapshot exactly once across repeated callbacks',async()=>{
 const gate=deferred();let captures=[],writes=0;const f=setup({save:async score=>{writes++;captures.push(score);await gate.promise;return row()}}),ticket=createImportPersistenceTicket('file-import'),original=structuredClone(fixture),expected=structuredClone(original);
 const first=f.model.persistImported(ticket,original,{activated:true}),second=f.model.persistImported(ticket,original,{activated:true});assert.equal(first,second);original.title='Later unsaved editor change';gate.resolve();assert.equal((await first).status,'saved');assert.equal(writes,1);assert.deepEqual(captures,[expected]);assert.equal((await f.model.persistImported(ticket,original,{activated:true})).status,'saved');assert.equal(writes,1);
});
test('catalog browsing, transpose/editor drafts, failed imports and cancelled imports never autosave',async()=>{
 const f=setup();for(const kind of ['catalog','transpose','editor','saved-library'])assert.throws(()=>createImportPersistenceTicket(kind),/explicit source imports/);
 const ticket=createImportPersistenceTicket('jianpu-import'),controller=new AbortController();controller.abort();
 assert.equal((await f.model.persistImported(ticket,fixture)).status,'skipped');assert.equal((await f.model.persistImported(ticket,fixture,{activated:true,signal:controller.signal})).status,'skipped');assert.equal((await f.model.persistImported({kind:'file-import'},fixture,{activated:true})).status,'skipped');assert.equal(f.calls.open,0);assert.equal(f.calls.save,0);
});
test('save failure preserves the usable score and is not automatically retried by its import hook',async()=>{
 let writes=0;const f=setup({save:async()=>{writes++;throw Object.assign(new Error('Disk full'),{code:'library_io'})}}),ticket=createImportPersistenceTicket('confirmed-omr-import'),usable=structuredClone(fixture),expected=structuredClone(usable);
 const result=await f.model.persistImported(ticket,usable,{activated:true});assert.equal(result.status,'failed');assert.equal(result.persistence,'not-saved');assert.deepEqual(usable,expected);assert.equal(f.model.snapshot().entries.length,0);await f.model.persistImported(ticket,usable,{activated:true});assert.equal(writes,1);await f.model.retrySave();assert.equal(writes,2);
});
test('a conflict waits for an explicit keep-both choice and serializes rapid repeated clicks',async()=>{
 const choices=[];const f=setup({save:async(score,options)=>{choices.push(options);if(!options.allowConflictingId)throw Object.assign(new Error('Conflict'),{code:'library_id_conflict',existing:row('old')});return row('new')}});
 const imported=await f.model.persistImported(createImportPersistenceTicket('file-import'),fixture,{activated:true});assert.equal(imported.status,'conflict');assert.equal(choices.length,1);
 const first=f.model.keepBoth(),extra=f.model.keepBoth();assert.equal((await extra).status,'skipped');assert.equal((await first).status,'saved');assert.equal(choices.length,2);assert.equal(choices[1].allowConflictingId,true);
});
test('duplicate and uncertain commits have distinct persistence states',async()=>{
 for(const [code,persistence,status]of [['library_duplicate','not-saved','duplicate'],['library_commit_uncertain','unknown','uncertain']]){
  const f=setup({save:async()=>{throw Object.assign(new Error(code),{code,persistence,existing:code==='library_duplicate'?row():undefined})}});const result=await f.model.save(fixture);assert.equal(result.status,status);assert.equal(result.persistence,status==='duplicate'?'saved':'unknown');assert.equal(f.model.snapshot().entries.length,status==='duplicate'?1:0);
 }
});
test('late startup/rescan results cannot erase a newly confirmed saved song',async()=>{
 const stale=deferred();const f=setup({list:()=>stale.promise});const loading=f.model.start();await f.model.save(fixture);assert.equal(f.model.snapshot().entries.length,1);stale.resolve({directory:'C:\\NativeScores',entries:[],issues:[]});assert.equal(await loading,false);assert.equal(f.model.snapshot().entries.length,1);assert.equal(f.model.snapshot().reading,false);
});
test('latest rescan wins and read failures retain the last known song list with a visible error',async()=>{
 const first=deferred(),second=deferred();let n=0;const f=setup({list:()=>++n===1?first.promise:second.promise});const a=f.model.rescan(),b=f.model.rescan();second.resolve({directory:'C:\\NativeScores',entries:[row('new')],issues:[]});await b;first.resolve({entries:[row('old')],issues:[]});await a;assert.equal(f.model.snapshot().entries[0].storageKey,'new');f.adapter.list=async()=>{throw Error('Temporarily inaccessible')};assert.equal(await f.model.rescan(),false);assert.equal(f.model.snapshot().entries[0].storageKey,'new');assert.match(f.model.snapshot().error.message,/inaccessible/);
});
test('song-list helpers use saved-copy identities and load without autosaving',async()=>{
 const rows=buildSongList([{id:fixture.id,title:'Catalog',composer:'Author'}],[row('first'),row('second')]);assert.equal(new Set(rows.map(item=>item.selectionKey)).size,3);assert.equal(new Set(rows.map(item=>item.scoreId)).size,1);assert.equal(filterSongList(rows,'','saved').length,2);
 let loaded=0;const f=setup({load:async key=>{loaded++;assert.equal(key,'native:first');return{score:fixture}}});assert.equal(await loadSongListItem(rows[1],{model:f.model}),fixture);assert.equal(loaded,1);assert.equal(f.calls.save,0);assert.equal(await loadSongListItem(rows[0],{model:f.model,loadCatalog:async item=>item.title}),'Catalog');
});

test('a failing view observer cannot misreport a committed save as failed or block other observers',async()=>{
 const f=setup(),errors=[],updates=[];f.model.onObserverError=error=>errors.push(error.message);f.model.subscribe(()=>{throw Error('View render failure')});f.model.subscribe(value=>updates.push(value));const result=await f.model.save(fixture);assert.equal(result.status,'saved');assert.equal(f.calls.save,1);assert.equal(f.model.snapshot().saveResult.persistence,'saved');assert.equal(f.model.snapshot().entries.length,1);assert.ok(errors.length>0);assert.ok(updates.some(state=>state.saveResult?.status==='saved'));
});
