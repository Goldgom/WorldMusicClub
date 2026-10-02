import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {sourceCheckSummary,setupSourceArchiveView} from '../web/source-archive-view.js';
const file={filename:'original.xml',declaredSha256:null,declaredBytes:null};
const result={filename:file.filename,mime:'application/octet-stream',bytes:new Uint8Array([0,1,2]),sha256:'a'.repeat(64),checksumMatches:null,sizeMatches:null};
const english=createI18n({locale:'en'});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};

test('source comparisons keep unknown, matching and mismatched declarations distinct',()=>{
 let summary=sourceCheckSummary(file,result,english);assert.match(summary.hash,/Unknown: no declared/);assert.match(summary.size,/Unknown/);assert.equal(summary.mismatch,false);assert.equal(summary.computedHash,result.sha256);
 summary=sourceCheckSummary({...file,declaredSha256:'b'.repeat(64),declaredBytes:4},{...result,checksumMatches:false,sizeMatches:false},english);assert.equal(summary.mismatch,true);assert.match(summary.hash,/Mismatch/);assert.equal(summary.computedBytes,'3');
 summary=sourceCheckSummary({...file,declaredSha256:result.sha256,declaredBytes:3},{...result,checksumMatches:true,sizeMatches:true},english);assert.match(summary.hash,/matches/);assert.match(summary.size,/matches/);assert.equal(summary.mismatch,false);assert.match(sourceCheckSummary(file,{...result,sha256:null},english).hash,/unavailable/);
});
function environment(){
 const {document,window}=parseHTML('<html><body><button id="source-files-button"></button></body></html>'),requests=[];
 let context={score:{title:'Original',source:{format:'musicxml',filename:'original.xml',content:'\uFEFF<score/>\r\n'}},version:1},pauses=0;
 const node=id=>document.getElementById(id),view=setupSourceArchiveView({document,window,i18n:createI18n({locale:'en'}),getContext:()=>context,pausePlayback:()=>pauses++,inspectFile:file=>new Promise(resolve=>requests.push({file,resolve}))}),dialog=node('source-archive-dialog');
 dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 return{requests,view,node,get pauses(){return pauses},get context(){return context},setContext:value=>context=value,firstButton:()=>node('source-archive-files').querySelector('button'),restore(){view.destroy()}};
}
test('closing the retained-source view ignores a late digest and never prepares a hidden download',async()=>{
 const env=environment();try{env.node('source-files-button').click();assert.equal(env.pauses,1);env.firstButton().click();assert.equal(env.requests.length,1);assert.equal(env.firstButton().disabled,true);env.node('source-archive-close').click();env.requests[0].resolve(result);await settle();assert.equal(env.node('source-archive-dialog').open,false);assert.equal(env.node('source-archive-download').disabled,true);assert.equal(env.node('source-archive-inspection').hidden,true)}finally{env.restore()}
});
test('source replacement and refresh discard old inspection bytes and permit only the new file',async()=>{
 const env=environment();try{
  env.node('source-files-button').click();env.firstButton().click();env.setContext({score:{title:'New',source:{format:'musicxml',filename:'new.xml',content:'<new/>'}},version:2});env.view.scoreChanged();assert.match(env.node('source-archive-status').textContent,/loaded score changed/);
  env.node('source-archive-refresh').click();assert.equal(env.firstButton().disabled,true);env.requests[0].resolve(result);await settle();assert.equal(env.node('source-archive-download').disabled,true);assert.equal(env.firstButton().disabled,false);assert.match(env.node('source-archive-status').textContent,/Cancelled inspection discarded/);
  env.firstButton().click();assert.equal(env.requests[1].file.filename,'new.xml');env.requests[1].resolve({...result,filename:'new.xml'});await settle();assert.equal(env.node('source-archive-selected').textContent,'new.xml');assert.equal(env.node('source-archive-download').disabled,false);
  env.setContext({...env.context,version:3});env.node('source-archive-download').click();assert.match(env.node('source-archive-status').textContent,/No file was downloaded/);assert.equal(env.node('source-archive-download').disabled,true);
 }finally{env.restore()}
});
test('an inconsistent inspection result cannot prepare another file under the selected label',async()=>{
 const env=environment();try{env.node('source-files-button').click();env.firstButton().click();env.requests[0].resolve({...result,filename:'different.xml'});await settle();assert.match(env.node('source-archive-status').textContent,/unexpected file data/);assert.equal(env.node('source-archive-download').disabled,true)}finally{env.restore()}
});
