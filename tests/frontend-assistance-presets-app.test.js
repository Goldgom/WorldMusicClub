import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred,authoredScore} from './native-storage-app-fixtures.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';

// Production app, receipt admission, recorder and audio cores in the existing
// Node DOM harness. HTTP/native transport, storage and audio devices are test
// doubles. These tests neither execute Rust nor establish browser/native QA.
// Assistance DTOs are committed Rust-generated vectors for original exercises;
// never derive ownership in JavaScript or rewrite a receipt to fit a preset.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/assistance-canonical.json',import.meta.url),'utf8'));
const presetNumbers={single:[1,500,1,0],balanced:[2,250,3,7],dense:[4,125,6,12]};
const numericFields=['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones'];
const customSettings=fixture.automatic.checked.plan.settings;
const expectedSettings=id=>({algorithm_id:'wmc-keyboard-assistance-v1',...Object.fromEntries(numericFields.map((field,index)=>[field,presetNumbers[id][index]]))});
const set=(app,id,value,type='change')=>{const node=typeof id==='string'?app.$(id):id;assert.ok(node,`Missing ${id}`);node.value=String(value);app.emit(node,type);};
const source=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.count!==undefined);
const assistanceRequests=server=>server.requests.filter(request=>request.path.startsWith('/api/practice-assistance/'));
const savedAssistance=values=>[...values].filter(([key])=>key.startsWith(ASSISTANCE_STORAGE_PREFIX));
const phase=app=>app.$('song-mod-assistance-status').dataset.phase;
const acknowledgeReset=app=>{app.$('song-mod-assistance-reset').checked=true;app.emit(app.$('song-mod-assistance-reset'),'change');};

let presetFixture;
function automaticResponse(settings){
  if(JSON.stringify(Object.fromEntries(Object.entries(settings).sort()))===JSON.stringify(Object.fromEntries(Object.entries(customSettings).sort())))return fixture.automatic;
  presetFixture??=JSON.parse(readFileSync(new URL('./fixtures/assistance-presets-canonical.json',import.meta.url),'utf8'));
  const id=Object.keys(presetNumbers).find(id=>numericFields.every(field=>settings[field]===expectedSettings(id)[field]));
  assert.ok(id,'Only explicit committed preset vectors may answer the synthetic API');
  assert.equal(presetFixture.source_fixture,'assistance-canonical.json');
  assert.deepEqual(presetFixture.selection,fixture.original.checked.plan.selection);
  const response=presetFixture.presets[id].response;
  assert.deepEqual(response.checked.plan.settings,settings);
  return response;
}

async function setup({storageValues=new Map(),localStorageDescriptor,hold,failOriginal=false}={}){
  const score=fixture.compilation.score,otherScore=authoredScore(),server=await nativeScoreServer({scores:[score,otherScore]});
  let wall=1000;
  server.setRoute(async request=>{
    const {path,body}=request;
    if(path==='/api/compile'&&body.id===score.id)return nativeResponse(fixture.compilation);
    if(path==='/api/canonical-audio-profile'&&body.id===score.id)return nativeResponse(fixture.audio_profile);
    // Inspect the real submitted scoring request without inventing a grade.
    if(path==='/api/assess')return nativeResponse({error:'Scoring is deliberately unavailable in this DOM transport fixture'},503);
    if(!path.startsWith('/api/practice-assistance/'))return;
    assert.deepEqual(body.score,score,'Assistance must remain bound to the unchanged original exercise');
    const response=path.endsWith('/generate')?automaticResponse(body.settings):body.selection.selected_part_ids.length?fixture.original:fixture.listen;
    assert.deepEqual(body.selection,response.checked.plan.selection);
    await hold?.(request);
    if(failOriginal&&path.endsWith('/original'))return nativeResponse({code:'assistance_response_limit',error:'Complete assistance response exceeds its response budget'},422);
    return nativeResponse(response);
  });
  const app=await nativeStorageApp(server,{now:()=>wall,storageValues,localStorageDescriptor}),[key,otherKey]=server.records.keys();
  await app.until(()=>Boolean(app.savedButton(key)));
  await app.click('home-single-player');set(app,'key-count',88);app.savedButton(key).click();
  await app.until(()=>!app.$('configure-song-mod').disabled);await app.tick();
  return {app,server,score,otherScore,otherKey,storageValues,
    time(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},
    async open(id='balanced',origin='preview'){
      await app.click(origin==='stage'?'edit-song-mod':'configure-song-mod');
      set(app,'song-mod-assistance-mode','automatic');
      if(id==='custom')for(const field of numericFields)set(app,`song-mod-assistance-${field}`,customSettings[field],'input');
      else set(app,'song-mod-assistance-preset',id);
    },
    async check(){await app.click('song-mod-assistance-check');await app.until(()=>phase(app)==='prepared',()=>app.$('song-mod-assistance-status').textContent);},
    async apply(){assert.equal(app.$('song-mod-apply').disabled,false);await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);},
    async start(){app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing',()=>app.$('notice-message').textContent);},
  };
}

function assertUnchecked(app){
  assert.equal(app.$('song-mod-assistance-preview').dataset.state,'unchecked');
  assert.equal(app.$('song-mod-assistance-units').hidden,true);
  assert.equal(app.$('song-mod-assistance-units').textContent,'');
  assert.doesNotMatch(app.$('song-mod-assistance-status').textContent,/\d+ human|\d+ machine/);
}

function assertTakePreserved(actual,before){
  assert.deepEqual(actual.passes,before.passes);
  assert.deepEqual(actual.target_plan,before.target_plan);
  assert.deepEqual(actual.practice_assistance,before.practice_assistance);
  assert.deepEqual(actual.song_mod,before.song_mod);
}

test('preset selection changes numeric drafts only; default Original still makes no assistance request',async()=>{
  const f=await setup(),{app,server}=f;
  try{
    await app.until(()=>!app.$('start-performance').disabled);
    await app.click('configure-song-mod');
    assert.equal(app.$('song-mod-assistance-mode').value,'original');
    assert.equal(app.$('song-mod-assistance-preset-label').hidden,true);
    assert.equal(assistanceRequests(server).length,0);
    set(app,'song-mod-assistance-mode','automatic');
    assert.equal(app.$('song-mod-assistance-preset').value,'balanced');
    for(const id of ['single','dense','balanced']){
      set(app,'song-mod-assistance-preset',id);
      assert.deepEqual(numericFields.map(field=>Number(app.$(`song-mod-assistance-${field}`).value)),presetNumbers[id]);
      assertUnchecked(app);
    }
    assert.equal(assistanceRequests(server).length,0);
    assert.equal(savedAssistance(f.storageValues).length,0);
    assert.equal(source(app),undefined);
    set(app,'song-mod-assistance-max_simultaneous_keys',2,'input');
    assert.equal(app.$('song-mod-assistance-preset').value,'custom');
    await app.click('song-mod-cancel');
    await app.click('configure-song-mod');
    assert.equal(app.$('song-mod-assistance-mode').value,'original');
    assert.equal(assistanceRequests(server).length,0);
  }finally{await app.close();}
});

test('rapid preset checks ignore both earlier responses and preserve only the newest request-bound ownership',async()=>{
  const pending=[];
  const f=await setup({hold:request=>{const wait=deferred();pending.push({request,wait});return wait.promise;}}),{app,server}=f;
  try{
    await f.open('single');await app.click('song-mod-assistance-check');await app.until(()=>pending.length===1);
    set(app,'song-mod-assistance-preset','dense');assertUnchecked(app);assert.equal(pending[0].request.options.signal.aborted,true);
    await app.click('song-mod-assistance-check');await app.until(()=>pending.length===2);
    set(app,'song-mod-assistance-preset','balanced');assertUnchecked(app);assert.equal(pending[1].request.options.signal.aborted,true);
    await app.click('song-mod-assistance-check');await app.until(()=>pending.length===3);
    pending[1].wait.resolve();await app.tick();await app.tick();
    assert.equal(app.$('song-mod-assistance-preview').dataset.state,'checking');
    assert.equal(app.$('song-mod-assistance-units').hidden,true);
    assert.equal(app.$('song-mod-assistance-units').textContent,'');
    assert.equal(savedAssistance(f.storageValues).length,0);assert.equal(source(app),undefined);
    pending[2].wait.resolve();await app.until(()=>phase(app)==='prepared');
    assert.equal(app.$('song-mod-assistance-preset').value,'balanced');
    const currentSummary=app.$('song-mod-assistance-preview').textContent;
    pending[0].wait.resolve();await app.tick();await app.tick();
    assert.equal(phase(app),'prepared');
    assert.equal(app.$('song-mod-assistance-preview').textContent,currentSummary);
    assert.deepEqual(assistanceRequests(server).map(request=>request.body.settings),['single','dense','balanced'].map(expectedSettings));
    await f.apply();
    assert.deepEqual(JSON.parse(savedAssistance(f.storageValues)[0][1]).settings,expectedSettings('balanced'));
    assert.equal(source(app),undefined,'Check and Apply never start machine playback');
  }finally{for(const {wait} of pending)wait.resolve();await app.close();}
});

test('Cancel fences a delayed preset Check before it can publish counts, save a recipe or start playback',async()=>{
  const wait=deferred();let request;
  const f=await setup({hold:value=>{request=value;return wait.promise;}}),{app}=f;
  try{
    await f.open('single');await app.click('song-mod-assistance-check');await app.until(()=>Boolean(request));
    await app.click('song-mod-cancel');assert.equal(request.options.signal.aborted,true);
    wait.resolve();await app.tick();await app.tick();
    assert.equal(app.$('song-mod-dialog').open,false);assert.equal(source(app),undefined);
    assert.equal(savedAssistance(f.storageValues).length,0);
    await app.click('configure-song-mod');assert.equal(app.$('song-mod-assistance-mode').value,'original');assertUnchecked(app);
  }finally{wait.resolve();await app.close();}
});

for(const boundary of ['source','profile'])for(const state of ['prepared','pending'])test(`${boundary} changes clear ${state} preset counts and fence the previous source/profile`,async()=>{
  const wait=deferred();let request;
  const f=await setup({hold:value=>{request=value;if(state==='pending')return wait.promise;}}),{app}=f;
  try{
    await f.open(boundary==='source'?'single':'dense');await app.click('song-mod-assistance-check');await app.until(()=>Boolean(request));
    if(state==='prepared')await app.until(()=>phase(app)==='prepared');
    if(boundary==='source'){
      app.savedButton(f.otherKey).click();
      await app.until(()=>app.$('preview-title').textContent===f.otherScore.title&&!app.$('configure-song-mod').disabled);
    }else{
      set(app,'key-count',61);
      await app.until(()=>!app.$('configure-song-mod').disabled&&app.$('song-mod-assistance-check').disabled);
    }
    assertUnchecked(app);
    assert.equal(app.$('song-mod-apply').disabled,true);
    if(state==='pending')assert.equal(request.options.signal.aborted,true);
    wait.resolve();await app.tick();await app.tick();assertUnchecked(app);
    assert.equal(assistanceRequests(f.server).length,1);
    assert.equal(savedAssistance(f.storageValues).length,0);assert.equal(source(app),undefined);
    await app.click('song-mod-cancel');await app.click('configure-song-mod');
    assert.equal(app.$('song-mod-assistance-mode').value,'original');assertUnchecked(app);
  }finally{wait.resolve();await app.close();}
});

for(const state of ['prepared','pending'])test(`part selection clears ${state} preset counts before Listen can be checked`,async()=>{
  const wait=deferred();let request;
  const f=await setup({hold:value=>{if(value.path.endsWith('/generate')){request=value;if(state==='pending')return wait.promise;}}}),{app}=f;
  try{
    await f.open('balanced');await app.click('song-mod-assistance-check');await app.until(()=>Boolean(request));
    if(state==='prepared')await app.until(()=>phase(app)==='prepared');
    await app.click('song-mod-all-machine');assertUnchecked(app);
    assert.equal(app.$('song-mod-assistance-check').disabled,true);
    assert.equal(app.$('song-mod-apply').disabled,true);
    if(state==='pending')assert.equal(request.options.signal.aborted,true);
    wait.resolve();await app.tick();await app.tick();assertUnchecked(app);
    set(app,'song-mod-assistance-mode','original');await f.check();await f.apply();await f.start();
    const take=await app.exported('export-takes');
    assert.equal(take.passes.length,0);assert.equal(take.practice_assistance.scored_mode_allowed,false);
    assert.deepEqual(take.practice_assistance.plan.selection.selected_part_ids,[]);
    assert.equal(source(app).core.plan.count,fixture.compilation.timeline.notes.length);
    assert.equal(app.$('assess-button').disabled,true);
  }finally{wait.resolve();await app.close();}
});

test('a named preset routes machine occurrences separately from human targets and input, and Cancel preserves the paused take',async()=>{
  const f=await setup(),{app,server}=f;
  try{
    const scoreBefore=JSON.stringify(f.score);
    await f.open('single');await f.check();await f.apply();await f.start();
    const checked=automaticResponse(expectedSettings('single')).checked,receiver=source(app);
    const machineIds=[...receiver.core.plan.occurrences].map(index=>fixture.compilation.timeline.notes[index].id);
    assert.deepEqual(machineIds,checked.machine_occurrence_ids);
    let before=await app.exported('export-takes');
    assert.deepEqual(before.target_plan.timeline.notes,checked.human_targets.timeline.notes);
    assert.deepEqual(before.passes[0].timeline.notes,checked.human_targets.timeline.notes);
    assert.deepEqual(before.passes[0].inputs,[],'Scheduled machine sound is not a human input');
    assert.ok(server.requests.filter(request=>request.path==='/api/instrument-check').slice(-2).every(request=>request.body.timeline.notes.every(note=>checked.human_targets.groups.some(group=>group.source_occurrence_ids.includes(note.id)))));
    f.time(app.sourceStartWall()+20);
    const key=app.document.querySelector('#keyboard [data-midi="60"]');
    app.emit(key,'pointerdown',{pointerId:721,button:0});app.emit(key,'pointerup',{pointerId:721});
    await app.click('edit-song-mod');before=await app.exported('export-takes');
    assert.equal(before.passes[0].inputs.length,1);
    const stored=savedAssistance(f.storageValues),position=app.$('progress').value;
    set(app,'song-mod-assistance-preset','dense');
    assert.equal(app.$('song-mod-apply').disabled,true);acknowledgeReset(app);
    set(app,'song-mod-assistance-preset','balanced');
    assert.equal(app.$('song-mod-assistance-reset').checked,false);
    assert.equal(app.$('song-mod-apply').disabled,true);
    await f.check();await app.click('song-mod-cancel');
    assertTakePreserved(await app.exported('export-takes'),before);
    assert.equal(app.$('progress').value,position);assert.deepEqual(savedAssistance(f.storageValues),stored);
    assert.equal(source(app),undefined);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');
    assert.equal(JSON.stringify(f.score),scoreBefore);
    await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const resumed=await app.exported('export-takes');
    assert.deepEqual(resumed.practice_assistance,before.practice_assistance);
    assert.deepEqual(resumed.passes[0].inputs,before.passes[0].inputs);
    assert.equal(resumed.passes.length,1);
    assert.deepEqual(resumed.passes[0].timeline.notes,checked.human_targets.timeline.notes);
    await app.click('assess-button');
    f.time(performance.now()+Math.max(0,resumed.latency_ms)+resumed.tolerance_ms+1);
    await app.until(()=>server.requests.some(request=>request.path==='/api/assess'));
    const scoring=server.requests.findLast(request=>request.path==='/api/assess').body;
    assert.deepEqual(scoring.timeline,checked.human_targets.timeline);
    assert.deepEqual(scoring.inputs,before.passes[0].inputs);
    assert.equal(scoring.inputs.length,1,'Only the actual human pointer contact reaches scoring');
    assert.equal((await app.exported('export-takes')).passes[0].assessment,null);
  }finally{await app.close();}
});

test('preview preset Apply preserves the paused active assignment while the next new session uses the new numeric recipe',async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.open('custom');await f.check();await f.apply();await f.start();
    await app.click('back-to-library');const before=await app.exported('export-takes');
    await f.open('dense');await f.check();await f.apply();
    assert.deepEqual(JSON.parse(savedAssistance(f.storageValues)[0][1]).settings,expectedSettings('dense'));
    assertTakePreserved(await app.exported('export-takes'),before);
    await app.click('resume-session');await app.until(()=>!app.$('play-button').disabled);
    assertTakePreserved(await app.exported('export-takes'),before);assert.equal(source(app),undefined);
    await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    assert.deepEqual((await app.exported('export-takes')).practice_assistance.plan.settings,customSettings);
    await app.click('back-to-library');await app.until(()=>!app.$('start-performance').disabled);await f.start();
    const fresh=await app.exported('export-takes');
    assert.deepEqual(fresh.practice_assistance.plan.settings,expectedSettings('dense'));
    assert.equal(fresh.passes.length,1);assert.deepEqual(fresh.passes[0].inputs,[]);
  }finally{await app.close();}
});

for(const id of ['single','balanced','dense','custom'])test(`saved ${id} numeric recipe reopens without preset metadata or migration and waits for validation`,async()=>{
  const values=new Map();let f=await setup({storageValues:values});
  try{await f.open(id);await f.check();await f.apply();}finally{await f.app.close();}
  const [[key,bytes]]=savedAssistance(values),recipe=JSON.parse(bytes);
  assert.deepEqual(Object.keys(recipe).sort(),['format','version','preference_key','source','selection','mode','settings','planner_revision','revision','expected_selection_digest'].sort());
  assert.deepEqual(recipe.settings,id==='custom'?customSettings:expectedSettings(id));
  const wait=deferred();let entered=false;
  f=await setup({storageValues:values,hold:()=>{entered=true;return wait.promise;}});
  try{
    const {app}=f;await app.until(()=>entered);
    assert.equal(app.$('start-performance').disabled,true);assert.equal(source(app),undefined);
    assert.equal(values.get(key),bytes);
    wait.resolve();await app.until(()=>!app.$('start-performance').disabled);
    await app.click('configure-song-mod');
    assert.equal(app.$('song-mod-assistance-preset').value,id);
    assert.deepEqual(numericFields.map(field=>Number(app.$(`song-mod-assistance-${field}`).value)),numericFields.map(field=>recipe.settings[field]));
    assert.equal(app.$('song-mod-assistance-preview').dataset.state,'checked');
    await app.click('song-mod-cancel');assert.equal(values.get(key),bytes);
  }finally{wait.resolve();await f.app.close();}
});

test('preset quota failure retains the new checked tab-only recipe and leaves older saved bytes intact',async()=>{
  const values=new Map();let refuse=false;
  const f=await setup({storageValues:values,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(refuse&&key.startsWith(ASSISTANCE_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app}=f;
  try{
    await f.open('custom');await f.check();await f.apply();const [[key,bytes]]=savedAssistance(values);refuse=true;
    await f.open('single');await f.check();await f.apply();
    assert.equal(values.get(key),bytes);assert.match(app.$('song-mod-preview-summary').textContent,/tab only|not saved/i);
    await f.start();let take=await app.exported('export-takes');
    assert.deepEqual(take.practice_assistance.plan.settings,expectedSettings('single'));
    await app.click('edit-song-mod');assert.equal(app.$('song-mod-assistance-preset').value,'single');
    await app.click('song-mod-cancel');assert.equal(values.get(key),bytes);
    take=await app.exported('export-takes');assert.deepEqual(take.practice_assistance.plan.settings,expectedSettings('single'));
  }finally{await app.close();}
});

test('cross-window recipe conflict rejects a preset Apply without replacing the active take or stored bytes',async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.open('single');await f.check();await f.apply();await f.start();
    await app.click('edit-song-mod');const before=await app.exported('export-takes');
    set(app,'song-mod-assistance-preset','dense');await f.check();acknowledgeReset(app);
    const [[key,bytes]]=savedAssistance(f.storageValues);f.storageValues.set(key,bytes+' ');
    await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('another window'));
    assert.equal(app.$('song-mod-dialog').open,true);assertTakePreserved(await app.exported('export-takes'),before);
    assert.equal(f.storageValues.get(key),bytes+' ');assert.equal(source(app),undefined);
    await app.click('song-mod-cancel');assertTakePreserved(await app.exported('export-takes'),before);
  }finally{await app.close();}
});

for(const mode of ['original','off'])test(`${mode} after a preset preserves Cancel and requires a paused reset before replacing human ownership`,async()=>{
  const f=await setup({failOriginal:mode==='off'}),{app,server}=f;
  try{
    await f.open('single');await f.check();await f.apply();await f.start();
    const choose=async()=>{await app.click('edit-song-mod');if(mode==='off')await app.click('song-mod-assistance-off');else set(app,'song-mod-assistance-mode','original');};
    await choose();const before=await app.exported('export-takes');
    assert.equal(app.$('song-mod-assistance-preset-label').hidden,true);
    assert.equal(app.$('song-mod-apply').disabled,true);await app.click('song-mod-cancel');
    assertTakePreserved(await app.exported('export-takes'),before);
    await choose();acknowledgeReset(app);await f.apply();
    const after=await app.exported('export-takes');assert.equal(after.passes.length,0);assert.equal(source(app),undefined);
    if(mode==='off'){
      assert.equal(after.practice_assistance,null);assert.equal(after.practice_assistance_disabled,true);
      assert.equal(assistanceRequests(server).some(request=>request.path.endsWith('/original')),false);
    }else{
      assert.equal(after.practice_assistance.plan.mode,'original');assert.equal(after.practice_assistance.plan.settings,null);
      assert.deepEqual(after.target_plan.timeline.notes,fixture.original.checked.human_targets.timeline.notes);
    }
    await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,fixture.compilation.timeline.notes.length);
    assert.equal(take.passes[0].inputs.length,0);assert.equal(source(app).core.plan.count,0);
  }finally{await app.close();}
});

for(const failure of ['conflict','write'])test(`failed Off ${failure} preserves the named preset, paused take and existing saved bytes`,async()=>{
  const values=new Map();let refuse=false;
  const f=await setup({storageValues:values,failOriginal:true,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(refuse&&key.startsWith(ASSISTANCE_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app,server}=f;
  try{
    await f.open('single');await f.check();await f.apply();await f.start();
    await app.click('edit-song-mod');const before=await app.exported('export-takes');
    await app.click('song-mod-assistance-off');acknowledgeReset(app);
    const [[key,originalBytes]]=savedAssistance(values);
    if(failure==='conflict')values.set(key,originalBytes+' ');else refuse=true;
    const bytes=values.get(key);
    await app.click('song-mod-apply');
    await app.until(()=>app.$('song-mod-error').textContent.includes(failure==='conflict'?'another window':'could not be saved'));
    assert.equal(app.$('song-mod-dialog').open,true);assert.equal(values.get(key),bytes);
    assertTakePreserved(await app.exported('export-takes'),before);assert.equal(source(app),undefined);
    await app.click('song-mod-cancel');await app.click('edit-song-mod');
    assert.equal(app.$('song-mod-assistance-mode').value,'automatic');
    assert.equal(app.$('song-mod-assistance-preset').value,'single');
    assert.equal(app.$('song-mod-assistance-preview').dataset.state,'checked');
    assert.equal(assistanceRequests(server).some(request=>request.path.endsWith('/original')),false);
  }finally{await app.close();}
});
