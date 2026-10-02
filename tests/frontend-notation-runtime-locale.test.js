import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setupEngravedView} from '../web/engraved-view.js';
import {createI18n} from '../web/i18n.js';
import {fixture} from './frontend-fixtures.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{resolve,reject,promise}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment({adapter}={}){
 const old=Object.fromEntries(['document','window','MutationObserver','fetch'].map(key=>[key,globalThis[key]]));
 const {document,window}=parseHTML('<html><body><aside id="notation-dock"><div class="engraving-scroll"><div id="engraved-staff"></div></div></aside><input id="engraving-follow" type="checkbox"><select id="engraving-part"></select><select id="engraving-page-size"><option value="8">8</option><option value="16">16</option></select><button id="engraving-prev"></button><button id="engraving-next"></button><span id="engraving-range"></span><button id="export-musicxml"></button><p id="engraving-fallback" hidden></p><p id="engraving-status"></p><ul id="engraving-diagnostics"></ul><span id="dock-warning-count"></span><p id="engraving-license-note" hidden></p></body></html>');
 for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 const calls=[],notices=[],visibility=[],failures=[];let current=null,manual=0,adapterLoads=0;
 globalThis.document=document;globalThis.window=window;globalThis.MutationObserver=window.MutationObserver;
 globalThis.fetch=(_url,options)=>{const pending=deferred();calls.push({...pending,options});return pending.promise};
 const i18n=createI18n();
 const view=setupEngravedView({document,i18n,getScore:()=>current,getPracticePart:()=>null,onVisibility:value=>visibility.push(value),onFallback:()=>failures.push(true),notice:(text,error)=>notices.push({text,error}),onManualNavigation:()=>manual++,loadAdapter:async()=>{adapterLoads++;return adapter}});
 return{document,window,i18n,view,calls,notices,visibility,failures,counts:()=>({manual,adapterLoads}),setScore(value=structuredClone(fixture)){current=value;view.updateScore();return value},close(){view.hide();for(const[key,value]of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value}};
}

test('engraved locale changes preserve controls, source labels, pending promises, renderer mounts and exact score bytes',async()=>{
 const render=deferred(),renders=[],disposed=[],applied=[];let mapping={status:'partial',verifiedGlyphCount:1,displayedSegmentCount:2,diagnostics:[]};
 const adapter={disposeEngravedStaff(){},renderEngravedStaff(container,xml,options){const mount=container.ownerDocument.createElement('svg');container.append(mount);renders.push({container,xml,options,mount});return render.promise}};
 const env=environment({adapter}),{document,i18n,view}=env,$=id=>document.getElementById(id);
 try{
  const score=structuredClone(fixture);score.title='<literal imported title> 标题';score.parts[0].name='Original <part> 𝄞';score.parts[0].id='part:原始';
  env.setScore(score);const original=JSON.stringify(score),controls=['engraving-part','engraving-page-size','engraving-prev','engraving-next','export-musicxml','engraving-follow'].map($),options=[...$('engraving-part').children];
  document.activeElement=controls[0];$('notation-dock').scrollTop=37;document.querySelector('.engraving-scroll').scrollLeft=19;
  const exactXml='<score-partwise><work-title>literal &amp; title</work-title></score-partwise>';
  assert.match($('engraving-status').textContent,/正在使用 Rust/);assert.equal(options[0].textContent,'全部声部');
  i18n.setLocale('en');assert.equal(env.calls.length,1);assert.equal(env.calls[0].options.signal.aborted,false);assert.match($('engraving-status').textContent,/Preparing exact/);assert.equal(options[0].textContent,'All parts');
  env.calls[0].resolve({ok:true,json:async()=>({xml:exactXml,part_id_map:{'part:原始':'P1'},diagnostics:[{code:'unknown-engine',message:'<b>Original diagnosis</b>'}]})});await tick();
  assert.equal(renders.length,1);assert.equal(renders[0].xml,exactXml);assert.equal(renders[0].options.i18n,i18n);
  i18n.setLocale('zh-CN');assert.equal(renders.length,1);assert.equal($('engraved-staff').firstChild,renders[0].mount);
  const result={ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){disposed.push(true)},mappingStatus:()=>mapping,setExpectedWrittenNotes:value=>{applied.push(value);return true},clearExpectedWrittenNotes:()=>true};render.resolve(result);await tick();
  assert.match($('engraving-status').textContent,/生成的五线谱预览/);assert.match($('engraving-diagnostics').textContent,/原始技术详情：<b>Original diagnosis<\/b>/);assert.equal($('engraving-diagnostics').querySelector('b'),null);
  assert.match($('engraving-diagnostics').textContent,/2 个可见谱面片段中，1 个/);const rows=[...$('engraving-diagnostics').children];
  view.setExpectedWrittenNotes({sourceNoteIds:['c4'],sourceMeasureIndex:0});const before=applied.length;
  i18n.setLocale('en');i18n.invalidate();
  assert.equal($('engraved-staff').firstChild,renders[0].mount);assert.deepEqual([...$('engraving-diagnostics').children],rows);assert.match(rows[1].textContent,/1 of 2/);
  assert.deepEqual(['engraving-part','engraving-page-size','engraving-prev','engraving-next','export-musicxml','engraving-follow'].map($),controls);assert.deepEqual([...$('engraving-part').children],options);assert.equal(options[1].textContent,score.parts[0].name);assert.equal(options[1].value,score.parts[0].id);assert.equal(document.activeElement,controls[0]);assert.equal($('notation-dock').scrollTop,37);assert.equal(document.querySelector('.engraving-scroll').scrollLeft,19);
  assert.equal($('notation-dock').getAttribute('aria-label'),'Score notation scroll area');assert.equal(applied.length,before);assert.equal(env.calls.length,1);assert.equal(renders.length,1);assert.equal(disposed.length,0);assert.deepEqual(env.counts(),{manual:0,adapterLoads:1});assert.equal(JSON.stringify(score),original);assert.deepEqual(i18n.getReports(),[]);
 }finally{env.close()}
});

test('fallback and late export failure messages redraw in place without retries or source prose matching',async()=>{
 const env=environment(),{document,i18n,view}=env,$=id=>document.getElementById(id);
 try{
  env.setScore();i18n.setLocale('en');env.calls[0].resolve({ok:false,status:400,json:async()=>({error:'Unknown engine <detail>.'})});await tick();
  assert.match($('engraving-fallback').textContent,/Original technical details: Unknown engine <detail>/);assert.equal(view.isActive(),false);assert.equal(env.failures.length,1);
  const node=$('engraving-fallback');i18n.setLocale('zh-CN');assert.equal($('engraving-fallback'),node);assert.match(node.textContent,/原始技术详情：Unknown engine <detail>/);assert.match(node.textContent,/简化音高参考/);assert.equal(env.calls.length,1);assert.equal(env.failures.length,1);
  $('export-musicxml').dispatchEvent(new env.window.Event('click'));assert.equal($('export-musicxml').disabled,true);assert.equal(env.calls.length,2);i18n.setLocale('en');assert.equal($('export-musicxml').disabled,true);
  env.calls[1].resolve({ok:true,json:async()=>({})});await tick();assert.equal(env.notices.length,1);assert.equal(typeof env.notices[0].text,'function');assert.match(env.notices[0].text(),/missing its XML/);
  i18n.setLocale('zh-CN');assert.match(env.notices[0].text(),/缺少 XML 或标准声部映射/);assert.equal(env.calls.length,2);assert.equal($('export-musicxml').disabled,false);assert.deepEqual(i18n.getReports(),[]);
 }finally{env.close()}
});

test('score replacement during pending export ignores the old failure across a locale change',async()=>{
 const env=environment();
 try{
  env.setScore();const old=env.calls[0];env.setScore({...structuredClone(fixture),id:'new-source'});assert.equal(old.options.signal.aborted,true);
  env.i18n.setLocale('en');old.reject(Error('obsolete error'));await tick();assert.equal(env.failures.length,0);assert.equal(env.view.isActive(),true);assert.match(env.document.getElementById('engraving-status').textContent,/Preparing exact/);
  env.calls[1].resolve({ok:false,status:409,json:async()=>({})});await tick();assert.equal(env.failures.length,1);assert.match(env.document.getElementById('engraving-fallback').textContent,/status 409/);
  env.i18n.setLocale('zh-CN');assert.match(env.document.getElementById('engraving-fallback').textContent,/状态码 409/);assert.doesNotMatch(env.document.getElementById('engraving-fallback').textContent,/obsolete error/);assert.equal(env.calls.length,2);assert.deepEqual(env.i18n.getReports(),[]);
 }finally{env.close()}
});
