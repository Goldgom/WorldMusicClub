import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
import {parseHTML} from 'linkedom';
import {nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';
import {liveToneNavigationFixture,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME} from '../scripts/prepare-live-tone-navigation-fixtures.mjs';

const source=readFileSync(new URL('../crates/desktop-shell/live-tone-navigation-acceptance.js',import.meta.url),'utf8');
const canonical=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0];
const helpers=runInNewContext(canonical+'\n'+source.split('(() => {')[0]+'\n({nativeLiveToneNavigationCase,nativeLiveToneNavigationInput,createNativeLiveToneNavigationControls,deliverNativeLiveToneNavigationReport,observeNativeLiveToneNavigation,observeCanonicalPracticeOwnedClick});',{structuredClone,TextEncoder});

function harness({controls={beginPicker(){},endPicker(){}}}={}){
 const listeners=new Map(),calls=[],results=new Map(),nodes=new Map(),report={controlActions:[],keyPreparations:[]};
 const document={body:{dataset:{screen:'stage'}},hidden:false,focused:true,open:null,activeElement:null,hit:null,hasFocus(){return this.focused;},getElementById:id=>nodes.get(id)||null,querySelector(selector){return selector==='dialog[open]'?this.open:null;},elementFromPoint(){return this.hit;},addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};
 const view={innerWidth:1280,innerHeight:720,performance:{timeOrigin:1000},setTimeout,clearTimeout,requestAnimationFrame:fn=>{queueMicrotask(fn);return 1;},cancelAnimationFrame:()=>{}};document.defaultView=view;
 const node=(id,{dialog=null,closePanel=null,tagName='BUTTON'}={})=>{const value={id,tagName,isConnected:true,...(['BUTTON','INPUT','SELECT'].includes(tagName)?{disabled:false}:{}),dataset:closePanel?{closePanel}:{},dialog,closest(selector){return ['dialog','dialog[open]'].includes(selector)?this.dialog:null;},contains:()=>false,scrollIntoView(){calls.push(['scroll',id]);},focus(){throw Error('Acceptance must never focus a pointer target');},getBoundingClientRect:()=>({x:20,y:30,width:120,height:30})};nodes.set(id,value);return value;};
 const stage=node('stage-title',{tagName:'H1'}),play=node('play-button'),settings=node('settings-button'),modal={id:'settings-dialog',hasAttribute:()=>true},heading=node('settings-title',{dialog:modal,tagName:'H2'}),close=node('',{dialog:modal,closePanel:'settings'});document.activeElement=stage;
 let running=true,fail=false,trusted=true;
 const until=async(fn,label)=>{for(let i=0;i<8;i++){if(await fn())return;await Promise.resolve();}throw Error(`Unsettled ${label}`);};
 const dispatch=helpers.createNativeLiveToneNavigationControls({document,phase:'live-navigation-settings-navigation',until,readClock:()=>({running,completed:false,positionMs:100}),frame:async()=>{calls.push(['frame']);},report,controls,postAction:async action=>{calls.push(['post',structuredClone(action)]);results.set(action.sequence,{ok:!fail,error:fail?'host refused':undefined});if(!action.kind.startsWith('live-key-r-')){calls.push(['native-pointer',document.hit.id]);document.activeElement=document.hit;for(const listener of listeners.get('click')||[])listener({target:document.hit,type:'click',timeStamp:1000,isTrusted:trusted});}},readResult:async sequence=>results.get(sequence)||null});
 return{document,stage,play,settings,heading,close,modal,report,calls,dispatch,node,listeners,useNode:value=>nodes.set(value.id,value),run:async(kind,target,file)=>{document.hit=target;return dispatch.native(kind,target,file);},running:value=>{running=value;},fail:value=>{fail=value;},trusted:value=>{trusted=value;}};
}

test('native live navigation selects exactly four separate phases without changing canonical guards',()=>{
 for(const route of ['settings','authoring'])for(const release of ['keyup','navigation'])assert.deepEqual(JSON.parse(JSON.stringify(helpers.nativeLiveToneNavigationCase(`live-navigation-${route}-${release}`))),{route,release});
 for(const phase of ['canonical-practice-seed','live-navigation-settings-other','live-navigation-other-keyup','live-navigation-settings-keyup-extra',null])assert.throws(()=>helpers.nativeLiveToneNavigationCase(phase));
 assert.doesNotThrow(()=>new Script(source));assert.doesNotMatch(source,/dispatchEvent|new KeyboardEvent|\.value\s*=(?!=)|\.checked\s*=(?!=)|\.click\(|\.focus\(/);
 assert.match(source,/observeLiveToneAudio\(document,\{keyCode:'KeyR',midi:60/);assert.match(source,/readSampleOffsetFrames:canonicalPracticeSampleOffsetFrames/);
 assert.match(source,/live\.checkpoint\('finished'\);await quiet\('finished',\{seal:false\}\);report.audio=live.finish\(\)/);
});

test('native held-key dispatch leaves focus intact until the actual owned pointer and later physical release',async()=>{
 const f=harness();assert.equal(await f.run('live-key-r-down',f.stage),1);assert.equal(f.dispatch.held(),true);assert.deepEqual(f.calls.map(row=>row[0]),['post']);assert.equal(f.document.activeElement,f.stage);
 assert.equal(await f.run('click',f.settings),2);assert.ok(f.calls.some(row=>row[0]==='native-pointer'&&row[1]==='settings-button'));assert.equal(f.document.activeElement,f.settings);assert.equal(f.dispatch.held(),true);
 f.document.open=f.modal;f.document.activeElement=f.heading;f.running(false);assert.equal(await f.run('live-key-r-up',f.heading),3);assert.equal(f.dispatch.held(),false);
 assert.deepEqual(f.report.keyPreparations.map(row=>row.kind),['live-key-r-down','live-key-r-up']);assert.equal(f.report.controlActions.length,1);assert.equal(f.report.controlActions[0].clicks[0].trusted,true);assert.equal(f.report.controlActions[0].clicks[0].owned,true);
});

test('native split keys reject lost foreground, wrong focus, repeated down and unmatched up before host mutation',async()=>{
 for(const mutate of [f=>f.document.focused=false,f=>f.document.hidden=true,f=>f.document.activeElement=f.settings,f=>f.document.open=f.modal,f=>f.document.body.dataset.screen='authoring',f=>f.running(false)]){const f=harness();mutate(f);await assert.rejects(f.run('live-key-r-down',f.stage));assert.equal(f.calls.filter(row=>row[0]==='post').length,0);}
 const f=harness();await assert.rejects(f.run('live-key-r-up',f.stage),/original held/);await f.run('live-key-r-down',f.stage);await assert.rejects(f.run('live-key-r-down',f.stage),/running prepared stage/);f.fail(true);await assert.rejects(f.run('live-key-r-up',f.stage),/host refused/);assert.equal(f.dispatch.held(),true,'A failed release cannot be reported as completed; host cleanup still owns it');
});

test('native pointer controls keep strict ownership, explicit blocked-key scope and fixed picker filenames',async()=>{
 const f=harness();await assert.rejects(f.run('key-r',f.stage),/actual authoring or Settings/);await assert.rejects(f.run('picker',f.settings,'private-score.json'),/Unexpected/);await assert.rejects(f.run('click',f.settings,'live-tone-navigation-original.json'),/Only the owned picker/);await assert.rejects(f.run('key-c5',f.stage),/Unsupported/);
 f.document.open=f.modal;await f.run('key-r',f.heading);assert.equal(f.report.controlActions.at(-1).kind,'key-r');
 f.trusted(false);await assert.rejects(f.run('click',f.close),/Unsettled/);assert.equal(f.report.controlActions.at(-1).closePanel,'settings');
});

test('native event ownership exists only during its dispatched pointer and clears on success or failure',async()=>{
 const f=harness(),rows=[];assert.equal(f.dispatch.ownedControl(),null);
 f.document.addEventListener('click',event=>rows.push(helpers.nativeLiveToneNavigationInput(event,f.dispatch.sequence(),f.dispatch.ownedControl())));
 await f.run('click',f.settings);assert.equal(rows[0].controlId,'settings-button');assert.equal(rows[0].id,'settings-button');assert.equal(f.dispatch.ownedControl(),null);
 f.fail(true);await assert.rejects(f.run('click',f.settings),/host refused/);assert.equal(rows[1].controlId,'settings-button');assert.equal(f.dispatch.ownedControl(),null);
});

test('picker setup failure clears the pointer observer and owner before any host dispatch',async()=>{
 let ended=0;const cause=Error('injected picker setup failure'),f=harness({controls:{beginPicker(){throw cause;},endPicker(){ended++;}}}),button=f.node('import-button');
 await assert.rejects(f.run('picker',button,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME),error=>error===cause);
 assert.equal(f.dispatch.ownedControl(),null);assert.equal(f.listeners.get('click').size,0);assert.equal(f.calls.filter(row=>row[0]==='post').length,0);assert.equal(ended,0,'A picker that never began must not be ended');assert.equal(f.report.controlActions[0].clicks.length,0);
});

test('real heading and summary DOM shapes retain an explicit boolean disabled field after serialization',async()=>{
 const {document}=parseHTML('<html><body><h1 id="real-h1">Stage</h1><h2 id="real-h2">Settings</h2><details open><summary id="real-summary">Options</summary></details><button id="disabled-button" disabled>Blocked</button></body></html>');
 for(const id of ['real-h1','real-h2','real-summary']){
  const node=document.getElementById(id);assert.equal(node.disabled,undefined,'Native non-form elements do not manufacture a disabled property');
  node.getBoundingClientRect=()=>({x:20,y:30,width:120,height:30});node.scrollIntoView=()=>{};
  const f=harness();f.useNode(node);await f.run('click',node);const row=JSON.parse(JSON.stringify(f.report.controlActions[0]));
  assert.equal(Object.hasOwn(row.afterDispatch,'disabled'),true);assert.equal(row.afterDispatch.disabled,false);assert.equal(row.clicks[0].owned,true);
 }
 const blocked=document.getElementById('disabled-button'),f=harness();assert.equal(blocked.disabled,true);await assert.rejects(f.run('click',blocked),/unavailable/);assert.equal(f.calls.filter(row=>row[0]==='post').length,0,'Normalization must not weaken disabled-control admission');
});

test('the actual app Import handler forwards exactly one click to its original hidden file input and preserves the original source',async()=>{
 // Actual product DOM/handler, in-memory transport and fixture trust only.
 // Linkedom bubbles document observers; this model checks both raw identities,
 // while the independent native verifier requires the real capture order.
 const server=await nativeScoreServer(),app=await nativeStorageApp(server),fixture=liveToneNavigationFixture();let observation;
 try{
  await app.until(()=>!app.$('start-listen').disabled);await app.click('import-tools-button');
  const button=app.$('import-button'),input=app.$('score-file'),targets=[];input.addEventListener('click',event=>targets.push(event.target));
  observation=helpers.observeCanonicalPracticeOwnedClick({document:app.document,node:button,sequence:7});
  const event=new app.window.Event('click',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});button.dispatchEvent(event);
  const raw=JSON.parse(JSON.stringify(observation.events));assert.equal(raw.length,2);assert.deepEqual(targets,[input]);
  assert.deepEqual(raw.filter(row=>row.owned),[{sequence:7,id:'import-button',owned:true,trusted:true}]);assert.deepEqual(raw.filter(row=>!row.owned),[{sequence:7,id:'score-file',owned:false,trusted:false}]);assert.equal(app.$('score-file'),input);
  app.importFile(fixture.bytes.toString(),{name:LIVE_TONE_NAVIGATION_FIXTURE_FILENAME});await app.until(()=>server.records.size===1&&app.storageStatus()?.dataset.persistence==='saved');
  assert.equal([...server.records.values()][0].score_json,fixture.bytes.toString());assert.deepEqual(await app.exported('export-button'),fixture.score);assert.deepEqual(JSON.parse(JSON.stringify(observation.events.slice(0,2))),raw,'Complete forwarding trace is retained unchanged');
 }finally{observation?.restore();await app.close();}
});

test('native renderer retains id-less real KeyR release evidence and makes no clock or source substitutions',()=>{
 assert.match(source,/event.code!=='KeyR'/);assert.match(source,/eventTime:event.timeStamp/);assert.match(source,/surface:target.closest\?\.\('\[data-keyboard-performance\]'\)/);
 assert.match(source,/if\(release==='navigation'\)[\s\S]*pointer navigation cancelled the still-held native voice[\s\S]*live-key-r-up/);
 assert.match(source,/report.pausedBefore=snapshot\(\);[\s\S]*report.actionRoles.beforeTake=await take\('beforeTake'\)/);
 assert.match(source,/report.pausedAfter=snapshot\(\)/);assert.match(source,/report.actionRoles.afterTake=await take\('afterTake'\);report.actionRoles.score=await score\(\)/);
 assert.doesNotMatch(source,/recorder\.|transport\.position|currentFrame\s*=|currentTime\s*=|postMessage|createOscillator|createBufferSource/);
});

test('actual authoring card descendants retain their raw target and dispatched owner with one owned click',async()=>{
 const server=await nativeScoreServer(),app=await nativeStorageApp(server);let observation;
 try{
  const button=app.$('home-song-authoring'),target=button.querySelector('.game-mode-copy strong'),rows=[];
  assert.ok(target);assert.equal(target.id,'');assert.equal(target.closest('button'),button);
  const capture=event=>rows.push(helpers.nativeLiveToneNavigationInput(event,19,button));app.document.addEventListener('click',capture,true);
  observation=helpers.observeCanonicalPracticeOwnedClick({document:app.document,node:button,sequence:19});
  const event=new app.window.Event('click',{bubbles:true});Object.defineProperties(event,{isTrusted:{value:true},timeStamp:{value:1234}});target.dispatchEvent(event);
  assert.equal(app.document.body.dataset.screen,'authoring','The actual card handler receives the child click');assert.equal(rows.length,1);
  const row=JSON.parse(JSON.stringify(rows[0]));assert.equal(row.id,null);assert.equal(row.controlId,'home-song-authoring');assert.equal(row.isTrusted,true);assert.equal(row.eventTime,1234);assert.equal(row.sequence,19);
  assert.deepEqual(JSON.parse(JSON.stringify(observation.events)),[{sequence:19,id:null,owned:true,trusted:true}]);
  app.document.removeEventListener('click',capture,true);
  const foreign=app.document.createElement('button'),child=app.document.createElement('span');foreign.id='foreign-button';foreign.append(child);app.document.body.append(foreign);
  assert.equal(helpers.nativeLiveToneNavigationInput({target:child,type:'click'},19,button),null,'A foreign button ancestor cannot acquire the dispatched control identity');
  assert.equal(helpers.nativeLiveToneNavigationInput({target,type:'click'},19),null,'No control identity is inferred outside the actual dispatcher lifetime');
 }finally{observation?.restore();await app.close();}
});

test('both Settings release routes close the owned modal before baseline export, reopen for blocked input, then return closed',async()=>{
 for(const release of ['keyup','navigation']){
  const f=harness(),events=[],windows=[],report=f.report;report.actionRoles={};report.files={};
  const status={dataset:{passId:'one-human-pass',revision:'1'}},query=f.document.querySelector.bind(f.document);f.document.querySelector=selector=>selector==='.performance-status'?status:query(selector);f.document.defaultView.performance.now=()=>100;
  for(const id of ['score-title','hud-captured','session-mode','keyboard-map','sound-button','workspace'])f.node(id);
  f.document.getElementById('score-title').textContent='Original native fixture';f.stage.textContent='Original native fixture';f.document.getElementById('hud-captured').textContent='1';f.document.getElementById('session-mode').value='practice';f.document.getElementById('keyboard-map').querySelector=()=>({dataset:{noteMidi:'60'}});f.document.getElementById('sound-button').getAttribute=()=> 'false';f.document.getElementById('workspace').hidden=false;
  const settings=f.node('settings-dialog');settings.open=false;settings.querySelector=()=>f.close;const results=f.node('results-button'),sourceButton=f.node('score-tools-button');
  let playing=true;
  const click=async value=>{const node=typeof value==='string'?f.document.getElementById(value):value,sequence=await f.run('click',node);events.push(node===f.close?'close-settings':node.id);
   if(node===f.settings){settings.open=true;f.document.open=f.modal;f.document.activeElement=f.heading;playing=false;f.running(false);}
   else if(node===f.close){settings.open=false;f.document.open=null;f.document.activeElement=f.settings;}
   return sequence;
  };
  const native=async(kind,node)=>{events.push(kind);return f.run(kind,node);};
  const until=async(fn,label)=>{for(let i=0;i<8;i++){if(await fn())return;await Promise.resolve();}throw Error(`Unsettled route: ${label}`);};
  const live={begin(){},sounding:()=>true,settled:()=>true,failureEvidence:()=>({current:{inputs:[{type:'keydown',wallMs:0}],receipts:[{record:{type:'ended'}}]}}),checkpoint:label=>windows.push(label),quiet:()=>true,sealCheckpoint(){},finish:()=>({model:'routing-only'})};
  const take=async name=>{events.push(`take:${name}`);const sequence=await click(results);assert.equal(settings.open,false,'Results must be reached only after the owned Settings close');report.files[name]=name+'.json';return sequence;};
  await helpers.observeNativeLiveToneNavigation({document:f.document,route:'settings',release,native,click,until,live,receiver:{quiet:()=>true},clock:()=>({running:playing,positionMs:100}),take,score:()=>click(sourceButton),report});
  assert.deepEqual(events.filter(value=>['settings-button','close-settings','take:beforeTake','take:afterTake','key-r'].includes(value)),['settings-button','close-settings','take:beforeTake','settings-button','key-r','close-settings','take:afterTake']);
  assert.deepEqual(windows,['navigation','entered','blocked-input','returned','finished']);assert.equal(settings.open,false);assert.equal(f.document.open,null);assert.equal(f.dispatch.held(),false);assert.deepEqual(report.pausedAfter,report.pausedBefore);
 }
});

test('native report delivery retains a bounded diagnostic when size or host admission rejects the full result',async()=>{
 const report={version:1,phase:'live-navigation-settings-keyup',route:'settings',release:'keyup',origin:'https://wmh.localhost',ok:true};
 for(const oversized of [false,true]){const sent=[],value={...report,...(oversized?{padding:'x'.repeat(1_000_000)}:{})},result=await helpers.deliverNativeLiveToneNavigationReport(value,async row=>{sent.push(row);if(!oversized&&sent.length===1)throw Error('host admission failed');});
  assert.equal(result.delivered,false);const failure=sent.at(-1);assert.equal(failure.ok,false);assert.equal(failure.phase,report.phase);assert.equal(failure.report_failure.code,'live_navigation_report_delivery_failed');assert.ok(JSON.stringify(failure).length<1024);assert.equal(sent.length,oversized?1:2);
 }
 const sent=[];assert.equal((await helpers.deliverNativeLiveToneNavigationReport(report,async row=>sent.push(row))).delivered,true);assert.equal(sent[0],report);
});
