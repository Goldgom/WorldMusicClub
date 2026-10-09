import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('hosted source proof uses actual saved native admission and preserves rejected draft and complete Listen',async()=>{
 const text=await readFile(new URL('../scripts/hosted-source-identity-check.mjs',import.meta.url),'utf8');
 for(const expected of ["const ADMISSION='/api/library/practice-admission'",'async function exerciseBlockedHuman',"assert.equal(rejected.status(),422)",'A rejected assignment must preserve the user draft',"assert.equal(await page.locator('#session-mode').inputValue(),'listen')",'listen_complete_attack_count','original_files_unchanged:true','Actual source-bound native Human admission must run','checked.plan.human_source_ids','receipt.source_eligibility.eligibility_policy_id'])assert.ok(text.includes(expected),expected);
 assert.match(text,/await launch\('native-restart'\).*await exerciseBlockedHuman/);
 assert.match(text,/for\(const status of \[404,413\]\).*await exerciseHumanPractice/);
 assert.ok(text.indexOf("assert.equal(process.env.GITHUB_ACTIONS,'true'")<text.indexOf('await startHostedAssetServer('));
 assert.doesNotMatch(text,/setInputFiles|dispatchEvent\(|fixtures\/.*native-open/);
});
test('policy validator remains inside the complete frozen worklet dependency closure',async()=>{
 const source=await readFile(new URL('../scripts/hosted-worklet-assets.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("'source-practice-eligibility.js'"));
 assert.ok(source.includes('seen.size<32'));assert.ok(source.includes('evidence.assets.length<=32'));
 for(const path of ['../scripts/verify-native-assistance-evidence.mjs','../scripts/verify-native-pitch-mod-evidence.mjs']){const text=await readFile(new URL(path,import.meta.url),'utf8');assert.ok(text.includes("'web/source-practice-eligibility.js'"));assert.ok(text.includes("'web/basic-practice-admission.js'"));assert.ok(text.includes("'crates/score-core/src/source_identity/eligibility.rs'"));}
});

test('hosted owned-frame native bridge accepts the mandatory route without relaxing origin ownership',async()=>{
 const {createHostedNativeBridge}=await import('../scripts/hosted-worklet-assets.mjs');
 const origin='http://127.0.0.1:43210',page={isClosed:()=>false,url:()=>origin+'/',workers:()=>[],mainFrame:()=>frame},frame={page:()=>page,url:()=>origin+'/',isDetached:()=>false};
 const request={url:()=>origin+'/api/library/practice-admission',method:()=> 'POST',allHeaders:async()=>({'content-type':'application/json'}),frame:()=>frame,serviceWorker:()=>null,isNavigationRequest:()=>false,resourceType:()=> 'fetch'};
 const bridge=createHostedNativeBridge({origin,getOwnedPage:()=>page});let called=false;
 await bridge.run(request,async(headers,row)=>{called=true;assert.equal(headers.origin,'https://wmh.localhost');assert.equal(row.path,'/api/library/practice-admission');});await bridge.drain();assert.equal(called,true);assert.equal(bridge.evidence.drain.status,'complete');
});
