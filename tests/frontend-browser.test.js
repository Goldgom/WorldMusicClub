import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {fixture} from './frontend-fixtures.js';
import {pitchMidi, beat} from '../web/music.js';
let server, browser, context, page, origin, pageErrors;
const requests=[];
const web=fileURLToPath(new URL('../web/',import.meta.url));
function compile(score) { return {score,timeline:{notes:score.parts.flatMap(p=>p.notes.filter(n=>n.pitch).map(n=>({id:n.id,part_id:p.id,midi:pitchMidi(n.pitch),start_ms:beat(n.at)*60000/score.tempo[0].bpm,duration_ms:beat(n.duration)*60000/score.tempo[0].bpm,voice:n.voice,staff:n.staff}))),duration_ms:1000*120/score.tempo[0].bpm},diagnostics:[]}; }
before(async () => {
 server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body});res.setHeader('Content-Type','application/json');if(req.url==='/api/catalog')return res.end(JSON.stringify([fixture]));if(req.url==='/api/compile'){const score=JSON.parse(body);if(!score.parts){res.statusCode=400;return res.end(JSON.stringify({error:'Score needs at least one part.'}))}return res.end(JSON.stringify(compile(score)))}if(req.url==='/api/assess'){const data=JSON.parse(body);return res.end(JSON.stringify({hits:data.inputs.length?[{grade:'perfect',note_id:'c4'}]:[],misses:['e4'],extras:[],accuracy_percent:data.inputs.length?50:0,mean_abs_error_ms:data.inputs.length?20:null}))}if(req.url==='/api/import/image')return res.end(JSON.stringify({version:1,width:10,height:10,format:'png',status:'unsupported',requires_review:true,assumptions:['Treble clef assumed'],warnings:['No supported staff found.'],staffs:[],candidates:[]}));const path=req.url==='/'?'index.html':req.url.slice(1);if(path.includes('..')||path.includes('?')){res.statusCode=404;return res.end()}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(web+path))}catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(existsSync);
 browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
beforeEach(async()=>{context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(origin);await page.locator('#play-button:not([disabled])').waitFor();});
afterEach(async()=>{assert.deepEqual(pageErrors,[]);await context.close();});
test('complete exercise UI, notation modes, all keyboard ranges and guitar',async()=>{
 assert.equal(await page.locator('#score-title').textContent(),'Test <score>');assert.equal(await page.locator('.piano-key').count(),61);
 await page.locator('#jianpu-button').click();assert.equal(await page.locator('.jianpu-note').count(),2);await page.locator('#staff-button').click();assert.equal(await page.locator('.note-head').count(),2);
 for(const count of [49,76,88,61]){await page.locator('#key-count').selectOption(String(count));assert.equal(await page.locator('.piano-key').count(),count)}
 await page.locator('#instrument').selectOption('guitar');assert.equal(await page.locator('.fret-button').count(),78);assert.equal(await page.locator('#guitar-stage').isVisible(),true);await page.locator('[data-string="5"][data-fret="0"]').click();
 await page.locator('#instrument').selectOption('piano');await page.screenshot({path:'/tmp/worldmusichub-desktop.png',fullPage:true});
});
test('keyboard notes are released on blur; pause/reset remain repeatable',async()=>{
 await page.locator('h1').click();await page.keyboard.down('a');assert.equal(await page.locator('.piano-key.pressed').count(),1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await page.locator('.piano-key.pressed').count(),0);await page.keyboard.up('a');
 await page.locator('#count-in').uncheck();await page.locator('#play-button').click();await page.waitForTimeout(130);await page.locator('#play-button').click();assert.match(await page.locator('#transport-status').textContent(),/Paused/);await page.locator('#play-button').click();await page.waitForTimeout(100);await page.locator('#reset-button').click();assert.equal(await page.locator('#progress').getAttribute('value'),'0');assert.equal(await page.locator('.piano-key.pressed').count(),0);
});
test('practice records input only after playback begins and submits canonical clock',async()=>{
 await page.locator('#session-mode').selectOption('practice');await page.locator('#count-in').uncheck();await page.locator('#play-button').click();await page.keyboard.press('a');await page.locator('#assess-button').click();await page.locator('#feedback-results').waitFor();assert.equal(await page.locator('#accuracy').textContent(),'50%');const request=requests.filter(r=>r.url==='/api/assess').at(-1);const data=JSON.parse(request.body);assert.equal(data.inputs.length,1);assert.equal(data.inputs[0].midi,60);assert.ok(data.inputs[0].at_ms>=0);assert.equal(data.tolerance_ms,180);
});
test('tempo recompiles, export retains canonical JSON and invalid import is recoverable',async()=>{
 await page.locator('#tempo').fill('60');await page.locator('#tempo').dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('#time-label').textContent.endsWith('/ 0:02'));
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'test-score.json');
 await page.locator('#score-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{oops')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Could not read'));assert.equal(await page.locator('#play-button').isEnabled(),true);
 await page.locator('#score-file').setInputFiles({name:'shape.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('at least one part'));assert.equal(await page.locator('#score-title').textContent(),'Test <score>');
});
test('mobile layout keeps document within viewport and piano scrolls locally',async()=>{
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);const geometry=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,view:innerWidth,piano:document.querySelector('#piano-scroll').scrollWidth}));assert.ok(geometry.doc<=geometry.view+1,JSON.stringify(geometry));assert.ok(geometry.piano>geometry.view);await page.screenshot({path:'/tmp/worldmusichub-mobile.png',fullPage:true});
});
