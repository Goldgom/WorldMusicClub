import {withMockBasicEligibility} from './basic-human-admission-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {preparePitchModView,pitchViewContext,originalPitchContext,PitchModStore,PITCH_MOD_STORAGE_PREFIX} from '../web/pitch-mod.js';
import {buildCanonicalAudioPlan} from '../web/canonical-audio-plan.js';

const vectors=withMockBasicEligibility(JSON.parse(readFileSync(new URL('./fixtures/pitch-mod-handler-vectors.json',import.meta.url)))).vectors;
const canonical=vectors.canonical_api;
const original=()=>({score:structuredClone(canonical.original.score),compiled:structuredClone(canonical.zero.compilation),cleanSong:null});

test('Rust C4→D4 snapshot drives effective targets/audio while zero restores original references and export source',async()=>{
 const source=original(),before=JSON.stringify(source);const requests=[];
 const view=await preparePitchModView(source,2,{api:async(path,body)=>{requests.push({path,body});return structuredClone(canonical.plus2);}});
 const effective=pitchViewContext(source,view);
 assert.deepEqual(effective.compiled.timeline.notes.map(n=>n.midi),[62,62]);
 const plan=buildCanonicalAudioPlan(view.compiled,view.audioProfile,{sampleRate:48000,mode:'listen',acceptedPolicyId:'wmh-canonical-sine-ms-v1'});
 assert.deepEqual(plan.notes.map(n=>n[3]),[62,62]);assert.equal(JSON.stringify(source),before);assert.equal(originalPitchContext(effective).score,source.score);
 const zero=await preparePitchModView(effective,0,{api:()=>{throw Error('zero must not compile');}});assert.equal(zero.score,source.score);assert.equal(zero.compiled,source.compiled);
 assert.equal(requests.length,1);assert.equal(requests[0].body.score,source.score);
});

async function fixture(options={}){
 const source=canonical.original.score,server=await nativeScoreServer({scores:[source]}),storageValues=options.storageValues||new Map();let route=null,clock=1000;
 server.setRoute(async request=>{const override=await route?.(request);if(override!==undefined)return override;const {path,body}=request;
  if(path==='/api/compile'&&body.id===source.id)return nativeResponse(canonical.zero.compilation);
  if(path==='/api/canonical-audio-profile'&&body.id===source.id)return nativeResponse(canonical.zero.audio_profile);
  if(path==='/api/pitch-mod/project')return nativeResponse(body.configuration.semitones===2?canonical.plus2:canonical.zero);
 });
 const app=await nativeStorageApp(server,{...options,storageValues,now:()=>clock}),key=[...server.records.keys()][0];
 await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
 return{app,server,source,storageValues,setRoute(value){route=value;},time(value){clock=value;app.renderAudioTo((value-1000)/1000);app.frame();}};
}
async function checked(app,shift){app.$('song-mod-pitch-shift').value=String(shift);app.emit(app.$('song-mod-pitch-shift'),'input');await app.click('song-mod-pitch-check');await app.until(()=>app.$('song-mod-pitch-status').dataset.pitchModStatus==='checked',()=>app.$('song-mod-pitch-status').textContent);}
async function apply(app){assert.equal(app.$('song-mod-apply').disabled,false,app.$('song-mod-error').textContent);await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);}

test('production Mod Check/Cancel are draft-only; Apply changes preview and stage while literal D4 input stays D4',async()=>{
 const f=await fixture(),{app,source,storageValues}=f;
 try{
  await app.click('configure-song-mod');await checked(app,2);assert.match(app.$('song-mod-pitch-status').textContent,/D4/);assert.equal([...storageValues.keys()].some(key=>key.startsWith(PITCH_MOD_STORAGE_PREFIX)),false);await app.click('song-mod-cancel');assert.equal(app.$('song-mod-preview-summary').dataset.pitchModSemitones,'0');
  await app.click('configure-song-mod');await checked(app,2);await apply(app);assert.equal(app.$('song-mod-preview-summary').dataset.pitchModSemitones,'2');assert.equal(app.audioNodes.some(n=>n.kind==='audio-worklet'&&n.connected),false);
  app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  f.time(1120);const key=app.document.querySelector('#keyboard [data-midi="62"]');app.emit(key,'pointerdown',{pointerId:101,button:0});await app.tick();f.time(1180);app.emit(key,'pointerup',{pointerId:101});await app.click('play-button');
  const take=await app.exported('export-takes');assert.deepEqual(take.target_plan.timeline.notes.map(n=>n.midi),[62,62]);assert.equal(take.passes[0].inputs[0].midi,62);assert.equal(app.plays.findLast(call=>call[0].startsWith('manual:'))[1],62);
  const downloaded=await app.exported('export-button');assert.deepEqual(downloaded,source);
  await app.click('edit-song-mod');await checked(app,0);assert.equal(app.$('song-mod-pitch-reset-label').hidden,false);assert.equal(app.$('song-mod-apply').disabled,true);await app.click('song-mod-cancel');assert.equal((await app.exported('export-takes')).passes.length,take.passes.length);
  await app.click('edit-song-mod');await checked(app,0);app.$('song-mod-pitch-reset').checked=true;app.emit(app.$('song-mod-pitch-reset'),'change');await apply(app);assert.equal(app.$('song-mod-stage-summary').dataset.pitchModSemitones,'0');assert.equal((await app.exported('export-takes')).passes.length,0);
 }finally{await app.close();}
});

test('cancelled delayed pitch Check never saves or installs a stale view',async()=>{
 const f=await fixture(),{app,storageValues}=f,waiting=deferred();
 try{f.setRoute(({path})=>path==='/api/pitch-mod/project'?waiting.promise:undefined);await app.click('configure-song-mod');app.$('song-mod-pitch-shift').value='2';app.emit(app.$('song-mod-pitch-shift'),'input');await app.click('song-mod-pitch-check');await app.click('song-mod-cancel');waiting.resolve(nativeResponse(canonical.plus2));await app.tick();assert.equal(app.$('song-mod-preview-summary').dataset.pitchModSemitones,'0');assert.equal([...storageValues.keys()].some(key=>key.startsWith(PITCH_MOD_STORAGE_PREFIX)),false);}finally{waiting.resolve(nativeResponse(canonical.plus2));await app.close();}
});

test('Basic FIFO and VSQ use actual native load/choice vectors with unchanged source and exact gates',async()=>{
 const {prepareCleanSong,prepareVsqPractice}=await import('../web/clean-song-package.js');
 const {buildBasicKeyAudioPlan}=await import('../web/basic-key-audio-plan.js');
 const {buildVsqAudioPlan}=await import('../web/vsq-audio-plan.js');
 for(const kind of ['basic','vsq']){
  const data=vectors[kind],opened=data.original.opened,key=`native:${opened.entry.key}`;
  let song=prepareCleanSong(key,opened.clean_package,JSON.parse(opened.score_json));
  if(kind==='vsq')song=prepareVsqPractice(song,data.original.choice_response);
  const context={score:song.notation,compiled:song.compilation,cleanSong:song},raw=song.score_json,view=await preparePitchModView(context,2,{api:async()=>structuredClone(data.plus2)});
  const plan=(kind==='basic'?buildBasicKeyAudioPlan:buildVsqAudioPlan)(view.cleanSong,{sampleRate:48000,mode:'listen'});
  assert.deepEqual(plan.notes.map(n=>n[4]),view.compiled.timeline.notes.map(n=>n.midi));
  assert.equal(view.cleanSong.score_json,raw);assert.equal(view.cleanSong.score,song.score);assert.equal(view.compiled.timeline.duration_ms,song.compilation.timeline.duration_ms);
  if(kind==='basic'){
   assert.deepEqual(view.cleanSong.runtime.rendition,song.runtime.rendition,'FIFO pairing, controls and gates stay original');
   for(const pitch of view.source_pitches.filter(p=>p.percussion))assert.equal(pitch.original_midi,pitch.effective_midi);
  }else assert.equal(view.cleanSong.runtime.practice_origin_tick,song.runtime.practice_origin_tick);
 }
});

test('pitch bundle scope, cross-window raw checks and known-missing reads fail closed',async()=>{
 const {defaultSongMod}=await import('../web/song-mod.js'),source=original(),mod=defaultSongMod(source),values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},store=new PitchModStore({storage});
 assert.equal(store.read(source),null);const configuration={format:'wmc-pitch-mod',version:1,semitones:2};
 const saved=store.save(source,configuration,mod);assert.equal(store.read(source).configuration.semitones,2);
 const foreign='worldmusichub.practice-assistance.v1.'+encodeURIComponent('another-song');
 assert.throws(()=>store.save(source,configuration,mod,{records:{[foreign]:JSON.stringify({preference_key:'another-song',source:null})},expectedRaw:saved.raw}),/another song/);
 const concurrent=JSON.stringify({...JSON.parse(saved.raw),configuration:{...configuration,semitones:3}});values.set(store.key(source),concurrent);
 assert.throws(()=>store.save(source,configuration,mod,{expectedRaw:saved.raw}),/another window/);assert.equal(values.get(store.key(source)),concurrent);
 assert.equal(store.read(source).configuration.semitones,3);values.delete(store.key(source));assert.match(store.read(source).error.message,/missing/);
 const unavailable=new PitchModStore({storage:{getItem(){throw Error('denied');}}});assert.equal(unavailable.read(source),null,'First-use storage absence keeps the old default');
});

test('failed pitch sidecar save preserves old targets, Mod and take in the production app',async()=>{
 const values=new Map();let denied=false;const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(denied&&key.startsWith(PITCH_MOD_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}};
 const f=await fixture({storageValues:values,localStorageDescriptor:{configurable:true,value:storage}}),{app}=f;
 try{
  app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(1120);await app.click('play-button');const before=await app.exported('export-takes');
  await app.click('edit-song-mod');await checked(app,2);app.$('song-mod-pitch-reset').checked=true;app.emit(app.$('song-mod-pitch-reset'),'change');denied=true;await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('could not be saved'));
  assert.equal(app.$('song-mod-dialog').open,true);await app.click('song-mod-cancel');const after=await app.exported('export-takes');assert.deepEqual(after.target_plan,before.target_plan);assert.deepEqual(after.passes,before.passes);assert.deepEqual(after.song_mod,before.song_mod);assert.equal(app.$('song-mod-stage-summary').dataset.pitchModSemitones,'0');
 }finally{await app.close();}
});

test('fresh shifted assistance drives checked production audio with source-bound bundle persistence',async()=>{
 const f=await fixture(),{app,storageValues}=f;
 try{
  app.$('key-count').value='custom';app.emit(app.$('key-count'),'change');app.$('custom-key-count').value='88';app.$('custom-lowest').value='A0';await app.click('instrument-apply');await app.until(()=>!app.$('configure-song-mod').disabled);
  f.setRoute(({path,body})=>path==='/api/practice-assistance/original'&&body.pitch_mod?.semitones===2?nativeResponse(canonical.assistance):undefined);
  await app.click('configure-song-mod');await checked(app,2);await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-preview').dataset.state==='checked','Fresh effective assistance check');await apply(app);
  const entries=[...storageValues].filter(([key])=>key.startsWith(PITCH_MOD_STORAGE_PREFIX));assert.equal(entries.length,1);const bundle=JSON.parse(entries[0][1]);assert.equal(Object.keys(bundle.records).length,1);assert.equal([...storageValues.keys()].some(key=>key.startsWith('worldmusichub.practice-assistance.')),false,'Fresh effective recipe is inside the atomic pitch bundle');
  app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing','Shifted assisted audio starts');await app.click('play-button');const take=await app.exported('export-takes');assert.equal(take.practice_assistance.receipt.runtime_policy,'wmc-pitch-mod-v1');assert.deepEqual(take.target_plan.timeline.notes.map(n=>n.midi),[62,62]);
  await app.click('edit-song-mod');const visible=app.$('song-mod-parts').querySelector('[data-mod-visible="piano"]');visible.checked=false;app.emit(visible,'change');await apply(app);const kept=await app.exported('export-takes');assert.deepEqual(kept.passes,take.passes,'Display-only shifted assisted Mod keeps the take');assert.deepEqual(kept.target_plan,take.target_plan);
 }finally{await app.close();}
});

for(const kind of ['basic','vsq'])test(`production ${kind} Mod installs native effective targets and all-machine audio without changing saved source`,async()=>{
 const data=vectors[kind],server=await nativeScoreServer(),opened=structuredClone(data.original.opened),key=opened.entry.key,before=opened.clean_package.score_json;server.records.set(key,opened);
 server.setRoute(({path})=>path==='/api/library/pitch-mod/project'?nativeResponse(data.plus2):path==='/api/library/runtime'&&kind==='vsq'?nativeResponse(data.original.choice_response):undefined);
 const app=await nativeStorageApp(server);
 try{
  await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();
  if(kind==='vsq'){await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice','VSQ original source awaits explicit choice');await app.click('vsq-listen-basic');await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('edit-song-mod');}
  else{await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');}
  await app.click('song-mod-all-machine');await checked(app,2);if(!app.$('song-mod-pitch-reset-label').hidden){app.$('song-mod-pitch-reset').checked=true;app.emit(app.$('song-mod-pitch-reset'),'change');}await apply(app);
  if(kind==='basic')await app.click('start-performance');else await app.click('play-button');
  await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing',`${kind} shifted native audio`);
  const receiver=app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.keys);assert.deepEqual([...receiver.core.plan.keys],data.plus2.compilation.timeline.notes.map(n=>n.midi));assert.equal(server.records.get(key).clean_package.score_json,before);
 }finally{await app.close();}
});

test('MIDI range rejection is explicit and keeps every current pitch and stored byte',async()=>{
 const f=await fixture(),{app,storageValues}=f;
 try{await app.click('configure-song-mod');const before=[...storageValues];f.setRoute(({path})=>path==='/api/pitch-mod/project'?nativeResponse({code:'pitch_mod_midi_range',error:'The whole pitch projection was rejected because a pitched note would leave MIDI 0–127'},422):undefined);app.$('song-mod-pitch-shift').value='12';app.emit(app.$('song-mod-pitch-shift'),'input');await app.click('song-mod-pitch-check');await app.until(()=>app.$('song-mod-pitch-status').dataset.pitchModStatus==='rejected');assert.match(app.$('song-mod-pitch-status').textContent,/whole.*MIDI 0–127/);assert.equal(app.$('song-mod-apply').disabled,true);assert.deepEqual([...storageValues],before);assert.equal(app.$('song-mod-preview-summary').dataset.pitchModSemitones,'0');await app.click('song-mod-cancel');}finally{await app.close();}
});

for(const outcome of ['success','failure','late'])test(`tempo changes reproject original C4 at the retained +2 shift: ${outcome}`,async()=>{
 const f=await fixture(),{app,server,storageValues}=f,tempo=vectors.canonical_api.tempo120,waiting=deferred();let requested=false;
 try{
  await app.click('configure-song-mod');await checked(app,2);await apply(app);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(1120);await app.click('play-button');const before=await app.exported('export-takes'),bytes=[...storageValues],digest=app.$('song-mod-stage-summary').dataset.pitchModDigest;
  f.setRoute(({path,body})=>{if(path==='/api/compile'&&body.tempo[0].bpm===120)return nativeResponse(tempo.zero.compilation);if(path==='/api/pitch-mod/project'&&body.score.tempo[0].bpm===120){requested=true;assert.equal(body.configuration.semitones,2);assert.ok(body.score.parts.every(p=>p.notes.every(n=>n.pitch?.step==='C')),'Recompile and project only the original C4 source');return outcome==='late'?waiting.promise:outcome==='failure'?nativeResponse({code:'pitch_mod_projection',error:'Projection unavailable'},422):nativeResponse(tempo.plus2);}});
  app.$('tempo').value='120';app.emit(app.$('tempo'),'change');await app.until(()=>requested,'Fresh tempo projection requested');
  if(outcome==='late'){await app.click('back-to-library');waiting.resolve(nativeResponse(tempo.plus2));}
  await app.until(()=>outcome==='success'?app.$('song-mod-stage-summary').dataset.pitchModDigest!==digest:app.$('tempo').value==='90','Tempo transaction settled');
  const after=await app.exported('export-takes'),source=await app.exported('export-button');assert.equal(app.$('song-mod-stage-summary').dataset.pitchModSemitones,'2');assert.ok(source.parts.every(p=>p.notes.every(n=>n.pitch?.step==='C')));assert.equal(server.requests.filter(r=>r.path==='/api/library/save').length,0);
  if(outcome==='success'){assert.equal(source.tempo[0].bpm,120);assert.deepEqual(after.target_plan.timeline.notes.map(n=>[n.midi,n.duration_ms]),[[62,500],[62,500]]);assert.equal(after.passes.length,0);assert.notEqual(after.pitch_mod.digest,before.pitch_mod.digest);}
  else{assert.equal(source.tempo[0].bpm,90);assert.deepEqual(after.target_plan,before.target_plan);assert.deepEqual(after.passes,before.passes);assert.deepEqual([...storageValues],bytes);assert.equal(after.pitch_mod.digest,before.pitch_mod.digest);}
 }finally{waiting.resolve(nativeResponse(tempo?.plus2||canonical.plus2));await app.close();}
});

test('native Basic lazy notation pages share effective melodic keys and unchanged drum selectors',async()=>{
 const {prepareCleanSong}=await import('../web/clean-song-package.js'),{basicKeyNotationRequest,basicKeyNotationPage,basicKeyEngravingIdentity}=await import('../web/basic-key-notation.js'),{renderBasicKeyPage}=await import('../web/basic-key-numbered.js');
 const data=vectors.basic,opened=data.original.opened,song=prepareCleanSong(`native:${opened.entry.key}`,opened.clean_package,JSON.parse(opened.score_json)),context={score:song.notation,compiled:song.compilation,cleanSong:song},view=await preparePitchModView(context,2,{api:async()=>structuredClone(data.plus2)});
 const targets=new Map(view.compiled.timeline.notes.map(note=>[note.id,note.midi]));
 for(const kind of ['melodic','percussion']){
  const vector=data.notation[kind],request=basicKeyNotationRequest(view.cleanSong,{partId:vector.request.settings.part_id,from:1,count:vector.plus2.page.measure_count,displayMeter:vector.request.settings.display_meter}),page=basicKeyNotationPage(structuredClone(vector.plus2),request,view.cleanSong);
  for(const note of page.interpreted_notes)assert.equal(note.key,targets.get(note.note_id));
  if(page.status==='ready')assert.ok(basicKeyEngravingIdentity(view.cleanSong,page));
  const rendered=renderBasicKeyPage(page,'jianpu',{width:800,numberedMode:'fixed',i18n:{locale:'en',t:key=>key}});assert.ok(typeof rendered.html==='string');
 }
});

test('removed bundled recipe stays blocked on repeated reads and cannot resurrect legacy bytes',async()=>{
 const {defaultSongMod}=await import('../web/song-mod.js'),source=original(),mod=defaultSongMod(source),values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,raw)=>values.set(key,raw)},store=new PitchModStore({storage}),base=store.base(source),key='worldmusichub.practice-assistance.v1.'+encodeURIComponent(base),raw=JSON.stringify({format:'wmc-practice-assistance-off',version:1,preference_key:base,source:null});
 values.set(key,raw);store.read(source);store.save(source,{format:'wmc-pitch-mod',version:1,semitones:0},mod,{records:{[key]:raw}});const bundle=JSON.parse(values.get(store.key(source)));delete bundle.records[key];values.set(store.key(source),JSON.stringify(bundle));
 store.read(source);for(let attempt=0;attempt<3;attempt++)assert.throws(()=>store.preferences.getItem(key),/disappeared/);
 assert.equal(values.get(key),raw);
 const {AppAssistanceStore,appAssistanceContext,assistancePracticeGate}=await import('../web/app-assistance.js'),{createProgressiveAssistanceController,PracticeProgressionStore}=await import('../web/practice-progression.js'),{songModIdentity}=await import('../web/song-mod.js'),binding=appAssistanceContext(source,{kind:'piano',key_count:88,lowest_midi:21},songModIdentity(source)),controller=createProgressiveAssistanceController({getContext:()=>binding,store:new AppAssistanceStore({storage:store.preferences}),progressionStore:new PracticeProgressionStore({storage:store.preferences}),api:()=>{throw Error('A missing bundle must not silently revalidate Original');}});await controller.restore();assert.ok(assistancePracticeGate(controller));controller.beginDraft();controller.cancelDraft();assert.ok(assistancePracticeGate(controller));
});

test('a new pitch can seed Automatic or progression controls as an explicit unchecked draft',async()=>{
 const {parseHTML}=await import('linkedom'),{setupPracticeAssistanceView}=await import('../web/practice-assistance-view.js'),{createProgressiveAssistanceController,PracticeProgressionStore}=await import('../web/practice-progression.js'),{PracticeAssistanceStore}=await import('../web/practice-assistance.js'),{assistanceContext,memoryStorage}=await import('./practice-assistance-fixtures.js');
 for(const mode of ['automatic','progression']){
  const {document}=parseHTML('<html><body><main></main></body></html>'),storage=memoryStorage(),binding=assistanceContext(),controller=createProgressiveAssistanceController({getContext:()=>binding,store:new PracticeAssistanceStore({storage}),progressionStore:new PracticeProgressionStore({storage}),api:()=>{throw Error('Opening a pitch draft must not request or save assistance');}}),view=setupPracticeAssistanceView({document,parent:document.querySelector('main'),i18n:{locale:'en'}});
  assert.doesNotThrow(()=>view.open(controller,{where:'preview',initialDraft:{mode,settings:null,layer:'single'},requireCheck:true}));assert.equal(view.changed(),true);assert.equal(document.getElementById('song-mod-assistance-preview').dataset.state,'unchecked');assert.equal(storage.values.size,0);view.close();
 }
});

test('tempo publishes its prechecked assistance and targets even if later preview revalidation is unavailable',async()=>{
 const f=await fixture(),{app}=f,tempo=canonical.tempo120;let tempoChecks=0;
 try{
  app.$('key-count').value='custom';app.emit(app.$('key-count'),'change');app.$('custom-key-count').value='88';app.$('custom-lowest').value='A0';await app.click('instrument-apply');await app.until(()=>!app.$('configure-song-mod').disabled);
  f.setRoute(({path,body})=>{if(path==='/api/compile'&&body.tempo[0].bpm===120)return nativeResponse(tempo.zero.compilation);if(path==='/api/pitch-mod/project'&&body.score.tempo[0].bpm===120)return nativeResponse(tempo.plus2);if(path==='/api/practice-assistance/original'&&body.pitch_mod?.semitones===2){if(body.score.tempo[0].bpm===120)return ++tempoChecks===1?nativeResponse(tempo.assistance):nativeResponse({code:'unavailable',error:'Later preview check unavailable'},503);return nativeResponse(canonical.assistance);}});
  await app.click('configure-song-mod');await checked(app,2);await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-preview').dataset.state==='checked');await apply(app);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('play-button');const before=app.$('song-mod-stage-summary').dataset.pitchModDigest;
  app.$('tempo').value='120';app.emit(app.$('tempo'),'change');await app.until(()=>app.$('song-mod-stage-summary').dataset.pitchModDigest!==before&&!app.$('play-button').disabled,'Prepared tempo assignment installed');
  await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing','Already checked stage playback remains usable');const take=await app.exported('export-takes');assert.equal(take.practice_assistance.receipt.runtime_digest,tempo.plus2.receipt.runtime_digest);assert.deepEqual(take.target_plan.timeline.notes.map(n=>[n.midi,n.duration_ms]),[[62,500],[62,500]]);
 }finally{await app.close();}
});


for(const editTiming of ['before','after'])test(`default Original role edits ${editTiming} pitch Check preserve admitted preview readiness`,async()=>{
 const vector=JSON.parse(readFileSync(new URL('./fixtures/pitch-mod-browser-c4-projection.json',import.meta.url))),server=await nativeScoreServer({scores:[vector.original]});
 server.setRoute(({path,body})=>path==='/api/compile'&&body.id===vector.original.id?nativeResponse(vector.compilation):path==='/api/pitch-mod/project'?nativeResponse(vector.plus2):undefined);
 const app=await nativeStorageApp(server),key=[...server.records.keys()][0];
 try{await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');const editRoles=async()=>{await app.click('song-mod-all-machine');const human=app.$('song-mod-parts').querySelector('[data-mod-performer="human"]');human.value='human';app.emit(human,'change');};if(editTiming==='before')await editRoles();await checked(app,2);if(editTiming==='after')await editRoles();await apply(app);assert.equal(app.$('start-performance').disabled,false,app.$('song-mod-preview-summary').textContent);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const take=await app.exported('export-takes');assert.deepEqual(take.practice_selection.part_ids,['human']);assert.deepEqual(take.target_plan.timeline.notes.map(n=>n.midi),[62,62,62]);assert.equal(server.requests.filter(row=>row.path.includes('/assistance/')).length,0,'Default Original never opts into note assistance');}
 finally{await app.close();}
});
