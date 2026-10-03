import {waitForTestCondition} from './async-test-wait.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCleanSong,isCleanSong} from '../web/clean-song-package.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {cleanDescriptor,cleanSong,fixtureKey,mediaFixture} from './clean-song-fixtures.js';
import {nativeScoreServer,nativeResponse} from './native-storage-app-fixtures.js';

test('native complete descriptor binds full parts, source-free notation and exact clock',()=>{const song=cleanSong();assert.ok(isCleanSong(song));assert.equal(song.score.performance.tracks.length,3);assert.equal(song.runtime.notes.length,5);assert.equal(song.runtime.duration_ms,1800);assert.equal(song.runtime.notes.at(-1).end_ms-song.runtime.notes.at(-1).start_ms,800);assert.equal(song.score.notation.source,null);assert.ok(Object.isFrozen(song.runtime.notes));assert.equal(isCleanSong(structuredClone(song)),false);});
test('raw optional defaults and JSON ordering use normalized native score equality',()=>{const descriptor=cleanDescriptor(({score})=>{delete score.notation.source;delete score.notation.composer;});const normalized=descriptor.runtime.compilation.score;assert.ok(prepareCleanSong(fixtureKey,descriptor,Object.fromEntries(Object.entries(normalized).reverse())));});
test('wrong package identity, canonical mutation, missing notes and path handles are rejected',()=>{for(const mutate of [d=>d.content_sha256='d'.repeat(64),d=>d.runtime.compilation.score.title='Changed',d=>d.runtime.notes.pop(),d=>d.runtime.notes[0].channel=5]){const d=cleanDescriptor(),score=structuredClone(d.runtime.compilation.score);mutate(d);assert.throws(()=>prepareCleanSong(fixtureKey,d,score),error=>error.code==='clean_package_invalid');}});
test('native media fetch requires admitted handle, matching MIME size and digest',async()=>{const asset=mediaFixture(),d=cleanDescriptor(({metadata})=>metadata.media.push(asset.descriptor)),score=d.runtime.compilation.score,server=await nativeScoreServer();const key=fixtureKey.slice(7);server.records.set(key,{entry:{key,revision:1,title:score.title,composer:'',score_id:score.id,label:score.title,score_bytes:JSON.stringify(score).length,saved_at_unix_ms:1700000000000,clean_package:{version:2}},score_json:JSON.stringify(score),clean_package:d});let corrupt=false;
server.setRoute(({path})=>path==='/api/library/asset'?{ok:true,url:'https://wmh.localhost/api/library/asset',redirected:false,headers:{get:()=>asset.descriptor.mime},arrayBuffer:async()=>Uint8Array.from(corrupt?Buffer.from('bad'):asset.data).buffer}:undefined);
const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>true});await assert.rejects(storage.loadAsset(fixtureKey,d.media[0].handle));const loaded=await storage.load(fixtureKey);assert.ok(loaded.cleanSong);const blob=await storage.loadAsset(fixtureKey,d.media[0].handle);assert.equal(await blob.text(),'authored-media');corrupt=true;await assert.rejects(storage.loadAsset(fixtureKey,d.media[0].handle));await assert.rejects(storage.exportBackup(),error=>error.code==='clean_pack_export_required');storage.close();});

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=predicate=>waitForTestCondition(predicate,{label:'Asset transport did not settle'});
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

/** The native Windows permit stays held until response bytes finish, not merely
 * until fetch returns headers. Concurrent admission gets a real 503 response. */
async function assetTransport({failures=[]}={}){
 const media=[mediaFixture(),mediaFixture({id:'background',role:'background',content:'authored-background'}),mediaFixture({id:'pv',role:'pv',mime:'video/mp4',content:'authored-pv'})];
 const descriptor=cleanDescriptor(({metadata})=>metadata.media.push(...media.map(item=>item.descriptor)));
 const score=descriptor.runtime.compilation.score,key=fixtureKey.slice(7),server=await nativeScoreServer();
 const record={entry:{key,revision:1,title:score.title,composer:'',score_id:score.id,label:score.title,score_bytes:JSON.stringify(score).length,saved_at_unix_ms:1700000000000,clean_package:{version:2}},score_json:JSON.stringify(score),clean_package:descriptor};
 server.records.set(key,record);
 const jobs=[];let active=0,busy=0,maxActive=0;
 server.setRoute(async({path,body,options})=>{
  if(path!=='/api/library/asset')return;
  if(active){busy++;return{...nativeResponse({code:'pack_busy'},503),arrayBuffer:async()=>new ArrayBuffer(0)};}
  active++;maxActive=Math.max(maxActive,active);
  const asset=media.find(item=>`asset-${item.descriptor.sha256}`===body.handle);
  const job={headers:gate(),body:gate(),options,handle:body.handle,...failures[jobs.length]};jobs.push(job);
  await job.headers.promise;
  if(job.fetchError){active--;throw new Error('Native response lost');}
  return{ok:!job.status||job.status===200,status:job.status||200,redirected:job.redirected||false,url:job.url||'https://wmh.localhost/api/library/asset',headers:{get:()=>job.mime||asset.descriptor.mime},
   arrayBuffer:async()=>{try{await job.body.promise;if(job.bodyError)throw new Error('Native response interrupted');return Uint8Array.from(job.data||asset.data).buffer;}finally{active--;}}};
 });
 const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>true});await storage.load(fixtureKey);
 return{storage,server,record,media,jobs,stats:()=>({active,busy,maxActive}),read:(index,options)=>storage.loadAsset(fixtureKey,descriptor.media[index].handle,options),finish:index=>{jobs[index].headers.resolve();jobs[index].body.resolve();}};
}

test('cover, background and PV share one async native asset permit through complete response bodies',async()=>{
 const h=await assetTransport();
 try{
  const all=Promise.all([h.read(0),h.read(1),h.read(2)]);
  assert.equal(h.jobs.length,1);h.jobs[0].headers.resolve();await tick();
  assert.equal(h.jobs.length,1,'Headers must not release native admission');
  // A fresh, identical validated load must not revoke unchanged opaque assets.
  await h.storage.load(fixtureKey);
  h.jobs[0].body.resolve();await until(()=>h.jobs.length===2);h.finish(1);
  await until(()=>h.jobs.length===3);h.finish(2);
  const blobs=await all;
  assert.deepEqual(await Promise.all(blobs.map(blob=>blob.text())),h.media.map(item=>item.data.toString()));
  assert.deepEqual(blobs.map(blob=>blob.type),h.media.map(item=>item.descriptor.mime));
  assert.deepEqual(h.stats(),{active:0,busy:0,maxActive:1});
  for(const job of h.jobs){assert.equal(job.options.signal,undefined);assert.equal(job.options.credentials,'same-origin');assert.equal(job.options.redirect,'error');assert.equal(job.options.cache,'no-store');}
 }finally{h.storage.close();}
});

test('asset transport releases genuine read failures without retries and still verifies the next asset',async()=>{
 const failures=[
  [{status:503},'clean_asset_read'],[{redirected:true},'clean_asset_read'],[{url:'https://other.example/asset'},'clean_asset_read'],
  [{mime:'text/plain'},'clean_asset_type'],[{data:Buffer.from('short')},'clean_asset_size'],
  [{data:Buffer.from('corrupt!-media')},'clean_asset_hash'],[{fetchError:true},undefined],[{bodyError:true},undefined]
 ];
 for(const [failure,code]of failures){
  const h=await assetTransport({failures:[failure]});
  try{
   const first=outcome(h.read(0)),second=h.read(2);h.finish(0);
   await until(()=>h.jobs.length===2);h.finish(1);
   const {error}=await first,blob=await second;assert.ok(error);if(code)assert.equal(error.code,code);
   assert.equal(await blob.text(),'authored-pv');assert.equal(h.jobs.length,2,'A failed read must not be retried');
   assert.deepEqual(h.stats(),{active:0,busy:0,maxActive:1});
  }finally{h.storage.close();}
 }
});

test('aborting active and queued reads prevents stale results without releasing a native permit early',async()=>{
 const h=await assetTransport(),active=new AbortController(),queued=new AbortController();
 try{
  const first=outcome(h.read(0,{signal:active.signal})),cancelled=outcome(h.read(1,{signal:queued.signal})),last=h.read(2);
  active.abort();queued.abort();
  assert.equal((await cancelled).error.name,'AbortError');await tick();assert.equal(h.jobs.length,1);
  h.jobs[0].headers.resolve();await tick();assert.equal(h.jobs.length,1,'Abort cannot start another native request while the body is pending');
  h.jobs[0].body.resolve();assert.equal((await first).error.name,'AbortError');
  await until(()=>h.jobs.length===2);assert.equal(h.jobs[1].handle,`asset-${h.media[2].descriptor.sha256}`);h.finish(1);
  assert.equal(await(await last).text(),'authored-pv');assert.equal(h.stats().busy,0);
 }finally{h.storage.close();}
});

test('closing storage rejects waiting reads and suppresses an already admitted response',async()=>{
 const h=await assetTransport(),first=outcome(h.read(0)),queued=outcome(h.read(1));
 h.storage.close();assert.equal((await queued).error.code,'library_storage_closed');
 await assert.rejects(h.read(2),error=>error.code==='library_storage_closed');
 h.finish(0);assert.equal((await first).error.code,'library_storage_closed');await tick();
 assert.equal(h.jobs.length,1);assert.equal(h.stats().active,0);
});

test('changed package admission invalidates both active and waiting stale handles before returning media',async()=>{
 const h=await assetTransport();
 try{
  const first=outcome(h.read(0)),stale=outcome(h.read(1)),last=h.read(2);
  h.record.clean_package=cleanDescriptor(({metadata})=>metadata.media.push(h.media[2].descriptor));
  await h.storage.load(fixtureKey);h.finish(0);
  assert.equal((await first).error.code,'clean_asset_identity');assert.equal((await stale).error.code,'clean_asset_identity');
  await until(()=>h.jobs.length===2);h.finish(1);assert.equal(await(await last).text(),'authored-pv');
  assert.equal(h.jobs.length,2);assert.equal(h.stats().busy,0);
 }finally{h.storage.close();}
});

test('asset waiting queue is bounded and cancelled entries free capacity without native dispatch',async()=>{
 const h=await assetTransport(),first=outcome(h.read(0)),controllers=Array.from({length:32},()=>new AbortController());
 const pending=controllers.map(controller=>outcome(h.read(1,{signal:controller.signal})));
 await assert.rejects(h.read(2),error=>error.code==='clean_asset_queue_limit');
 controllers[0].abort();assert.equal((await pending[0]).error.name,'AbortError');
 const replacement=outcome(h.read(2));
 const alreadyAborted=new AbortController();alreadyAborted.abort();
 await assert.rejects(h.read(1,{signal:alreadyAborted.signal}),error=>error.name==='AbortError');
 h.storage.close();h.finish(0);
 assert.equal((await first).error.code,'library_storage_closed');assert.equal((await replacement).error.code,'library_storage_closed');
 assert.ok((await Promise.all(pending.slice(1))).every(result=>result.error.code==='library_storage_closed'));
 assert.equal(h.jobs.length,1);assert.equal(h.stats().active,0);
});
