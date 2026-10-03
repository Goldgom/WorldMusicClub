import test from 'node:test';
import assert from 'node:assert/strict';
import {BulkImportQueue,BULK_IMPORT_LIMITS,createBulkImportTransport,summarizeImport} from '../web/bulk-import.js';
import {deferred,nativeResponse} from './native-storage-app-fixtures.js';
import {importFile,importItem,importReport} from './bulk-import-fixtures.js';

const key=`song-${'1'.repeat(64)}`,saved=()=>importItem({status:'saved',entry:{key}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('raw original File transport is same-origin, Unicode-safe, and never aborts a started commit',async()=>{
 const file=importFile('一键导入 <original>.zip',Buffer.from([80,75,3,4,0,255])),calls=[],controller=new AbortController();
 const transport=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async(path,options)=>{calls.push({path,options});return nativeResponse(importReport(file,{mode:path.endsWith('/commit')?'commit':'preview',items:path.endsWith('/commit')?[saved()]:undefined}))}});
 await transport.preview(file,{signal:controller.signal});await transport.commit(file,{signal:controller.signal,index:2,keepBoth:true,sha256:'a'.repeat(64)});
 assert.equal(calls[0].options.body,file);assert.equal(calls[0].options.signal,controller.signal);assert.equal(calls[1].options.signal,undefined);assert.equal(calls[1].options.body,file);
 assert.equal(calls[1].options.headers['x-wmh-filename'],encodeURIComponent(file.name));assert.equal(calls[1].options.headers['x-wmh-item-index'],'2');assert.equal(calls[1].options.headers['x-wmh-conflict'],'keep-both');assert.equal(calls[1].options.credentials,'same-origin');assert.equal(calls[1].options.redirect,'error');
});

test('untrusted or changed native reports cannot claim a successful save',async()=>{
 const file=importFile('source.zip','original');
 const altered=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(importReport(file,{mode:'commit',sha256:'b'.repeat(64),items:[saved()]}))});
 await assert.rejects(altered.commit(file,{sha256:'a'.repeat(64)}),error=>error.code==='pack_source_changed'&&error.persistence==='unknown');
 const escaped=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async()=>({...nativeResponse(importReport(file)),url:'https://external.example/report'})});
 await assert.rejects(escaped.preview(file),{code:'pack_environment_unknown'});
 const broken=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(importReport(file,{mode:'commit',items:[importItem({status:'saved'})]}))});
 await assert.rejects(broken.commit(file),error=>error.code==='pack_invalid_response'&&error.persistence==='unknown');
});

test('a newer selection owns preflight; late old responses cannot replace it or save anything',async()=>{
 const first=importFile('old.zip','old'),second=importFile('new.zip','new'),gate=deferred(),signals=[];let commits=0;
 const queue=new BulkImportQueue({transport:{preview:async(file,{signal})=>{signals.push(signal);if(file===first)await gate.promise;return importReport(file)},commit:()=>{commits++}}});
 const old=queue.select([first]);await tick();await queue.select([second]);gate.resolve();await old;
 assert.equal(signals[0].aborted,true);assert.equal(queue.snapshot().groups.length,1);assert.equal(queue.snapshot().groups[0].name,'new.zip');assert.equal(queue.snapshot().phase,'review');assert.equal(commits,0);
});

test('cancellation during atomic save waits for its report, preserves it, and stops subsequent files',async()=>{
 const a=importFile('a.zip','a'),b=importFile('b.zip','b'),gate=deferred(),calls=[];let rescans=0;
 const queue=new BulkImportQueue({transport:{preview:async file=>importReport(file),commit:async file=>{calls.push(file);await gate.promise;return importReport(file,{mode:'commit',items:[saved()]})}},onCommitted:async()=>{rescans++}});
 await queue.select([a,b]);const running=queue.commit();await tick();queue.cancel();assert.equal(queue.snapshot().phase,'cancelling');assert.equal(queue.snapshot().groups[0].report.source.retained,false);
 assert.equal(await queue.select([importFile('new.zip','new')]),false,'A new selection cannot discard the active commit');gate.resolve();await running;
 assert.deepEqual(calls,[a]);assert.equal(rescans,1);assert.equal(queue.snapshot().phase,'cancelled');assert.equal(summarizeImport(queue.snapshot().groups).saved,1);assert.equal(queue.snapshot().groups[1].complete,false);
 await queue.commit();assert.deepEqual(calls,[a,b],'Continue skips already completed source A');assert.equal(summarizeImport(queue.snapshot().groups).saved,2);
});

test('lost commit results stay uncertain; explicit retry uses the exact original and safely confirms duplicate',async()=>{
 const file=importFile('original.zip',Buffer.from([0,255,1,2])),seen=[];let calls=0,rescans=0;
 const queue=new BulkImportQueue({transport:{preview:async file=>importReport(file),commit:async file=>{seen.push(file);if(++calls===1)throw Object.assign(Error('Lost after write'),{code:'library_commit_uncertain',persistence:'unknown'});return importReport(file,{mode:'commit',items:[importItem({status:'duplicate',entry:{key}})]})}},onCommitted:async()=>{rescans++}});
 await queue.select([file]);await queue.commit();assert.equal(queue.snapshot().groups[0].phase,'uncertain');assert.equal(summarizeImport(queue.snapshot().groups).saved,0);
 await queue.retry(queue.snapshot().groups[0].id);assert.deepEqual(seen,[file,file]);assert.equal(rescans,2);assert.equal(summarizeImport(queue.snapshot().groups).duplicate,1);
});

test('per-song Keep both commits only its index and keeps earlier saved and unsupported results',async()=>{
 const file=importFile('editions.zip','editions'),items=[saved(),importItem({index:1,status:'conflict'}),importItem({index:2,status:'retained_nonplayable',playable:false})],calls=[];
 const queue=new BulkImportQueue({transport:{preview:async file=>importReport(file,{items}),commit:async(file,options)=>{calls.push(options);return importReport(file,{mode:'commit',items:[importItem(),importItem({index:1,status:'saved',entry:{key}}),items[2]]})}}});
 await queue.select([file]);const id=queue.snapshot().groups[0].id;await queue.commitItem(id,1,{keepBoth:true});
 assert.equal(calls[0].index,1);assert.equal(calls[0].keepBoth,true);assert.deepEqual(queue.snapshot().groups[0].report.items.map(item=>item.status),['saved','saved','retained_nonplayable']);assert.equal(summarizeImport(queue.snapshot().groups).retained_nonplayable,1);
});

test('bounded file selection and per-format limits are checked before any file reads; preview retries work',async()=>{
 let calls=0,fail=true;const file=importFile('retry.zip','small');
 const queue=new BulkImportQueue({transport:{preview:async value=>{calls++;if(fail)throw Error('Read failed');return importReport(value)}}});
 await queue.select(Array.from({length:BULK_IMPORT_LIMITS.files+1},()=>file));assert.equal(calls,0);assert.equal(queue.snapshot().error.code,'pack_selection_limit');
 await queue.select([{name:'oversize.zip',size:BULK_IMPORT_LIMITS.zipBytes+1}]);assert.equal(calls,0);assert.equal(queue.snapshot().groups[0].error.code,'pack_file_limit');
 await queue.select([file]);assert.equal(queue.snapshot().groups[0].phase,'failed');fail=false;await queue.retry(queue.snapshot().groups[0].id);assert.equal(queue.snapshot().groups[0].phase,'ready');assert.equal(calls,2);
});

test('browser mode explains native requirement and cannot claim native saved originals',async()=>{
 let calls=0;const queue=new BulkImportQueue({getStorageKind:async()=> 'browser',transport:{preview:()=>{calls++}}});await queue.select([importFile('pack.zip','zip')]);assert.equal(calls,0);assert.equal(queue.snapshot().error.code,'pack_native_required');assert.equal(summarizeImport(queue.snapshot().groups).saved,0);
});

test('a successful report with a post-publication uncertain item keeps known saves and reconciles through selected retry',async()=>{
 const file=importFile('partial-original.zip','complete unchanged source'),uncertain=importItem({index:1,status:'error',code:'library_commit_uncertain',message:'Publication happened; confirmation failed'}),calls=[];let rescans=0;
 const queue=new BulkImportQueue({transport:{preview:async value=>importReport(value,{items:[importItem(),importItem({index:1})]}),commit:async(value,options)=>{calls.push({value,options});return importReport(value,{mode:'commit',items:calls.length===1?[saved(),uncertain]:[importItem({status:'duplicate',entry:{key}}),importItem({index:1,status:'duplicate',entry:{key:`song-${'2'.repeat(64)}`}})]})}},onCommitted:async()=>{rescans++}});
 await queue.select([file]);await queue.commit();let group=queue.snapshot().groups[0],summary=summarizeImport([group]);
 assert.equal(group.phase,'uncertain');assert.equal(group.complete,false);assert.equal(group.report.source.retained,true);assert.deepEqual(group.report.items[1],uncertain);assert.equal(summary.saved,1);assert.equal(summary.unconfirmed,1);assert.equal(summary.unconfirmedItems,1);assert.equal(summary.error,0);assert.equal(rescans,1);
 await queue.commitItem(group.id,1);group=queue.snapshot().groups[0];summary=summarizeImport([group]);
 assert.equal(calls[1].options.index,1);assert.equal(calls[1].value,file);assert.equal(rescans,2);assert.equal(group.phase,'complete');assert.equal(group.complete,true);assert.deepEqual(group.report.items.map(item=>item.status),['saved','duplicate']);assert.equal(summary.unconfirmedItems,0);assert.equal(summary.error,0);
});
