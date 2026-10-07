import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,authoredScore,deferred} from './native-storage-app-fixtures.js';
import {importFile,importReport,importItem,selectImportFiles} from './bulk-import-fixtures.js';
import {keyboardGeometry} from '../web/music.js';
import {getAppI18n} from '../web/app-locale.js';
import {importDirectMidiFallback} from '../web/direct-midi-import.js';
import {createBulkImportTransport} from '../web/bulk-import.js';

// The original 117-byte consumer fixture, authored only for this repository.
// This is transport/DOM coverage; Rust source conversion is tested separately.
function originalMidi(){
  const tracks=[
    [0,176,0,7,0,192,42,0,176,74,91,0,144,60,90,96,128,60,0,0,144,64,90,0,128,64,0,0,144,67,90,0,255,47,0],
    [0,153,35,100,48,137,35,0,0,255,47,0],
    [96,144,72,80,96,128,72,0,0,255,47,0],
    [0,255,1,4,110,111,116,101,0,255,47,0],
  ];
  const bytes=Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,1,0,4,0,96]),...tracks.map(track=>Buffer.concat([Buffer.from([77,84,114,107,0,0,0,track.length]),Buffer.from(track)]))]);
  const source=JSON.parse(basicKeyRenditionFixture().clean_package.score_json).source;
  assert.equal(bytes.length,source.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
  return importFile('original-direct-midi.mid',bytes);
}

async function setup({canonical=false,rejectionStatus=400,invalid=false,blocked=false,existing=false,intercept}={}){
  const opened=blocked?JSON.parse(readFileSync(new URL('./fixtures/basic-keys-native-open.json',import.meta.url),'utf8')):basicKeyRenditionFixture(),descriptor=opened.clean_package;
  if(blocked){const full=JSON.parse(descriptor.score_json);full.performance.timing.relative_clock_available=false;descriptor.score_json=JSON.stringify(full);descriptor.runtime.compilation=null;}
  const score=JSON.parse(descriptor.score_json).notation,key=`song-${descriptor.content_sha256}`;
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  const entry={key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(descriptor.score_json),saved_at_unix_ms:1700000000000,clean_package:summary};
  const server=await nativeScoreServer();if(existing)server.records.set(key,{...opened,entry});
  const file=originalMidi(),strictReason='Overlapping MIDI notes make note-off pairing ambiguous',warnings=['Basic MIDI-key rendition uses FIFO/tempo interpretation; source sounds remain unresolved.'];
  server.setRoute(async request=>{
    const override=await intercept?.(request);if(override!==undefined)return override;
    const {path,body}=request;
    if(path==='/api/import/midi')return canonical?nativeResponse({score:authoredScore({id:'direct-canonical',title:'Original canonical MIDI'})}):nativeResponse({error:strictReason},rejectionStatus);
    if(path==='/api/library/import/preview'||path==='/api/library/import/commit'){
      assert.equal(body,file,'The native importer receives the original File object');
      const mode=path.endsWith('/commit')?'commit':'preview';
      const item=invalid?importItem({status:'retained_nonplayable',playable:false,code:'midi_parse_invalid',message:'Truncated MIDI track'}) :importItem({status:existing?'duplicate':mode==='commit'?'saved':'ready',entry:mode==='commit'||existing?entry:undefined,clean_package:summary,playable:!blocked});
      if(mode==='commit')server.records.set(key,{...opened,entry});
      return nativeResponse({...importReport(file,{mode,items:[item],sha256:JSON.parse(descriptor.score_json).source.sha256}),warnings});
    }
    if(path==='/api/instrument-check'){
      const geometry=keyboardGeometry(body.profile.key_count,body.profile.lowest_midi),low=geometry[0].midi,high=geometry.at(-1).midi;
      return nativeResponse({lowest_midi:low,highest_midi:high,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=low&&note.midi<=high,positions:[]})),diagnostics:[],changed_source_notes:false});
    }
  });
  const app=await nativeStorageApp(server,{now:()=>1000});await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');
  return{app,server,file,key,score,descriptor,strictReason};
}
const imports=app=>app.requests.filter(row=>row.path.startsWith('/api/library/import/'));
async function importBasic(value){selectImportFiles(value.app,[value.file]);await value.app.until(()=>value.app.savedButton(value.key)&&value.app.$('song-lobby').dataset.previewId===`native:${value.key}`&&value.app.$('song-lobby').dataset.previewStatus!=='loading','Raw MIDI fallback was not admitted');}

test('raw MIDI strict rejection saves the complete original through native import and admits normal Start without canonical recompile',async()=>{
  const value=await setup(),{app,server,file,key,score,descriptor,strictReason}=value;
  try{
    const before=app.requests.filter(row=>row.path==='/api/compile').length,source=descriptor.score_json;
    await importBasic(value);await app.until(()=>!app.$('start-practice').disabled);
    assert.deepEqual(imports(app).map(row=>row.path),['/api/library/import/preview','/api/library/import/commit']);
    assert.equal(app.requests.some(row=>row.path==='/api/library/save'),false);assert.equal(app.requests.filter(row=>row.path==='/api/compile').length,before);
    assert.match(app.$('notice-message').textContent,/FIFO/);assert.ok(app.$('notice-message').textContent.includes(strictReason));assert.equal(app.document.querySelector('dialog[open]'),null);
    assert.equal(app.$('export-takes').disabled,true);assert.equal(app.$('play-button').disabled,true,'Importing a preview never starts a new active take');
    await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');
    const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,3);assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id===score.parts[0].id));assert.deepEqual(take.passes[0].inputs,[]);assert.equal(take.passes[0].interpretation.policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(server.records.get(key).clean_package.score_json,source);assert.equal(imports(app)[1].body,file);
    await app.click('back-to-library');app.savedButton(key).click();await app.until(()=>!app.$('start-listen').disabled);await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
    const plan=app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected).core.plan;assert.equal(plan.ends.length,5,'Listening keeps every source attack');
  }finally{await app.close();}
});

test('canonical raw MIDI success retains its old activation and canonical save path',async()=>{
  const {app,file}=await setup({canonical:true});try{selectImportFiles(app,[file]);await app.until(()=>app.$('score-title').textContent==='Original canonical MIDI'&&app.requests.some(row=>row.path==='/api/library/save'));assert.equal(imports(app).length,0);}finally{await app.close();}
});

for(const status of [413,500])test(`HTTP ${status} never causes MIDI reinterpretation or persistence`,async()=>{
  const {app,file}=await setup({rejectionStatus:status});try{selectImportFiles(app,[file]);await app.until(()=>app.$('notice').classList.contains('error'));assert.equal(imports(app).length,0);}finally{await app.close();}
});

test('unparseable raw source remains a parser error without a save or fabricated practice',async()=>{
  const {app,file,server}=await setup({invalid:true});try{const title=app.$('preview-title').textContent;selectImportFiles(app,[file]);await app.until(()=>app.$('notice-message').textContent.includes('Truncated MIDI track'));assert.equal(server.records.size,0);assert.equal(imports(app).length,1);assert.equal(app.$('preview-title').textContent,title);assert.equal(app.$('export-takes').disabled,true);}finally{await app.close();}
});

test('saved complete MIDI keeps independent range gates and offers the existing explicit repair',async()=>{
  const value=await setup(),{app,score}=value;try{await importBasic(value);app.$('preview-part').value=score.parts[1].id;app.emit(app.$('preview-part'),'change');await app.until(()=>app.$('preview-gate').classList.contains('preview-blocked'));assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);assert.match(app.$('basic-key-preview-range-text').textContent,/1 outside/);await app.click('basic-key-preview-piano-88');await app.until(()=>!app.$('start-practice').disabled);assert.equal(app.$('key-count').value,'88');assert.equal(imports(app).length,2);}finally{await app.close();}
});

test('a source without an admitted practice clock is saved for inspection and never enabled for Start',async()=>{
  const value=await setup({blocked:true}),{app}=value;try{await importBasic(value);assert.equal(app.$('song-lobby').dataset.previewStatus,'inspection');assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,true);assert.match(app.$('notice-message').textContent,/practice clock/);getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('notice-message').textContent,/练习时钟/);}finally{await app.close();}
});

for(const stage of ['preview','commit'])test(`newer navigation fences an old MIDI ${stage} without losing a submitted save`,async()=>{
  const gate=deferred();let held=false;
  const value=await setup({intercept:async({path})=>{if(path===`/api/library/import/${stage}`){held=true;await gate.promise;}}}),{app,file,server,key}=value;
  try{selectImportFiles(app,[file]);await app.until(()=>held);await app.click('settings-button');const identity=app.$('song-lobby').dataset.previewId;gate.resolve();await app.tick();await app.tick();if(stage==='commit')await app.until(()=>app.savedButton(key));assert.equal(app.$('settings-dialog').open,true);assert.equal(app.$('song-lobby').dataset.previewId,identity);assert.equal(server.records.size,stage==='commit'?1:0);assert.equal(app.$('export-takes').disabled,true);}finally{gate.resolve();await app.close();}
});

test('duplicate raw MIDI uses its confirmed saved identity without another edition',async()=>{
  const value=await setup({existing:true});try{await importBasic(value);assert.equal(value.server.records.size,1);assert.equal(imports(value.app).length,2);assert.equal(value.app.$('song-lobby').dataset.previewId,`native:${value.key}`);}finally{await value.app.close();}
});

test('browser fallback reports its native requirement without attempting a native write',async()=>{
  let reads=0;await assert.rejects(importDirectMidiFallback(originalMidi(),{getStorage:async()=>({info:{kind:'browser'}}),transport:{preview:()=>reads++}}),{code:'midi_native_import_required'});assert.equal(reads,0);
});

test('a delayed MIDI source rejection cannot supersede a newer canonical import',async()=>{
  const gate=deferred();let held=false;
  const {app,file}=await setup({intercept:async({path})=>{if(path==='/api/import/midi'){held=true;await gate.promise;}}});
  try{selectImportFiles(app,[file]);await app.until(()=>held);app.importFile(authoredScore({id:'newer-source',title:'Newer source stays selected'}));await app.until(()=>app.$('score-title').textContent==='Newer source stays selected');gate.resolve();await app.tick();await app.tick();assert.equal(imports(app).length,0);assert.equal(app.$('preview-title').textContent,'Newer source stays selected');}finally{gate.resolve();await app.close();}
});

test('raw MIDI fallback remains directly playable from its saved edition after app restart',async()=>{
  const value=await setup();let app=value.app;
  try{await importBasic(value);await app.close();app=await nativeStorageApp(value.server,{now:()=>1000});await app.until(()=>app.savedButton(value.key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(value.key).click();await app.until(()=>!app.$('start-practice').disabled&&app.$('song-lobby').dataset.previewId===`native:${value.key}`);await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(imports(app).length,2,'Restart only loads the already saved complete source');}finally{await app.close();}
});

test('uncertain MIDI commit keeps its original error even when inventory refresh also fails',async()=>{
  const descriptor=basicKeyRenditionFixture().clean_package,summary={...descriptor,notation_available:true},file=originalMidi();let refreshed=0;
  const uncertain=Object.assign(new Error('The save response was lost'),{code:'library_commit_uncertain',persistence:'unknown'});
  await assert.rejects(importDirectMidiFallback(file,{getStorage:async()=>({info:{kind:'native'}}),transport:{preview:async()=>({source:{sha256:'a'.repeat(64)},items:[importItem({clean_package:summary})]}),commit:async()=>{throw uncertain;}},onCommitted:async()=>{refreshed++;throw Error('Inventory unavailable');}}),error=>error===uncertain);
  assert.equal(refreshed,1);
});

test('incomplete package coverage and a mismatched saved identity are never trusted for direct admission',async()=>{
  const descriptor=basicKeyRenditionFixture().clean_package,summary={...descriptor,notation_available:true},file=originalMidi();
  for(const item of [importItem({clean_package:{...summary,coverage:{...summary.coverage,represented_events:0}}}),importItem({status:'duplicate',entry:{key:`song-${'0'.repeat(64)}`},clean_package:summary})]){
    let commits=0;await assert.rejects(importDirectMidiFallback(file,{getStorage:async()=>({info:{kind:'native'}}),transport:{preview:async()=>({items:[item]}),commit:async()=>{commits++;}}}),{code:'midi_import_result'});assert.equal(commits,0);
  }
});

function directMidiReportFixture({preview,commit}){
  const file=originalMidi(),calls=[],descriptor=basicKeyRenditionFixture().clean_package;
  const sha256=JSON.parse(descriptor.score_json).source.sha256;
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  const transport=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async(path,options)=>{
    assert.equal(options.body,file,'Both requests must retain the original File');
    const mode=path.endsWith('/commit')?'commit':'preview';calls.push(mode);
    const item=(mode==='commit'?commit:preview)(structuredClone(summary));
    return nativeResponse(importReport(file,{mode,sha256,items:[item]}));
  }});
  return{file,transport,calls,summary,getStorage:async()=>({info:{kind:'native'}})};
}

for(const status of ['saved','duplicate'])test(`real MIDI transport rejects a ${status} package substituted after preview despite matching source SHA`,async()=>{
  const value=directMidiReportFixture({
    preview:summary=>importItem({clean_package:summary}),
    commit:summary=>{const other={...summary,content_sha256:'b'.repeat(64)};assert.notEqual(other.content_sha256,summary.content_sha256);return importItem({status,clean_package:other,entry:{key:`song-${other.content_sha256}`,clean_package:other}});},
  });let refreshed=0;
  await assert.rejects(importDirectMidiFallback(value.file,{...value,onCommitted:async()=>{refreshed++;}}),{code:'midi_import_result'});
  assert.deepEqual(value.calls,['preview','commit']);assert.equal(refreshed,1,'A rejected response must still refresh a possibly committed inventory');
});

for(const stage of ['preview','commit'])for(const contradiction of ['identity','profile','coverage'])test(`real MIDI transport rejects contradictory ${contradiction} in the ${stage} entry summary`,async()=>{
  const contradictory=summary=>{
    const other=structuredClone(summary);
    if(contradiction==='identity')other.content_sha256='b'.repeat(64);
    if(contradiction==='profile')other.profile='wmh-performance-midi1-v1';
    if(contradiction==='coverage')other.coverage.represented_events=0;
    return importItem({status:stage==='preview'?'duplicate':'saved',clean_package:summary,entry:{key:`song-${summary.content_sha256}`,clean_package:other}});
  };
  const value=directMidiReportFixture({preview:stage==='preview'?contradictory:summary=>importItem({clean_package:summary}),commit:contradictory});let refreshed=0;
  await assert.rejects(importDirectMidiFallback(value.file,{...value,onCommitted:async()=>{refreshed++;}}),{code:'midi_import_result'});
  assert.deepEqual(value.calls,stage==='preview'?['preview']:['preview','commit']);assert.equal(refreshed,stage==='preview'?0:1);
});

for(const inspection of [false,true])for(const entryOnly of [false,true])test(`real MIDI transport admits same-content duplicate ${inspection?'inspection':'playable'} reports with ${entryOnly?'entry-only':'matching'} summaries`,async()=>{
  const duplicate=summary=>importItem({status:'duplicate',playable:!inspection,...(entryOnly?{}:{clean_package:summary}),entry:{key:`song-${summary.content_sha256}`,clean_package:summary}});
  const value=directMidiReportFixture({preview:duplicate,commit:duplicate});let refreshed=0;
  const result=await importDirectMidiFallback(value.file,{...value,onCommitted:async()=>{refreshed++;}});
  assert.deepEqual(result,{libraryKey:`native:song-${value.summary.content_sha256}`,warnings:[],status:'duplicate'});
  assert.deepEqual(value.calls,['preview','commit']);assert.equal(refreshed,1);
});
