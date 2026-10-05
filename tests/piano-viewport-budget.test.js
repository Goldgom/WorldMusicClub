import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {pianoViewportBudget,observePianoViewportBudget} from '../web/piano-viewport-budget.js';

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
  const narrow=rules.find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px) and (max-width:800px)');
  assert.ok(narrow,'The full 651–800px range needs a layout distinct from the wider compact header');
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
