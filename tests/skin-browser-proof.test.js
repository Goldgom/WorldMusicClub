import {readPureTestFiles} from '../scripts/run-pure-tests.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {originalBrowserSkin, originalSkinPng, originalSkinScore, sha256} from './skin-browser-fixture.js';
import {prepareSkinPackage} from '../web/skin-storage.js';
import {assertSkinPresentation, assertStoredBrowserSkin, assertExecutedSkinCases, validateSkinInteractionReport, validateSkinPersistenceReport, SKIN_BROWSER_CASES, SKIN_SCREENSHOTS} from './skin-browser-proof.js';
import {registerSkinBrowserRegressions} from './skin-browser-regression.js';
import {verifyUiPreviewSkin} from '../scripts/ui-preview-skin.mjs';

// Synthetic contract inputs only. No browser, server, screenshots or PCM are
// produced here. Hosted execution must supply all of those independently.
const fixture = originalBrowserSkin(), theme = JSON.stringify({mode:'custom',accent:'#326b4c',background:'#f4f6f1'});
function stored(selected = 'imported') { return {version:1,selected,manifest:fixture.json.toString(),manifestSha256:fixture.jsonSha256,resources:[{path:'assets/checker.png',bytes:fixture.png.length,sha256:fixture.pngSha256}]}; }
function settings(selected = 'imported', locale = 'en') { return {locale,selected,choice:selected,active:selected === 'imported' ? fixture.manifest.id : null,importedDisabled:false,theme,
  presentation:{'--skin-human-fill':'#FBBF24','--skin-machine-fill':'#67E8F9','--skin-key-white':'#F8FAFC','--skin-background-image':'url("blob:contract-input")'},
  title:locale === 'en' ? 'Piano skin' : '钢琴皮肤',status:locale === 'en' ? 'Imported skin is selected and saved for this browser profile.' : '已使用导入皮肤，并保存到此浏览器配置。',
  scope:locale === 'en' ? 'Background images decorate the home artwork only.' : '背景图片仅用于首页装饰。',diagnostics:locale === 'en' ? 'Stage background images are unsupported. This skin’s layout settings are unsupported.' : '此处不支持谱面区域背景图片。',
  legend:[{role:'human',marker:'square',pattern:'solid'},{role:'machine',marker:'triangle',pattern:'solid'}]}; }
const decoration = () => ({image:true,width:16,height:16,opacity:'0.2',pointerEvents:'none',ariaHidden:'true'});
const screenshots = names => names.map(name => ({name,bytes:2000,sha256:'a'.repeat(64),width:1280,height:720}));
function presentation() {
  const rect = {x:0,y:0,width:800,height:120}, geometry = {clock:{phase:'paused',running:false,completed:false,available:true,positionMs:100},activityRows:[{partId:'machine',state:'paused'}],activity:{x:0,y:640,width:800,height:56},viewport:{width:1280,height:720},canvas:{...rect},keyboard:{...rect},transport:{...rect},keys:Array.from({length:61},(_,i)=>({midi:String(i+36),rect:{x:i*10,y:200,width:10,height:100}})),sameKeyNodes:true};
  const marker = midi => { const pixels = [];for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)pixels.push({x,y,color:midi === 60 || Math.abs(x)<=Math.floor((y+3)/2) ? '#111111' : '#67e8f9',alpha:255});return {midi,pixels,foregroundPixels:pixels.filter(pixel=>pixel.color==='#111111').length}; };
  const replacement=originalBrowserSkin({replacement:true});
  return {fixture:{id:fixture.manifest.id,manifestSha256:fixture.jsonSha256,pngSha256:fixture.pngSha256},attemptedReplacement:{id:replacement.manifest.id,manifestSha256:replacement.jsonSha256,pngSha256:replacement.pngSha256},imported:settings(),invalid:{...settings(),status:'The skin was not changed. Check the JSON.'},storageFailure:{...settings(),status:'The skin was not changed because local storage is unavailable.'},
    fault:{method:'native-indexeddb-write-transaction-abort',aborted:1},storedImported:stored(),storedAfterInvalid:stored(),storedAfterFailure:stored(),reset:{...settings('default'),status:'Your imported skin is still available.'},storedReset:stored('default'),reselected:settings(),chinese:settings('imported','zh-CN'),themeBefore:theme,themeAfter:theme,skinRequests:[],geometryBefore:geometry,geometryAfter:structuredClone(geometry),readyGeometryBefore:{...structuredClone(geometry),clock:{phase:'ready',running:false,completed:false,available:true,positionMs:0},activityRows:[],activity:null},readyGeometryAfter:{...structuredClone(geometry),clock:{phase:'ready',running:false,completed:false,available:true,positionMs:0},activityRows:[],activity:null},
    paint:{skin:fixture.manifest.id,humanIds:['human'],machineIds:['machine'],labels:'true',fillPixels:{'#fbbf24':500,'#67e8f9':500},keys:[{midi:62,background:'rgb(248, 250, 252)'},{midi:61,background:'rgb(17, 17, 17)'}],markers:[marker(60),marker(67)],laneBackground:'none',homeImage:'url("blob:contract-input")',homeAriaHidden:'true'},pressed:{pressed:'true',background:'rgb(37, 99, 235)'},homeDecoration:decoration(),screenshots:screenshots(SKIN_SCREENSHOTS.slice(0,4))};
}
function persistence() {
  const profileId = 'b'.repeat(64), rounds = Array.from({length:3},(_,i)=>({origin:'http://127.0.0.1:4123',profileId,newContext:true,priorPageClosed:i?true:null,pageClosed:true,settings:settings(i===2?'default':'imported',i===2?'zh-CN':'en'),stored:stored(i===2?'default':'imported')}));
  Object.assign(rounds[1],{decoration:decoration(),afterReset:settings('default','zh-CN'),storedReset:stored('default')});
  Object.assign(rounds[2],{decoration:{image:false,ariaHidden:'true'},reselected:settings('imported','zh-CN'),storedReselected:stored()});
  return {version:1,kind:'persistence',ok:true,originalFixturesOnly:true,physicalAudio:false,scope:'same-origin-same-Chromium-user-data-directory',profileId,rounds,pageErrors:[],apiFailures:[],screenshots:screenshots(SKIN_SCREENSHOTS.slice(4))};
}

test('original procedural skin input has deterministic validated PNG bytes and disclosed home-only scope', async () => {
  assert.deepEqual(originalSkinPng(), fixture.png);assert.equal(sha256(fixture.png), fixture.pngSha256);
  const pkg = await prepareSkinPackage(fixture.json, new Map([['assets/checker.png',fixture.png]]));
  assert.equal(pkg.resolved.skin.id, fixture.manifest.id);assert.deepEqual(pkg.resolved.homeDecoration.bytes, new Uint8Array(fixture.png));
  assert.equal(pkg.resolved.background_bytes, null);assert.ok(pkg.resolved.diagnostics.some(row=>row.path==='background_image'));
  assert.notEqual(pkg.resolved.skin.notes.human.marker,pkg.resolved.skin.notes.machine.marker);
  const replacement=originalBrowserSkin({replacement:true}), next=await prepareSkinPackage(replacement.json,new Map([['assets/checker.png',replacement.png]]));
  assert.notEqual(replacement.pngSha256,fixture.pngSha256);assert.notEqual(next.resolved.skin.id,pkg.resolved.skin.id);assert.notEqual(next.resolved.skin.notes.human.fill,pkg.resolved.skin.notes.human.fill);
  assert.deepEqual(originalSkinScore().parts.map(part=>part.id),['human','machine']);assert.match(originalSkinScore().source.content,/\r\n/);
});

test('retained skin record rejects changed original bytes, wrong selection and absent artwork', () => {
  assertStoredBrowserSkin(stored());assertStoredBrowserSkin(stored('default'),'default');
  for (const mutate of [r=>r.selected='default',r=>r.manifest+=' ',r=>r.manifestSha256='0'.repeat(64),r=>r.resources=[],r=>r.resources[0].sha256='0'.repeat(64),r=>r.resources[0].bytes++,r=>r.resources[0].path='elsewhere.png']) {
    const report = stored();mutate(report);assert.throws(()=>assertStoredBrowserSkin(report));
  }
});

test('presentation oracle rejects lost roles, erased markers, geometric/input/theme changes and concealed failures', () => {
  assertSkinPresentation(presentation());
  const mutations = [r=>r.paint.fillPixels['#fbbf24']=0,r=>r.paint.machineIds=[],r=>r.paint.markers[1]=structuredClone(r.paint.markers[0]),r=>r.paint.markers[0].pixels[24].color='#fbbf24',
    r=>r.paint.laneBackground='url("blob:unsupported")',r=>r.paint.keys[0].background='rgb(255, 255, 255)',r=>r.pressed.pressed='false',r=>r.geometryAfter.keys[0].rect.x++,r=>r.geometryAfter.sameKeyNodes=false,r=>r.readyGeometryAfter.canvas.height++,r=>r.readyGeometryAfter.keys[0].rect.y++,r=>r.readyGeometryAfter.sameKeyNodes=false,r=>r.geometryAfter.clock.positionMs++,r=>{r.geometryBefore.clock.phase='ready';r.geometryAfter.clock.phase='ready';},r=>{r.geometryBefore.activityRows[0].state='playing';r.geometryAfter.activityRows[0].state='playing';},r=>{r.geometryBefore.activity=null;r.geometryAfter.activity=null;},r=>{r.readyGeometryBefore.activity=r.geometryBefore.activity;r.readyGeometryAfter.activity=r.geometryBefore.activity;},
    r=>r.skinRequests.push({path:'/api/compile'}),r=>r.themeAfter='{}',r=>r.invalid.active=null,r=>r.storageFailure.status='Saved',r=>r.fault.aborted=0,r=>r.storedAfterFailure.selected='default',
    r=>r.reset.importedDisabled=true,r=>r.chinese.locale='en',r=>r.imported.scope='Full stage background supported',r=>r.homeDecoration.pointerEvents='auto',r=>r.screenshots.pop(),
    r=>r.attemptedReplacement=r.fixture,r=>r.storageFailure.presentation['--skin-human-fill']='#67E8F9',r=>r.storageFailure.presentation['--skin-background-image']='url("blob:replacement")'];
  for (const [i, mutate] of mutations.entries()) { const report = presentation();mutate(report);assert.throws(()=>assertSkinPresentation(report), `Presentation adversary ${i} accepted`); }
});

test('profile oracle requires fresh closed contexts, one origin/profile, selected and default reopen, exact bytes and retained slot', () => {
  validateSkinPersistenceReport(persistence());
  const mutations = [r=>r.ok=false,r=>r.physicalAudio=true,r=>r.scope='storageState-copy',r=>r.rounds.pop(),r=>r.rounds[1].profileId='c'.repeat(64),r=>r.rounds[1].origin='http://127.0.0.1:4124',r=>r.rounds[1].newContext=false,
    r=>r.rounds[0].pageClosed=false,r=>r.rounds[1].priorPageClosed=false,r=>r.rounds[1].stored.resources[0].sha256='d'.repeat(64),r=>r.rounds[2].settings.active=fixture.manifest.id,
    r=>r.rounds[2].settings.locale='en',r=>r.rounds[2].reselected.importedDisabled=true,r=>r.rounds[2].decoration.image=true,r=>r.pageErrors.push('uncaught'),r=>r.apiFailures.push('failed'),r=>r.screenshots[0].width=16];
  for (const [i, mutate] of mutations.entries()) { const report = persistence();mutate(report);assert.throws(()=>validateSkinPersistenceReport(report), `Profile adversary ${i} accepted`); }
});

test('interaction report cannot pass on an ok flag and plausible UI data without real live audio evidence', () => {
  const paused={position:500,mode:'practice',captured:'1'}, report={version:1,kind:'interaction',ok:true,originalFixturesOnly:true,physicalAudio:false,audioScope:'finite-checkpoint-windows',route:'settings',release:'keyup',...presentation(),scoreBefore:originalSkinScore(),scoreAfter:originalSkinScore(),pausedBefore:paused,pausedAfter:structuredClone(paused)};
  assert.throws(()=>validateSkinInteractionReport(report));
});

test('skin preview requires exact executed passing cases; skipped, TODO, duplicate and substring names fail closed', () => {
  const lines = SKIN_BROWSER_CASES.map(({name},i)=>`ok ${i+1} - ${name}`), tap = lines.join('\n');assertExecutedSkinCases(tap);
  for (const invalid of ['',lines[0],tap.replace('ok 1','not ok 1'),tap.replace(lines[0],lines[0]+' # SKIP filtered'),tap.replace(lines[0],lines[0]+' # TODO'),tap+'\n'+lines[0],tap.replace(lines[0],lines[0]+' extra')]) {
    assert.throws(()=>assertExecutedSkinCases(invalid));assert.throws(()=>verifyUiPreviewSkin('/never-read-with-invalid-tap',invalid));
  }
});

test('two bounded browser cases register without launching a browser and retain real UI and profile contracts', async () => {
  const rows=[];registerSkinBrowserRegressions({test:(name,options,run)=>rows.push({name,options,run})});
  assert.deepEqual(rows.map(row=>row.name),SKIN_BROWSER_CASES.map(row=>row.name));assert.ok(rows.every(row=>row.options.timeout===120_000&&typeof row.run==='function'));
  const source=await readFile(new URL('./skin-browser-regression.js',import.meta.url),'utf8');
  assert.match(source,/launchPersistentContext\(profile,/);assert.doesNotMatch(source,/storageState|dispatchEvent|setContent|fake-indexeddb/);
  assert.match(source,/await context.close\(\)/);assert.match(source,/page.keyboard.down\('r'\)/);assert.match(source,/page.keyboard.up\('r'\)/);
  assert.match(source,/page\.screenshot\(/);assert.match(source,/getImageData\(/);assert.match(source,/native-indexeddb-write-transaction-abort/);
});

test('skin registration reaches aggregate, focused and hosted preview gates while preserving all four live-silence cases', async () => {
  const [suite, verifier, workflow, packageText] = await Promise.all(['tests/full-app-browser.test.js','scripts/verify-ui-preview.mjs','.github/workflows/ui-preview.yml','package.json'].map(path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')));
  assert.equal((suite.match(/registerSkinBrowserRegressions\(\{/g)||[]).length,1);
  assert.match(suite,/getOrigin:\(\)=>origin/);assert.match(suite,/getRequests:getRequestsForLocale/);
  assert.match(verifier,/\.\.\.SKIN_BROWSER_CASES\.map\(row=>row.name\)/);assert.match(verifier,/\.\.\.verifyUiPreviewSkin\(directory,tap\)/);
  const pattern = workflow.match(/--test-name-pattern='([^']+)'/);assert.ok(pattern);const expression = new RegExp(pattern[1]);
  for (const {name} of SKIN_BROWSER_CASES) assert.ok(expression.test(name));
  for (const route of ['settings','authoring']) for (const release of ['keyup','navigation']) assert.ok(expression.test(`real unmuted live worklet verifies finite silence through ${route} after ${release}`));
  const {scripts} = JSON.parse(packageText);
  for (const files of [readPureTestFiles(),scripts['test:skin'].split(/\s+/)]) assert.equal(files.filter(path=>path==='tests/skin-browser-proof.test.js').length,1);
});

test('skin geometry pairs READY with READY and paused admission with paused admission',async()=>{
  const report=presentation();
  for(const key of ['readyGeometryBefore','readyGeometryAfter'])report[key].canvas.height+=24;
  assertSkinPresentation(report);
  for(const mutate of [
    row=>{row.geometryAfter=structuredClone(row.readyGeometryBefore);},
    row=>{row.readyGeometryAfter=structuredClone(row.geometryBefore);},
    row=>{row.geometryAfter.canvas.height--;},
    row=>{row.geometryAfter.activity.height--;},
    row=>{row.geometryAfter.activityRows[0].partId='replacement';},
  ]){const changed=structuredClone(report);mutate(changed);assert.throws(()=>assertSkinPresentation(changed));}
  const source=await readFile(new URL('./skin-browser-regression.js',import.meta.url),'utf8');
  const readyBefore=source.indexOf('report.readyGeometryBefore ='),readyAfter=source.indexOf('report.readyGeometryAfter ='),play=source.indexOf("await page.locator('#play-button').click()"),paused=source.indexOf('report.pausedBefore ='),baseline=source.indexOf("await selectSkin(page, 'default');await closeShellPanels()"),before=source.indexOf('report.geometryBefore ='),after=source.indexOf('report.geometryAfter =');
  assert.ok(readyBefore<readyAfter&&readyAfter<play&&play<paused&&paused<baseline&&baseline<before&&before<after);
  assert.equal((source.match(/stageGeometry\(page, true\)/g)||[]).length,1,'Keep original human key identity across both comparisons');
});
