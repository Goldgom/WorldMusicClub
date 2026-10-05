import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';

const renderedParts=app=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]');
const lastTargets=app=>app.requests.filter(request=>request.path==='/api/practice-targets').at(-1).body.timeline;
async function startOriginalPractice(app,server,partCount){
 const key=[...server.records.keys()][0];
 await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);
 await app.click('home-single-player');app.savedButton(key).click();
 await app.until(()=>!app.$('start-practice').disabled&&app.$('preview-part').options.length===partCount+1);
 await app.click('sound-button');await app.click('start-practice');
 await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);
 if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
 await app.click('jianpu-button');
}
async function selectHumanPart(app,partId){
 app.$('practice-part').value=partId;app.emit(app.$('practice-part'),'change');
 await app.until(()=>!app.$('play-button').disabled);
}

// Production application with a Node DOM and in-memory native protocol only.
// This original authored exercise never opens a browser, server or user library.
test('legacy All parts selection keeps its control, human targets and Current notation in agreement',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4});
 // Two authored parts share one exact opening attack. This fixed protocol
 // response represents Rust's physical target dedupe, retaining both sources.
 score.parts[1].notes[0].pitch=structuredClone(score.parts[0].notes[0].pitch);
 const before=JSON.stringify(score),server=await nativeScoreServer({scores:[score]});
 server.setRoute(({path,body})=>{
  if(path!=='/api/practice-targets'||body.timeline.notes.length!==4)return;
  const [first,second]=score.parts.map(part=>body.timeline.notes.find(note=>note.id===part.notes[0].id));
  if(!first||!second)return;
  const notes=body.timeline.notes.filter(note=>note.id!==second.id).map(note=>note.id===first.id?{...note,source_note_ids:[first.id,second.id]}:note);
  return nativeResponse({timeline:{...body.timeline,notes},groups:notes.map(note=>note.id===first.id?{target_id:first.id,source_occurrence_ids:[first.id,second.id],source_note_ids:[first.id,second.id],part_ids:score.parts.map(part=>part.id)}:{target_id:note.id,source_occurrence_ids:[note.id],source_note_ids:[note.id],part_ids:[note.part_id]}),diagnostics:[],source_note_count:4,target_count:3,playable:true});
 });
 const app=await nativeStorageApp(server,{now:()=>1000});
 try{
  await startOriginalPractice(app,server,score.parts.length);
  assert.equal(app.$('practice-part').value,'');
  assert.deepEqual(renderedParts(app),score.parts.map(part=>part.id),'Initial all-human Current notation contains both parts');
  await selectHumanPart(app,score.parts[1].id);
  assert.equal(app.$('practice-part').value,score.parts[1].id);
  assert.deepEqual(renderedParts(app),[score.parts[1].id]);
  assert.equal(app.$('notation-scope').value,'current');assert.equal(app.$('notation-scope').disabled,true);
  assert.deepEqual(lastTargets(app).notes.map(note=>note.id),score.parts[1].notes.map(note=>note.id));
  await selectHumanPart(app,'');
  const targetIds=lastTargets(app).notes.map(note=>note.id);
  assert.deepEqual(targetIds.toSorted(),score.parts.flatMap(part=>part.notes.map(note=>note.id)).toSorted(),'All retained source targets remain human');
  assert.equal(app.$('practice-part').value,'','All parts remains selected instead of silently displaying the first part');
  assert.match(app.$('practice-scope').textContent,/All parts/);
  assert.equal(app.$('notation-scope').value,'current');assert.equal(app.$('notation-scope').disabled,true);
  assert.deepEqual(renderedParts(app),score.parts.map(part=>part.id));
  assert.equal(app.$('notation').querySelectorAll('[data-note-id^="original-held-"]').length,2);
  assert.equal(app.$('notation').querySelectorAll('[data-practice-role="machine"]').length,0);
  await app.click('play-button');
  await app.until(()=>!app.$('export-takes').disabled);
  const take=await app.exported('export-takes');
  assert.equal(take.practice_part,null);
  assert.deepEqual(take.practice_selection,{kind:'all',part_ids:score.parts.map(part=>part.id)});
  assert.equal(take.target_plan.source_note_count,4);assert.equal(take.target_plan.target_count,3);
  assert.equal(take.passes[0].timeline.notes.length,3,'One physical opening attack represents both source parts');
  assert.deepEqual(take.target_plan.groups[0].source_note_ids,score.parts.map(part=>part.notes[0].id));
  assert.deepEqual(take.target_plan.groups[0].part_ids,score.parts.map(part=>part.id));
  const calls=app.requests.length;
  getAppI18n(app.document).setLocale('zh-CN');
  assert.equal(app.$('practice-part').value,'');assert.match(app.$('practice-scope').textContent,/所有声部/);
  assert.deepEqual(await app.exported('export-takes'),take,'Locale redraw preserves the complete human take and target provenance');
  assert.equal(app.requests.length,calls);
  assert.equal(JSON.stringify(score),before);
 }finally{await app.close();}
});

test('legacy all-human Current notation reaches every part page and solo reselect restores one human part',async()=>{
 const score=originalMultipartNotation({partCount:6,measures:4}),before=JSON.stringify(score),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server,{now:()=>1000});
 try{
  await startOriginalPractice(app,server,score.parts.length);
  await selectHumanPart(app,score.parts[5].id);await selectHumanPart(app,'');
  assert.equal(app.$('notation-scope').value,'current');
  assert.deepEqual(renderedParts(app),score.parts.slice(0,4).map(part=>part.id));
  const targets=structuredClone(lastTargets(app)),calls=app.requests.length;
  await app.click('notation-parts-next');
  assert.deepEqual(renderedParts(app),score.parts.slice(4).map(part=>part.id));
  assert.equal(app.$('notation-parts-next').disabled,true);assert.equal(app.$('practice-part').value,'');
  assert.deepEqual(lastTargets(app),targets);assert.equal(app.requests.length,calls,'Notation part paging never recompiles or changes scoring');
  app.$('session-mode').value='listen';app.emit(app.$('session-mode'),'change');
  assert.equal(app.$('notation-scope').disabled,false);
  app.$('notation-scope').value='current';app.emit(app.$('notation-scope'),'change');
  assert.deepEqual(renderedParts(app),score.parts.slice(0,4).map(part=>part.id));
  app.$('session-mode').value='practice';app.emit(app.$('session-mode'),'change');
  await selectHumanPart(app,score.parts[5].id);
  assert.equal(app.$('practice-part').value,score.parts[5].id);
  assert.equal(app.$('notation-scope').value,'current');assert.equal(app.$('notation-scope').disabled,true);
  assert.deepEqual(renderedParts(app),[score.parts[5].id]);assert.equal(app.$('notation-parts-next').disabled,true);
  app.$('notation-scope').value='all';app.emit(app.$('notation-scope'),'change');
  assert.equal(app.$('notation-scope').value,'current','A stale wider view request cannot override solo human ownership');
  assert.deepEqual(renderedParts(app),[score.parts[5].id]);
  assert.deepEqual(lastTargets(app).notes.map(note=>note.id),score.parts[5].notes.map(note=>note.id));
  assert.equal(JSON.stringify(score),before);
 }finally{await app.close();}
});
