import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {partActivityMidi} from './part-activity-browser-fixture.js';
export const PART_ACTIVITY_BROWSER_CASE='real machine activity follows admitted source gates without human input or display coupling';
export const PART_ACTIVITY_VIEWPORTS=Object.freeze([[1280,720],[1920,1080],[844,390],[390,844]]);
export function readPartActivityGeometry(){
 const visible=node=>Boolean(node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
 const box=node=>{if(!visible(node))return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 const root=document.querySelector('.part-activity-strip');
 return{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
 host:box(document.querySelector('.part-activity-host')),strip:box(root),row:box(root?.querySelector('.part-activity-row')),state:root?.querySelector('.part-activity-row')?.dataset.state??null,label:root?.querySelector('.part-activity-name')?.textContent??null,
 clock:JSON.parse(document.querySelector('#progress')?.getAttribute('data-playback-clock')||'null'),
 reachable:Object.fromEntries(['#play-button','#reset-button'].map(selector=>{const node=document.querySelector(selector),r=node?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return[selector,Boolean(node&&hit&&(node===hit||node.contains(hit)))];})),
 controls:Object.fromEntries(['#play-button','#reset-button','#piano-scroll','#keyboard','.performance-status'].map(selector=>[selector,box(document.querySelector(selector))])),
 notes:root?.querySelectorAll('canvas,.key,[data-note-id],.falling-note').length??0,keyboardInput:root?.dataset.keyboardInput,live:root?.getAttribute('aria-live'),pageLive:root?.querySelector('.part-activity-page-label')?.getAttribute('aria-live')};
}
export function assertPartActivityGeometry(s,{visible}){
 assert.ok(PART_ACTIVITY_VIEWPORTS.some(([w,h])=>w===s.width&&h===s.height));assert.ok(s.documentWidth<=s.width+1&&s.documentHeight<=s.height+1,'Document overflow hides stage controls');
 const inside=r=>{assert.ok(r&&Object.values(r).every(Number.isFinite));assert.ok(r.width>0&&r.height>0&&r.x>=-1&&r.y>=-1&&r.x+r.width<=s.width+1&&r.y+r.height<=s.height+1);};
 for(const id of ['#play-button','#reset-button','#piano-scroll'])inside(s.controls[id]);for(const id of ['#play-button','#reset-button'])assert.equal(s.reachable[id],true);assert.ok(s.controls['#keyboard']?.height>=80);
 if(!visible){assert.equal(s.host,null);assert.equal(s.strip,null);return;}
 inside(s.host);inside(s.strip);inside(s.row);assert.equal(s.host.height,56);assert.equal(s.strip.height,56);for(const r of Object.values(s.controls).filter(Boolean)){const a=s.strip;assert.ok(a.x+a.width<=r.x+1||r.x+r.width<=a.x+1||a.y+a.height<=r.y+1||r.y+r.height<=a.y+1,'Strip overlaps human controls');}assert.equal(s.notes,0);assert.equal(s.keyboardInput,'off');assert.equal(s.live,'off');assert.equal(s.pageLive,'polite');
}
export function assertPartActivitySourceEvidence(e,{suffix=''}={}){
 const fixture=partActivityMidi({suffix}),source=Buffer.from(e.sourceBase64,'base64'),response=Buffer.from(e.responseBase64,'base64'),hash=b=>createHash('sha256').update(b).digest('hex');
 assert.deepEqual(source,fixture.bytes);assert.equal(e.sourceSha256,fixture.sha256);assert.equal(e.sourceBytes,source.length);assert.equal(e.httpStatus,200);assert.equal(e.responseSha256,hash(response));assert.equal(e.responseBytes,response.length);const imported=JSON.parse(response);assert.ok(imported.score);assert.deepEqual(e.imported,imported);assert.equal(imported.score.source.format,'midi-base64');assert.equal(imported.score.source.content,source.toString('base64'));return imported.score;
}
