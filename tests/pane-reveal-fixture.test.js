import test from 'node:test';
import assert from 'node:assert/strict';
import {originalPaneRevealStudy,choosePaneRevealTarget,paneRevealSourceIdsAt} from './pane-reveal-fixture.js';

test('original reveal fixture retains six duplicate-labelled measures while adding genuine multi-system notation pressure',()=>{
  const score=originalPaneRevealStudy(),notes=score.parts[0].notes;
  assert.equal(score.measures.length,6);assert.ok(score.measures.every(measure=>measure.number===7));assert.equal(score.tempo[0].bpm,120);
  assert.equal(notes.length,192);assert.equal(new Set(notes.map(note=>note.id)).size,192);
  for(let index=0;index<notes.length;index++){assert.equal(notes[index].at.numerator/notes[index].at.denominator,index/8);assert.equal(notes[index].duration.numerator/notes[index].duration.denominator,1/8);assert.equal(notes[index].tie_start,false);assert.equal(notes[index].tie_stop,false);}
  assert.equal(notes.at(-1).at.numerator/8+1/8,24,'The real source duration stays twelve seconds at 120 BPM');
  const second=originalPaneRevealStudy();notes[0].pitch.step='F';assert.equal(second.parts[0].notes[0].pitch.step,'C','Fixture calls own independent source objects');
});

test('a reveal target requires observed vertical exclusion and independent source timing',()=>{
  const compilation={timeline:{duration_ms:12000,notes:[{source_note_ids:['early'],start_ms:1000,duration_ms:250},{source_note_ids:['visible'],start_ms:6500,duration_ms:250},{source_note_ids:['later'],start_ms:8000,duration_ms:500},{source_note_ids:['end'],start_ms:11900,duration_ms:100}]}};
  const marker=(sourceNoteId,top,measure)=>({sourceNoteId,top,measure,height:10}),geometry={viewport:{top:100,bottom:260},markers:[marker('early',400,0),marker('visible',200,3),marker('invented',450,3),marker('end',480,5),marker('later',420,4)]};
  assert.deepEqual(choosePaneRevealTarget(compilation,geometry),{...geometry.markers[4],startMs:8000,endMs:8500});
  assert.equal(choosePaneRevealTarget(compilation,{...geometry,markers:geometry.markers.slice(0,4)}),null,'Neither source ordinal, an unknown ID nor a visible cue can substitute for the real later target');
  assert.deepEqual(paneRevealSourceIdsAt(compilation,7999),[]);assert.deepEqual(paneRevealSourceIdsAt(compilation,8000),['later']);assert.deepEqual(paneRevealSourceIdsAt(compilation,8499),['later']);assert.deepEqual(paneRevealSourceIdsAt(compilation,8500),[],'Paused cue ownership uses the independently compiled half-open interval');
});
