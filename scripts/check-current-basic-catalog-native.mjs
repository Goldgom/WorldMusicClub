// ORIGINAL production DOM + Rust stdin regression. No browser, GUI, or listener.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {authoredLegacyPack} from '../tests/native-import-driver-fixtures.js';
import {digest} from '../tests/clean-song-package-fixtures.js';
import {basicKeyAcceptanceFixture} from './prepare-basic-key-fixtures.mjs';
import {practiceBaselineReady} from './pack-management-acceptance-fixtures.mjs';
import {getAppI18n} from '../web/app-locale.js';

const binary = process.env.WMH_NATIVE_IMPORT_DRIVER;
assert.ok(binary, 'An independently built native_import_driver is required');
const root = await mkdtemp(join(tmpdir(), 'wmc-original-current-basic-')), directory = join(root, 'Scores');
const basic = basicKeyAcceptanceFixture(), legacy = authoredLegacyPack(), sentinel = Buffer.from('Original current Basic outside sentinel');
await writeFile(join(root, 'outside-sentinel'), sentinel);
const report = {version: 1, kind: 'original-current-basic-catalog-production-dom-native-stdio', source_commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), source_tree: execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(), fixture: basic.manifest, driver_build_source: process.env.WMH_CATALOG_DRIVER_BUILD_SHA || null, driver_sha256: digest(await readFile(binary)), browser: false, native_window: false, physical_audio: false, network_listener: false, ok: false, cases: [], api: []};
let driver, app, wall=1000;
const advance=milliseconds=>{wall+=milliseconds;app.renderAudioTo((wall-1000)/1000);app.frame();};
const transport = {requests: [], async fetcher(path, options = {}) {
  const body = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer()) : options.body;
  const row = {path, method: options.method || 'GET', body: typeof body === 'string' ? JSON.parse(body) : null}; transport.requests.push(row);
  const response = await driver.fetcher(path, {...options, body}), bytes = await response.bytes();
  Object.assign(row, {status: response.status, sha256: digest(bytes)});
  if(path.startsWith('/api/library/'))report.api.push({...row, response: response.contentType.includes('json') ? JSON.parse(bytes) : null});
  const result = new Response(bytes,{status: response.status,headers:{'Content-Type':response.contentType}});Object.defineProperty(result,'url',{value:`https://wmh.localhost${path}`});return result;
}};
const json = async (path, body) => { const response = await transport.fetcher(path,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value; };
async function upload(filename, body) { const response=await transport.fetcher('/api/library/import/commit',{method:'POST',headers:{'content-type':'application/octet-stream','x-wmh-filename':encodeURIComponent(filename)},body});assert.equal(response.status,200);return response.json(); }
const cat = suffix => app.$(`management-catalog-${suffix}`), click = suffix => app.click(`management-catalog-${suffix}`);
async function open(phase='ready') {await app.click('library-management-button');await app.until(()=>!app.$('management-catalog-button').hidden);await app.click('management-catalog-button');await app.until(()=>app.$('management-catalog').dataset.phase===phase);}
async function review(suffix='preview') {await click(suffix);await app.until(()=>!cat('review').hidden);}
async function confirm() {await click('confirm');await app.until(()=>app.$('management-catalog').dataset.phase==='ready'&&cat('review').hidden);}
function box(id) {return app.document.querySelector(`[data-catalog-edition="${id}"]`);}
function select(id) {const input=box(id);assert.ok(input);assert.equal(input.disabled,false);input.checked=true;app.emit(input,'change');}
async function retained() {const result={};async function walk(relative=''){for(const entry of await readdir(join(directory,relative),{withFileTypes:true})){if(!relative&&(entry.name.includes('catalog')||entry.name==='.library.lock'))continue;assert.equal(entry.isSymbolicLink(),false);const name=relative?`${relative}/${entry.name}`:entry.name;if(entry.isDirectory())await walk(name);else result[name]=digest(await readFile(join(directory,name)));}}await walk();return result;}
async function externalTransition(edition, action, trashOperationId=null) {
  const external=startVsqNativeDriver({binary,directory});
  try {
    const call=async(suffix,body)=>{const response=await external.fetcher(`/api/library/catalog/${suffix}`,{method:suffix==='status'?'GET':'POST',headers:{'Content-Type':'application/json'},body:suffix==='status'?undefined:JSON.stringify(body)}),bytes=await response.bytes(),value=JSON.parse(bytes);assert.equal(response.status,200,JSON.stringify(value));(report.external_calls??=[]).push({process_id:external.pid,suffix,body:body??null,response:value});return value;};
    const status=await call('status'),plan=await call('preview',{action,edition_ids:[edition],trash_operation_id:trashOperationId,expected_generation:status.generation,catalog_digest:status.catalog_digest,library_id:status.library_id});
    await call('commit',{library_id:status.library_id,preview:plan.preview});return plan;
  } finally {await external.close();}
}
const passed = name => report.cases.push({name,ok:true});
try {
  driver=startVsqNativeDriver({binary,directory});
  const basicImport=await upload('original-basic-guard.zip',basic.bytes), legacyImport=await upload('original-legacy-guard.zip',legacy.bytes);
  const basicKey=basicImport.items.find(row=>row.status==='saved').entry.key, edition=`clean:${basicKey}`, legacyKey=legacyImport.items.find(row=>row.status==='saved').entry.key;
  const originalFiles=await retained();
  app=await nativeStorageApp(transport,{now:()=>wall});await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');
  await open('uninitialized');await review('initialize-preview');await confirm();await app.click('management-close');
  app.savedButton(basicKey).click();await app.until(()=>app.$('song-lobby').dataset.previewId===`native:${basicKey}`&&!app.$('start-practice').disabled);
  await app.click('start-practice');await app.until(()=>/Pause/.test(app.$('play-button').textContent));advance(200);const pianoKey=app.$('keyboard').querySelector('[data-midi="60"]');app.emit(pianoKey,'pointerdown',{pointerId:9,button:0});advance(100);app.emit(pianoKey,'pointerup',{pointerId:9});await app.click('play-button');
  if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
  app.$('engraving-page-size').value='2';app.emit(app.$('engraving-page-size'),'change');await app.click('jianpu-button');
  await app.until(()=>report.api.some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===200&&row.body.settings.measure_count===2));
  await app.click('results-button');await app.click('assess-button');advance(1000);await app.until(()=>practiceBaselineReady(app.document),'Original Basic assessment settles');app.$('results-dialog').close();
  await app.click('back-to-library');const beforeTakes=await app.exported('export-takes'), beforeAudio=app.audio();
  await open();assert.equal(box(edition).disabled,true);getAppI18n(app.document).setLocale('zh-CN');assert.match(cat('rows').textContent,/请先选择并打开另一首歌/);
  const commits=report.api.filter(row=>row.path==='/api/library/catalog/commit').length;
  box(edition).checked=true;app.emit(box(edition),'change');await click('preview');assert.equal(cat('review').hidden,true);assert.equal(report.api.filter(row=>row.path==='/api/library/catalog/commit').length,commits);
  await app.click('management-close');assert.deepEqual(await app.exported('export-takes'),beforeTakes);assert.deepEqual(app.audio(),beforeAudio);
  getAppI18n(app.document).setLocale('en');await app.click('resume-session');
  const requestCount=report.api.length;await app.click('engraving-next');
  await app.until(()=>report.api.slice(requestCount).some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===200&&row.body.settings.first_measure>=2),'Later original native Basic page succeeds');
  assert.equal(report.api.slice(requestCount).some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===409),false);
  assert.deepEqual(await app.exported('export-takes'),beforeTakes);assert.deepEqual(await retained(),originalFiles);
  passed('paused-current-basic-is-unselectable-and-later-native-pages-and-takes-survive');
  const firstPart=app.$('practice-part').value, alternate=[...app.$('practice-part').options].find(option=>!option.disabled&&option.value!==firstPart)?.value;
  assert.ok(alternate,'Original fixture supplies another supported Basic part');
  let handoffStart=report.api.length;app.$('practice-part').value=alternate;app.emit(app.$('practice-part'),'change');
  await app.until(()=>report.api.slice(handoffStart).some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===200&&row.body.settings.part_id===alternate),'Normal Basic part switch requests the actual native source');
  assert.equal(app.$('engraving-basic-meter').disabled,false);app.$('engraving-basic-meter').value='3/4';app.emit(app.$('engraving-basic-meter'),'change');
  handoffStart=report.api.length;app.$('engraving-basic-view-mode').value='source';app.emit(app.$('engraving-basic-view-mode'),'change');
  await app.until(()=>report.api.slice(handoffStart).some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===200&&row.body.settings.display_meter?.numerator===3&&!row.body.settings.rendition_policy_id),'Source inspection honors the custom display meter');
  await app.click('back-to-library');await open();assert.equal(box(edition).disabled,true);await app.click('management-close');await app.click('resume-session');
  handoffStart=report.api.length;app.$('engraving-basic-view-mode').value='rendition';app.emit(app.$('engraving-basic-view-mode'),'change');
  await app.until(()=>report.api.slice(handoffStart).some(row=>row.path==='/api/library/basic-keys/notation'&&row.status===200&&row.body.settings.display_meter?.numerator===3&&row.body.settings.rendition_policy_id),'Playable rendition keeps its actual native source after the view change');
  await app.click('back-to-library');await open();assert.equal(box(edition).disabled,true);await app.click('management-close');
  app.$('preview-part').value=firstPart;app.emit(app.$('preview-part'),'change');await app.until(()=>!app.$('start-practice').disabled);await app.click('start-practice');await app.until(()=>/Pause/.test(app.$('play-button').textContent));await app.click('back-to-library');
  await open();assert.equal(box(edition).disabled,true);await app.click('management-close');await app.click('resume-session');
  assert.deepEqual(await retained(),originalFiles);passed('normal-part-preview-meter-and-rendition-handoffs-keep-exact-adapter-protection');

  await app.click('back-to-library');app.savedButton(legacyKey).click();await app.until(()=>app.$('song-lobby').dataset.previewId===`native:${legacyKey}`&&!app.$('start-practice').disabled);app.$('count-in').checked=false;
  await app.click('start-practice');await app.until(()=>/Pause/.test(app.$('play-button').textContent));await app.click('back-to-library');
  await open();select(edition);await review();await confirm();assert.equal((await json('/api/library/catalog/query',{view:'trash',refresh:true,limit:100})).rows.some(row=>row.edition_id===edition),true);
  assert.deepEqual(await retained(),originalFiles);passed('explicit-song-switch-allows-the-exact-basic-edition-trash-without-changing-retained-files');
  await click('trash');await app.until(()=>box(edition)&&!box(edition).disabled);select(edition);await review();await confirm();await app.click('management-close');
  app.savedButton(basicKey).click();await app.until(()=>app.$('song-lobby').dataset.previewId===`native:${basicKey}`&&!app.$('start-practice').disabled);
  // A separate native owner removes only this ORIGINAL fixture after preview admission.
  const externalTrash=await externalTransition(edition,'trash_songs');
  const stageTitle=app.$('stage-title').textContent, takes=await app.exported('export-takes');await app.click('start-practice');
  await app.until(()=>app.$('start-practice').disabled&&report.api.some(row=>row.path==='/api/library/load'&&row.body?.key===basicKey&&row.status===409));
  assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('stage-title').textContent,stageTitle);assert.deepEqual(await app.exported('export-takes'),takes);
  assert.match(app.$('preview-status').textContent,/no longer active/);assert.deepEqual(await retained(),originalFiles);passed('external-trash-blocks-new-preview-admission-without-replacing-current-session');
  await externalTransition(edition,'restore_songs',externalTrash.preview.request.operation_id);
  await app.click('settings-button');app.storageAction('rescan').click();await app.until(()=>app.savedButton(basicKey));app.$('settings-dialog').close();
  app.savedButton(basicKey).click();await app.until(()=>!app.$('start-practice').disabled);
  await externalTransition(edition,'trash_songs');
  await app.click('settings-button');app.storageAction('rescan').click();await app.until(()=>!app.savedButton(basicKey)&&app.$('start-practice').disabled);app.$('settings-dialog').close();
  assert.equal(app.$('stage-title').textContent,stageTitle);assert.deepEqual(await app.exported('export-takes'),takes);assert.deepEqual(await retained(),originalFiles);
  passed('external-rescan-invalidates-only-the-stale-preview-and-keeps-the-admitted-session');
  report.source_hashes={};for(const path of ['web/app.js','web/native-score-storage.js','web/library-catalog-model.js','web/library-catalog-view.js','web/library-management-view.js','scripts/check-current-basic-catalog-native.mjs'])report.source_hashes[path]=digest(await readFile(new URL(`../${path}`,import.meta.url)));
  report.ok=true;
} catch(error) {if(app)report.failure_state={summary:app.$('result-summary').dataset,assessDisabled:app.$('assess-button').disabled,feedback:app.$('feedback-results').textContent,notice:app.$('preview-status').textContent};report.error=error.stack||String(error);process.exitCode=1;}
finally {try{await app?.close();await driver?.close();assert.deepEqual(await readFile(join(root,'outside-sentinel')),sentinel);}finally{await rm(root,{recursive:true,force:true});if(process.env.WMH_CURRENT_BASIC_REPORT){await mkdir(dirname(process.env.WMH_CURRENT_BASIC_REPORT),{recursive:true});await writeFile(process.env.WMH_CURRENT_BASIC_REPORT,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify({...report,api:report.api.length},null,2));}}
