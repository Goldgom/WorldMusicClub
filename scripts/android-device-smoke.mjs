/** Inspect an already installed debug APK. No install, data clearing or settings changes. */
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || `${process.env.LOCALAPPDATA}/Android/Sdk`;
const adb = process.env.ADB || resolve(sdk, `platform-tools/adb${process.platform==='win32'?'.exe':''}`);
const output = resolve('dist/android/device-smoke');
const execute = (...args) => execFileSync(adb, args, {encoding:'utf8'}).trim();
const sleep = delay => new Promise(resolve=>setTimeout(resolve,delay));
const serial = process.env.ANDROID_SERIAL;
const device = (...args) => execute(...(serial?['-s',serial]:[]),...args);
let browser,forward;
await mkdir(output,{recursive:true});
const errors=[];
try {
  const packageInfo=JSON.parse(await readFile('dist/android/BUILD-INFO.json','utf8'));
  const apkBytes=await readFile('dist/android/worldmusicclub-debug.apk');
  assert.equal(createHash('sha256').update(apkBytes).digest('hex'),packageInfo.apk_sha256,'Local APK differs from build identity');
  const installedPath=device('shell','pm','path','org.worldmusicclub.android').replace(/^package:/,'');
  assert.match(installedPath,/^\/data\/app\/[a-zA-Z0-9_~=.\/-]+\.apk$/,'Unexpected installed package path');
  const installedSha=device('shell','sha256sum',installedPath).split(/\s/)[0];
  assert.equal(installedSha,packageInfo.apk_sha256,'Installed APK differs from the local build; reinstall before testing');
  device('shell','am','start','-n','org.worldmusicclub.android/.MainActivity');
  let pid,socketReady=false;
  for(let i=0;i<30;i++) {
    try { pid=device('shell','pidof','org.worldmusicclub.android'); }
    catch { await sleep(500);continue; }
    const sockets=device('shell','cat','/proc/net/unix');
    if(sockets.includes(`webview_devtools_remote_${pid}`)){socketReady=true;break;}
    await sleep(500);
  }
  assert.match(pid,/^\d+$/,'App process did not start');
  assert.ok(socketReady,'Debug WebView did not become ready; check the app startup error and logcat');
  forward=device('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);
  for(let i=0;i<30;i++) {
    try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{noDefaults:true});break; }
    catch(error){if(i===29)throw error;await sleep(500);}
  }
  const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url()==='https://wmh.localhost/');
  assert.ok(page,'Actual bundled WebView target is missing');
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.querySelector('#catalog')?.querySelector('button'),{},{timeout:30000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const report=await page.evaluate(async()=>{
    const get=async path=>{const r=await fetch(path);if(!r.ok)throw new Error(`${path}: ${r.status}`);return r.json();};
    const health=await get('/api/health'),build=await get('/api/diagnostics/build'),catalog=await get('/api/catalog');
    const response=await fetch('/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(catalog[0])});
    const compiled=await response.json();
    const denied=await fetch('/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:'{bad json'});
    const storage=await get('/api/library/list');
    const worklet=await fetch('/canonical-audio-processor.js');
    const audio=new AudioContext();
    try { await audio.audioWorklet.addModule('/canonical-audio-processor.js'); }
    finally { await audio.close(); }
    const blobUrl=URL.createObjectURL(new Blob([new Uint8Array([0,128,255])],{type:'application/octet-stream'}));
    let blobBytes;
    try { blobBytes=Array.from(new Uint8Array(await (await fetch(blobUrl)).arrayBuffer())); }
    finally { URL.revokeObjectURL(blobUrl); }
    return {origin:location.origin,health,build,catalogCount:catalog.length,compileStatus:response.status,
      compiled,invalidStatus:denied.status,storage,workletStatus:worklet.status,workletModuleLoaded:true,blobBytes,
      renderedCatalogButtons:document.querySelectorAll('#catalog button').length,
      layout:{viewport:{width:innerWidth,height:innerHeight},shell:document.querySelector('.app-shell').getBoundingClientRect().toJSON(),
        supports:{dynamicViewport:CSS.supports('height','100dvh'),relationalSelectors:CSS.supports('selector(:has(*))')}}};
  });
  assert.equal(report.health.engine,'rust');
  assert.equal(report.health.network,'native-protocol-no-listener');
  assert.equal(report.compileStatus,200);
  assert.equal(report.invalidStatus,400);
  assert.equal(report.workletStatus,200);
  assert.deepEqual(report.blobBytes,[0,128,255]);
  assert.ok(report.catalogCount>0);
  assert.ok(report.renderedCatalogButtons>0);
  assert.ok(report.layout.shell.height>=report.layout.viewport.height-2,'Visible application shell collapsed below the viewport; inspect the actual screenshot');
  assert.equal(report.build.compiled.source_sha,packageInfo.source_sha);
  assert.equal(report.build.compiled.source_tree,packageInfo.source_tree);
  assert.equal(report.build.compiled.source_status,packageInfo.source_dirty?'dirty':'clean');
  report.package=packageInfo; report.device={serial:serial||null,api:device('shell','getprop','ro.build.version.sdk'),abis:device('shell','getprop','ro.product.cpu.abilist'),pid};
  report.pageErrors=errors;assert.deepEqual(errors,[]);
  await page.screenshot({path:resolve(output,'android-webview.png')});
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Android device startup, bundled UI, Rust compile/errors, worklet assets and private storage passed. Evidence: ${output}`);
} finally {
  await browser?.close();
  if(forward)device('forward','--remove',`tcp:${forward}`);
}
