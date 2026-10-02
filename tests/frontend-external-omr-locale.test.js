import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {setupExternalOmrReview} from '../web/external-omr-view.js';
import {ExternalOmrReview,OMR_REVIEW_CATEGORIES,editedBeat,boundedJson} from '../web/external-omr-model.js';
import {fixture as originalScore} from './frontend-fixtures.js';
import {imageMetadata} from '../web/image-metadata.js';
import en from '../web/locales/external-review-en.js';
import zh from '../web/locales/external-review-zh-CN.js';
import schema from '../web/locales/external-review-schema.js';

const settle=async()=>{for(let index=0;index<40;index++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const originalXml='\uFEFF<?xml version="1.0"?>\r\n<score>原始 &amp; source</score>\r\n';
const technical='<script>engine & 原始 warning</script>';
function draft(input,notes=2){
 const score=structuredClone(originalScore);score.title='<原始 score & title>';score.composer='Original credits 原作者';score.provenance.attribution='Rights text \r\n原始权利';score.parts[0].name='<Original part 原声部>';score.parts[0].notes=Array.from({length:notes},(_,index)=>({...structuredClone(score.parts[0].notes[index%2]),id:`source-note-${index}`,at:{numerator:index,denominator:3}}));
 score.source={format:'external-omr-draft',filename:'原稿.musicxml',content:JSON.stringify({version:1,input,normalizations:[technical],confirmation:null})};
 return{score,requires_review:true,confidence:null,normalizations:[technical],diagnostics:[{code:'MODEL_EXTERNAL_17',message:technical}]};
}
function reviewed(payload){const score=structuredClone(payload.score),record=JSON.parse(score.source.content);record.confirmation={...payload.confirmation};score.source={...score.source,format:'external-omr-reviewed',content:JSON.stringify(record)};score.provenance.kind='user_reviewed_external_omr';return{score,timeline:{notes:[]},diagnostics:[{code:'UNCHANGED',message:technical}]}}
function fixture({locale='zh-CN',shared=false,notes=2,api,Image}={}){
 const {document,window}=parseHTML('<html><body><input id="score-file"><input id="score-image-file"></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
 window.HTMLInputElement.prototype.setCustomValidity=function(value){this.validationMessage=value};
 const reports=[],i18n=shared?getAppI18n(document):createI18n({locale,onReport:issue=>reports.push(issue)}),calls={api:[],activate:[],pause:0,read:0,decode:0,notice:[]};let sourceVersion=7,response;
 const view=setupExternalOmrReview({document,...(!shared?{i18n}:{}),crypto:{randomUUID:()=>`manual-${calls.api.length}`},Image,api:async(path,body,signal)=>{calls.api.push({path,body,signal});if(api)return api(path,body,signal);if(path==='/api/omr/audiveris-draft'){response=draft(body,notes);return response}return reviewed(body)},onActivate:async(...args)=>{calls.activate.push(args);return true},pausePlayback:()=>calls.pause++,notice:value=>calls.notice.push(value),getSourceVersion:()=>sourceVersion});
 const $=id=>document.getElementById(id),dialog=$('external-omr-dialog');dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 const event=(node,type)=>node.dispatchEvent(new window.Event(type));
 const file=(name='原稿.musicxml',bytes=new TextEncoder().encode(originalXml))=>({name,size:bytes.byteLength,arrayBuffer:async()=>{calls.read++;return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}});
 const select=(id,value)=>{Object.defineProperty($(id),'files',{value:[value],configurable:true});event($(id),'change')};
 const confirm=()=>{for(const[key]of OMR_REVIEW_CATEGORIES){const input=$(`external-confirm-${key}`);input.checked=true;event(input,'change')}};
 return{document,window,i18n,reports,calls,view,$,event,file,select,confirm,response:()=>response,setSourceVersion:value=>sourceVersion=value,async prepare(value=file()){view.open();select('external-output-file',value);$('external-engine-declaration').checked=true;event($('external-engine-declaration'),'change');$('external-prepare').click();await settle()}};
}

const snapshot=f=>({api:f.calls.api.length,activate:f.calls.activate.length,pause:f.calls.pause,read:f.calls.read,source:f.response()?.score.source.content});

test('external OMR catalogs cover paired explicit messages and the view uses shared default Chinese',()=>{
 assert.deepEqual(Object.keys(en),Object.keys(zh));assert.deepEqual(Object.keys(en),Object.keys(schema));assert.ok(Object.keys(schema).every(key=>key.startsWith('review.external.')));
 const f=fixture({shared:true});assert.equal(f.i18n.locale,'zh-CN');assert.equal(f.$('external-omr-title').textContent,'对照原稿，核对完整乐谱。');const title=f.$('external-omr-title'),declaration=f.$('external-engine-declaration');f.view.open();f.document.activeElement=declaration;declaration.checked=true;f.i18n.setLocale('en');assert.equal(title.textContent,'Review the music, not just the engine result.');assert.equal(f.$('external-omr-close').getAttribute('aria-label'),'Close external OMR review');assert.equal(f.$('external-original-image').getAttribute('alt'),'User-selected original score image for manual comparison');assert.equal(f.$('external-engine-declaration'),declaration);assert.equal(f.document.activeElement,declaration);assert.equal(declaration.checked,true);assert.equal(f.calls.pause,1);assert.equal(f.calls.api.length,0);f.view.destroy();
});

test('locale redraw preserves note controls, paging, exact source bytes, credits, focus and fresh attestations',async()=>{
 const f=fixture({notes:23});await f.prepare();f.$('external-note-page').value='2';f.event(f.$('external-note-page'),'change');f.confirm();
 const input=f.$('external-notes').querySelector('input'),row=input.closest('fieldset'),warning=f.$('external-warnings').firstElementChild,warningDetail=warning.lastElementChild,source=f.$('external-source-preview'),before=snapshot(f),draftBefore=JSON.stringify(f.response());f.document.activeElement=input;input.selectionStart=1;input.selectionEnd=3;f.$('external-omr-dialog').scrollTop=313;
 f.i18n.setLocale('en');assert.equal(f.$('external-notes').firstElementChild,row);assert.equal(f.document.activeElement,input);assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(input.getAttribute('aria-label'),'Pitch for draft note 21');assert.equal(f.$('external-note-page').value,'2');assert.equal(f.$('external-omr-dialog').scrollTop,313);assert.equal(f.$('external-confirm-load').disabled,false);assert.equal(f.$('external-title').value,'<原始 score & title>');assert.equal(f.$('external-composer').value,'Original credits 原作者');assert.equal(source.value,originalXml);assert.equal(warningDetail.textContent,`normalization: ${technical}`);assert.equal(warning.querySelector('script'),null);assert.match(warning.textContent,/Original technical details:/);assert.deepEqual(snapshot(f),before);assert.equal(JSON.stringify(f.response()),draftBefore);assert.equal(f.$('external-warnings').firstElementChild,warning);
 f.i18n.setLocale('zh-CN');assert.match(warning.textContent,/原始技术详情/);assert.equal(warning.lastElementChild,warningDetail);assert.equal(f.$('external-confirm-notes_and_rests').checked,true);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('invalid local fields and their localized native validity stay intact without revalidation or confirmation',async()=>{
 const f=fixture();await f.prepare();const staff=f.$('external-notes').querySelector('[data-field-key="note-0-0-staff"]');staff.value='999';f.event(staff,'input');f.document.activeElement=staff;const validity=staff.validationMessage,before=snapshot(f);assert.match(validity,/谱表编号必须/);assert.equal(staff.getAttribute('aria-invalid'),'true');assert.equal(f.$('external-confirm-load').disabled,true);
 f.i18n.setLocale('en');assert.equal(staff.value,'999');assert.equal(staff.getAttribute('aria-label'),'Staff for draft note 1');assert.equal(staff.validationMessage,'Staff must be a whole number from 1 to 255.');assert.equal(f.document.activeElement,staff);assert.deepEqual(snapshot(f),before);assert.equal(f.$('external-confirm-load').disabled,true);f.$('external-json-tab').click();assert.match(f.$('external-status').textContent,/Correct invalid field text first: Staff must be/);f.i18n.setLocale('zh-CN');assert.match(f.$('external-status').textContent,/请先修正无效字段：谱表编号必须/);assert.equal(staff.validationMessage,validity);assert.equal(f.$('external-json-panel').hidden,true);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('pending JSON and replacement confirmation survive switching without implicit apply, discard or replacement',async()=>{
 const f=fixture();await f.prepare();f.$('external-json-tab').click();const json=f.$('external-json');json.value='{"title":"未完成 & <draft>"';f.event(json,'input');f.document.activeElement=json;json.selectionStart=12;const before=snapshot(f);f.i18n.setLocale('en');assert.equal(json.value,'{"title":"未完成 & <draft>"');assert.equal(json.selectionStart,12);assert.equal(f.document.activeElement,json);assert.equal(f.$('external-json-panel').hidden,false);assert.equal(f.$('external-confirm-load').disabled,true);
 f.select('external-output-file',f.file('replacement.xml'));const keep=f.$('external-keep-draft'),replace=f.$('external-replace-draft');f.document.activeElement=keep;f.i18n.setLocale('zh-CN');assert.equal(f.$('external-replacement').hidden,false);assert.equal(f.$('external-replacement-name').textContent,'replacement.xml');assert.equal(f.$('external-replace-draft'),replace);assert.equal(replace.textContent,'替换草稿并清除编辑');assert.equal(json.value,'{"title":"未完成 & <draft>"');assert.equal(f.document.activeElement,keep);assert.deepEqual(snapshot(f),before);keep.click();assert.equal(f.$('external-replacement').hidden,true);assert.equal(json.value,'{"title":"未完成 & <draft>"');assert.equal(f.$('external-source-preview').value,originalXml);assert.match(f.$('external-status').textContent,/已保留当前草稿/);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('switching locale during preparation redraws progress and completion without extra IO or aborts',async()=>{
 const pending=deferred(),f=fixture({locale:'en',api:(path,body)=>pending.promise});await f.prepare();const call=f.calls.api[0],before=snapshot(f);assert.equal(call.path,'/api/omr/audiveris-draft');assert.equal(call.body.output_content,originalXml);f.i18n.setLocale('zh-CN');assert.match(f.$('external-status').textContent,/正在读取大小受限/);assert.equal(f.$('external-omr-dialog').getAttribute('aria-busy'),'true');assert.equal(call.signal.aborted,false);assert.deepEqual(snapshot(f),before);pending.resolve(draft(call.body));await settle();assert.match(f.$('external-status').textContent,/已读取未经核对的草稿/);assert.equal(f.$('external-editor').hidden,false);assert.equal(f.calls.api.length,1);assert.equal(f.$('external-source-preview').value,originalXml);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('unknown engine errors remain exact literal technical details across locales, including long diagnostics',async()=>{
 const detail=technical+' Ω'.repeat(5000),f=fixture({api:async()=>{throw Object.assign(new Error(detail),{code:'UNKNOWN_ENGINE_CODE'})}});await f.prepare();assert.match(f.$('external-status').textContent,/原始技术/);assert.ok(f.$('external-status').textContent.endsWith(detail));assert.equal(f.$('external-status').querySelector('script'),null);const before=snapshot(f);f.i18n.setLocale('en');assert.match(f.$('external-status').textContent,/Original technical/);assert.ok(f.$('external-status').textContent.endsWith(detail));assert.deepEqual(snapshot(f),before);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('in-flight confirmation keeps exact payload and rights, activates once, and retains a localized notice callback',async()=>{
 const pending=deferred(),f=fixture({api:async(path,body)=>path==='/api/omr/audiveris-draft'?draft(body):pending.promise});await f.prepare();f.confirm();f.$('external-confirm-load').click();await settle();const call=f.calls.api[1],payload=JSON.stringify(call.body),before=snapshot(f),focus=f.$('external-confirm-source_rights');f.document.activeElement=focus;f.i18n.setLocale('en');assert.match(f.$('external-status').textContent,/Validating your corrected score/);assert.equal(call.signal.aborted,false);assert.equal(f.document.activeElement,focus);assert.equal(focus.checked,true);assert.equal(JSON.stringify(call.body),payload);assert.deepEqual(snapshot(f),before);pending.resolve(reviewed(call.body));await settle();assert.equal(f.calls.activate.length,1);assert.equal(f.calls.api.length,2);assert.equal(f.$('external-omr-dialog').open,false);const loaded=f.calls.activate[0][0];assert.equal(JSON.parse(loaded.source.content).input.output_content,originalXml);assert.equal(loaded.provenance.attribution,'Rights text \r\n原始权利');assert.equal(typeof f.calls.notice[0],'function');assert.match(f.calls.notice[0](),/User-reviewed external OMR score loaded/);f.i18n.setLocale('zh-CN');assert.match(f.calls.notice[0](),/已载入用户核对后的外部识谱乐谱/);assert.equal(f.calls.activate.length,1);assert.deepEqual(f.reports,[]);f.view.destroy();
});

for(const reason of ['close','source'])test(`stale confirmation stays cancelled after ${reason} and a locale change`,async()=>{
 const pending=deferred(),f=fixture({api:async(path,body)=>path==='/api/omr/audiveris-draft'?draft(body):pending.promise});await f.prepare();f.confirm();f.$('external-confirm-load').click();await settle();const call=f.calls.api[1];if(reason==='close')f.view.close();else f.event(f.$('score-file'),'change');f.i18n.setLocale('en');pending.resolve(reviewed(call.body));await settle();assert.equal(call.signal.aborted,true);assert.equal(f.calls.activate.length,0);assert.equal(f.$('external-confirm-load').disabled,true);if(reason==='source')assert.match(f.$('external-status').textContent,/Another source was selected/);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('image reading and decoding survive locale changes and source package keeps exact image and XML bytes',async()=>{
 const bytes=readFileSync(new URL('./fixtures/omr-original-scale.png',import.meta.url)),metadata=imageMetadata(bytes),pending=deferred();let decodes=0;class Image{naturalWidth=metadata.width;naturalHeight=metadata.height;decode(){decodes++;return pending.promise}}
 const f=fixture({Image});f.view.open();f.select('external-image-file',f.file('原图.png',bytes));await settle();assert.equal(decodes,1);f.i18n.setLocale('en');assert.equal(f.$('external-image-name').textContent,'Reading 原图.png…');pending.resolve();await settle();assert.equal(decodes,1);assert.match(f.$('external-original-caption').textContent,/retained only after/);const image=f.$('external-original-image'),src=image.src;f.i18n.setLocale('zh-CN');assert.match(f.$('external-original-caption').textContent,/仅在读取并确认/);assert.equal(image.src,src);await f.prepare();assert.equal(f.calls.api.length,1);const input=f.calls.api[0].body;assert.equal(input.output_content,originalXml);assert.equal(input.original_image.filename,'原图.png');assert.deepEqual(Buffer.from(input.original_image.base64,'base64'),bytes);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('binary output placeholder is localized separately from retained compressed bytes',async()=>{
 const f=fixture(),binary=Uint8Array.from([0,255,80,75,3,4]);await f.prepare(f.file('原稿.mxl',binary));assert.equal(f.$('external-source-preview').hidden,true);assert.equal(f.$('external-source-preview').value,'');assert.equal(f.$('external-source-binary').textContent,'压缩 MXL 已按原样保留。');const source=f.response().score.source.content;f.i18n.setLocale('en');assert.equal(f.$('external-source-binary').textContent,'Compressed MXL retained unchanged.');assert.deepEqual(Buffer.from(JSON.parse(source).input.output_content,'base64'),Buffer.from(binary));assert.equal(f.response().score.source.content,source);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('map labels and errors redraw in place and existing event handlers still save exact edits',async()=>{
 const f=fixture();await f.prepare();f.$('external-map-kind').value='keys';f.event(f.$('external-map-kind'),'change');const mode=f.$('external-maps').querySelector('[data-field-key="keys-0-mode"]');mode.value='';f.event(mode,'input');assert.match(mode.validationMessage,/请输入明确的调式/);const row=mode.parentNode.parentNode,before=snapshot(f);f.document.activeElement=mode;f.i18n.setLocale('en');assert.equal(f.$('external-map-kind').value,'keys');assert.equal(f.$('external-add-map').textContent,'Add explicit key event');assert.equal(f.$('external-maps').firstElementChild,row);assert.equal(mode.value,'');assert.equal(mode.getAttribute('aria-label'),'Key mode 1');assert.equal(mode.validationMessage,'Enter the explicit key mode, such as major or minor.');assert.equal(f.document.activeElement,mode);assert.deepEqual(snapshot(f),before);
 mode.value='original custom mode';f.event(mode,'input');const onset=f.$('external-maps').querySelector('[data-field-key="keys-0-at"]');onset.value='2/3';f.event(onset,'input');f.confirm();assert.equal(f.$('external-confirm-load').disabled,false);f.$('external-confirm-load').click();await settle();const payload=f.calls.api[1].body;assert.deepEqual(payload.score.keys[0].at,{numerator:2,denominator:3});assert.equal(payload.score.keys[0].mode,'original custom mode');assert.equal(JSON.parse(payload.score.source.content).input.output_content,originalXml);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('owned size and JSON errors localize while pending drafts stay unchanged',async()=>{
 const f=fixture();await f.prepare({...f.file('huge.xml'),size:8*1024*1024+1});assert.equal(f.calls.read,0);assert.equal(f.calls.api.length,0);assert.equal(f.$('external-status').textContent,'引擎输出超过 8 MiB。');f.i18n.setLocale('en');assert.equal(f.$('external-status').textContent,'Engine output exceeds 8 MiB.');await f.prepare();f.$('external-json-tab').click();const json=f.$('external-json'),pending='{"source":';json.value=pending;f.event(json,'input');f.$('external-json-apply').click();assert.equal(f.$('external-status').textContent,'The advanced editor is not valid JSON. Correct it before applying.');f.i18n.setLocale('zh-CN');assert.equal(f.$('external-status').textContent,'高级编辑器中的内容不是有效 JSON。请修正后再应用。');assert.equal(json.value,pending);assert.equal(f.$('external-confirm-load').disabled,true);assert.deepEqual(f.reports,[]);f.view.destroy();
});

test('known model errors carry stable keys without changing original English diagnostic messages',()=>{
 const model=new ExternalOmrReview(draft({engine_version:'5.11.0',output_format:'musicxml',output_content:originalXml}));
 assert.throws(()=>model.replaceJson('{'),error=>error.reviewKey==='review.external.error.jsonSyntax'&&error.message==='The advanced editor is not valid JSON. Correct it before applying.');
 assert.throws(()=>editedBeat('x'),error=>error.reviewKey==='review.external.error.beat'&&error.message==='Use a non-negative beat number such as 0, 4, 1.5 or 3/2.'&&error.cause.message===error.message);
 assert.throws(()=>editedBeat('1/0'),error=>error.reviewKey==='review.external.error.beat'&&error.message==='Beat value is outside the supported rational range.');
 assert.throws(()=>editedBeat('0',{duration:true}),error=>error.reviewKey==='review.external.error.positiveDuration'&&error.message==='A note/rest duration must be positive.');
 const invalid=JSON.parse(model.editorText());invalid.keys='invalid';assert.throws(()=>model.replaceJson(JSON.stringify(invalid)),error=>error.reviewKey==='review.external.error.mapShape.keys'&&error.reviewParams.maximum===100000&&error.message==='The keys map must be an array with at most 100000 entries.');
 assert.throws(()=>boundedJson({data:'x'.repeat(8*1024*1024)},'Editable score','review.external.error.editablePackageSize'),error=>error.reviewKey==='review.external.error.editablePackageSize'&&error.message==='Editable score exceeds 8 MiB. Use a smaller original fragment; sources are never stripped to fit.');
});

test('invalid rational input localizes without reparsing or losing exact field draft',async()=>{
 const f=fixture();await f.prepare();const input=f.$('external-notes').querySelector('[data-field-key="note-0-0-at"]');input.value='1/0';f.event(input,'input');f.document.activeElement=input;const before=snapshot(f);assert.match(input.validationMessage,/请使用受支持的非负拍数/);f.i18n.setLocale('en');assert.match(input.validationMessage,/Use a supported non-negative beat number/);assert.equal(input.value,'1/0');assert.equal(f.document.activeElement,input);assert.equal(input.getAttribute('aria-invalid'),'true');assert.deepEqual(snapshot(f),before);assert.equal(f.$('external-confirm-load').disabled,true);input.value='1/3';f.event(input,'input');f.confirm();f.$('external-confirm-load').click();await settle();assert.deepEqual(f.calls.api[1].body.score.parts[0].notes[0].at,{numerator:1,denominator:3});assert.deepEqual(f.reports,[]);f.view.destroy();
});
