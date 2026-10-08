import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderNotation} from '../web/music.js';
import {planNotationFit,setupNotationFit} from '../web/notation-fit.js';
import {resolveNotationScope,planNotationPartBatch,loadNotationPartBatch} from '../web/notation-scope.js';
import {setupNotationScopeControls} from '../web/notation-scope-controls.js';
import {createI18n} from '../web/i18n.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';

test('original twelve-part fixture reproduces excessive staff and Jianpu paint at 720/900/1080 landscape',()=>{
  const score=originalMultipartNotation(),before=JSON.stringify(score);
  for(const height of [720,900,1080])for(const mode of ['staff','jianpu']) {
    const width=Math.round(height*16/9)-70,laneHeight=height*.5;
    const {document}=parseHTML(renderNotation(score,mode,{allParts:true,width,spanBeats:8}));
    const svg=document.querySelector('svg'),contentWidth=Number(svg.getAttribute('width')),contentHeight=Number(svg.getAttribute('height'));
    assert.ok(contentHeight>laneHeight,`${mode}: original overlay clipped lower parts`);
    assert.equal(svg.querySelectorAll('.part-name').length>=12,true);
    const fit=planNotationFit({width,height:laneHeight,contentWidth,contentHeight,glyphSize:mode==='jianpu'?25:10,mode});
    assert.equal(fit.status,'scroll');assert.ok(fit.glyphSize>=(mode==='jianpu'?18:7));assert.ok(fit.verticalPages>1);
  }
  assert.equal(JSON.stringify(score),before);
});

test('fit scales a moderate page and retains a readable floor for excess rows, narrow widths and zoom',()=>{
  assert.equal(planNotationFit({width:1000,height:300,contentWidth:1000,contentHeight:400,glyphSize:10}).scale,.75);
  for(const width of [300,700,1100])for(const height of [150,360,540])for(const mode of ['jianpu','staff']) {
    const result=planNotationFit({width,height,contentWidth:1400,contentHeight:1600,glyphSize:mode==='jianpu'?25:9,mode});
    assert.ok(result.scale>=.75);assert.ok(result.glyphSize>=(mode==='jianpu'?18:7));assert.equal(result.overflowY,true);
  }
  assert.equal(planNotationFit({width:0}).status,'unavailable');
  const small=planNotationFit({width:800,height:300,contentWidth:800,contentHeight:300,glyphSize:5});assert.equal(small.scale,1.4);
});

test('scope never silently chooses the first part; current follows explicit changes and All ignores mute/solo',()=>{
  const parts=originalMultipartNotation().parts,before=JSON.stringify(parts);
  assert.deepEqual(resolveNotationScope({parts}).partIds,[]);assert.equal(resolveNotationScope({parts}).status,'choose_current_part');
  assert.deepEqual(resolveNotationScope({parts,practicePartId:parts[10].id}).partIds,[parts[10].id]);
  assert.deepEqual(resolveNotationScope({parts,scope:'part',selectedPartId:parts[4].id,practicePartId:parts[10].id}).partIds,[parts[4].id]);
  assert.deepEqual(resolveNotationScope({parts,scope:'all',mutedPartIds:[parts[1].id],soloPartId:parts[0].id}).partIds,parts.map(part=>part.id));
  const reached=[];for(let firstPart=0;firstPart<parts.length;firstPart+=4){const batch=planNotationPartBatch(parts.map(part=>part.id),{firstPart});assert.equal(batch.partPages,3);reached.push(...batch.partIds);}
  assert.deepEqual(reached,parts.map(part=>part.id));assert.equal(JSON.stringify(parts),before);
});

test('batch keeps each validated page identity, bounds concurrent parts and reduces a dense window without losing targets',async()=>{
  const partIds=['one','two','three','four','five'],calls=[];let running=0,maxRunning=0;
  const result=await loadNotationPartBatch({partIds,measureCount:8,requestPage:async(partId,{measureCount})=>{running++;maxRunning=Math.max(maxRunning,running);await Promise.resolve();running--;calls.push([partId,measureCount]);return {status:'ready',part_id:partId,interpreted_notes:Array.from({length:measureCount*200},(_,index)=>({note_id:`${partId}-${index}`})),source_sha256:'unchanged',continuations:[{note_id:'held',enters_page:true}]};}});
  assert.equal(result.measureCount,2);assert.equal(result.requestedMeasureCount,8);assert.equal(result.targetCount,1600);assert.equal(result.pages.length,4);assert.equal(result.nextPart,4);assert.equal(maxRunning,4);assert.deepEqual(result.pages.map(page=>page.part_id),partIds.slice(0,4));assert.equal(calls.length,12);assert.ok(result.pages.every(page=>page.continuations[0].enters_page));
});

test('batch exposes one-measure limit, unmappable parts and cancellation instead of returning a misleading complete page',async()=>{
  const dense=await loadNotationPartBatch({partIds:['a','b'],requestPage:async partId=>({part_id:partId,status:'ready',interpreted_notes:Array(1100).fill({})})});
  assert.equal(dense.status,'page_limit');assert.equal(dense.measureCount,1);assert.deepEqual(dense.pages,[]);
  const partial=await loadNotationPartBatch({partIds:['a','b'],requestPage:async partId=>({part_id:partId,status:partId==='a'?'ready':'percussion_mapping_required',interpreted_notes:[]})});assert.equal(partial.status,'partial');assert.equal(partial.pages.length,2);
  const selectors=await loadNotationPartBatch({partIds:['a','b'],requestPage:async partId=>({part_id:partId,status:partId==='a'?'onset_page':'percussion_selectors',interpreted_notes:[]})});assert.equal(selectors.status,'ready');
  const fallback=await loadNotationPartBatch({partIds:['a'],requestPage:async partId=>({part_id:partId,status:'rendering_unavailable',interpreted_notes:[]})});assert.equal(fallback.status,'partial');assert.equal(fallback.pages.length,1);
  await assert.rejects(loadNotationPartBatch({partIds:['a'],requestPage:async()=>({part_id:'wrong',status:'ready'})}),/wrong source part/);
  const controller=new AbortController();controller.abort();let requested=false;await assert.rejects(loadNotationPartBatch({partIds:['a'],signal:controller.signal,requestPage:async()=>{requested=true;}}),{name:'AbortError'});assert.equal(requested,false);
});

test('scope controls report actual rendered parts and page counts without mutating playback or source',()=>{
  const {document,window}=parseHTML('<html><body><main id="workspace"><div id="dock"><div class="section-heading"></div></div><div id="options"></div></main></body></html>');
  // Linkedom has getter-only select.value; browsers provide a writable value.
  const create=document.createElement.bind(document);document.createElement=name=>{const node=create(name);if(name==='select')Object.defineProperty(node,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.firstElementChild?.value||'';},set(value){for(const option of this.children)option.toggleAttribute('selected',option.value===value);}});return node;};
  const stage=document.getElementById('workspace'),i18n=createI18n({locale:'en'}),view=setupNotationScopeControls({document,stage,dock:document.getElementById('dock'),options:document.getElementById('options'),i18n});
  const parts=originalMultipartNotation().parts,changes=[];stage.addEventListener('notationscopechange',event=>changes.push(event.detail));
  stage.dispatchEvent(new window.CustomEvent('notationscopecontext',{detail:{parts,scope:'all',renderedPartIds:parts.slice(0,4).map(part=>part.id),page:2,totalPages:7}}));
  assert.match(document.getElementById('notation-scope-status').textContent,/4 \/ 12 source parts shown · score page 2 \/ 7/);
  document.getElementById('notation-parts-next').click();assert.equal(changes[0].firstPart,4);assert.deepEqual(changes[0].partIds,parts.map(part=>part.id));
  view.setFit({status:'scroll',scale:.75});assert.match(document.getElementById('notation-scope-status').textContent,/75%/);
  i18n.setLocale('zh-CN');assert.match(document.getElementById('notation-scope-status').textContent,/已显示 4 \/ 12/);assert.deepEqual(i18n.getReports(),[]);view.destroy();
});

test('fit leaves notation nodes and note identities intact, restores owned styles, and has stable repeated geometry',()=>{
  const {document,window}=parseHTML('<html><body><div id="viewport"><div id="surface"><svg width="1000" height="800"><g class="score-note" data-note-id="held"><ellipse class="note-head"/></g></svg></div></div></body></html>');
  const viewport=document.getElementById('viewport'),surface=document.getElementById('surface'),svg=surface.firstElementChild,head=svg.querySelector('.note-head'),note=svg.querySelector('.score-note');
  Object.defineProperty(viewport,'clientHeight',{value:300});viewport.getBoundingClientRect=()=>({width:1000,height:300});surface.getBoundingClientRect=()=>({width:1000,height:800*(parseFloat(svg.style.width)/1000||1)});svg.getBoundingClientRect=()=>({width:1000*(parseFloat(svg.style.width)/1000||1),height:800*(parseFloat(svg.style.width)/1000||1)});head.getBoundingClientRect=()=>({height:10*(parseFloat(svg.style.width)/1000||1)});window.getComputedStyle=()=>({});
  const results=[],fit=setupNotationFit({viewport,getSurface:()=>surface,onChange:value=>results.push(value),window});fit.measure();fit.measure();assert.equal(results.length,1);assert.equal(svg.style.width,'750px');assert.equal(svg.style.height,'600px');assert.equal(surface.firstElementChild,svg);assert.equal(svg.querySelector('[data-note-id="held"]'),note);fit.destroy();assert.equal(svg.style.width,'');assert.equal(svg.style.height,'');
});

test('current-note cue visibility does not remeasure the whole score but structural and viewport changes do',()=>{
 const {document}=parseHTML('<html><body><div id="viewport"><div id="surface"><svg width="1000" height="800">'+Array.from({length:12},()=>'<ellipse class="note-head"/>').join('')+'</svg><div class="engraving-expected-cues"><span class="engraving-expected-cue" hidden></span></div><p id="part">Part</p></div></div></body></html>');
 const viewport=document.getElementById('viewport'),surface=document.getElementById('surface'),svg=surface.querySelector('svg'),cue=surface.querySelector('.engraving-expected-cue'),part=document.getElementById('part');
 let notify,resize,reads=0,serial=0;const frames=new Map(),listeners=new Map();
 const window={MutationObserver:class{constructor(callback){notify=callback}observe(){}disconnect(){}},ResizeObserver:class{constructor(callback){resize=callback}observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),getComputedStyle:()=>({})};
 const flush=()=>{const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();};
 viewport.getBoundingClientRect=()=>({width:1000,height:300});surface.getBoundingClientRect=()=>({width:1000,height:800*(parseFloat(svg.style.width)/1000||1)});svg.getBoundingClientRect=()=>({width:1000*(parseFloat(svg.style.width)/1000||1),height:800*(parseFloat(svg.style.width)/1000||1)});
 for(const head of svg.querySelectorAll('.note-head'))head.getBoundingClientRect=()=>{reads++;return{height:10*(parseFloat(svg.style.width)/1000||1)}};
 const fit=setupNotationFit({viewport,getSurface:()=>surface,window});flush();reads=0;
 for(let i=0;i<10;i++){cue.hidden=!cue.hidden;notify([{type:'attributes',attributeName:'hidden',target:cue}]);flush();}assert.equal(reads,0,'Ten current-note changes must not read 120 unchanged glyph boxes');
 for(const record of [{type:'attributes',attributeName:'hidden',target:part},{type:'attributes',attributeName:'width',target:svg},{type:'attributes',attributeName:'viewBox',target:svg},{type:'childList',target:surface}]){reads=0;notify([{type:'attributes',attributeName:'hidden',target:cue},record]);flush();assert.equal(reads,12);}
 reads=0;resize();flush();assert.equal(reads,12);reads=0;listeners.get('resize')();flush();assert.equal(reads,12);fit.destroy();
});

test('clock-bearing quiet pages remain usable alone and beside sounding parts, while unclocked emptiness stays explicit',async()=>{
 const quiet={part_id:'quiet',status:'empty_page',measures:[{start_ms:0,end_ms:16000,follow_end_ms:16000}],source_start_ms:0,follow_end_ms:16000,next_measure:8,interpreted_notes:[]};
 const alone=await loadNotationPartBatch({partIds:['quiet'],requestPage:async()=>quiet});assert.equal(alone.status,'ready');assert.equal(alone.pages[0],quiet);assert.equal(alone.pages[0].next_measure,8);
 const mixed=await loadNotationPartBatch({partIds:['quiet','sounding'],requestPage:async id=>id==='quiet'?quiet:{...quiet,part_id:id,status:'ready',interpreted_notes:[{note_id:'original-sound'}]}});assert.equal(mixed.status,'ready');assert.equal(mixed.pages.length,2);assert.equal(mixed.targetCount,1);
 for(const patch of [{measures:[]},{source_start_ms:null},{follow_end_ms:null},{follow_end_ms:0}]){const result=await loadNotationPartBatch({partIds:['quiet'],requestPage:async()=>({...quiet,...patch})});assert.equal(result.status,'unavailable');}
});

test('nested responsive part mounts stay unscaled, account for headings, and release replaced SVG ownership',()=>{
 const {document,window}=parseHTML('<html><body><div id="viewport"><div id="surface"><div class="notation-part-render"><p>Original part heading</p><div class="responsive-paint"><svg width="1000" height="400"><ellipse class="note-head"/></svg></div></div></div></div></body></html>');
 const viewport=document.getElementById('viewport'),surface=document.getElementById('surface'),mount=surface.firstElementChild,wrapper=mount.querySelector('.responsive-paint'),first=mount.querySelector('svg');let svg=first;
 const geometry=node=>{node.getBoundingClientRect=()=>({width:1000*(parseFloat(node.style.width)/1000||1),height:400*(parseFloat(node.style.width)/1000||1)});node.querySelector('.note-head').getBoundingClientRect=()=>({height:10*(parseFloat(node.style.width)/1000||1)});};geometry(first);
 viewport.getBoundingClientRect=()=>({width:1000,height:420});surface.getBoundingClientRect=()=>({width:1000,height:100+400*(parseFloat(svg.style.width)/1000||1)});window.getComputedStyle=()=>({});const plans=[];
 const fit=setupNotationFit({viewport,getSurface:()=>surface,window,onChange:plan=>plans.push(plan)});fit.measure();fit.measure();assert.equal(first.style.width,'800px','100px of unscaled headings and spacing is reserved');assert.equal(mount.style.zoom,undefined);assert.equal(wrapper.style.zoom,undefined);assert.equal(plans.length,1,'Stable native geometry does not trigger repeated fitting');
 const next=first.cloneNode(true);next.style.width='';next.style.height='';next.style.maxWidth='';delete next.dataset.notationFitPaint;geometry(next);first.replaceWith(next);svg=next;fit.measure();assert.equal(first.style.width,'');assert.equal(first.style.height,'');assert.equal(first.dataset.notationFitPaint,undefined,'Historical page ownership is released immediately');assert.equal(next.style.width,'800px');assert.equal(mount.style.zoom,undefined);assert.equal(plans.length,2,'A replacement page with equal fit dimensions refreshes its new cue geometry');fit.measure();assert.equal(plans.length,2,'Stable replacement paint does not repeatedly measure cue geometry');next.remove();assert.equal(fit.measure().status,'unavailable');assert.equal(next.style.width,'');assert.equal(next.style.height,'');assert.equal(viewport.dataset.notationScale,'1');fit.destroy();assert.equal(next.style.width,'');assert.equal(next.style.height,'');
});

test('a resized viewport invalidates follow geometry even when minimum scale and page counts stay unchanged',()=>{
 const {document,window}=parseHTML('<html><body><div id="viewport"><div id="surface"><svg><ellipse class="note-head"/></svg></div></div></body></html>');
 const viewport=document.getElementById('viewport'),surface=document.getElementById('surface'),svg=surface.firstElementChild,plans=[];
 let height=150,top=90;
 viewport.getBoundingClientRect=()=>({left:10,top,width:1000,height});
 surface.getBoundingClientRect=()=>({width:1000,height:300*(parseFloat(svg.style.width)/1000||1)});
 svg.getBoundingClientRect=()=>({width:1000*(parseFloat(svg.style.width)/1000||1),height:300*(parseFloat(svg.style.width)/1000||1)});
 svg.firstElementChild.getBoundingClientRect=()=>({height:10*(parseFloat(svg.style.width)/1000||1)});window.getComputedStyle=()=>({});
 const fit=setupNotationFit({viewport,getSurface:()=>surface,window,onChange:plan=>plans.push(plan)});
 try{
  fit.measure();const first=plans[0];assert.equal(first.scale,.75);assert.equal(first.verticalPages,2);
  height=130;assert.deepEqual(fit.measure(),first,'The fitted music itself is unchanged');
  assert.equal(plans.length,2,'The smaller reveal viewport must invalidate a previously ready current-note group');
  top=105;fit.measure();assert.equal(plans.length,3,'Moving the lane must also refresh its clipping coordinates');
  fit.measure();assert.equal(plans.length,3,'Stable geometry does not repeatedly read current-note bounds');
 }finally{fit.destroy();}
});
