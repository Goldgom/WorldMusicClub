import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {admitPracticeAssistance} from '../web/practice-assistance-receipt.js';
import {createPracticeAssistanceDisplayIndex,practiceStageNotes,markPracticeNotation} from '../web/practice-stage-display.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {renderNotation} from '../web/music.js';
import {updateWrittenNoteHighlights} from '../web/performance-view.js';
import {buildBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {audioFixture,audioAssistanceFixture} from './practice-assistance-audio-fixtures.js';
import {basicKeyNotationPage} from '../web/basic-key-notation.js';
import {renderBasicKeyPage} from '../web/basic-key-numbered.js';

function selected(sourceToken,response){
  const native=Boolean(sourceToken.runtime),plan=response.checked.plan;
  const binding={source:native?response.source:null,sourceToken,runtimeToken:native?sourceToken.runtime:sourceToken.timeline,selection:plan.selection,mode:plan.mode,settings:plan.settings,revision:plan.revision,expected_selection_digest:plan.selection_digest};
  const assistance=admitPracticeAssistance(response,binding),sourceNotes=(sourceToken.compilation??sourceToken).timeline.notes;
  return{assistance,ownershipIndex:createPracticeAssistanceDisplayIndex({assistance,sourceNotes}),sourceNotes,humanNotes:assistance.human_targets.timeline.notes,binding};
}
function basic(){const fixture=audioFixture('assistance-native-basic');return{fixture,song:prepareCleanSong(`native:${fixture.source.key}`,fixture.opened.clean_package,JSON.parse(fixture.opened.score_json))};}
function notation(score,mode='jianpu'){
  const {document}=parseHTML('<html lang="en"><body><main></main></body></html>'),root=document.querySelector('main');root.innerHTML=renderNotation(score,mode,{allParts:true});
  return{root,sourceNotes:new Map(score.parts.flatMap(part=>part.notes.map(note=>[note.id,{note,partId:part.id}])))};
}

test('real canonical same-part split uses exact checked source roles and retains default notation bytes',()=>{
  const f=audioFixture('assistance-canonical'),before=JSON.stringify(f),display=selected(f.compilation,f.automatic),out=practiceStageNotes(display);
  assert.deepEqual(out.map(note=>[note.id,note.practice_role]),[['human-note','machine'],['machine-note','human']]);
  for(const mode of ['staff','jianpu']){
    const {root,sourceNotes}=notation(f.compilation.score,mode),musical=[...root.querySelectorAll('[data-note-id]')].map(node=>[node.dataset.noteId,node.innerHTML]);
    markPracticeNotation(root,{...display,sourceNotes,mode:'practice'});
    const human=root.querySelector('[data-note-id="machine-note"]'),machine=root.querySelector('[data-note-id="human-note"]');
    assert.equal(human.dataset.practiceRole,'human');assert.equal(machine.dataset.practiceRole,'machine');
    const cue=machine.querySelector('[data-practice-machine-cue]');assert.ok(cue);assert.equal(cue.getAttribute('stroke-dasharray'),'3 3');assert.equal(cue.getAttribute('fill'),'none');
    updateWrittenNoteHighlights(root,['human-note','machine-note']);assert.equal(machine.classList.contains('active'),false);assert.equal(human.classList.contains('active'),true);
    for(const[id,markup]of musical){const node=root.querySelector(`[data-note-id="${id}"]`);node.querySelector('[data-practice-machine-cue]')?.remove();assert.equal(node.innerHTML,markup,'The pitch, accidental, duration and clef strokes are unchanged');}
  }
  assert.equal(JSON.stringify(f),before);
});

test('real Basic source attacks absent from written notation retain falling roles without invented glyphs',()=>{
  const {fixture,song}=basic(),before=JSON.stringify(song),display=selected(song,fixture.explicit),view=notation(song.notation);
  assert.deepEqual(song.compilation.timeline.notes.map(note=>note.id),['midi-t1-e3','midi-t1-e4','midi-t1-e7','midi-t1-e8','midi-t1-e11','midi-t1-e13']);
  assert.deepEqual([...view.sourceNotes.keys()],['midi-t1-e7','midi-t1-e8','midi-t1-e13']);
  markPracticeNotation(view.root,{...display,sourceNotes:view.sourceNotes,mode:'practice'});
  assert.equal(view.root.querySelectorAll('[data-note-id]').length,3);
  for(const id of ['midi-t1-e3','midi-t1-e4','midi-t1-e11'])assert.equal(view.root.querySelector(`[data-note-id="${id}"]`),null);
  const roles=new Map(practiceStageNotes(display).map(note=>[note.id,note.practice_role]));assert.equal(roles.size,6);assert.equal(roles.get('midi-t1-e3'),'human');assert.equal(roles.get('midi-t1-e4'),'machine');assert.equal(roles.get('midi-t1-e11'),'machine');
  assert.equal(JSON.stringify(song),before);
});

test('real admitted Basic rendition page maps only emitted interval glyphs; synthetic and percussion stay event identities',()=>{
  const data=audioFixture('basic-key-rendition-notation-page'),descriptor=data.open.clean_package;
  const song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(descriptor.score_json).notation),before=JSON.stringify(data);
  const page=basicKeyNotationPage(data.melodic.response,data.melodic.request,song),f=audioAssistanceFixture(song,{partIds:song.notation.parts.map(part=>part.id),humanIds:[]});
  const ownershipIndex=createPracticeAssistanceDisplayIndex({assistance:f.assistance,sourceNotes:song.compilation.timeline.notes});
  const {document}=parseHTML('<html><body><main></main></body></html>'),root=document.querySelector('main');root.dataset.notationPartId=page.part_id;root.innerHTML=renderBasicKeyPage(page,'jianpu').html;
  markPracticeNotation(root,{assistance:f.assistance,ownershipIndex,mode:'practice'});
  assert.equal(root.querySelectorAll('[data-note-id]').length,page.score.parts[0].notes.length);
  for(const note of page.score.parts[0].notes){assert.equal(ownershipIndex.occurrenceRole(note.id),'machine');assert.equal(root.querySelector(`[data-note-id="${note.id}"]`).dataset.practiceRole,'machine');}
  for(const item of page.onsets)assert.equal(root.querySelector(`[data-note-id="${item.note_id}"]`),null);
  assert.equal(JSON.stringify(data),before);
});

test('real VSQ cross-scope physical unison remains entirely machine with the exact native clock',()=>{
  const fixture=audioFixture('assistance-native-vsq'),opened=audioFixture('vsq-clean-v1-native-open');
  const song=prepareVsqPractice(prepareCleanSong(`native:${fixture.source.key}`,opened.clean_package,JSON.parse(opened.score_json)),fixture.selected_runtime),before=JSON.stringify(song);
  const display=selected(song,fixture.narrow_scope),out=practiceStageNotes({...display,humanPartIds:new Set(fixture.narrow_scope.checked.plan.selection.selected_part_ids)});
  assert.deepEqual(out.map(note=>note.practice_role),['machine','machine']);
  assert.deepEqual(out.map(({practice_role,...note})=>note),song.compilation.timeline.notes);assert.equal(out[0].start_ms,0);assert.equal(out[1].start_ms,0);assert.equal(JSON.stringify(song),before);
  // Consumer-boundary negative fixture only: Rust never emits this split atom.
  const split=audioAssistanceFixture(song,{partIds:['vsq-track-1'],humanIds:['vsq-t1-ID#0001']});
  assert.throws(()=>createPracticeAssistanceDisplayIndex({assistance:split.assistance,sourceNotes:song.compilation.timeline.notes}),/physical keyboard unison/);
});

test('hiding assisted machine notes is display-only and cannot change native audio gates or source bytes',()=>{
  const {fixture,song}=basic(),display=selected(song,fixture.explicit),before=JSON.stringify(song);
  const options={sampleRate:48000,mode:'practice',practiceSelection:{kind:'parts',part_ids:display.assistance.plan.selection.selected_part_ids},assistance:display.assistance,assistanceContext:display.binding};
  const audio=buildBasicKeyAudioPlan(song,options),view=notation(song.notation,'staff');
  for(const settings of [{layout:'solo'},{showOthers:false},{hiddenPartIds:new Set(song.notation.parts.map(part=>part.id))}]){
    const out=practiceStageNotes({...display,...settings});assert.ok(out.every(note=>note.practice_role==='human'));
    markPracticeNotation(view.root,{...display,sourceNotes:view.sourceNotes,mode:'practice',...settings});
    if(!settings.hiddenPartIds)assert.ok([...view.root.querySelectorAll('.machine-note')].every(node=>node.classList.contains('practice-machine-hidden')));
    assert.deepEqual(buildBasicKeyAudioPlan(song,options),audio);
  }
  assert.equal(JSON.stringify(song),before);assert.equal(audio.notes.length,5);
});

test('complete cached ownership retains every tied source and repeated occurrence without scanning the source per frame',()=>{
  const evidence=audioFixture('canonical-audio-evidence'),source=evidence.compilation,partIds=source.score.parts.map(part=>part.id),humanIds=[...new Set(source.timeline.notes.filter(note=>note.midi===60).flatMap(note=>note.source_note_ids))];
  const before=JSON.stringify(source);let iterations=0;
  const originalNotes=source.timeline.notes,notes=new Proxy(originalNotes,{get(target,key,receiver){if(key===Symbol.iterator)iterations++;return Reflect.get(target,key,receiver);}});source.timeline.notes=notes;
  const f=audioAssistanceFixture(source,{partIds,humanIds});iterations=0;
  const ownershipIndex=createPracticeAssistanceDisplayIndex({assistance:f.assistance,sourceNotes:notes});assert.equal(iterations,1);
  for(let frame=0;frame<200;frame++){
    assert.equal(createPracticeAssistanceDisplayIndex({assistance:f.assistance,sourceNotes:notes}),ownershipIndex);
    for(const note of originalNotes){assert.equal(ownershipIndex.occurrenceRole(note.id),note.midi===60?'human':'machine');for(const id of note.source_note_ids)assert.equal(ownershipIndex.sourceRole(id,note.part_id),note.midi===60?'human':'machine');}
  }
  assert.equal(iterations,1);assert.ok(source.timeline.notes.some(note=>note.source_note_ids.length>1));assert.ok(new Set(source.timeline.notes.flatMap(note=>note.source_note_ids)).size<source.timeline.notes.flatMap(note=>note.source_note_ids).length);assert.equal(JSON.stringify(source),before);
});

test('unadmitted, partial, stale and conflicting ownership fails closed without a part-color fallback',()=>{
  const {fixture,song}=basic(),sourceNotes=song.compilation.timeline.notes,display=selected(song,fixture.explicit),fresh=()=>admitPracticeAssistance(fixture.explicit,display.binding);
  assert.throws(()=>createPracticeAssistanceDisplayIndex({assistance:structuredClone(display.assistance),sourceNotes}));
  for(const notes of [sourceNotes.slice(1),[...sourceNotes,sourceNotes[0]],sourceNotes.map((note,index)=>index?note:{...note,part_id:'wrong'})])assert.throws(()=>createPracticeAssistanceDisplayIndex({assistance:fresh(),sourceNotes:notes}),{code:'practice_assistance_display_identity'});
  assert.throws(()=>practiceStageNotes({...display,assistance:fresh()}),{code:'practice_assistance_display_identity'});
  assert.throws(()=>practiceStageNotes({...display,ownershipIndex:null}),{code:'practice_assistance_display_identity'});
  assert.throws(()=>practiceStageNotes({...display,humanNotes:[sourceNotes[1]]}),{code:'practice_assistance_display_identity'});
  const missing=audioAssistanceFixture(song,{partIds:song.notation.parts.map(part=>part.id),modify:response=>{response.checked.machine_occurrence_ids[0]='foreign-occurrence';}});
  assert.throws(()=>createPracticeAssistanceDisplayIndex({assistance:missing.assistance,sourceNotes}),/Every source occurrence/);
  const view=notation(song.notation);view.root.querySelector('[data-note-id]').dataset.noteId='foreign-source';markPracticeNotation(view.root,{...display,sourceNotes:view.sourceNotes,mode:'practice'});
  assert.ok([...view.root.querySelectorAll('[data-note-id]')].every(node=>node.dataset.practiceRole==='unavailable'));
  updateWrittenNoteHighlights(view.root,[...view.sourceNotes.keys(),'foreign-source']);assert.equal(view.root.querySelectorAll('.active').length,0);
});

test('machine distinction has a noncolor cue and preserves open heads and duration strokes',()=>{
  const css=readFileSync(new URL('../web/clean-song.css',import.meta.url),'utf8');
  assert.match(css,/note-head:not\(\.open-head\)/);assert.match(css,/engraving-machine-cue\{[^}]*border-style:dashed/);
  const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');assert.match(app,/setLineDash\(machine\?\[5,4\]:\[\]\)/);
  const text=readFileSync(new URL('../web/practice-assistance-locales.js',import.meta.url),'utf8');assert.match(text,/Human · play and score/);assert.match(text,/Machine · striped accompaniment/);
});
