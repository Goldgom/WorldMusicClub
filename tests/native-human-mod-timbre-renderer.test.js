import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {SongModStore,defaultSongMod,songModConfigFingerprint} from '../web/song-mod.js';
import {humanModTimbreFixture} from '../scripts/prepare-human-mod-timbre-fixtures.mjs';
import {humanModTimbreBootstrap,HUMAN_MOD_TIMBRE_BROWSER_CASE} from './human-mod-timbre-browser-regression.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),renderer=read('crates/desktop-shell/human-mod-timbre-acceptance.js'),shared=read('crates/desktop-shell/live-tone-navigation-acceptance.js').split('(() => {')[0];
function harness(phase,{onPost,result={ok:true}}={}){const report={controlActions:[],keyPreparations:[]},posted=[],node={id:'import-button',isConnected:true,disabled:false,contains:()=>false,scrollIntoView(){},getBoundingClientRect:()=>({x:20,y:20,width:100,height:40})},doc={defaultView:{innerWidth:1280,innerHeight:720,performance:{timeOrigin:1000}},elementFromPoint:()=>node},context={structuredClone,TextEncoder,waitCanonicalPracticeControl:async()=>{},prepareCanonicalPracticeTarget:async()=>{},observeCanonicalPracticeOwnedClick:()=>({events:[],restore(){}}),requireCanonicalPracticeOwnedClick:async()=>{}};const make=runInNewContext(shared+'\ncreateNativeLiveToneNavigationControls',context),dispatch=make({document:doc,phase,until:async fn=>{assert.ok(await fn());},readClock:()=>({running:false}),frame:async()=>{},postAction:async row=>{posted.push(row);onPost?.(row);},readResult:async()=>result,report,controls:{beginPicker(){},endPicker(){}}});return{node,doc,report,posted,dispatch};}

test('native renderer and browser bootstrap parse and retain only the existing passive observers',()=>{assert.doesNotThrow(()=>new Script(renderer));assert.doesNotThrow(()=>new Script(humanModTimbreBootstrap));assert.doesNotMatch(renderer,/dispatchEvent|new KeyboardEvent|\.value\s*=(?!=)|\.checked\s*=(?!=)|\.click\(|\.focus\(|createOscillator|setInterval|AudioWorkletNode\(/);assert.match(renderer,/observeLiveToneAudio\(document,\{keyCode:'KeyR',midi:60/);assert.match(renderer,/observeNativeReferenceTransport\(document/);assert.match(renderer,/live\.checkpoint\('released'\)/);assert.match(renderer,/native\('live-key-r-down'/);assert.match(renderer,/native\('live-key-r-up'/);assert.ok(read('tests/full-app-browser.test.js').includes('registerHumanModTimbreBrowserRegression({'));assert.ok(HUMAN_MOD_TIMBRE_BROWSER_CASE.startsWith('real human Mod'));});

test('only three exact human phases can reuse the fixed native picker controls',async()=>{for(const phase of ['human-timbre-seed','human-timbre-migrate','human-timbre-restart']){const h=harness(phase);await assert.rejects(h.dispatch.native('picker',h.node,'live-tone-navigation-original.json'));await assert.rejects(h.dispatch.native('picker',h.node,'private-score.json'));assert.equal(h.posted.length,0);if(phase==='human-timbre-seed'){await h.dispatch.native('picker',h.node,'human-mod-timbre-original.json');assert.equal(h.posted[0].file,'human-mod-timbre-original.json');}else await assert.rejects(h.dispatch.native('picker',h.node,'human-mod-timbre-original.json'));}for(const phase of ['human-timbre','human-timbre-restart-extra','human-timbre-other'])assert.throws(()=>harness(phase));});

test('selectors use existing closed positions and unchanged 64-action bound',async()=>{const h=harness('human-timbre-migrate');for(let i=0;i<64;i++)await h.dispatch.native(i===0?'select-second':'click',h.node);assert.equal(h.posted.length,64);await assert.rejects(h.dispatch.native('click',h.node),/bound exceeded/);assert.equal(h.posted.length,64);await assert.rejects(h.dispatch.native('select-third',h.node),/Unsupported/);});

test('fixture generation is original, exact-rational and does not relabel a production source',()=>{const f=humanModTimbreFixture();assert.equal(f.score.parts.length,2);assert.equal(f.manifest.sourceNotes,4);assert.equal(f.manifest.targetNotes,2);assert.equal(f.manifest.defaultPerformanceProfile,'piano');assert.deepEqual(f.manifest.targetNotesByPerformanceProfile,{piano:2,guitar:4});assert.deepEqual(f.manifest.targetOwnershipByPerformanceProfile,{piano:'shared-unison-owners',guitar:'separate-source-events'});assert.equal(f.manifest.midi,60);for(const part of f.score.parts){assert.deepEqual(part.notes.map(n=>n.at),[{numerator:0,denominator:1},{numerator:63,denominator:1}]);assert.equal(part.notes[0].pitch.octave,4);}assert.match(f.score.provenance.attribution,/Self-authored/);assert.ok(f.score.source.content.startsWith('\uFEFF'));assert.ok(f.score.source.content.includes('\r\n'));assert.doesNotMatch(read('scripts/prepare-human-mod-timbre-fixtures.mjs'),/Unity|user_import/);});

const sourceKey='song-'+'a'.repeat(64),catalogSelector=`#catalog [data-library-key="native:${sourceKey}"]`,summarySelector='#settings-dialog .practice-options > summary';
const rawInput=runInNewContext(shared+'\nnativeLiveToneNavigationInput');
test('closed ID-less native targets retain raw descendant identity, composed path, trust and time',()=>{
 const {document}=parseHTML(`<html><body><div id="catalog"><button data-library-key="native:${sourceKey}"><span>Original fixture</span></button></div><dialog id="settings-dialog"><details class="practice-options"><summary><span>Practice options</span></summary></details></dialog></body></html>`);
 for(const selector of [catalogSelector,summarySelector]){
  const control=document.querySelector(selector),target=control.querySelector('span'),event={type:'click',target,isTrusted:true,timeStamp:1234.75,composedPath:()=>[target,control,document]};
  const row=JSON.parse(JSON.stringify(rawInput(event,2,control,selector)));assert.equal(row.id,null);assert.equal(row.controlId,null);assert.equal(row.controlSelector,selector);assert.equal(row.controlPathOwned,true);assert.equal(row.type,'click');assert.equal(row.isTrusted,true);assert.equal(row.eventTime,1234.75);assert.equal(row.sequence,2);assert.equal(row.actionSequence,2);
  assert.equal(rawInput({...event,isTrusted:false},2,control,selector).isTrusted,false,'Observer retains the real trust bit');
  assert.equal(rawInput({...event,type:'change'},2,control,selector),null,'A selector does not grant ownership to another event type');
  assert.equal(rawInput({...event,composedPath:()=>[target,document]},2,control,selector),null,'Missing actual owner path is not repaired');
  assert.equal(rawInput({...event,composedPath:undefined},2,control,selector),null,'Path evidence is mandatory for an ID-less selector');
  assert.equal(rawInput(event,2,null,selector),null,'A stale selector outside the dispatcher lifetime cannot own a click');
  const sibling=document.createElement('span');control.parentNode.append(sibling);
  assert.equal(rawInput({...event,target:sibling,composedPath:()=>[sibling,control,document]},2,control,selector),null,'An unrelated target cannot gain ownership from a supplied path');
 }
});

test('only a unique original selector can accompany an ID-less human click without changing the native wire',async()=>{
 for(const selector of [catalogSelector,summarySelector]){
  const h=harness('human-timbre-migrate');h.node.id='';h.report.key=sourceKey;h.doc.querySelectorAll=()=>[h.node];
  await h.dispatch.native('click',h.node,undefined,selector);assert.deepEqual(Object.keys(h.posted[0]).sort(),['version','sequence','kind','x','y','width','height'].sort());assert.equal(h.report.controlActions[0].selector,selector);assert.equal(h.dispatch.ownedSelector(),null);
  for(const matches of [[],[h.node,h.node],[{}]]){const bad=harness('human-timbre-migrate');bad.node.id='';bad.report.key=sourceKey;bad.doc.querySelectorAll=()=>matches;await assert.rejects(bad.dispatch.native('click',bad.node,undefined,selector),/exactly the dispatched node/);assert.equal(bad.posted.length,0);}
 }
 for(const [kind,selector]of [['click','#catalog button'],['click',catalogSelector.replace(sourceKey,'song-'+'b'.repeat(64))],['select-first',summarySelector]]){const h=harness('human-timbre-migrate');h.node.id='';h.report.key=sourceKey;h.doc.querySelectorAll=()=>[h.node];await assert.rejects(h.dispatch.native(kind,h.node,undefined,selector));assert.equal(h.posted.length,0);}
 const unnamed=harness('human-timbre-migrate');unnamed.node.id='';await assert.rejects(unnamed.dispatch.native('click',unnamed.node),/requires its closed selector/);assert.equal(unnamed.posted.length,0);
 const changed=harness('human-timbre-migrate');changed.node.id='';changed.report.key=sourceKey;let queries=0;changed.doc.querySelectorAll=()=>++queries===1?[changed.node]:[];await assert.rejects(changed.dispatch.native('click',changed.node,undefined,summarySelector),/changed before dispatch/);assert.equal(changed.posted.length,0);assert.equal(changed.dispatch.ownedSelector(),null);
});

test('ID-less selector ownership exists only during its actual dispatch and clears after a host failure',async()=>{
 for(const fail of [false,true]){
  let active;const h=harness('human-timbre-migrate',{result:{ok:!fail,error:'host refused'},onPost:()=>{active={node:h.dispatch.ownedControl(),selector:h.dispatch.ownedSelector()};}});h.node.id='';h.report.key=sourceKey;h.doc.querySelectorAll=()=>[h.node];
  const dispatch=h.dispatch.native('click',h.node,undefined,catalogSelector);if(fail)await assert.rejects(dispatch,/host refused/);else await dispatch;
  assert.equal(active.node,h.node);assert.equal(active.selector,catalogSelector);assert.equal(h.dispatch.ownedControl(),null);assert.equal(h.dispatch.ownedSelector(),null);
 }
});


test('externally seeded original legacy conflicts need a fresh store, not catalog reselection',()=>{
 const {score}=humanModTimbreFixture(),context={score,mode:'practice',practiceSelection:{kind:'all'}},values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const active=new SongModStore({storage}),initial=defaultSongMod(context);
 active.save(context,initial);
 const conflict=structuredClone(initial);conflict.config.parts.forEach((part,index)=>part.liveInstrument=index?'guitar':'piano');conflict.configFingerprint=songModConfigFingerprint(conflict.config);
 storage.setItem(active.key(active.identity(context)),JSON.stringify(conflict));
 assert.deepEqual(active.read({...context}).mod.config.parts.map(part=>part.liveInstrument),['follow','follow'],'Same app retains its cached explicit preference');
 assert.deepEqual(new SongModStore({storage}).read(context).mod.config.parts.map(part=>part.liveInstrument),['piano','guitar'],'A fresh app store consumes the actual seeded legacy conflict');
});

test('hosted conflict seeding closes observers and reloads the actual app before reading drafts',()=>{
 const source=read('tests/human-mod-timbre-browser-regression.js'),seed=source.slice(source.indexOf('  const seedConflict='),source.indexOf('  const install='));
 assert.match(seed,/await cleanup\(\);await reopen\(\);await prepareOptions\(\);/);
 assert.match(seed,/after>before/);
 assert.match(source,/const reopen=async\(\)=>\{await page\.reload/);
 assert.doesNotMatch(seed,/\.entries\.clear|commitSaved|dispatchEvent|__.*songMod/);
});
