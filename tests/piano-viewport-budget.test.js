import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {pianoViewportBudget,observePianoViewportBudget} from '../web/piano-viewport-budget.js';
import {settlePianoViewportBudget} from './browser-piano-budget.js';

test('short-landscape Mod and navigation stay compact when the shared stage switches between piano and guitar',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<html><style>${css}</style><body class="game-shell"><main id="workspace" class="piano-workspace"><div class="piano-workspace-heading"><section id="song-mod-stage"><button id="edit-song-mod"></button><span id="song-mod-stage-summary"></span></section><nav><button id="settings-button" class="button"></button></nav></div></main></body></html>`),rules=[...document.querySelector('style').sheet.cssRules];
  const scoped=rules.filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
  const summary=scoped.find(rule=>rule.selectorText.endsWith(' #song-mod-stage-summary'));
  assert.ok(summary,'The compact rule must cover the failing 844×390 viewport without changing desktop or portrait');
  assert.equal(summary.style.position,'absolute','Long localized Mod prose must not consume the navigation width or a new heading row');
  assert.equal(summary.style.width,'1px');assert.equal(summary.style.height,'1px');assert.equal(summary.style['clip-path'],'inset(50%)');
  assert.notEqual(summary.style.display,'none','Keep the full button description available to assistive reading');
  assert.notEqual(summary.style.visibility,'hidden');
  const button=scoped.find(rule=>rule.selectorText.endsWith(' #edit-song-mod'));
  assert.equal(button.style.flex,'none');assert.equal(button.style['white-space'],'nowrap','The existing Mod control keeps its complete label');
  const mod=scoped.find(rule=>rule.selectorText.endsWith('>#song-mod-stage'));
  const navigation=scoped.find(rule=>rule.selectorText.endsWith(' .piano-workspace-heading nav .button'));
  for(const piano of [true,false,true]){
    document.getElementById('workspace').classList.toggle('piano-workspace',piano);
    for(const [id,rule]of [['song-mod-stage',mod],['song-mod-stage-summary',summary],['edit-song-mod',button],['settings-button',navigation]])assert.equal(document.getElementById(id).matches(rule.selectorText),true,`${id} keeps its compact rule in ${piano?'piano':'guitar'}`);
  }
});

test('narrow landscape reserves six real navigation targets without consuming a second music row',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
  const narrow=rules.find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px) and (max-width:1000px)');
  assert.ok(narrow,'The full 651–1000px range needs usable navigation targets without tall wrapped labels');
  const targets=[...narrow.cssRules].find(rule=>rule.style?.width==='34px');
  for(const id of ['library-button','import-tools-button','score-tools-button','settings-button','results-button','back-to-library'])assert.ok(targets.selectorText.includes('#'+id));
  assert.equal(targets.style.flex,'0 0 34px');assert.equal(targets.style['min-width'],'34px');assert.equal(targets.style['min-height'],'34px');
  assert.equal(targets.style.overflow,'hidden','Full text cannot paint over an adjacent pointer target');
  for(const property of ['display','visibility','pointer-events'])assert.equal(targets.style.getPropertyValue(property),'','Every action remains operable');
  const icons=[...narrow.cssRules].find(rule=>rule.selectorText?.includes('::before'));
  assert.equal(icons.style.content,"''");assert.equal(icons.style['pointer-events'],'none','Decorative icons cannot intercept the original button');
  const gap=Number.parseFloat([...narrow.cssRules].find(rule=>rule.selectorText?.endsWith(' .piano-workspace-heading')).style.gap);
  const primary=[...narrow.cssRules].find(rule=>rule.selectorText?.includes('>#notation-toggle'));
  const mod=[...narrow.cssRules].find(rule=>rule.selectorText?.endsWith(' #edit-song-mod'));
  // Include the full 64px title + observed 70.6875px guide + 6px grid gap,
  // all five primary actions, and the existing fullscreen target.
  const titleAndGuide=64+70.6875+6,toolRow=6*34+5*3;
  const required=34+titleAndGuide+2*parseFloat(primary.style['max-width'])+parseFloat(mod.style['max-width'])+5*gap+toolRow;
  for(const width of [651,700,731,800])assert.ok(required<=width-20,`${width}px reserves every target inside both 10px workspace edges`);
});

test('viewport capacity accounts for real footer overflow, preserves spare desktop space and converts CSS zoom once',()=>{
  assert.deepEqual(pianoViewportBudget({viewportBottom:720,laneHeight:308,transportBottom:729.796875,bottomPadding:8}),{height:290.2,available:290.2,deficit:0});
  const spacious=pianoViewportBudget({viewportBottom:1080,laneHeight:488,transportBottom:995.8,bottomPadding:16});
  assert.ok(spacious.height>=540,'A 52px HUD must not remove music height when the full desktop still has room');
  const zoomed=pianoViewportBudget({viewportBottom:720,laneHeight:375,transportBottom:780,zoom:1.25,bottomPadding:8});
  assert.equal(zoomed.height,244);assert.equal(780-375+zoomed.height*1.25+8*1.25,720,'The new CSS height fits its actual zoomed pixels');
  const tight=pianoViewportBudget({viewportBottom:390,laneHeight:100,transportBottom:410,bottomPadding:6});
  assert.deepEqual(tight,{height:100,available:74,deficit:26},'An impossible chrome budget cannot silently shrink the readable lane');
  assert.equal(pianoViewportBudget({viewportBottom:720,laneHeight:0,transportBottom:700}),null);
});

test('measured compact chrome leaves room for the complete extreme keybed, live HUD and fixed transport',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),all=[...document.querySelector('style').sheet.cssRules];
  const short=all.filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]),style=selector=>short.findLast(rule=>rule.selectorText===selector).style;
  const workspace=style('.game-shell.performance-layout #workspace,.game-shell #workspace.piano-workspace,.game-shell #free-practice-screen.piano-workspace');
  const status=style('.game-shell #workspace.piano-workspace .play-panel>.performance-status'),counter=style('.game-shell #workspace.piano-workspace .performance-status .onset-counter>span,.game-shell #workspace.piano-workspace .performance-status #hud-accuracy');
  const toolbar=style('.game-shell .piano-stage-shared .piano-stage-toolbar'),transport=style('.game-shell.performance-layout #workspace.piano-workspace .play-panel[data-instrument=piano]>.piano-compact-transport');
  const heading=all.find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:801px) and (max-width:1000px)');
  const headingRules=[...heading.cssRules],headingHeight=parseFloat(headingRules.find(rule=>rule.selectorText.endsWith(' .piano-workspace-heading')).style['min-height']);
  // Actual 500 evidence: 844×390, visible notice 40px + 4px margin,
  // heading 44.09375px, READY status 36.390625px, extreme keybed 104px,
  // lane floor 100px, transport 44.84375px. Total was 433.328125px.
  const old=44+4+44.09375+4+36.390625+40+100+4+104+2+44.84375+6;
  assert.equal(old,433.328125);assert.ok(old>390);
  const notice=34+2,liveStatus=parseFloat(counter['line-height'])+parseFloat(status['padding-top'])+parseFloat(status['padding-bottom'])+2;
  const fullSeekAndLabel=38.84375,transportHeight=Math.max(parseFloat(transport['min-height']),fullSeekAndLabel+parseFloat(transport['padding-top'])+parseFloat(transport['padding-bottom'])+2);
  const chrome=notice+parseFloat(workspace['padding-top'])+headingHeight+parseFloat(workspace.gap)+liveStatus+parseFloat(toolbar['min-height'])+4+104+2+transportHeight+parseFloat(workspace['padding-bottom']);
  assert.ok(chrome+100<=390,'Even the 22px live counter, 104px glyph keybed and complete seek target fit beside the unchanged 100px lane');
  assert.equal(style('.piano-workspace')['--piano-lane-height'],'max(100px,var(--piano-available-lane-height,calc(32dvh + 1px)))','Remaining space must keep the transport anchored across live HUD changes instead of stopping at a viewport-percentage cap');
  const available=pianoViewportBudget({viewportBottom:390,laneHeight:100,transportBottom:chrome+100-parseFloat(workspace['padding-bottom']),bottomPadding:parseFloat(workspace['padding-bottom'])});
  assert.ok(available.height>=100);assert.equal(available.deficit,0);
  const reveal=pianoViewportBudget({viewportBottom:390,laneHeight:100,transportBottom:chrome+100-26-2,bottomPadding:2});
  const next=pianoViewportBudget({viewportBottom:390,laneHeight:reveal.height,transportBottom:390-2+2,bottomPadding:2});
  assert.equal(next.height,reveal.height-2,'The observed 2px live change with the 78px keybed is absorbed by the lane, preserving the bottom transport position');
  const hint=all.findLast(rule=>rule.selectorText==='.game-shell #workspace.piano-workspace .performance-status>.performance-hint').style;
  assert.equal(hint.flex,'none');assert.equal(hint['max-width'],'50%','The observed D768 hint can use idle horizontal space, retaining every word');
});

test('wider compact header reserves separate title, guide, mapping and navigation targets',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),all=[...document.querySelector('style').sheet.cssRules];
  const rules=[...all.find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:801px) and (max-width:1000px)').cssRules];
  const heading=rules.find(rule=>rule.selectorText.endsWith('.stage-heading:has(>.beginner-controls-compact)')).style,meta=rules.find(rule=>rule.selectorText.endsWith(' .keyboard-stage-meta')).style;
  assert.equal(heading['grid-template-columns'],'minmax(64px,1fr) max-content auto');assert.equal(meta['grid-column'],'3');assert.equal(meta['grid-row'],'1');
  // Existing measured guide 70.6875px and mapping target 81.671875px retain
  // their native sizes beside a 64px title and 54px mode text minimum.
  assert.ok(64+70.6875+81.671875+54+4+12<=parseFloat(heading['min-width']));
  const mod=rules.find(rule=>rule.selectorText.endsWith(' #edit-song-mod')).style;
  assert.equal(mod['white-space'],'nowrap');assert.equal(mod['max-width'],'none');
  const primary=rules.find(rule=>rule.selectorText.endsWith('>:is(#notation-toggle,#rhythm-stage-free)')).style;
  assert.equal(2*parseFloat(primary['line-height'])+parseFloat(primary['padding-top'])+parseFloat(primary['padding-bottom'])+2,34,'Both complete two-line primary labels fit their unchanged 34px targets');
  const oldModText=92-18,newMod=(oldModText*11/12)+parseFloat(mod['padding-left'])+parseFloat(mod['padding-right'])+2;
  const reserved=parseFloat(heading['min-width'])+34+70+70+newMod+(6*34+5*3)+5*4;
  for(const width of [801,844,900,1000])assert.ok(reserved<=width-20,`${width}px preserves every target inside the 10px workspace edges`);
});

test('actual heading changes and 125 percent zoom refresh one shared normal/Free capacity without synchronous observer writes',()=>{
  const tree=id=>`<main id="${id}" class="piano-workspace"><div class="piano-workspace-heading"></div><div class="piano-lanes-shared"></div><div class="piano-keybed-shared"></div><div class="piano-transport"></div></main>`;
  const {document}=parseHTML(`<html lang="en"><body data-screen="stage">${tree('workspace')}${tree('free-practice-screen')}</body></html>`);
  let laneHeight=360,zoom=1,normalChrome=300,freeChrome=260,serial=0,callback,disconnected=false;const frames=new Map(),values=new Map(),writes=[];
  Object.defineProperty(document.body,'style',{value:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);writes.push([key,value]);laneHeight=Math.min(360,parseFloat(value));},removeProperty:key=>values.delete(key)}});
  for(const [id,chrome]of [['workspace',()=>normalChrome],['free-practice-screen',()=>freeChrome]]){
    const root=document.getElementById(id);root.querySelector('.piano-lanes-shared').getBoundingClientRect=()=>({width:1000,height:laneHeight*zoom});root.querySelector('.piano-keybed-shared').getBoundingClientRect=()=>({height:110*zoom});root.querySelector('.piano-transport').getBoundingClientRect=()=>({height:50*zoom,bottom:(chrome()+laneHeight)*zoom});
  }
  const window={innerWidth:1280,innerHeight:720,getComputedStyle:node=>({height:node.classList.contains('piano-lanes-shared')?`${laneHeight}px`:'',paddingBottom:'8px'}),requestAnimationFrame:fn=>(frames.set(++serial,fn),serial),cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},ResizeObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}};
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();},budget=()=>values.get('--piano-available-lane-height');
  const view=observePianoViewportBudget({document,window});
  try{
    flush();assert.equal(budget(),'412px');assert.equal(laneHeight,360,'Spare space preserves the desired music size');
    normalChrome=380;writes.length=0;for(let i=0;i<20;i++)callback();assert.equal(writes.length,0);assert.equal(frames.size,1);flush();assert.equal(budget(),'332px');
    writes.length=0;callback();flush();assert.equal(writes.length,0,'Changing the lane itself cannot create a budget feedback loop');
    document.body.dataset.screen='free';view.refresh();flush();assert.equal(budget(),'332px');assert.equal(laneHeight,332,'Free retains the same current piano geometry');
    document.body.dataset.screen='stage';zoom=1.25;view.refresh();flush();assert.equal(budget(),'188px');assert.equal((normalChrome+laneHeight+8)*zoom,720);
    callback();const pending=[...frames.values()];view.destroy();writes.length=0;for(const fn of pending)fn();assert.equal(writes.length,0);assert.equal(frames.size,0);assert.equal(disconnected,true);
  }finally{view.destroy();}
});

function guideBudgetFixture(){
  const {document}=parseHTML('<html lang="en"><body data-screen="stage"><main id="workspace" class="piano-workspace"><div class="piano-lanes-shared"></div><div class="piano-keybed-shared"></div><div class="piano-transport"></div></main></body></html>');
  const root=document.getElementById('workspace'),lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport'),keyboard=root.querySelector('.piano-keybed-shared'),frames=new Map();
  let serial=0,laneHeight=128.5625,keybedHeight=82,otherChrome=177.4375,notify;
  const values=new Map();Object.defineProperty(document.body,'style',{value:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);laneHeight=Math.round(parseFloat(value)*64)/64;},removeProperty:key=>values.delete(key)}});
  lane.getBoundingClientRect=()=>({width:824,height:laneHeight});keyboard.getBoundingClientRect=()=>({height:keybedHeight});
  transport.getBoundingClientRect=()=>({height:40.84375,bottom:otherChrome+keybedHeight+laneHeight});
  const window={innerWidth:844,innerHeight:390,getComputedStyle:node=>({height:node===lane?`${laneHeight}px`:'',paddingBottom:'2px'}),setTimeout,clearTimeout,requestAnimationFrame:fn=>(frames.set(++serial,fn),serial),cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},ResizeObserver:class{constructor(fn){notify=fn;}observe(){}disconnect(){}}};
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
  const view=observePianoViewportBudget({document,window});flush();
  return{document,window,view,frames,flush,notify:()=>notify(),guide(){keybedHeight+=12;},overflow(){otherChrome+=50;},bottom:()=>transport.getBoundingClientRect().bottom};
}

test('guide budget settlement observes the real queued 12px repair after delayed ResizeObserver delivery',async()=>{
  const env=guideBudgetFixture();
  try{
    assert.equal(env.bottom(),388);env.guide();assert.equal(env.bottom(),400,'The immediate DOM read sees the larger guide with the previous lane capacity');
    const settling=settlePianoViewportBudget(env);env.flush();
    assert.equal(env.bottom(),400,'The first test frame does not invent a production observer notification');
    env.notify();assert.equal(env.bottom(),400,'The real ResizeObserver only schedules a write');
    env.flush();assert.equal(env.bottom(),388,'The next production frame commits the entire 12px correction');
    env.flush();const samples=await settling;
    assert.equal(samples.length,4);assert.deepEqual(samples.map(sample=>sample.committed),[128.56,128.56,128.56,116.56]);
    assert.ok(samples.every(sample=>sample.expected===116.56));assert.equal(samples.at(-1).laneHeight,116.5625);assert.equal(env.frames.size,0);
  }finally{env.view.destroy();}
});

test('guide settlement fails after three frames when the actual observer never commits',async()=>{
  const env=guideBudgetFixture();
  try{
    env.guide();const settling=settlePianoViewportBudget(env),rejected=assert.rejects(settling,/did not commit within three rendered frames/);
    for(let index=0;index<3;index++)env.flush();await rejected;
    assert.equal(env.bottom(),400);assert.equal(env.frames.size,0);
  }finally{env.view.destroy();}
});

test('a committed minimum budget does not wait away persistent clipping or reduce the readable lane',async()=>{
  const env=guideBudgetFixture();
  try{
    env.overflow();env.notify();env.flush();const samples=await settlePianoViewportBudget(env);
    assert.equal(samples.length,1);assert.equal(samples[0].committed,100);assert.equal(samples[0].laneHeight,100);
    assert.ok(samples[0].available<100);assert.ok(env.bottom()>390,'Geometry acceptance must still fail after a valid but insufficient minimum budget');
    assert.equal(env.frames.size,0);
  }finally{env.view.destroy();}
});
