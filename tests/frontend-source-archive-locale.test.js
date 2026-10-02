import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {retainedSourceArchive,inspectRetainedSourceFile} from '../web/source-archive.js';
import {setupSourceArchiveView,sourceCheckSummary} from '../web/source-archive-view.js';

const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const sourceScore=()=>({title:'<Original score & 原稿>',source:{format:'musicxml',filename:'原稿.musicxml',content:'\uFEFF<score>\r\nOriginal & 原稿</score>\r\n'}});
function fixture(locale='zh-CN',options={}){
 const {document,window}=parseHTML('<html><body><button id="source-files-button"></button></body></html>'),i18n=createI18n({locale,onReport:issue=>assert.fail(JSON.stringify(issue))});
 let context={score:sourceScore(),version:12};const counts={context:0,inspections:0,pause:0};
 const view=setupSourceArchiveView({document,window,i18n,getContext:()=>{counts.context++;return context},pausePlayback:()=>counts.pause++,inspectFile:async file=>{counts.inspections++;return inspectRetainedSourceFile(file,{crypto:null})},...options}),$=id=>document.getElementById(id),dialog=$('source-archive-dialog');
 dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 return{document,window,i18n,counts,view,$,open(){ $('source-files-button').click() },context:()=>context,setContext:value=>context=value};
}

test('source inspection locale redraw retains prepared bytes, source snapshot, selection, controls and focus',async()=>{
 const f=fixture();f.open();const canonical=JSON.stringify(f.context()),button=f.$('source-archive-files').querySelector('button'),row=button.parentNode;
 button.click();await settle();const heading=f.$('source-archive-selected'),download=f.$('source-archive-download'),counts={...f.counts};f.document.activeElement=download;f.$('source-archive-dialog').scrollTop=77;
 assert.equal(f.$('source-archive-role').textContent,'完整保留的来源');assert.equal(heading.textContent,'原稿.musicxml');assert.equal(f.$('source-archive-inspection').hidden,false);assert.equal(download.disabled,false);
 f.i18n.setLocale('en');assert.equal(f.$('source-archive-role').textContent,'Complete retained source');assert.equal(f.$('source-archive-download').textContent,'Download selected file');assert.equal(button.getAttribute('aria-label'),'Inspect retained file 原稿.musicxml');
 assert.equal(f.$('source-archive-files').firstElementChild,row);assert.equal(f.$('source-archive-selected'),heading);assert.equal(f.$('source-archive-download'),download);assert.equal(f.document.activeElement,download);assert.equal(f.$('source-archive-dialog').open,true);assert.equal(f.$('source-archive-dialog').scrollTop,77);assert.equal(JSON.stringify(f.context()),canonical);assert.deepEqual(f.counts,counts);assert.equal(f.$('source-archive-score').textContent,'<Original score & 原稿>');assert.equal(f.$('source-archive-score').querySelector('original'),null);
 f.view.destroy();
});

test('locale changes during an inspection cannot replace its generation or rerun the inspector',async()=>{
 const pending=deferred();let file,calls=0;const f=fixture('en',{inspectFile:value=>{file=value;calls++;return pending.promise}});f.open();f.$('source-archive-files').querySelector('button').click();await settle();const counts={...f.counts};f.i18n.setLocale('zh-CN');
 assert.equal(calls,1);assert.deepEqual(f.counts,counts);assert.match(f.$('source-archive-status').textContent,/正在本地核对 原稿.musicxml/);assert.equal(f.$('source-archive-dialog').getAttribute('aria-busy'),'true');
 pending.resolve(await inspectRetainedSourceFile(file,{crypto:null}));await settle();assert.equal(calls,1);assert.equal(f.$('source-archive-inspection').hidden,false);assert.equal(f.$('source-archive-download').disabled,false);assert.match(f.$('source-archive-status').textContent,/核对已就绪/);f.view.destroy();
});

for(const action of ['close','refresh','replace'])test(`stale source results stay cancelled across a locale change after ${action}`,async()=>{
 const pending=deferred();let file;const f=fixture('en',{inspectFile:value=>{file=value;return pending.promise}});f.open();f.$('source-archive-files').querySelector('button').click();await settle();
 if(action==='close')f.view.close();else if(action==='refresh')f.$('source-archive-refresh').click();else{f.setContext({score:{...sourceScore(),title:'Replacement'},version:13});f.view.scoreChanged()}
 f.i18n.setLocale('zh-CN');pending.resolve(await inspectRetainedSourceFile(file,{crypto:null}));await settle();assert.equal(f.$('source-archive-inspection').hidden,true);assert.equal(f.$('source-archive-download').disabled,true);assert.equal(f.$('source-archive-dialog').open,action!=='close');
 if(action==='replace'){assert.match(f.$('source-archive-status').textContent,/载入的乐谱已改变/);assert.equal(f.$('source-archive-score').textContent,'<Original score & 原稿>','The retained snapshot is not silently replaced')}f.view.destroy();
});

test('source errors and warnings use stable messages and retain external diagnostic text and codes literally',async()=>{
 const detail='<script>external digest problem & 原文</script>',f=fixture('zh-CN',{inspectFile:async()=>{throw Object.assign(new Error(detail),{code:'DIGEST_EXTERNAL_3'})}});f.open();f.$('source-archive-files').querySelector('button').click();await settle();
 const disclosure=f.$('source-archive-status').querySelector('details'),original=disclosure.querySelector('p');assert.match(f.$('source-archive-status').textContent,/无法核对此文件/);assert.equal(original.textContent,detail);assert.match(disclosure.textContent,/DIGEST_EXTERNAL_3/);assert.equal(disclosure.querySelector('script'),null);disclosure.open=true;f.document.activeElement=disclosure.querySelector('summary');
 f.i18n.setLocale('en');assert.match(f.$('source-archive-status').textContent,/Could not inspect this file/);assert.equal(original.textContent,detail);assert.equal(disclosure.open,true);assert.equal(f.document.activeElement,disclosure.querySelector('summary'));
 f.setContext({score:{title:'Original',source:{format:'worldmusichub-curated-edition-v1',filename:'envelope.json',content:'{"version":2,"files":{}}'}},version:13});f.$('source-archive-refresh').click();f.i18n.setLocale('zh-CN');
 assert.match(f.$('source-archive-warnings').textContent,/未知的存档版本/);assert.match(f.$('source-archive-warnings').textContent,/source_archive_version/);assert.doesNotMatch(f.$('source-archive-warnings').textContent,/Unknown archive version/);assert.equal(f.$('source-archive-files').children.length,1);assert.equal(f.$('source-archive-files').querySelector('strong').textContent,'envelope.json');f.view.destroy();
});

test('checksum and byte mismatches stay visible in both locales and never alter declared values',()=>{
 const file={declaredSha256:'a'.repeat(64),declaredBytes:1},result={bytes:new Uint8Array([1,2,3]),sha256:'b'.repeat(64),checksumMatches:false,sizeMatches:false},before=JSON.stringify({file,result});
 for(const locale of ['zh-CN','en']){const i18n=createI18n({locale}),summary=sourceCheckSummary(file,result,i18n);assert.equal(summary.mismatch,true);assert.equal(summary.declaredHash,file.declaredSha256);assert.equal(summary.computedHash,result.sha256);assert.equal(summary.declaredBytes,'1');assert.equal(summary.computedBytes,'3');assert.match(summary.hash,locale==='en'?/Mismatch/:/不匹配/);assert.match(summary.size,locale==='en'?/Mismatch/:/不匹配/)}assert.equal(JSON.stringify({file,result}),before);
});

test('each original edition file downloads with identical filename and exact bytes in both locales',async()=>{
 const edition=JSON.parse(readFileSync(new URL('../catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json',import.meta.url),'utf8')),before=JSON.stringify(edition),archive=retainedSourceArchive(edition),expected=await Promise.all(archive.files.map(file=>inspectRetainedSourceFile(file,{crypto:null}))),urls=[],downloads=[];
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{urls.push(blob);return'blob:locale-test'};URL.revokeObjectURL=()=>{};
 try{
  for(const locale of ['zh-CN','en']){
   const f=fixture(locale);f.setContext({score:edition,version:22});const create=f.document.createElement.bind(f.document);f.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push(node.download);return node};f.open();
   for(let index=0;index<archive.files.length;index++){
    const button=f.$('source-archive-files').querySelector(`[data-source-file-index="${index}"]`);button.click();await settle();f.i18n.setLocale(locale==='en'?'zh-CN':'en');f.$('source-archive-download').click();
    assert.equal(downloads.at(-1),expected[index].filename);assert.deepEqual(new Uint8Array(await urls.at(-1).arrayBuffer()),expected[index].bytes);assert.equal(f.$('source-archive-selected').textContent,expected[index].filename);f.i18n.setLocale(locale);
   }
   assert.equal(f.counts.inspections,archive.files.length);f.view.destroy();
  }
  assert.equal(urls.length,archive.files.length*2);assert.equal(JSON.stringify(edition),before);
 }finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke}
});
