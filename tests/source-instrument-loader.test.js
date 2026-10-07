import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeScoreServer,nativeStorageApp,nativeResponse,authoredScore} from './native-storage-app-fixtures.js';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {getAppI18n} from '../web/app-locale.js';
import {SourceInstrumentDetailsLoader} from '../web/source-instrument-loader.js';

const hash='a'.repeat(64);
const score=(id='first')=>({id,source:{format:'midi-base64',content:'retained'},parts:[{id:'part-a'},{id:'part-b'}]});
const response=(sourceScore,extra={})=>({request_sha256:createHash('sha256').update(JSON.stringify(sourceScore)).digest('hex'),details:{revision:1,source_binding:{domain:'wmc-canonical-score-serde-json',serialization_revision:1,digest:hash},original_midi_sha256:hash,parts:sourceScore.parts.map(part=>({part_id:part.id,selection_status:'unknown'}))},...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('canonical details are fetched once from the complete original source, never pitch/progression views',async()=>{
 const original={score:score()},requests=[],loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push({path,body});return response(body);}});
 assert.equal(loader.read(original).sourceInstrumentDetailsStatus,'loading');
 const shifted={score:{...score(),parts:[{id:'part-a'}]},pitchView:{sourceView:original},practiceSelection:{part_ids:['part-a']},assistance:{human_targets:[]}};
 assert.equal(loader.read(shifted).sourceInstrumentDetailsToken,original.score);await flush();
 assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/source-instrument-details/canonical');assert.deepEqual(requests[0].body,original.score);assert.notEqual(requests[0].body,original.score);
 assert.equal(loader.read(shifted).sourceInstrumentDetailsStatus,'ready');assert.equal(loader.read(shifted).sourceInstrumentDetails.parts.length,2);
 assert.equal(loader.read(shifted).sourceInstrumentDetails.parts[0].selection_status,'unknown');
});

test('late A response cannot become B metadata, even with the same song/part IDs',async()=>{
 const a={score:score()},b={score:score()},first=deferred(),second=deferred();let calls=0,changes=0;
 const loader=new SourceInstrumentDetailsLoader({api:()=>++calls===1?first.promise:second.promise,onChange:()=>changes++});
 loader.read(a);loader.read(b);await flush();first.resolve(response(a.score));await flush();
 assert.equal(loader.read(b).sourceInstrumentDetailsStatus,'loading');assert.equal(loader.read(b).sourceInstrumentDetails,null);
 second.resolve(response(b.score));await flush();assert.equal(loader.read(b).sourceInstrumentDetailsStatus,'ready');assert.equal(changes,2);
});

test('absent, unsupported, loading and failed disclosure remain distinct and do not retry on redraw',async()=>{
 let calls=0;const loader=new SourceInstrumentDetailsLoader({api:async()=>{calls++;throw Object.assign(Error('metadata failed'),{code:'source_projection_mismatch'});}});
 assert.equal(loader.read(null).sourceInstrumentDetailsStatus,'absent');assert.equal(loader.read({score:{parts:[]}}).sourceInstrumentDetailsStatus,'absent');
 assert.equal(loader.read({score:{parts:[],source:{format:'musicxml'}}}).sourceInstrumentDetailsStatus,'unsupported');assert.equal(calls,0);
 const context={score:score()};assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'loading');await flush();
 for(let i=0;i<10;i++)assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(calls,1);
 const unsupportedLoader=new SourceInstrumentDetailsLoader({api:async()=>{throw Object.assign(Error('profile'),{code:'unsupported_source_profile'});}});
 unsupportedLoader.read(context);await flush();assert.equal(unsupportedLoader.read(context).sourceInstrumentDetailsStatus,'unsupported');
});

test('metadata rejects incomplete, duplicate, foreign parts and invalid source binding',async()=>{
 for(const corrupt of [r=>r.details.parts.pop(),r=>r.details.parts[1].part_id='part-a',r=>r.details.parts[1].part_id='foreign',r=>r.details.source_binding.digest='bad',r=>r.details.source_binding.domain='other']){
  const context={score:score()},result=response(context.score);corrupt(result);
  const loader=new SourceInstrumentDetailsLoader({api:async()=>result});loader.read(context);await flush();assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(loader.read(context).sourceInstrumentDetails,null);
 }
});

test('Basic native request carries original saved source and requires matching response descriptor',async()=>{
 const original={score:score(),cleanSong:{libraryKey:`native:song-${hash}`,identity:hash,profile:'wmh-basic-keys-midi1-v1',runtime:{rendition:{}}}},requests=[];
 const loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push({path,body});const result=response(original.score,{source:body.source});result.details.source_binding.domain='wmc-basic-complete-wire-json';return result;}});
 loader.read({score:score('shifted'),pitchView:{sourceView:original}});await flush();
 assert.equal(loader.read(original).sourceInstrumentDetailsStatus,'ready');assert.equal(requests[0].path,'/api/library/source-instrument-details');
 assert.deepEqual(requests[0].body,{source:{key:`song-${hash}`,content_sha256:hash,profile:'wmh-basic-keys-midi1-v1',choice:null,runtime_policy:'wmh-basic-key-rendition-fifo-v1'}});
 const mismatched=new SourceInstrumentDetailsLoader({api:async()=>response(original.score,{source:{...requests[0].body.source,content_sha256:'b'.repeat(64)}})});
 mismatched.read(original);await flush();assert.equal(mismatched.read(original).sourceInstrumentDetailsStatus,'error');
});


test('same part IDs with a foreign valid request digest are rejected',async()=>{
 const context={score:score()},foreign=response(score('other-source'));
 const loader=new SourceInstrumentDetailsLoader({api:async()=>foreign});loader.read(context);await flush();
 assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');
});

test('in-place mutation during disclosure cannot install old metadata',async()=>{
 const context={score:score()},pending=deferred(),requests=[];
 const loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push(body);return pending.promise;}});
 loader.read(context);await flush();context.score.source.content='changed in place';
 pending.resolve(response(requests[0]));await flush();
 assert.equal(loader.read(context).sourceInstrumentDetailsStatus,'error');assert.equal(loader.read(context).sourceInstrumentDetails,null);
 assert.equal(requests[0].source.content,'retained');assert.equal(requests.length,1);
});


test('peek keeps supported sources idle until explicit inspection and reuses cached original metadata',async()=>{
 const original={score:score()},requests=[],loader=new SourceInstrumentDetailsLoader({api:async(path,body)=>{requests.push(body);return response(body);}});
 for(let i=0;i<10;i++)assert.equal(loader.read(original,{load:false}).sourceInstrumentDetailsStatus,'idle');
 await flush();assert.equal(requests.length,0);
 assert.equal(loader.read({score:{parts:[]}},{load:false}).sourceInstrumentDetailsStatus,'absent');
 assert.equal(loader.read({score:{parts:[],source:{format:'musicxml'}}},{load:false}).sourceInstrumentDetailsStatus,'unsupported');
 loader.read(original);await flush();const shifted={score:score('shifted'),pitchView:{sourceView:original}};
 for(let i=0;i<10;i++)assert.equal(loader.read(shifted,{load:false}).sourceInstrumentDetailsStatus,'ready');
 loader.read(shifted);assert.equal(requests.length,1);
});

test('production app defers optional metadata until Mod opens and keeps late source results isolated',async()=>{
 // Transport/DOM fixture only; real endpoint/browser coverage is registered in full-app-browser.
 const a=authoredScore({id:'metadata-a',title:'Metadata A',source:{format:'midi-base64',content:'fixture-a'}}),b=authoredScore({id:'metadata-b',title:'Metadata B',source:{format:'midi-base64',content:'fixture-b'}});
 const server=await nativeScoreServer({scores:[a,b]}),held=deferred(),requests=[];
 const details=body=>{const value=response(body);value.details.parts=value.details.parts.map(part=>({...part,track_id:'track',source_attack_count:2,notated_note_count:2,key_range:{lowest:60,highest:64}}));value.details.tracks=[{id:'track',source_track_index:0,names:[{role:'instrument_name',utf8:body.title,channel_prefix_scope:'unscoped'}]}];return value;};
 server.setRoute(({path,body})=>{if(path==='/api/source-instrument-details/canonical'){requests.push(body);return body.id===a.id?held.promise:nativeResponse(details(body));}});
 const app=await nativeStorageApp(server),[keyA,keyB]=[...server.records.keys()];
 try{
  await app.until(()=>!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(keyA).click();await app.until(()=>app.$('preview-title').textContent===a.title&&!app.$('configure-song-mod').disabled);
  for(let i=0;i<3;i++){app.frame();await app.tick();}assert.equal(requests.length,0);
  await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage');assert.equal(requests.length,0,'Starting practice never asks for optional source metadata');await app.click('back-to-library');await app.until(()=>!app.$('configure-song-mod').disabled);
  await app.click('configure-song-mod');await app.until(()=>requests.length===1);const disclosure=app.document.querySelector('.song-mod-source-details');disclosure.open=true;app.emit(disclosure,'toggle');assert.match(app.$('song-mod-dialog').textContent,/Loading/);
  await app.click('song-mod-cancel');await app.click('configure-song-mod');await app.tick();assert.equal(requests.length,1);await app.click('song-mod-cancel');
  app.savedButton(keyB).click();await app.until(()=>app.$('preview-title').textContent===b.title&&!app.$('configure-song-mod').disabled);assert.equal(requests.length,1);
  await app.click('configure-song-mod');const nextDisclosure=app.document.querySelector('.song-mod-source-details');nextDisclosure.open=true;app.emit(nextDisclosure,'toggle');await app.until(()=>app.document.querySelector('.song-mod-source-details dl')?.textContent.includes(b.title));assert.equal(requests.length,2);
  held.resolve(nativeResponse(details(a)));await app.tick();assert.ok(app.document.querySelector('.song-mod-source-details dl').textContent.includes(b.title));assert.ok(!app.document.querySelector('.song-mod-source-details dl').textContent.includes(a.title));
  await app.click('song-mod-cancel');await app.click('configure-song-mod');await app.tick();assert.equal(requests.length,2);
 }finally{held.resolve(nativeResponse(details(a)));await app.close();}
});


test('unsupported clean profiles are cached without requesting or inspecting a source descriptor',async()=>{
 let calls=0;const loader=new SourceInstrumentDetailsLoader({api:async()=>{calls++;throw Error('Unsupported metadata must not be requested');}});
 for(const profile of ['wmh-vsq-clean-v1','wmh-clean-song-v2','future-unsupported-profile']){
  const song={profile,get libraryKey(){throw Error('Unsupported metadata must not inspect source identity');}},context={score:score(),cleanSong:song};
  for(const load of [false,true,true,false]){
   const value=loader.read(context,{load});assert.equal(value.sourceInstrumentDetailsStatus,'unsupported');assert.equal(value.sourceInstrumentDetailsToken,song);assert.equal(value.sourceInstrumentDetails,null);
  }
  assert.equal(loader.read({score:score('shifted'),pitchView:{sourceView:context}}).sourceInstrumentDetailsStatus,'unsupported');
 }
 await flush();assert.equal(calls,0);
});

test('production VSQ Mod edits and starts with honest unsupported disclosure and no metadata request',async()=>{
 const fixture=vsqAcceptanceFixture(),server=await nativeScoreServer(),opened=structuredClone(fixture.opened),key=fixture.key,before=opened.clean_package.score_json,requests=[];
 opened.entry={key,revision:1,title:fixture.metadata.title,composer:"",score_id:fixture.metadata.id,label:fixture.metadata.title,score_bytes:Buffer.byteLength(before),saved_at_unix_ms:1700000000000,clean_package:fixture.summary};server.records.set(key,opened);
 server.setRoute(({path})=>{
  if(path.includes('source-instrument-details')){requests.push(path);return nativeResponse({code:'unsupported_source_profile',error:'VSQ has no instrument disclosure'},422);}
  if(path==='/api/library/runtime')return nativeResponse(fixture.runtime);
 });
 const app=await nativeStorageApp(server);
 try{
  getAppI18n(app.document).setLocale('en');await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();
  await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');await app.click('vsq-choose-base-notes');await app.until(()=>!app.$('configure-song-mod').disabled);
  await app.click('configure-song-mod');const details=app.document.querySelector('.song-mod-source-details');details.open=true;app.emit(details,'toggle');await app.tick();
  assert.match(details.textContent,/This source format does not provide instrument details/);assert.match(details.textContent,/does not determine practice support/);assert.deepEqual(requests,[]);
  await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('start-performance').disabled,false);
  app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(app.$('session-mode').value,'listen');
  await app.click('edit-song-mod');await app.click('song-mod-all-human');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('session-mode').value,'practice');assert.equal(app.$('play-button').disabled,false);
  await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.deepEqual(requests,[]);assert.equal(server.records.get(key).clean_package.score_json,before);
 }finally{await app.close();}
});
