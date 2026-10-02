import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {setupJianpuEditor,JIANPU_EXAMPLE} from '../web/jianpu-editor.js';
import {setupJianpuExport} from '../web/jianpu-export.js';
import {setupImageReview,REVIEW_DURATIONS} from '../web/image-review.js';
import {fixture as scoreFixture} from './frontend-fixtures.js';

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
function fixture(locale='zh-CN'){
 const {document,window}=parseHTML(html),i18n=createI18n({locale,onReport:issue=>assert.fail(JSON.stringify(issue))});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 window.HTMLElement.prototype.showModal=function(){this.open=true};window.HTMLElement.prototype.close=function(){this.open=false};window.HTMLElement.prototype.focus=function(){document.activeElement=this};
 const $=id=>document.getElementById(id);return {document,window,i18n,$};
}
function fire(f,node,type){node.dispatchEvent(new f.window.Event(type,{bubbles:true}))}

test('Jianpu uses shared default Chinese and keeps source text, pending import and focus through locale changes',async()=>{
 const f=fixture(),pending=deferred(),calls=[];let pauses=0;
 const view=setupJianpuEditor({document:f.document,pausePlayback:()=>pauses++,onImport:(text,signal)=>{calls.push({text,signal});return pending.promise}}),i18n=getAppI18n(f.document);
 assert.equal(i18n.locale,'zh-CN');assert.equal(f.$('jianpu-editor-load').textContent,'导入练习乐谱');assert.equal(f.$('jianpu-text').value,JIANPU_EXAMPLE);
 f.$('jianpu-editor-button').click();const input=f.$('jianpu-text'),draft='\uFEFFtitle=<原稿 & source>\r\n1:1/3 0:2/3\r\n# rights: keep EXACT\r\n';input.value=draft;input.focus();f.$('jianpu-syntax').open=true;f.$('jianpu-editor').scrollTop=31;
 f.$('jianpu-editor-load').click();assert.equal(calls.length,1);i18n.setLocale('en');
 assert.match(f.$('jianpu-editor-status').textContent,/Validating notes/);assert.equal(f.$('jianpu-text'),input);assert.equal(input.value,draft);assert.equal(f.document.activeElement,input);assert.equal(f.$('jianpu-syntax').open,true);assert.equal(f.$('jianpu-editor').scrollTop,31);assert.equal(f.$('jianpu-editor-load').disabled,true);assert.equal(calls[0].signal.aborted,false);assert.equal(calls[0].text,draft);assert.equal(calls.length,1);assert.equal(pauses,1);
 pending.resolve(false);await settle();assert.match(f.$('jianpu-editor-status').textContent,/was not loaded/);i18n.setLocale('zh-CN');assert.match(f.$('jianpu-editor-status').textContent,/乐谱未加载/);assert.equal(input.value,draft);view.destroy();
});

test('Jianpu cancellation still rejects stale success, and unknown diagnostics stay literal beneath localized wrappers',async()=>{
 const f=fixture('en'),pending=deferred();let signal;
 const view=setupJianpuEditor({...f,pausePlayback(){},onImport:(_text,s)=>{signal=s;return pending.promise}});f.$('jianpu-editor-button').click();f.$('jianpu-editor-load').click();
 f.i18n.setLocale('zh-CN');f.$('jianpu-editor-cancel').click();assert.equal(signal.aborted,true);f.$('jianpu-editor-button').click();pending.resolve(true);await settle();assert.equal(f.$('jianpu-editor').open,true);view.destroy();
 const g=fixture(),detail='<script>Rust unchanged & 原稿</script> '+ 'source'.repeat(1800),error=new Error(detail);
 const next=setupJianpuEditor({...g,pausePlayback(){},onImport:async()=>{throw error}});g.$('jianpu-editor-button').click();g.$('jianpu-editor-load').click();await settle();
 assert.equal(g.$('jianpu-editor-status').textContent,'原始技术详情： '+detail);assert.equal(g.$('jianpu-editor-status').querySelector('script'),null);g.i18n.setLocale('en');assert.equal(g.$('jianpu-editor-status').textContent,'Original technical details: '+detail);assert.equal(error.message,detail);next.destroy();
});

test('Jianpu export pending/ready redraw retains exact Rust bytes, mappings, source and downloaded filename',async t=>{
 const f=fixture(),pending=deferred(),calls=[],score=structuredClone(scoreFixture),source='\uFEFF<score>\r\n来源 & original\r\n</score>';score.source={format:'musicxml',filename:'原稿.xml',content:source};const snapshot=JSON.stringify(score),text='\uFEFF# rights: 原始 & exact\r\n1:1/3 0:2/3\r\n';
 const view=setupJianpuExport({...f,getScore:()=>score,pausePlayback(){},api:(...args)=>{calls.push(args);return pending.promise}});
 f.$('export-jianpu').click();const textarea=f.$('jianpu-export-text'),cancel=f.$('jianpu-export-cancel');cancel.focus();f.i18n.setLocale('en');assert.equal(calls.length,1);assert.equal(calls[0][2].aborted,false);assert.match(f.$('jianpu-export-status').textContent,/Checking this complete score/);assert.equal(f.document.activeElement,cancel);
 const raw='<b>engine & original</b>';pending.resolve({text,diagnostics:[{code:'raw_code',message:raw}],note_map:['c4','e4',null]});await settle();const mapping=f.$('jianpu-export-map').firstElementChild,diagnostic=f.$('jianpu-export-diagnostics').firstElementChild;
 f.i18n.setLocale('zh-CN');assert.equal(textarea.value,text);assert.equal(f.$('jianpu-export-text'),textarea);assert.equal(f.$('jianpu-export-map').firstElementChild,mapping);assert.match(mapping.textContent,/规范来源音符：c4/);assert.equal(f.$('jianpu-export-diagnostics').firstElementChild,diagnostic);assert.equal(diagnostic.textContent,'原始技术详情： '+raw);assert.equal(diagnostic.querySelector('b'),null);assert.equal(JSON.stringify(score),snapshot);assert.equal(calls.length,1);
 let blob,download;t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:test-export'});t.mock.method(URL,'revokeObjectURL',()=>{});
 const originalClick=f.window.HTMLElement.prototype.click;f.window.HTMLElement.prototype.click=function(){if(this.localName==='a'){download=this.download;return}return originalClick.call(this)};t.after(()=>f.window.HTMLElement.prototype.click=originalClick);
 f.$('jianpu-export-download').click();assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new TextEncoder().encode(text));assert.equal(download,`${score.id.replace(/[^\w.-]/g,'_').slice(0,120)}.jianpu`);f.i18n.setLocale('en');assert.match(f.$('jianpu-export-status').textContent,/file downloaded/);view.destroy();
});

test('Jianpu export cancellation suppresses late results and coded validation failure localizes',async()=>{
 const f=fixture('en'),pending=deferred(),score=structuredClone(scoreFixture);let signal;
 const view=setupJianpuExport({...f,getScore:()=>score,pausePlayback(){},api:(_path,_score,s)=>{signal=s;return pending.promise}});f.$('export-jianpu').click();f.i18n.setLocale('zh-CN');f.$('jianpu-export-cancel').click();pending.resolve({text:'1',note_map:[],diagnostics:[]});await settle();assert.equal(signal.aborted,true);assert.equal(f.$('jianpu-export').open,false);assert.equal(f.$('jianpu-export-text').value,'');view.destroy();
 const g=fixture();const next=setupJianpuExport({...g,getScore:()=>score,pausePlayback(){},api:async()=>({text:'1',note_map:[],diagnostics:[]})});g.$('export-jianpu').click();await settle();assert.match(g.$('jianpu-export-status').textContent,/简谱文本导出不完整/);g.i18n.setLocale('en');assert.match(g.$('jianpu-export-status').textContent,/numbered-text export is incomplete/);assert.equal(g.$('jianpu-export-download').disabled,true);next.destroy();
});

async function imageFixture(t,{recognize,activate}={}){
 const f=fixture(),bytes=await readFile(new URL('fixtures/omr-original-scale.png',import.meta.url)),calls={read:0,decode:0,draw:0,fetch:[],import:[],notices:[],pause:0},dataUrl='data:image/png;base64,'+bytes.toString('base64'),old={Image:globalThis.Image,FileReader:globalThis.FileReader};
 globalThis.FileReader=class {readAsDataURL(){this.result=dataUrl;this.onload()}};globalThis.Image=class {naturalWidth=640;naturalHeight=160;async decode(){calls.decode++}};
 t.after(()=>Object.assign(globalThis,old));
 const context={drawImage(){calls.draw++},strokeRect(){},set strokeStyle(_value){},set lineWidth(_value){}};
 f.window.HTMLCanvasElement.prototype.getContext=()=>context;f.window.HTMLCanvasElement.prototype.toBlob=callback=>callback(new Blob(['crop'],{type:'image/png'}));
 t.mock.method(globalThis,'fetch',(...args)=>{calls.fetch.push(args);return recognize?.(...args)||Promise.resolve({ok:true,json:async()=>({status:'review',candidates:[],assumptions:[],warnings:[]})})});
 const view=setupImageReview({...f,pausePlayback(){calls.pause++},notice:(...args)=>calls.notices.push(args),onImport:(...args)=>{calls.import.push(args);return activate?.(...args)||Promise.resolve(false)}});
 const file={name:'原稿.exact.png',size:bytes.length,async arrayBuffer(){calls.read++;return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}};
 await view.open(file);return {...f,view,calls,dataUrl,file};
}

test('image locale swaps do not repeat reads/recognition or rebuild manual controls, rational choices and evidence',async t=>{
 const pending=deferred(),f=await imageFixture(t,{recognize:()=>pending.promise});f.$('review-add-note').click();const input=f.$('review-notes').querySelector('input'),select=f.$('review-notes').querySelector('select');input.value='Bb3';fire(f,input,'input');select.value='1/3';fire(f,select,'change');input.focus();f.$('review-title').value='Original fragment & 标题';
 const initial={read:f.calls.read,decode:f.calls.decode,draw:f.calls.draw,pause:f.calls.pause};f.$('analyze-image').click();await settle();assert.equal(f.calls.fetch.length,1);const signal=f.calls.fetch[0][1].signal,draws=f.calls.draw;f.i18n.setLocale('en');assert.match(f.$('review-status').textContent,/Analyzing the selected region/);assert.equal(f.calls.fetch.length,1);assert.equal(signal.aborted,false);assert.equal(f.calls.draw,draws);assert.equal(f.calls.read,initial.read);assert.equal(f.calls.decode,initial.decode);assert.equal(f.calls.pause,initial.pause);assert.equal(f.$('review-notes').querySelector('input'),input);assert.equal(f.document.activeElement,input);assert.equal(input.value,'Bb3');assert.equal(select.value,'1/3');assert.equal(select.getAttribute('aria-label'),'Duration for note 1');assert.equal(f.$('review-title').value,'Original fragment & 标题');
 pending.resolve({ok:true,json:async()=>({status:'review',candidates:[{tentative_pitch:{step:'C',octave:4},confidence:0.73,bounds:{x:2,y:3,width:4,height:5}}],assumptions:['Untouched & 原始'],warnings:[]})});await settle();const candidate=f.$('review-notes').querySelector('input'),choices=f.$('review-notes').querySelector('select'),evidence=f.$('review-notes').querySelector('.review-evidence');f.i18n.setLocale('zh-CN');assert.equal(f.$('review-notes').querySelector('input'),candidate);assert.equal(evidence.textContent,'启发式估计 73%');assert.equal(choices.querySelector('option[value="1/3"]').textContent,'⅓ 拍 · 八分音符三连音');assert.deepEqual([...choices.options].slice(1).map(o=>o.value),REVIEW_DURATIONS.map(o=>o.value));assert.equal(f.$('image-assumptions').textContent,'原始技术详情： Untouched & 原始');f.view.destroy();
});

test('confirmed image draft and original bytes survive locale swap during validation; withdrawing confirmation still aborts',async t=>{
 const pending=deferred(),f=await imageFixture(t,{activate:()=>pending.promise});f.$('review-add-note').click();const input=f.$('review-notes').querySelector('input'),select=f.$('review-notes').querySelector('select');input.value='F##4';fire(f,input,'input');select.value='1/3';fire(f,select,'change');f.$('review-title').value='原稿 & literal';f.$('review-confirm').checked=true;fire(f,f.$('review-confirm'),'change');f.$('review-create').click();const [score,signal]=f.calls.import[0],snapshot=JSON.stringify(score),source=JSON.parse(score.source.content);input.focus();
 assert.equal(source.original_image_data_url,f.dataUrl);assert.equal(score.source.filename,f.file.name);assert.deepEqual(score.parts[0].notes[0].duration,{numerator:1,denominator:3});assert.equal(source.manual_notes[0].duration,'1/3');f.i18n.setLocale('en');assert.match(f.$('review-status').textContent,/Validating your explicitly confirmed/);assert.equal(f.$('review-confirm').checked,true);assert.equal(f.$('review-create').disabled,true);assert.equal(f.document.activeElement,input);assert.equal(signal.aborted,false);assert.equal(JSON.stringify(score),snapshot);assert.equal(f.calls.import.length,1);assert.equal(f.calls.fetch.length,0);
 f.$('review-confirm').checked=false;fire(f,f.$('review-confirm'),'change');assert.equal(signal.aborted,true);f.i18n.setLocale('zh-CN');pending.resolve(true);await settle();assert.equal(f.$('image-review-dialog').open,true);assert.equal(f.$('review-create').disabled,true);assert.equal(JSON.stringify(score),snapshot);f.view.destroy();
});


test('local image-header and pitch validation errors use stable keys while pure diagnostic messages stay untouched',async t=>{
 const f=await imageFixture(t);await f.view.open({name:'invalid.png',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
 assert.equal(f.calls.notices.length,1);assert.match(f.calls.notices[0][0](),/请选择真正的 PNG 或 JPEG/);f.i18n.setLocale('en');assert.match(f.calls.notices[0][0](),/Choose an actual PNG or JPEG/);assert.equal(f.calls.fetch.length,0);
 f.$('review-add-note').click();const input=f.$('review-notes').querySelector('input'),select=f.$('review-notes').querySelector('select');input.value='X4';fire(f,input,'input');select.value='1/3';fire(f,select,'change');f.$('review-confirm').checked=true;fire(f,f.$('review-confirm'),'change');f.$('review-create').click();await settle();assert.match(f.$('review-status').textContent,/is not a pitch/);f.i18n.setLocale('zh-CN');assert.match(f.$('review-status').textContent,/不是有效音高/);assert.equal(f.calls.import.length,0);assert.equal(input.value,'X4');assert.equal(select.value,'1/3');f.view.destroy();
});
