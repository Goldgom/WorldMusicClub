import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {authoredScore,deferred,nativeResponse,nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';

const saves=app=>app.requests.filter(request=>request.path==='/api/library/save');
const savedRows=app=>[...app.document.querySelectorAll('#catalog [data-library-key]')];
const storageBusy=app=>app.document.querySelector('[data-score-storage]')?.getAttribute('aria-busy')!=='false';
async function ready(app){await app.until(()=>app.storageStatus()&&!storageBusy(app)&&!app.$('start-listen').disabled,'Initial catalog and native inventory did not load');}
async function enterLibrary(app){await ready(app);await app.click('home-single-player');}
async function activate(app,mode='listen'){app.$('count-in').checked=false;await app.click(`start-${mode}`);await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled,'Selected score did not activate');}
async function imported(app,score,raw=score){const before=saves(app).length;app.importFile(raw);await app.until(()=>app.$('score-title').textContent===score.title&&saves(app).length>before&&!storageBusy(app),'Explicit file import did not finish its native save attempt');}
function noBrowserScoreStorage(app){assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'),false,'Native persistence must not open the legacy IndexedDB score archive');}

test('actual app lists native editions independently of a bundled score with the same score ID and activates the chosen copy',async()=>{
  const saved=authoredScore({title:'Authored saved edition <A>'}),second=authoredScore({title:'Authored saved edition B'});
  const server=await nativeScoreServer({scores:[saved,second]}),app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);
    const [firstKey,secondKey]=server.records.keys(),bundled=app.document.querySelector(`#catalog [data-score-id="${fixture.id}"]`);
    assert.ok(bundled);assert.equal(savedRows(app).length,2);assert.equal(app.$('catalog').querySelectorAll('.catalog-item').length,3);
    const identities=[bundled,...savedRows(app)].map(button=>button.dataset.songKey);
    assert.ok(identities.every(Boolean),'Every song has a stable selection identity');assert.equal(new Set(identities).size,3);
    assert.equal(app.savedButton(firstKey).dataset.libraryKey,`native:${firstKey}`);assert.equal(app.savedButton(secondKey).dataset.libraryKey,`native:${secondKey}`);
    app.savedButton(firstKey).click();await app.until(()=>app.$('preview-title').textContent===saved.title&&!app.$('start-listen').disabled);
    assert.equal(app.savedButton(firstKey).getAttribute('aria-pressed'),'true');assert.equal(bundled.getAttribute('aria-pressed'),'false');
    await app.click('lobby-preview-play');await app.until(()=>app.$('lobby-preview-status').dataset.state==='playing');
    assert.ok(app.plays.some(args=>String(args[0]).startsWith('lobby:')));assert.equal(app.$('export-button').disabled,true,'Audition has not created a score session');
    await activate(app);assert.equal(app.$('score-title').textContent,saved.title);assert.deepEqual(await app.exported('export-button'),saved);
    assert.equal(saves(app).length,0,'Browsing, audition and activating an existing saved copy never autosave');noBrowserScoreStorage(app);
  }finally{await app.close();}
});

test('successful explicit file import saves one complete immutable canonical source and is selectable after a fresh app restart',async()=>{
  const original=authoredScore({id:'authored-import',title:'Authored complete source',source:{format:'authored-test-envelope-v1',filename:'original.json',content:'\uFEFF{"original":"AAEC/w==","rights":"original test fixture"}\r\n'}});
  const expected=structuredClone(original),server=await nativeScoreServer();let app=await nativeStorageApp(server);
  try {
    const raw=`\n${JSON.stringify(expected,null,2)}\r\n`;await enterLibrary(app);await imported(app,original,raw);
    assert.equal(saves(app).length,1);const request=saves(app)[0];
    assert.equal(request.options.method,'POST');assert.equal(request.body.score_json,raw);assert.equal(request.body.allow_conflicting_id,false);
    assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'same-origin');
    assert.equal(app.storageStatus().dataset.persistence,'saved');assert.match(app.storageStatus().textContent,/saved to the native game score folder/);
    const key=[...server.records.keys()][0];assert.ok(app.savedButton(key));assert.deepEqual(await app.exported('export-button'),expected);noBrowserScoreStorage(app);
    original.source.content='Uncommitted later caller edit';original.title='Uncommitted title';
    await app.close();app=await nativeStorageApp(server);await enterLibrary(app);
    assert.equal(saves(app).length,1,'Restart inventories existing content without saving it again');
    app.savedButton(key).click();await app.until(()=>app.$('preview-title').textContent===expected.title&&!app.$('start-listen').disabled);await activate(app);
    assert.deepEqual(await app.exported('export-button'),expected);assert.equal(saves(app).length,1);noBrowserScoreStorage(app);
  }finally{await app.close();}
});

test('duplicate imports reuse their saved key and conflicting IDs require the explicit keep-both action',async()=>{
  const first=authoredScore({id:fixture.id,title:'First authored edition'}),second=authoredScore({id:first.id,title:'Second authored edition'});
  const server=await nativeScoreServer({scores:[first]}),app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);const originalKey=[...server.records.keys()][0];await imported(app,first);
    assert.equal(server.records.size,1);assert.equal(savedRows(app).length,1);assert.ok(app.savedButton(originalKey));
    assert.equal(app.storageStatus().dataset.persistence,'saved');assert.match(app.storageStatus().textContent,/already saved/);assert.equal(app.storageAction('keepBoth').hidden,true);
    await imported(app,second);assert.equal(server.records.size,1);assert.equal(savedRows(app).length,1);
    assert.match(app.storageStatus().textContent,/same ID|shares an ID/);assert.equal(app.storageStatus().dataset.persistence,'not-saved');assert.equal(app.storageAction('keepBoth').hidden,false);
    assert.deepEqual(await app.exported('export-button'),second,'The unsaved conflicting import remains usable');
    const attempts=saves(app).length;await app.tick();assert.equal(saves(app).length,attempts,'A conflict never silently chooses an edition policy');
    app.storageAction('keepBoth').click();await app.until(()=>server.records.size===2&&!storageBusy(app));
    assert.equal(saves(app).length,attempts+1);assert.equal(saves(app).at(-1).body.allow_conflicting_id,true);assert.equal(savedRows(app).length,2);
    assert.ok(app.savedButton(originalKey));assert.equal(app.storageAction('keepBoth').hidden,true);assert.equal(app.storageStatus().dataset.persistence,'saved');noBrowserScoreStorage(app);
    const savedKey=[...server.records.keys()].find(key=>key!==originalKey);
    assert.equal(app.$('song-lobby').dataset.previewId,`native:${savedKey}`);
    assert.equal(app.savedButton(savedKey).getAttribute('aria-pressed'),'true');
    assert.equal(app.document.querySelector(`#catalog [data-score-id="${fixture.id}"]`).getAttribute('aria-pressed'),'false','A same-ID bundled song is not the saved edition');
  }finally{await app.close();}
});

test('native write failure keeps the imported score usable, shows a retry, and never falls back to browser score storage',async()=>{
  const score=authoredScore({id:'authored-retry',title:'Authored failed write'}),server=await nativeScoreServer();
  server.setRoute(({path})=>path==='/api/library/save'?nativeResponse({code:'library_io',error:'Test disk write was rejected'},500):undefined);
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await imported(app,score);
    assert.equal(server.records.size,0);assert.equal(savedRows(app).length,0);assert.equal(app.$('play-button').disabled,false);assert.deepEqual(await app.exported('export-button'),score);
    assert.equal(app.storageStatus().dataset.persistence,'not-saved');assert.match(app.storageStatus().textContent,/not saved.*remains usable/);assert.equal(app.storageAction('retry').hidden,false);noBrowserScoreStorage(app);
    server.setRoute(null);app.storageAction('retry').click();await app.until(()=>server.records.size===1&&!storageBusy(app));
    assert.equal(saves(app).length,2);assert.equal(app.storageStatus().dataset.persistence,'saved');assert.equal(app.storageAction('retry').hidden,true);noBrowserScoreStorage(app);
    const key=[...server.records.keys()][0];assert.equal(app.$('song-lobby').dataset.previewId,`native:${key}`);assert.equal(app.savedButton(key).getAttribute('aria-pressed'),'true');
  }finally{await app.close();}
});

test('a late import save retains its settings result without replacing a newer import error',async()=>{
  const score=authoredScore({id:'authored-delayed-save',title:'Accepted source A'}),server=await nativeScoreServer(),gate=deferred();
  server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/save'){await gate.promise;return defaultReply();}});
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);app.importFile(score);await app.until(()=>saves(app).length===1);
    app.importFile('{broken',{name:'newer-broken-source.json'});await app.until(()=>app.$('notice-message').textContent.includes('newer-broken-source.json'));
    const newerError=app.$('notice-message').textContent,identity=app.$('song-lobby').dataset.previewId;
    gate.resolve();await app.until(()=>!storageBusy(app));await app.tick();
    assert.equal(app.$('notice-message').textContent,newerError);assert.equal(app.$('notice').classList.contains('error'),true);
    assert.equal(app.storageStatus().dataset.persistence,'saved');assert.equal(savedRows(app).length,1);
    assert.equal(app.$('song-lobby').dataset.previewId,identity);assert.deepEqual(await app.exported('export-button'),score);noBrowserScoreStorage(app);
  }finally{gate.resolve();await app.close();}
});

for(const action of ['retry','keepBoth'])test(`a pending ${action} cannot select an older saved edition after a newer song selection`,async()=>{
  const score=authoredScore({title:`Authored ${action} edition`}),server=await nativeScoreServer({scores:action==='keepBoth'?[authoredScore({title:'Existing edition'})]:[]}),gate=deferred();
  if(action==='retry')server.setRoute(({path})=>path==='/api/library/save'?nativeResponse({code:'library_io',error:'Authored disk failure'},500):undefined);
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await imported(app,score);assert.equal(app.storageAction(action).hidden,false);
    server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/save'){await gate.promise;return defaultReply();}});
    await app.click('settings-button');app.storageAction(action).click();await app.until(()=>saves(app).length===2);
    app.$('settings-dialog').close();app.document.querySelector(`#catalog [data-score-id="${fixture.id}"]`).click();
    await app.until(()=>app.$('preview-title').textContent===fixture.title&&!app.$('start-listen').disabled);
    const notice=app.$('notice-message').textContent;
    gate.resolve();await app.until(()=>!storageBusy(app));await app.tick();
    assert.equal(app.storageStatus().dataset.persistence,'saved');assert.equal(app.$('preview-title').textContent,fixture.title);
    assert.equal(app.$('song-lobby').dataset.previewId,fixture.id);assert.equal(app.$('notice-message').textContent,notice);
    assert.equal(app.document.querySelector(`#catalog [data-score-id="${fixture.id}"]`).getAttribute('aria-pressed'),'true');
    assert.ok(savedRows(app).every(row=>row.getAttribute('aria-pressed')==='false'));
    assert.deepEqual(await app.exported('export-button'),score,'Changing the browsing candidate does not replace the active source');
  }finally{gate.resolve();await app.close();}
});

test('retry completion remains owned by its original import when a newer same-ID same-title source is adopted',async()=>{
  const source=content=>({format:'authored-source',filename:'original.txt',content});
  const first=authoredScore({title:'Same title',source:source('original A')}),second=authoredScore({title:'Same title',source:source('original B')}),server=await nativeScoreServer(),firstGate=deferred(),secondGate=deferred();
  server.setRoute(({path})=>path==='/api/library/save'?nativeResponse({code:'library_io',error:'Authored disk failure'},500):undefined);
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await imported(app,first);
    server.setRoute(async({path,body,defaultReply})=>{if(path==='/api/library/save'){await(JSON.parse(body.score_json).source.content==='original A'?firstGate:secondGate).promise;return defaultReply();}});
    app.storageAction('retry').click();await app.until(()=>saves(app).length===2);
    app.importFile(second);await app.until(()=>app.requests.filter(row=>row.path==='/api/compile'&&row.body?.source?.content==='original B').length>=1);await app.tick();await app.tick();
    assert.deepEqual(await app.exported('export-button'),second);
    firstGate.resolve();await app.until(()=>saves(app).length===3);await app.tick();
    const firstKey=[...server.records.keys()][0];assert.ok(app.savedButton(firstKey));
    assert.notEqual(app.$('song-lobby').dataset.previewId,`native:${firstKey}`);assert.equal(app.savedButton(firstKey).getAttribute('aria-pressed'),'false');
    assert.doesNotMatch(app.$('notice-message').textContent,/was saved to the native/);
    secondGate.resolve();await app.until(()=>!storageBusy(app));assert.deepEqual(await app.exported('export-button'),second);
    assert.match(app.storageStatus().textContent,/shares an ID/);assert.equal(server.records.size,1);
  }finally{firstGate.resolve();secondGate.resolve();await app.close();}
});

test('a save settling after Main menu and Free piano navigation preserves the live route and preview',async()=>{
  const score=authoredScore({id:'authored-navigation-save',title:'Pending navigation source'}),server=await nativeScoreServer(),gate=deferred();
  server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/save'){await gate.promise;return defaultReply();}});
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);app.importFile(score);await app.until(()=>saves(app).length===1);
    const identity=app.$('song-lobby').dataset.previewId;
    await app.click('lobby-home');await app.click('start-free-practice');assert.equal(app.document.body.dataset.screen,'free');
    const notice=app.$('notice-message').textContent;
    gate.resolve();await app.until(()=>!storageBusy(app));await app.tick();
    assert.equal(app.document.body.dataset.screen,'free');assert.equal(app.$('song-lobby').dataset.previewId,identity);assert.equal(app.$('notice-message').textContent,notice);
    assert.equal(app.storageStatus().dataset.persistence,'saved');assert.equal(savedRows(app).length,1);assert.equal(saves(app).length,1);
    await app.click('free-exit');assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('song-lobby').dataset.previewId,identity);
    assert.deepEqual(await app.exported('export-button'),score);
  }finally{gate.resolve();await app.close();}
});

test('auditioning a saved edition leaves the existing score and take exports intact',async()=>{
  const saved=authoredScore({title:'Separate authored audition'}),server=await nativeScoreServer({scores:[saved]}),app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await activate(app,'practice');
    const key=app.$('keyboard').querySelector('[data-midi="60"]');app.emit(key,'pointerdown',{pointerId:1,button:0});app.emit(key,'pointerup',{pointerId:1,button:0});
    await app.click('back-to-library');
    const beforeScore=await app.exported('export-button'),beforeTakes=await app.exported('export-takes'),title=app.$('score-title').textContent,progress=app.$('progress').value;
    assert.equal(beforeTakes.passes.length,1);assert.equal(beforeTakes.passes[0].inputs.length,1,'The preservation check includes a real captured note');
    app.savedButton([...server.records.keys()][0]).click();await app.until(()=>app.$('preview-title').textContent===saved.title&&!app.$('lobby-preview-play').disabled);
    await app.click('lobby-preview-play');await app.until(()=>app.$('lobby-preview-status').dataset.state==='playing');
    assert.equal(app.audio().contexts,2,'Session and audition have independent audio contexts');
    await app.click('settings-button');assert.equal(app.$('lobby-preview-status').dataset.state,'stopped');app.$('settings-dialog').close();
    assert.equal(app.$('score-title').textContent,title);assert.equal(app.$('progress').value,progress);
    assert.deepEqual(await app.exported('export-button'),beforeScore);assert.deepEqual(await app.exported('export-takes'),beforeTakes);assert.equal(saves(app).length,0);
  }finally{await app.close();}
});

test('a lost native commit response stays uncertain until rescan or explicit retry confirms the existing archive',async()=>{
  const score=authoredScore({id:'authored-uncertain',title:'Authored uncertain save'}),server=await nativeScoreServer();
  server.setRoute(({path,defaultReply})=>{if(path==='/api/library/save'){defaultReply();throw Error('Test response lost after native commit');}});
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await imported(app,score);
    assert.equal(server.records.size,1);assert.equal(savedRows(app).length,0);assert.equal(app.storageStatus().dataset.persistence,'unknown');assert.match(app.storageStatus().textContent,/unconfirmed/);
    assert.equal(app.$('play-button').disabled,false);assert.deepEqual(await app.exported('export-button'),score);noBrowserScoreStorage(app);
    server.setRoute(null);app.storageAction('rescan').click();await app.until(()=>savedRows(app).length===1&&!storageBusy(app));
    assert.equal(saves(app).length,1,'Rescan confirms the inventory without repeating the write');
    app.storageAction('retry').click();await app.until(()=>saves(app).length===2&&!storageBusy(app));
    assert.equal(server.records.size,1);assert.equal(savedRows(app).length,1);assert.equal(app.storageStatus().dataset.persistence,'saved');assert.match(app.storageStatus().textContent,/already saved/);noBrowserScoreStorage(app);
  }finally{await app.close();}
});

test('invalid and Rust-rejected file imports keep the existing session and never reach native persistence',async()=>{
  const rejected=authoredScore({id:'authored-rejected',title:'Rejected authored score'}),server=await nativeScoreServer();
  server.setRoute(({path,body})=>path==='/api/compile'&&body.id===rejected.id?nativeResponse({error:'Rejected canonical test score'},422):undefined);
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await activate(app);const original=await app.exported('export-button');
    app.importFile('{broken',{name:'broken.json'});await app.until(()=>app.$('notice-message').textContent.includes('broken.json'));
    assert.deepEqual(await app.exported('export-button'),original);assert.equal(saves(app).length,0);
    app.importFile(rejected);await app.until(()=>app.$('notice-message').textContent.includes('Rejected canonical test score'));
    assert.deepEqual(await app.exported('export-button'),original);assert.equal(app.$('play-button').disabled,false);assert.equal(saves(app).length,0);assert.equal(server.records.size,0);noBrowserScoreStorage(app);
  }finally{await app.close();}
});

test('late saved loads and cancelled audio admission cannot replace the newest selection or the active session',async()=>{
  const saved=authoredScore({title:'Delayed authored saved edition'}),server=await nativeScoreServer({scores:[saved]}),gate=deferred();
  server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/load'){await gate.promise;return defaultReply();}});
  const app=await nativeStorageApp(server);
  try {
    await enterLibrary(app);await activate(app);await app.click('back-to-library');const original=await app.exported('export-button');
    const key=[...server.records.keys()][0];app.savedButton(key).click();await app.until(()=>app.requests.some(row=>row.path==='/api/library/load'));
    app.document.querySelector(`#catalog [data-score-id="${fixture.id}"]`).click();await app.until(()=>app.$('preview-title').textContent===fixture.title&&!app.$('start-listen').disabled);
    gate.resolve();await app.tick();await app.tick();assert.equal(app.$('preview-title').textContent,fixture.title);
    assert.equal(app.requests.some(row=>row.path==='/api/compile'&&row.body.title===saved.title),false,'A cancelled late native load never reaches preview compilation');
    server.setRoute(null);app.savedButton(key).click();await app.until(()=>app.$('preview-title').textContent===saved.title&&!app.$('start-listen').disabled);
    const unlock=deferred();app.setUnlock(()=>unlock.promise);await app.click('start-listen');await app.click('lobby-home');unlock.resolve();await app.tick();await app.tick();
    assert.equal(app.document.body.dataset.screen,'home');assert.deepEqual(await app.exported('export-button'),original);assert.equal(saves(app).length,0);
  }finally{gate.resolve();await app.close();}
});

test('a superseded file read and cancelled editor draft never autosave; ordinary tempo edits do not create saved copies',async()=>{
  const server=await nativeScoreServer(),app=await nativeStorageApp(server),read=deferred();
  try {
    await enterLibrary(app);const stale=authoredScore({id:'authored-stale',title:'Stale file'}),current=authoredScore({id:'authored-current',title:'Current file'});
    app.importFile(stale,{text:()=>read.promise});await imported(app,current);read.resolve(JSON.stringify(stale));await app.tick();await app.tick();
    assert.equal(app.$('score-title').textContent,current.title);assert.equal(saves(app).length,1);assert.equal(JSON.parse(saves(app)[0].body.score_json).id,current.id);
    const before=await app.exported('export-button');await app.click('jianpu-editor-button');app.$('jianpu-text').value='title: Unsaved authored draft\n1 2 3 4';app.emit(app.$('jianpu-text'),'input');await app.click('jianpu-editor-cancel');
    await app.click('transposition-button');app.$('transposition-semitones').value='2';app.emit(app.$('transposition-semitones'),'input');await app.click('transposition-cancel');
    assert.deepEqual(await app.exported('export-button'),before);assert.equal(saves(app).length,1);
    app.$('tempo').value='90';app.emit(app.$('tempo'),'change');await app.until(()=>app.requests.some(row=>row.path==='/api/compile'&&row.body.tempo?.[0]?.bpm===90));await app.tick();await app.tick();
    assert.equal(saves(app).length,1,'Recompiling a tempo edit does not autosave a new archive');
  }finally{read.resolve('{}');await app.close();}
});

test('settings shows the backend path, rescans metadata and exports complete native backups while unavailable folder controls stay disabled',async()=>{
  const score=authoredScore({id:'authored-settings',title:'Authored settings score',source:{format:'original-authored-test',filename:'source.txt',content:'Exact authored source\r\n'}});
  const server=await nativeScoreServer({scores:[score],issues:[{code:'library_backup_missing',message:'Test fixture backup is missing'}]}),app=await nativeStorageApp(server);
  try {
    await ready(app);await app.click('home-settings');const panel=app.document.querySelector('[data-score-storage]');
    assert.ok(panel.closest('#settings-dialog'));assert.equal(panel.querySelector('.score-storage-path').textContent,server.directory);
    assert.match(panel.textContent,/Native game score folder/);assert.match(panel.textContent,/Test fixture backup is missing/);
    for(const action of ['choose','open']){assert.equal(app.storageAction(action).disabled,true);assert.match(app.storageAction(action).textContent,/not available yet/);}
    const controlsBefore=app.requests.length;app.storageAction('choose').click();app.storageAction('open').click();await app.tick();assert.equal(app.requests.length,controlsBefore);
    const added=server.seed(authoredScore({id:'authored-rescan',title:'Authored external inventory change'})),listCount=app.requests.filter(row=>row.path==='/api/library/list').length;
    assert.equal(app.savedButton(added.key),null);app.storageAction('rescan').click();await app.until(()=>app.savedButton(added.key)&&!storageBusy(app));
    assert.equal(app.requests.filter(row=>row.path==='/api/library/list').length,listCount+1);
    const downloads=app.downloads.length;app.storageAction('backup').click();await app.until(()=>app.downloads.length===downloads+1&&!storageBusy(app));
    const backup=JSON.parse(await app.downloads.at(-1).text());assert.equal(backup.format,'worldmusichub-library-backup');assert.equal(backup.version,1);assert.equal(backup.entries.length,2);
    assert.deepEqual(backup.entries.find(entry=>entry.score.id===score.id).score,score);assert.equal(app.requests.filter(row=>row.path==='/api/library/export').length,2);
    assert.match(app.storageStatus().textContent,/Backup download requested/);assert.equal(saves(app).length,0);noBrowserScoreStorage(app);
    app.$('settings-dialog').close();await app.click('library-button');await app.until(()=>app.$('score-library').getAttribute('aria-busy')==='false');
    assert.match(app.$('library-button').textContent,/Legacy browser archives/i,'The legacy browser archive must identify its separate storage');
    assert.match(app.$('score-library').textContent,/browser|IndexedDB/i);
    assert.equal(app.$('library-list').children.length,0,'The browser archive does not impersonate the native inventory');
  }finally{await app.close();}
});
