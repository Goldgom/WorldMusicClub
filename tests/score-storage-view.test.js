import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {ScoreStorageModel,createImportPersistenceTicket} from '../web/score-storage-model.js';
import {setupScoreStorageView} from '../web/score-storage-view.js';
import {fixture} from './frontend-fixtures.js';

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const entry={key:'first',storageKey:'first',libraryKey:'native:first',score_id:fixture.id,title:fixture.title,composer:fixture.composer};
async function setup({kind='native',locale='zh-CN',adapter:changes={},download}={}){
 const {document,window}=parseHTML('<html><body><main id="host"></main></body></html>'),i18n=createI18n({locale}),counts={save:0,list:0,export:0},downloads=[];
 const adapter={info:{kind,storage:kind==='native'?'native-filesystem':'indexeddb',origin:'https://wmh.localhost',capabilities:{rescan:true,backup:true,chooseDirectory:false,openFolder:false}},async list(){counts.list++;return{directory:kind==='native'?'C:\\Native\\<script>&原稿':null,entries:[{...entry,libraryKey:`${kind}:first`}],issues:[]}},async save(){counts.save++;return entry},async exportBackup(){counts.export++;return{text:'{"complete":"backup"}',filename:'worldmusichub-library-backup.json'}},close(){},...changes};
 const model=new ScoreStorageModel({openStorage:async()=>adapter}),view=setupScoreStorageView({model,host:document.getElementById('host'),document,i18n,download:download||((value)=>downloads.push(value))});
 await model.start();const button=name=>view.element.querySelector(`[data-storage-action="${name}"]`);
 return{document,window,i18n,model,view,adapter,counts,downloads,button,status:()=>view.element.querySelector('[role="status"]').textContent};
}
test('native settings displays the literal folder and keeps unimplemented OS actions disabled',async()=>{
 const f=await setup();assert.match(f.view.element.textContent,/游戏的原生谱面文件夹/);assert.equal(f.view.element.querySelector('.score-storage-path').textContent,'C:\\Native\\<script>&原稿');assert.equal(f.view.element.querySelector('script'),null);assert.equal(f.button('choose').disabled,true);assert.equal(f.button('open').disabled,true);assert.equal(f.counts.export,0);assert.equal(f.counts.save,0);
 f.button('rescan').click();await settle();assert.equal(f.counts.list,2);assert.equal(f.counts.save,0);f.view.destroy();f.model.destroy();
});
test('browser settings names IndexedDB and downloads without claiming a native save',async()=>{
 const f=await setup({kind:'browser',locale:'en'});assert.match(f.view.element.textContent,/IndexedDB in this browser/);assert.equal(f.view.element.querySelector('.score-storage-path').textContent,'https://wmh.localhost');assert.match(f.view.element.textContent,/Clearing browser data/);
 await f.model.save(fixture);assert.match(f.status(),/saved in this browser/);assert.doesNotMatch(f.status(),/saved to the native/);f.button('backup').click();await settle();assert.equal(f.downloads.length,1);assert.match(f.status(),/download requested/);assert.doesNotMatch(f.status(),/file was saved/);f.view.destroy();
});
test('failed writes clearly say not saved and preserve the score while offering only explicit retry',async()=>{
 let attempts=0;const f=await setup({adapter:{save:async()=>{attempts++;throw Object.assign(new Error('<img src=x> 原始错误'),{code:'library_io'})}}}),current=structuredClone(fixture),expected=structuredClone(current);
 await f.model.persistImported(createImportPersistenceTicket('file-import'),current,{activated:true});assert.deepEqual(current,expected);assert.match(f.status(),/尚未保存/);assert.match(f.status(),/当前谱面仍可使用/);assert.match(f.status(),/当前谱面的 JSON 导出/);assert.equal(f.button('retry').hidden,false);assert.equal(f.view.element.querySelector('img'),null);assert.match(f.view.element.querySelector('.score-storage-detail').textContent,/library_io/);
 f.i18n.setLocale('en');assert.match(f.status(),/is not saved/);assert.equal(attempts,1);f.button('retry').click();await settle();assert.equal(attempts,2);f.view.destroy();
});
test('conflict waits for explicit keep-both and locale switching neither writes nor alters the snapshot',async()=>{
 const requests=[];const f=await setup({adapter:{save:async(score,options)=>{requests.push({score,options});if(!options.allowConflictingId)throw Object.assign(new Error('Same id'),{code:'library_id_conflict',existing:entry});return{...entry,key:'second',libraryKey:'native:second'}}}});
 const imported=structuredClone(fixture);await f.model.save(imported);imported.title='Later draft';assert.match(f.status(),/当前导入尚未保存/);assert.equal(f.button('keepBoth').hidden,false);const button=f.button('keepBoth');f.document.activeElement=button;f.i18n.setLocale('en');assert.equal(f.button('keepBoth'),button);assert.equal(f.document.activeElement,button);assert.equal(requests.length,1);button.click();await settle();assert.equal(requests.length,2);assert.equal(requests[1].score.title,fixture.title);assert.equal(requests[1].options.allowConflictingId,true);assert.match(f.status(),/saved to the native/);f.view.destroy();
});
test('pending save keeps one operation and existing DOM controls while language changes',async()=>{
 const pending=deferred();let attempts=0;const f=await setup({adapter:{save:async()=>{attempts++;return pending.promise}}});const button=f.button('rescan');const operation=f.model.save(fixture);await settle();assert.equal(f.view.element.getAttribute('aria-busy'),'true');assert.equal(button.disabled,true);f.i18n.setLocale('en');assert.match(f.status(),/^Saving/);assert.equal(f.button('rescan'),button);assert.equal(attempts,1);pending.resolve(entry);await operation;assert.match(f.status(),/saved to the native/);assert.equal(button.disabled,false);f.view.destroy();
});
test('closing the view during export prevents an unsolicited late download',async()=>{
 const pending=deferred();const f=await setup({adapter:{exportBackup:()=>pending.promise}});f.button('backup').click();await settle();f.view.destroy();pending.resolve({text:'{}',filename:'late.json'});await settle();assert.equal(f.downloads.length,0);assert.equal(f.document.getElementById('host').children.length,0);
});
test('a newer save failure is not hidden behind an earlier backup-download message',async()=>{
 const f=await setup();f.button('backup').click();await settle();assert.match(f.status(),/已请求下载备份/);f.adapter.save=async()=>{throw Object.assign(new Error('No space'),{code:'library_io'})};await f.model.save(fixture);assert.match(f.status(),/尚未保存/);assert.doesNotMatch(f.status(),/已请求下载备份/);f.view.destroy();
});
test('inventory issues and refresh errors stay visible without replacing known songs',async()=>{
 const f=await setup({adapter:{list:async()=>({directory:'C:\\Scores',entries:[entry],issues:[{key:'broken',code:'library_corrupt_entry',message:'<bad> archive needs review'}]})}});assert.match(f.view.element.querySelector('.score-storage-issues').textContent,/<bad> archive/);assert.equal(f.view.element.querySelector('bad'),null);f.adapter.list=async()=>{throw Object.assign(new Error('Read failure'),{code:'library_io'})};f.button('rescan').click();await settle();assert.match(f.status(),/先前显示的列表可能不是最新/);assert.equal(f.model.snapshot().entries.length,1);f.i18n.setLocale('en');assert.match(f.status(),/may be out of date/);f.view.destroy();
});
