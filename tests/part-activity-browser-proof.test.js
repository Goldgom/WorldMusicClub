import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {partActivityMidi} from './part-activity-browser-fixture.js';import {assertPartActivityGeometry,assertPartActivitySourceEvidence,partActivityMinimumKeyHeight,PART_ACTIVITY_LOOP,partActivityLoopTargets} from './part-activity-browser-proof.js';
const rect=(x,y,width,height)=>({x,y,width,height}),base=()=>({width:1280,height:720,documentWidth:1280,documentHeight:720,host:rect(0,650,1280,56),strip:rect(0,650,1280,56),row:rect(160,654,1100,44),controls:{'#play-button':rect(0,600,80,40),'#reset-button':rect(90,600,40,40),'#keyboard':rect(0,400,1280,180),'#piano-scroll':rect(0,400,1280,180)},reachable:{'#play-button':true,'#reset-button':true},notes:0,keyboardInput:'off',live:'off',pageLive:'polite'});
test('original fixture is deterministic MIDI with running rests and bounded bilingual labels',()=>{const a=partActivityMidi();assert.deepEqual(a,partActivityMidi());assert.equal(a.bytes.subarray(0,4).toString(),'MThd');assert.equal(a.bytes.readUInt16BE(10),3);assert.equal(a.rights.license,'CC0-1.0');assert.deepEqual(a.gateWindows.silent,[5000,7000]);assert.equal(a.durationMs,20000);assert.ok(a.names[1].length>80&&a.names[1].length<160);});
test('strip geometry rejects overlap, clipping, notes, unreachable controls and vertical overflow',()=>{assertPartActivityGeometry(base(),{visible:true});for(const mutate of [s=>s.controls['#keyboard'].height=260,s=>s.strip.y=700,s=>s.notes=1,s=>s.host=null,s=>s.live='polite',s=>s.documentHeight=722,s=>s.reachable['#play-button']=false]){const s=base();mutate(s);assert.throws(()=>assertPartActivityGeometry(s,{visible:true}));}});
test('collapse cannot excuse hidden human controls',()=>{const s=base();s.width=390;s.height=844;s.documentWidth=390;s.documentHeight=844;s.host=s.strip=null;s.controls['#keyboard']=s.controls['#piano-scroll']=rect(0,400,390,180);assertPartActivityGeometry(s,{visible:false});s.controls['#play-button']=null;assert.throws(()=>assertPartActivityGeometry(s,{visible:false}));});
test('replacement source has distinct exact bytes',()=>{assert.notEqual(partActivityMidi().sha256,partActivityMidi({suffix:' replacement'}).sha256);});
test('source evidence rejects mutated fixture bytes, substituted response and changed source payload',()=>{const f=partActivityMidi(),imported={score:{source:{format:'midi-base64',content:f.bytes.toString('base64')}}},bytes=Buffer.from(JSON.stringify(imported)),e={sourceBase64:f.bytes.toString('base64'),sourceSha256:f.sha256,sourceBytes:f.bytes.length,httpStatus:200,responseBase64:bytes.toString('base64'),responseSha256:createHash('sha256').update(bytes).digest('hex'),responseBytes:bytes.length,imported};assertPartActivitySourceEvidence(e);for(const mutate of [s=>s.sourceBase64=Buffer.from('wrong').toString('base64'),s=>s.responseSha256='0'.repeat(64),s=>s.imported.score.source.content='different']){const v=structuredClone(e);mutate(v);assert.throws(()=>assertPartActivitySourceEvidence(v));}});

test('missing activity rectangles identify the exact failed viewport and element',()=>{for(const key of ['host','strip','row']){const sample=base();sample[key]=null;assert.throws(()=>assertPartActivityGeometry(sample,{visible:true}),new RegExp(`activity ${key}: missing or nonfinite rectangle at 1280x720`));}});
test('activity viewport samples require fresh real playback after display Mod changes and retain CI evidence',()=>{
 const source=readFileSync(new URL('./part-activity-browser-regression.js',import.meta.url),'utf8'),loop=source.slice(source.indexOf('for(const [width,height]of PART_ACTIVITY_VIEWPORTS)'),source.indexOf("for(const [label,options]of"));
 const ordered=["await page.setViewportSize({width,height})","await page.locator('#play-button').click()",'await waitForPlaybackClockAdvance(page)','const geometryPlan=await plan(',"assert.deepEqual(geometryPlan[field],originalPlan[field]",'await pause()',"await waitState('paused')",'const s=await snapshot(', 'assertPartActivityGeometry(s,{visible:width>=1280})',"showOtherParts:false",'const baseline=await snapshot(',"showOtherParts:true"];
 let at=-1;for(const fragment of ordered){const next=loop.indexOf(fragment,at+1);assert.ok(next>at,`Missing or out-of-order real geometry step: ${fragment}`);at=next;}
 assert.match(source,/worldmusichub-live-part-activity\.json/);assert.match(source,/worldmusichub-part-activity-\$\{width\}x\$\{height\}\.png/);
 const workflow=readFileSync(new URL('../.github/workflows/check.yml',import.meta.url),'utf8');assert.match(workflow,/\/tmp\/worldmusichub-live-\*\.json/);assert.match(workflow,/\/tmp\/worldmusichub-\*\.png/);
});

test('activity key-height floors match the existing shared piano CSS media policies',()=>{
 const css=readFileSync(new URL('../web/piano-stage.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
 const keyHeight=items=>items.filter(rule=>rule.selectorText==='.piano-workspace'&&rule.style?.getPropertyValue('--piano-key-height')).at(-1)?.style.getPropertyValue('--piano-key-height');
 const compact=rules.filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
 const portrait=rules.filter(rule=>rule.media?.mediaText==='(max-width:650px)').flatMap(rule=>[...rule.cssRules]);
 assert.equal(keyHeight(compact),'78px');assert.equal(keyHeight(portrait),'110px');assert.equal(keyHeight(rules),'clamp(110px,calc(17 * var(--wmc-viewport-unit,1vh)),170px)');
 for(const [width,height,minimum]of [[844,390,78],[651,600,78],[650,600,110],[651,601,110],[390,844,110],[1280,720,110],[1920,1080,110]])assert.equal(partActivityMinimumKeyHeight({width,height}),minimum);
});
test('compact activity accepts the established keybed, but rejects undersize, nonfinite and zero-width keys',()=>{
 const compact=base();Object.assign(compact,{width:844,height:390,documentWidth:844,documentHeight:390,host:null,strip:null,row:null});
 compact.controls={'#play-button':rect(59,350,106,36),'#reset-button':rect(19,350,34,36),'#piano-scroll':rect(11,137,822,209),'#keyboard':rect(11,268,822,78)};
 assertPartActivityGeometry(compact,{visible:false});
 for(const change of [{height:77.99},{height:0},{height:NaN},{height:Infinity},{width:0},{width:NaN},{x:Infinity}]){const value=structuredClone(compact);Object.assign(value.controls['#keyboard'],change);assert.throws(()=>assertPartActivityGeometry(value,{visible:false}),/Keyboard/);}
 for(const [width,height]of [[390,844],[1280,720],[1920,1080]]){const value=base();Object.assign(value,{width,height,documentWidth:width,documentHeight:height});value.host=value.strip=value.row=null;value.controls={'#play-button':rect(0,300,80,40),'#reset-button':rect(90,300,40,40),'#piano-scroll':rect(0,100,width,180),'#keyboard':rect(0,100,width,110)};assertPartActivityGeometry(value,{visible:false});value.controls['#keyboard'].height=109.99;assert.throws(()=>assertPartActivityGeometry(value,{visible:false}),/accepted piano keybed height/);}
});

test('activity loop includes an original human attack and rejects the machine-only interval',()=>{
 const human='original-human',notes=[{part_id:human,start_ms:0,duration_ms:1000,midi:60},{part_id:human,start_ms:19000,duration_ms:1000,midi:64}];
 assert.deepEqual(PART_ACTIVITY_LOOP,{fromBeat:'0',toBeat:'10',startMs:0,endMs:10000});assert.deepEqual(partActivityLoopTargets(notes,human),[notes[0]]);
 assert.throws(()=>partActivityLoopTargets(notes,human,{startMs:2000,endMs:10000}),/original human note-on/);
 assert.throws(()=>partActivityLoopTargets([{...notes[0],part_id:'machine'}],human),/original human ownership/);
 for(const range of [{startMs:0,endMs:0},{startMs:NaN,endMs:10000},{startMs:0,endMs:Infinity}])assert.throws(()=>partActivityLoopTargets(notes,human,range),/ordered finite bounds/);
 const source=readFileSync(new URL('./part-activity-browser-regression.js',import.meta.url),'utf8'),loop=source.slice(source.indexOf('const loopTargets='),source.indexOf('report.audio='));
 assert.match(loop,/partActivityLoopTargets\(positive.target_plan.timeline.notes,human\)/);assert.match(loop,/fill\(PART_ACTIVITY_LOOP.fromBeat\)/);assert.match(loop,/fill\(PART_ACTIVITY_LOOP.toBeat\)/);
 assert.equal((loop.match(/ui\('#loop-apply'\)\.click\(\)/g)||[]).length,1,'One visible Apply enables the loop; uncheck alone disables it');assert.doesNotMatch(loop,/loop-enabled'\)\.check\(/);
 for(const guard of ["waitState('silent',[5000,7000])","waitState('playing',[8500,9500])","waitState('playing',[2000,3000])",'assert.deepEqual(loopTake.target_plan.timeline.notes,loopTargets','c.rangeStartMs===startMs&&c.rangeEndMs===endMs','c.rangeEndMs===c.durationMs'])assert.ok(loop.includes(guard),guard);
});
