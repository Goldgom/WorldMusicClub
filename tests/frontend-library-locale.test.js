import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {createI18n} from '../web/i18n.js';
import {openScoreLibrary,libraryError} from '../web/local-library.js';
import {setupScoreLibrary} from '../web/library-view.js';
import {fixture as scoreFixture} from './frontend-fixtures.js';

const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
const finishIO=async(predicate)=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(predicate(),true)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(locale='zh-CN',overrides={}){
 const {document,window}=parseHTML('<html><body><button id="library-button"></button></body></html>');
 let current={...structuredClone(scoreFixture),title:'<原稿 & Source>',composer:'Original Composer'};
 const i18n=createI18n({locale,onReport:issue=>assert.fail(JSON.stringify(issue))}),counts={list:0,save:0,remove:0,open:0,pause:0,validate:0},notices=[];
 const row={key:'stable-key',title:current.title,composer:current.composer,label:'<label & 备注>',bytes:1234,updated_at:'2026-10-01T12:34:56.000Z',revision:7};
 const saved={...row,score:structuredClone(current)};
 const library={async list(){counts.list++;return[row]},async get(){return saved},async save(score,options){counts.save++;return{...row,...options,score}},async remove(key,options){counts.remove++;assert.equal(key,row.key);assert.equal(options.expectedRevision,7);return true},...overrides.library};
 const view=setupScoreLibrary({document,i18n,getScore:()=>current,openLibrary:async()=>library,onLoad:async()=>{counts.open++;return true},pausePlayback:()=>counts.pause++,notice:(...value)=>notices.push(value),validate:async()=>{counts.validate++},...overrides});
 const $=id=>document.getElementById(id),dialog=$('score-library');dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 for(const element of document.querySelectorAll('button,input'))element.focus=()=>document.activeElement=element;
 return{document,window,i18n,counts,notices,library,view,row,saved,$,open:async()=>{$('library-button').click();await settle()},setScore:score=>{current=score},getScore:()=>current};
}

test('saved-score locale redraw preserves labels, confirmed deletion, focused controls and revisions without IO',async()=>{
 const f=fixture();await f.open();
 const input=f.$('library-label'),open=f.$('library-list').querySelector('[data-library-open]'),row=f.$('library-list').firstElementChild;
 input.value='unsaved <draft> 13/7';f.document.activeElement=input;f.$('score-library').scrollTop=42;
 assert.equal(f.$('library-title').textContent,'随时打开收藏的乐谱');assert.equal(open.textContent,'打开');
 const counts={...f.counts};f.i18n.setLocale('en');
 assert.equal(f.$('library-title').textContent,'Your scores, close at hand.');assert.match(f.$('library-status').textContent,/^Ready\./);
 assert.equal(f.$('library-label'),input);assert.equal(input.value,'unsaved <draft> 13/7');assert.equal(f.document.activeElement,input);assert.equal(f.$('score-library').scrollTop,42);assert.equal(f.$('score-library').open,true);
 assert.equal(f.$('library-list').firstElementChild,row);assert.equal(f.$('library-list').querySelector('[data-library-open]'),open);assert.equal(open.getAttribute('aria-label'),'Open saved copy <label & 备注>');assert.equal(f.$('library-list').querySelector('label'),null);assert.deepEqual(f.counts,counts);
 f.$('library-list').querySelector('[data-library-delete]').click();const cancel=f.$('library-delete-cancel');cancel.focus();f.i18n.setLocale('zh-CN');
 assert.equal(f.$('library-delete-confirm').hidden,false);assert.equal(f.$('library-delete-name').textContent,f.row.label);assert.equal(f.document.activeElement,cancel);assert.equal(cancel.textContent,'保留副本');assert.deepEqual(f.counts,counts);
 f.$('library-delete-submit').click();await settle();assert.equal(f.counts.remove,1);assert.match(f.$('library-status').textContent,/收藏副本已删除/);f.view.destroy();
});

test('pending save keeps its exact snapshot and label across locale changes and a replaced current score',async()=>{
 const pending=deferred();let captured;
 const f=fixture('en',{library:{async save(score,options){captured={score,options};return pending.promise}}});await f.open();
 f.$('library-label').value='Original draft';f.$('library-save-copy').click();await settle();const original=structuredClone(captured),input=f.$('library-label'),before={...f.counts};
 f.document.activeElement=input;f.i18n.setLocale('zh-CN');assert.match(f.$('library-status').textContent,/正在保存完整/);assert.equal(f.$('score-library').getAttribute('aria-busy'),'true');assert.equal(input.disabled,true);assert.equal(input.value,'Original draft');assert.equal(f.document.activeElement,input);assert.deepEqual(captured,original);assert.deepEqual(f.counts,before);
 f.setScore({...f.getScore(),title:'New score'});f.view.scoreChanged();assert.equal(input.value,'');assert.match(f.$('library-status').textContent,/此前的快照/);assert.deepEqual(captured,original);
 pending.resolve({...f.row,label:captured.options.label});await settle();assert.match(f.$('library-status').textContent,/已将“Original draft”保存在本浏览器/);assert.equal(f.$('library-current-title').textContent,'New score');assert.equal(input.disabled,false);assert.deepEqual(captured.score.title,'<原稿 & Source>');f.view.destroy();
});

test('pending reads and activation are neither repeated nor cancelled by a locale switch',async()=>{
 const list=deferred(),load=deferred();let reads=0,loads=0,signal;
 const f=fixture('zh-CN',{library:{list(){reads++;return list.promise}},onLoad:async(score,activeSignal)=>{loads++;signal=activeSignal;return load.promise}});
 f.$('library-button').click();await settle();f.i18n.setLocale('en');assert.equal(reads,1);assert.match(f.$('library-status').textContent,/Reading your saved copies/);
 list.resolve([f.row]);await settle();f.$('library-list').querySelector('[data-library-open]').click();await settle();assert.equal(loads,1);f.i18n.setLocale('zh-CN');assert.equal(signal.aborted,false);assert.equal(loads,1);assert.match(f.$('library-status').textContent,/正在读取收藏副本/);
 load.resolve(true);await settle();assert.equal(f.$('score-library').open,false);assert.equal(f.notices.length,1);assert.match(f.notices[0][0],/已打开收藏副本/);f.view.destroy();
});

test('closed and reopened list ignores its old pending result even when locale changes',async()=>{
 const pending=deferred();const f=fixture('en',{library:{list:()=>pending.promise}});
 f.$('library-button').click();await settle();f.view.close();f.i18n.setLocale('zh-CN');pending.resolve([f.row]);await settle();assert.equal(f.$('library-list').children.length,0);assert.equal(f.$('score-library').open,false);
 f.$('library-button').click();await settle();assert.equal(f.$('library-list').children.length,1);assert.match(f.$('library-status').textContent,/已就绪/);f.view.destroy();
});

test('revision and quota errors localize from stable codes while original browser details and code stay literal',async()=>{
 const detail='<script>quota & 原始诊断</script>',external=Object.assign(new Error(detail),{name:'QuotaExceededError',code:'BROWSER_QUOTA_EXACT'});
 const f=fixture('zh-CN',{library:{async remove(){throw libraryError('library_delete_revision','legacy English must stay off the UI')},async save(){throw libraryError('library_storage_full','legacy quota prose',{cause:external})}}});await f.open();
 f.$('library-list').querySelector('[data-library-delete]').click();f.$('library-delete-submit').click();await settle();assert.match(f.$('library-status').textContent,/其他标签页改变/);assert.doesNotMatch(f.$('library-status').textContent,/legacy English/);assert.match(f.$('library-status').textContent,/library_delete_revision/);
 f.i18n.setLocale('en');assert.match(f.$('library-status').textContent,/changed in another tab/);f.$('library-delete-cancel').click();f.$('library-save-copy').click();await settle();
 const disclosure=f.$('library-status').querySelector('details'),original=disclosure.querySelector('p');assert.equal(original.textContent,detail);assert.equal(disclosure.querySelector('script'),null);assert.match(disclosure.textContent,/BROWSER_QUOTA_EXACT/);disclosure.open=true;f.document.activeElement=disclosure.querySelector('summary');
 f.i18n.setLocale('zh-CN');assert.match(f.$('library-status').textContent,/存储空间已满/);assert.equal(disclosure.open,true);assert.equal(f.document.activeElement,disclosure.querySelector('summary'));assert.equal(original.textContent,detail);assert.equal(disclosure.querySelector('summary').textContent,'原始技术详情');f.view.destroy();
});

for(const failure of ['abort','genuine'])test(`closing suppresses only its coded restore cancellation (${failure})`,async()=>{
 const pending=deferred(),f=fixture('en',{library:{restoreBackup:()=>pending.promise}});await f.open();
 const input=f.$('library-backup-file');Object.defineProperty(input,'files',{value:[{size:2,text:async()=>'{}'}],configurable:true});input.dispatchEvent(new f.window.Event('change'));await settle();f.view.close();f.i18n.setLocale('zh-CN');
 const cause=failure==='abort'?new DOMException('Cancelled in another language','AbortError'):new Error('was not restored: abort-looking genuine failure <raw>');
 pending.reject(libraryError(failure==='abort'?'library_restore_aborted':'library_restore_score','legacy wrapper',{params:{count:2},cause}));await settle();
 if(failure==='abort')assert.equal(f.notices.length,0);else{assert.equal(f.notices.length,1);assert.match(f.notices[0][0],/第 2 个乐谱未能恢复/);assert.match(f.notices[0][0],/was not restored: abort-looking genuine failure <raw>/)}f.view.destroy();
});

test('restoration validation keeps its generation and original JSON through locale changes',async()=>{
 const factory=new IDBFactory(),library=await openScoreLibrary({factory}),source={...structuredClone(scoreFixture),source:{format:'musicxml',filename:'原稿.xml',content:'\uFEFF<score>\r\n音符 & 原稿</score>'}},backup=JSON.stringify({format:'worldmusichub-library-backup',version:1,entries:[{label:'Original label',score:source}]}),validation=deferred();let seen,signal,calls=0;
 const f=fixture('en',{openLibrary:async()=>library,validate:async(score,activeSignal)=>{seen=score;signal=activeSignal;calls++;await validation.promise}});await f.open();await finishIO(()=>f.$('score-library').getAttribute('aria-busy')==='false');
 const input=f.$('library-backup-file');Object.defineProperty(input,'files',{value:[{size:backup.length,text:async()=>backup}],configurable:true});input.dispatchEvent(new f.window.Event('change'));await settle();assert.equal(calls,1);const canonical=JSON.stringify(seen);f.i18n.setLocale('zh-CN');assert.equal(signal.aborted,false);assert.equal(calls,1);assert.equal(JSON.stringify(seen),canonical);assert.match(f.$('library-status').textContent,/第 1 个乐谱/);
 validation.resolve();await finishIO(()=>f.$('score-library').getAttribute('aria-busy')==='false');const rows=await library.list();assert.equal(rows.length,1);assert.deepEqual((await library.get(rows[0].key)).score,source);assert.equal(rows[0].label,'Original label');assert.match(f.$('library-status').textContent,/已恢复 1 个新副本/);f.view.destroy();library.close();
});

test('long selected-language library labels stay complete and wrapped without changing literal drafts',async()=>{
 const base=createI18n({locale:'en'}),long='<Expanded label> '.repeat(150),i18n={t:(key,params)=>key==='library.save'?long+base.t(key,params):base.t(key,params),formatNumber:base.formatNumber,formatDateTime:base.formatDateTime,subscribe:base.subscribe},f=fixture('en',{i18n});await f.open();
 f.$('library-label').value='<literal draft> 原稿';const button=f.$('library-save-copy');assert.equal(button.textContent,long+'Save new copy');assert.equal(button.querySelector('expanded'),null);assert.equal(button.style.whiteSpace,'normal');assert.equal(button.style.maxWidth,'100%');
 base.setLocale('zh-CN');assert.equal(button.textContent,long+'保存新副本');assert.equal(f.$('library-label').value,'<literal draft> 原稿');assert.equal(f.$('score-library').style.overflowWrap,'anywhere');f.view.destroy();
});
