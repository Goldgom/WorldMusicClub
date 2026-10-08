import test from 'node:test';
import assert from 'node:assert/strict';
import {identityContext,identityResponse,numericResponse} from './source-identity-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';

function seed(server,context){
 const opened=context.opened,descriptor=opened.clean_package,score=context.score,key=`song-${descriptor.content_sha256}`;
 const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
 server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(descriptor.score_json),saved_at_unix_ms:1700000000000,clean_package:summary}});return key;
}
function renamedContext(){
 const context=identityContext(),source=context.cleanSong.score,descriptor=context.opened.clean_package,metadata=JSON.parse(descriptor.metadata_json),identity='b'.repeat(64);
 source.notation.title='Independent Basic B';metadata.title=source.notation.title;descriptor.content_sha256=identity;descriptor.score_json=JSON.stringify(source);descriptor.metadata_json=JSON.stringify(metadata);
 Object.assign(context.cleanSong,{identity,libraryKey:`native:song-${identity}`,score_json:descriptor.score_json});return context;
}
function showDetails(app){for(const details of app.document.querySelectorAll('.song-mod-source-details')){details.open=true;app.emit(details,'toggle');}}
const summaries=app=>[...app.document.querySelectorAll('.song-mod-source-details summary')].map(node=>node.textContent).join('\n');
const counts=(requests,path)=>requests.filter(row=>row.path===path).length;

test('production Basic Mod isolates late equal-part-ID identity through Cancel, reopen and source switch',async()=>{
 const a=identityContext(),b=renamedContext(),server=await nativeScoreServer(),keyA=seed(server,a),keyB=seed(server,b),pending=deferred(),requests=[];
 const originalA=server.records.get(keyA).clean_package.score_json,originalB=server.records.get(keyB).clean_package.score_json;
 server.setRoute(({path,body})=>{
  if(path==='/api/library/source-identity'){requests.push({path,body});return body.source.key===keyA?pending.promise:nativeResponse(identityResponse(b,{known:true}));}
  if(path==='/api/library/source-instrument-details'){requests.push({path,body});return nativeResponse(numericResponse(body.source.key===keyA?a:b));}
 });
 const app=await nativeStorageApp(server);
 try{
  await app.until(()=>app.savedButton(keyA));await app.click('home-single-player');app.savedButton(keyA).click();await app.until(()=>!app.$('configure-song-mod').disabled&&app.$('preview-title').textContent===a.score.title);
  for(let i=0;i<8;i++){app.frame();await app.tick();}assert.equal(requests.length,0,'Optional identity and numeric disclosure wait for Mod inspection');
  await app.click('configure-song-mod');showDetails(app);await app.until(()=>counts(requests,'/api/library/source-identity')===1);assert.match(app.$('song-mod-dialog').textContent,/Loading/);
  await app.click('song-mod-all-machine');const draft=[...app.document.querySelectorAll('[data-mod-performer]')].map(node=>node.value);
  await app.click('song-mod-cancel');await app.click('configure-song-mod');await app.tick();assert.equal(counts(requests,'/api/library/source-identity'),1);await app.click('song-mod-cancel');
  app.savedButton(keyB).click();await app.until(()=>app.$('preview-title').textContent===b.score.title&&!app.$('configure-song-mod').disabled,'Independent Basic B did not become ready');await app.click('configure-song-mod');showDetails(app);await app.until(()=>summaries(app).includes('Acoustic Grand Piano'),'Independent Basic B identity did not render');
  const before=summaries(app);pending.resolve(nativeResponse(identityResponse(a)));await app.tick();await app.tick();assert.equal(summaries(app),before,'Late A result cannot repaint B despite identical part IDs');
  await app.click('song-mod-cancel');await app.click('configure-song-mod');await app.tick();assert.equal(counts(requests,'/api/library/source-identity'),2);assert.match(summaries(app),/Acoustic Grand Piano/);
  getAppI18n(app.document).setLocale('zh-CN');assert.match(summaries(app),/原始乐器/);assert.match(summaries(app),/Acoustic Grand Piano/);
  assert.equal(server.records.get(keyA).clean_package.score_json,originalA);assert.equal(server.records.get(keyB).clean_package.score_json,originalB);assert.equal(app.$('start-performance').disabled,false);assert.ok(draft.length===0||draft.every(value=>value==='machine'));
 }finally{pending.resolve(nativeResponse(identityResponse(a)));await app.close();}
});

for(const mode of ['identity404','identity413','numeric503'])test(`production optional ${mode} keeps the other source disclosure and practice ready`,async()=>{
 const context=identityContext(),server=await nativeScoreServer(),key=seed(server,context),requests=[],before=JSON.stringify(context.opened.clean_package);
 server.setRoute(({path,body})=>{
  if(path==='/api/library/source-identity'){requests.push({path,body});return mode==='numeric503'?nativeResponse(identityResponse(context,{known:true})):nativeResponse({code:mode==='identity404'?'not_found':'source_identity_response_limit',error:'Optional identity is unavailable'},mode==='identity404'?404:413);}
  if(path==='/api/library/source-instrument-details'){requests.push({path,body});return mode==='numeric503'?nativeResponse({code:'numeric_unavailable',error:'Optional numeric details are unavailable'},503):nativeResponse(numericResponse(context));}
 });
 const app=await nativeStorageApp(server);
 try{
  await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled&&app.$('preview-title').textContent===context.score.title);
  await app.click('configure-song-mod');showDetails(app);await app.until(()=>requests.length===2&&app.$('song-mod-dialog').textContent.includes('could not be loaded'));
  if(mode==='numeric503'){assert.match(summaries(app),/Acoustic Grand Piano/);assert.match(app.$('song-mod-dialog').textContent,/Analyzed source attacks/);}
  else{assert.match(summaries(app),/File metadata/);assert.match(app.$('song-mod-dialog').textContent,/MIDI channel/);assert.doesNotMatch(summaries(app),/Acoustic Grand Piano/);}
  await app.click('song-mod-cancel');await app.click('configure-song-mod');await app.tick();assert.equal(requests.length,2,'Optional failed endpoints are not retried on reopen');await app.click('song-mod-all-human');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('start-performance').disabled,false);
  assert.equal(JSON.stringify(server.records.get(key).clean_package),before,'Identity never changes saved source or runtime');
 }finally{await app.close();}
});
