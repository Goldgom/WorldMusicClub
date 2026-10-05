import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeOptions,canonicalDisplayNotes} from '../web/canonical-practice-session.js';
import {nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';

test('canonical transformations preserve a complete multi-part human selection and legacy All anchor',()=>{
  const parts=[{id:'lead'},{id:'harmony'},{id:'bass'}],selection={kind:'parts',part_ids:['bass','lead']};
  const copy=canonicalPracticeOptions(parts,{practiceSelection:selection,practiceLayout:'complete',showOthers:false});
  assert.deepEqual(copy,{part:'lead',practiceSelection:{kind:'parts',part_ids:['lead','bass']},practiceLayout:'complete',showOthers:false});
  assert.equal(canonicalPracticeOptions(parts,{practiceSelection:{kind:'all'}}).part,null);
  assert.deepEqual(selection.part_ids,['bass','lead']);
  assert.throws(()=>canonicalPracticeOptions(parts.slice(1),{practiceSelection:selection}),/existing human parts/);
});

test('canonical accompaniment display clips crossing ties at both loop boundaries and excludes B onsets',()=>{
  const timeline={duration_ms:5000,notes:[{id:'crossing',source_note_ids:['tie-a','tie-b'],part_id:'bass',start_ms:500,duration_ms:3000},{id:'at-b',part_id:'bass',start_ms:2500,duration_ms:1000}]};
  const before=structuredClone(timeline),notes=canonicalDisplayNotes(timeline,{start_ms:1000,end_ms:2500});
  assert.deepEqual(notes,[{...timeline.notes[0],start_ms:1000,duration_ms:1500}]);
  assert.deepEqual(timeline,before);
});

test('canonical Complete popup supports subset, cancel, explicit All and silent full-source practice',async()=>{
  const score=originalMultipartNotation({partCount:3,measures:4}),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server,{now:()=>1000});
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);
    await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-complete-practice').disabled);
    await app.click('sound-button');await app.click('start-complete-practice');
    const boxes=[...app.$('complete-practice-parts').querySelectorAll('input')];boxes[1].checked=false;app.emit(boxes[1],'change');
    await app.click('complete-practice-apply');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('play-button').textContent.includes('Pause'));
    await app.click('play-button');let take=await app.exported('export-takes');
    assert.deepEqual(take.practice_selection,{kind:'parts',part_ids:[score.parts[0].id,score.parts[2].id]});
    assert.equal(take.view_configuration.practice_layout,'complete');assert.deepEqual(take.passes[0].inputs,[]);
    assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id!==score.parts[1].id));
    await app.click('edit-complete-practice');await app.click('complete-practice-all');await app.click('complete-practice-cancel');
    take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.practice_selection.kind,'parts');
    await app.click('edit-complete-practice');await app.click('complete-practice-all');await app.click('complete-practice-apply');await app.until(()=>!app.$('play-button').disabled);
    await app.click('play-button');take=await app.exported('export-takes');
    assert.equal(take.practice_selection.kind,'all');assert.equal(take.practice_part,null);assert.deepEqual(take.practice_selection.part_ids,score.parts.map(part=>part.id));
    assert.deepEqual(app.plays,[],'Automatic notes never enter the manual Synth input path');
  }finally{await app.close();}
});
