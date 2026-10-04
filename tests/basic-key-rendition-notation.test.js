import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyNotationRequest,basicKeyNotationPage,basicKeyWrittenAt} from '../web/basic-key-notation.js';
import {renderBasicKeyPage} from '../web/basic-key-numbered.js';
import {createI18n} from '../web/i18n.js';

test('playable source-bound page requests explicitly bind the chosen rendition; source-only inspection is a separate request',()=>{
 const song=basicKeySong(),settings={partId:song.notation.parts[0].id,from:1,count:8,displayMeter:{numerator:4,denominator:4}};
 const playable=basicKeyNotationRequest(song,settings),source=basicKeyNotationRequest(song,{...settings,sourceOnly:true});assert.equal(playable.settings.rendition_policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(source.settings.rendition_policy_id,undefined);assert.deepEqual(playable.source,source.source);assert.equal(song.score_json,JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-native-open.json',import.meta.url),'utf8')).clean_package.score_json);
});

test('bounded numbered rendering keeps more than1000 simultaneous targets by batching instead of truncation',()=>{
 const score=structuredClone(basicKeySong().notation);score.parts=[score.parts[0]];score.parts[0].notes=Array.from({length:1001},(_,index)=>({...score.parts[0].notes[0],id:`original-${index}`}));
 const result=renderBasicKeyPage({score,interpreted_notes:[]},'jianpu',{width:800,numberedMode:'fixed',i18n:createI18n({locale:'en'})});assert.equal(result.renderedIds.length,1001);assert.equal(new Set(result.renderedIds).size,1001);assert.equal(result.fallback.length,0);for(const id of result.renderedIds)assert.ok(result.html.includes(`data-note-id="${id}"`));assert.doesNotMatch(result.html,/first 1,000/);
});

test('bounded numbered rendering includes later intervals beyond32beats and leaves synthetic/percussion markers unpitched',()=>{
 const score=structuredClone(basicKeySong().notation);score.parts=[score.parts[0]];score.parts[0].notes=[{...score.parts[0].notes[0],id:'first'}, {...score.parts[0].notes[0],id:'later',at:{numerator:40,denominator:1}}];
 const page={score,interpreted_notes:[{note_id:'synthetic',display_kind:'synthetic_onset'},{note_id:'drum',display_kind:'percussion_selector'}]},result=renderBasicKeyPage(page,'jianpu',{width:800,numberedMode:'fixed',i18n:createI18n({locale:'en'})});assert.deepEqual(result.renderedIds,['first','later']);assert.ok(result.html.includes('data-note-id="later"'));assert.doesNotMatch(result.html,/data-note-id="(synthetic|drum)"/);assert.equal(renderBasicKeyPage({score:null},'jianpu',{}).html,'');
});


function nativePages(name){const data=JSON.parse(readFileSync(new URL(`./fixtures/basic-key-rendition-notation-${name}.json`,import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,JSON.parse(descriptor.score_json).notation);return{data,song};}
test('actual native melodic, synthetic and percussion pages retain the exact complete target identities',()=>{
 const {data,song}=nativePages('page');
 for(const key of ['melodic','percussion']){const row=data[key],page=basicKeyNotationPage(row.response,row.request,song);assert.equal(page.view_version,2);assert.equal(page.rendition_policy_id,song.runtime.rendition.policy_id);assert.equal(page.interpreted_notes.length,key==='melodic'?3:1);}
 const page=basicKeyNotationPage(data.melodic.response,data.melodic.request,song),at=510,active=song.compilation.timeline.notes.filter(note=>note.start_ms<=at&&note.start_ms+note.duration_ms>at),written=basicKeyWrittenAt(song,page,at,active);assert.deepEqual(written.entries.map(entry=>entry.sourceNoteId),['midi-t1-e6','midi-t1-e8']);assert.equal(page.score.parts[0].notes.length,2);assert.equal(page.onsets[0].note_id,'midi-t1-e6');
 for(const mutate of [p=>p.rendition_policy_id='other',p=>p.interpreted_notes.pop(),p=>p.interpreted_notes[0].attack.event++,p=>p.interpreted_notes[0].end_exact.numerator='1',p=>p.interpreted_notes[0].key++,p=>p.onsets=[],p=>p.score.parts[0].notes.pop(),p=>p.score.parts[0].notes[1].pitch.octave++,p=>p.follow_end_ms++,p=>p.source_clock_available=false]){const response=structuredClone(data.melodic.response);mutate(response.page);assert.throws(()=>basicKeyNotationPage(response,data.melodic.request,song),{code:'basic_keys_notation_identity'});}
 const response=structuredClone(data.percussion.response);response.page.selectors=[];assert.throws(()=>basicKeyNotationPage(response,data.percussion.request,song),{code:'basic_keys_notation_identity'});
});

test('actual native synthetic onsets continue across fast bars and follow the terminal20ms gate',()=>{
 const {data,song}=nativePages('tail');for(const row of [...data.pages,data.tail])basicKeyNotationPage(row.response,row.request,song);
 for(const [index,position,ids]of [[0,1.5,['midi-t1-e3','midi-t1-e5']],[1,5,['midi-t1-e3']],[2,9,['midi-t1-e3']],[3,15,['midi-t1-e3','midi-t1-e7']],[3,33,['midi-t1-e7']]]){const row=data.pages[index],page=basicKeyNotationPage(row.response,row.request,song),active=song.compilation.timeline.notes.filter(note=>note.start_ms<=position&&note.start_ms+note.duration_ms>position),written=basicKeyWrittenAt(song,page,position,active);assert.deepEqual(written.entries.map(entry=>entry.sourceNoteId),ids);assert.equal(written.occurrence.end_ms,index===3?34:(index+1)*4);}
 const page=data.tail.response.page;assert.equal(page.source_end_ms,14);assert.equal(page.follow_end_ms,34);assert.equal(page.resolved_position_ms,33);assert.equal(page.onsets.length,2);assert.equal(page.score.parts[0].notes.length,0);
});
