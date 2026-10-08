import test from 'node:test';
import assert from 'node:assert/strict';
import {freePracticeApp, fixtureScoreServer} from './free-practice-app-fixtures.js';
import {fixture} from './frontend-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView} from '../web/performance-view.js';
import {setupKeyboardInputView} from '../web/keyboard-input-view.js';
import {createKeyboardInput} from '../web/keyboard-input.js';
import {setupBeginnerView} from '../web/beginner-view.js';
import {createI18n} from '../web/i18n.js';
import {nativeScoreServer,nativeStorageApp} from './native-storage-app-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

const physicalC = {code:'KeyR', key:'r'};
const fixedTones = ['1','♯1','2','♯2','3','4','♯4','5','♯5','6','♯6','7'];
const keys = (app, root, selector = '[data-midi]') => [...app.$(root).querySelectorAll(selector)];
const label = key => key.querySelector('.beginner-note-label');
const glyph = key => {
  assert.ok(key, 'The real app rendered the requested playable key');
  const node = label(key);
  assert.ok(node, `A numbered label exists on ${key.outerHTML}`);
  assert.equal(node.parentElement, key, 'The guide decorates the real input cell');
  assert.deepEqual([...node.children].map(child=>child.className), ['beginner-note-above','beginner-note-tone','beginner-note-below']);
  assert.equal(node.getAttribute('aria-hidden'), 'true');
  assert.equal(node.style.pointerEvents, 'none');
  assert.equal(key.querySelectorAll('.beginner-note-label').length, 1);
  const description = key.querySelector('.beginner-note-description');
  assert.ok(description?.hidden, 'Accessible explanation is supplemental, not duplicate visible text');
  assert.ok((key.getAttribute('aria-describedby') || '').split(/\s+/).includes(description.id));
  return [node.querySelector('.beginner-note-tone').textContent, node.querySelector('.beginner-note-above').textContent, node.querySelector('.beginner-note-below').textContent];
};
function assertFixed(key, midi) {
  const octave = Math.floor(midi / 12) - 5;
  assert.deepEqual(glyph(key), [fixedTones[midi % 12], Array(Math.max(octave, 0)).fill('•').join('\n'), Array(Math.max(-octave, 0)).fill('•').join('\n')]);
}
function toggle(app, id, enabled) {
  const control = app.$(id);
  assert.ok(control, `${id} is present in the actual app`);
  control.checked = enabled; app.emit(control, 'change');
}
function choose(app, id, value) {app.$(id).value = value; app.emit(app.$(id), 'change');}
function key(app, properties=physicalC, target=app.$('stage-title')) {app.emit(target, 'keydown', properties); app.emit(target, 'keyup', properties);}
async function scoreApp(score = fixture) {
  const original = await fixtureScoreServer();
  const app = await freePracticeApp({fetchResult:(path,body)=>{
    if(path === '/api/catalog/index'){const index=original(path,body);index.items[0]={...index.items[0],id:score.id,title:score.title,composer:score.composer,provenance:score.provenance};return index;}
    if(path === `/api/catalog/score/${score.id}`)return structuredClone(score);
    return original(path,body);
  }});
  await app.until(()=>!app.$('start-listen').disabled);
  getAppI18n(app.document).setLocale('en');
  await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-exit');
  app.$('count-in').checked = false;
  await app.click('start-listen'); await app.until(()=>app.document.body.dataset.screen === 'stage');
  await app.click('reset-button');
  return app;
}
async function importScore(app, score) {
  Object.defineProperty(app.$('score-file'), 'files', {configurable:true,value:[{name:'beginner-original.json',size:JSON.stringify(score).length,text:async()=>JSON.stringify(score)}]});
  app.emit(app.$('score-file'), 'change');
  await app.until(()=>app.$('score-title').textContent === score.title && !app.$('play-button').disabled, 'Imported beginner fixture was not activated');
}
function originalScore(id, fifths=0, mode='major') {
  const score = structuredClone(fixture); score.id = id; score.title = id;
  score.keys[0] = {...score.keys[0],fifths,mode};
  score.source = {format:'original-test-text',filename:'原稿.txt',content:'\uFEFFKeep this original · 原稿\r\nExact rational time and source spelling.'};
  return score;
}

for (const initiallyCompact of [true, false]) test(`real shell/input/performance/guide setup with initial compact=${initiallyCompact} keeps one stage control across resizes`, async()=>{
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const prior=new Map(['document','window'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'window',{configurable:true,value:window});
  const listeners=new Set(),media={matches:initiallyCompact,addEventListener(type,callback){assert.equal(type,'change');listeners.add(callback);},removeEventListener(type,callback){assert.equal(type,'change');listeners.delete(callback);}};
  window.matchMedia=()=>media;
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value));}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLElement.prototype.close=function(){this.removeAttribute('open');};
  const $=id=>document.getElementById(id),events=[],i18n=createI18n({locale:'en'}),score=originalScore('compact-beginner-source'),source=structuredClone(score);
  let shell,inputView,performanceView,guide,numberedMode='fixed';
  try {
    // This is the production setup order that previously put the beginner
    // panel inside Settings before its first render on a short viewport.
    shell=setupGameShell({i18n,pausePlayback(){},onNotation(){},onScreen(){}});
    const controller=createKeyboardInput({getContext:()=>({screen:'stage'}),pressNote:(...args)=>events.push(['on',...args]),releaseNote:(...args)=>events.push(['off',...args]),releaseMatching:(...args)=>events.push(['cleanup',...args]),onChange:next=>inputView?.render(next)});
    $('keyboard').innerHTML='<button data-midi="60"><span class="key-shortcut"></span></button>';
    inputView=setupKeyboardInputView({document,controller,i18n,onConfigure:()=>shell.open('settings')});
    performanceView=setupPerformanceView({i18n,getContext:()=>({instrument:'piano',mode:'practice',position:0,segmentStart:0,now:0,recorder:{active:null,interruptions:[]}})});
    const free=document.createElement('section');free.innerHTML='<div id="free-practice-keys"><button data-midi="60"></button></div>';document.body.append(free);
    guide=setupBeginnerView({document,i18n,getContext:()=>({score,numberedMode}),onNumberedMode:value=>{numberedMode=value;}});
    shell.show('stage'); performanceView.screenChanged('stage');
    const panel=$('beginner-controls'),toggle=$('beginner-enabled'),reference=$('beginner-reference'),details=panel.querySelector('details'),map=document.querySelector('#keyboard-map [data-code="KeyR"]'),piano=document.querySelector('#keyboard [data-midi="60"]'),badge=$('keyboard-compact-status'),footer=document.querySelector('.keyboard-footer');
    assert.equal(Boolean(toggle.checked),false);
    const state=compact=>{
      assert.equal(panel.closest('dialog'),null,'Guide never inherits the footer Settings host');
      assert.equal(panel.parentElement,compact?$('stage-title').parentElement:document.querySelector('.play-panel'));
      assert.equal(panel.classList.contains('beginner-controls-compact'),compact);
      assert.equal($('stage-title').parentElement.classList.contains('has-beginner-controls'),compact,'Heading layout works without relational CSS selectors');
      assert.equal(reference.parentElement,compact?panel.querySelector('.beginner-help-body'):panel);
      assert.equal(footer.closest('dialog')?.id,compact?'settings-dialog':undefined);
      assert.equal(badge.hidden,!compact);assert.equal(badge.previousElementSibling.id,'stage-subtitle');
      assert.equal(document.querySelector('#notation-dock .notation-panel').classList.contains('short-notation'),true,'Piano overlay controls use their compact disclosure at every viewport');
      for(const id of ['beginner-controls','beginner-enabled','beginner-reference','beginner-help','beginner-numbered-mode','keyboard-map','keyboard-compact-status'])assert.equal(document.querySelectorAll(`#${id}`).length,1);
    };
    state(initiallyCompact);
    controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
    const evidence=structuredClone(events),configuration=controller.exportConfigurationData();
    toggle.checked=true;toggle.dispatchEvent(new window.Event('change'));
    const pianoLabel=label(piano),mapLabel=label(map);details.setAttribute('open','');
    let displayedCompact=initiallyCompact;
    for(const compact of [!initiallyCompact,initiallyCompact,!initiallyCompact,initiallyCompact]){
      media.matches=compact;
      // A viewport command can return after CSS/matches changes but before the
      // browser's rendering task reports media changes. Reproduce that interval:
      // the guide, footer badge and notation all still have the prior placement.
      state(displayedCompact);
      assert.deepEqual(events,evidence,'A pending layout notification must not disturb the held contact');
      for(const listener of listeners)listener({matches:compact});state(compact);displayedCompact=compact;
      for(const locale of ['zh-CN','en']){
        i18n.setLocale(locale);assert.equal($('beginner-controls'),panel);assert.equal($('beginner-enabled'),toggle);assert.equal($('beginner-reference'),reference);
        assert.equal(details.hasAttribute('open'),true,'Moving one native disclosure retains its state');
        assert.equal(label(piano),pianoLabel);assert.equal(label(map),mapLabel);assert.equal(map.classList.contains('held'),true);
        assert.equal(toggle.checked,true);assert.equal(toggle.parentElement.title,i18n.t('beginner.enabled'));
      }
    }
    assert.deepEqual(events,evidence);assert.deepEqual(controller.exportConfigurationData(),configuration);assert.deepEqual(score,source);
    toggle.checked=false;toggle.dispatchEvent(new window.Event('change'));assert.equal(map.classList.contains('held'),true);assert.equal(label(piano),null);
    controller.keyup({code:'KeyR',key:'r',target:document.body,timeStamp:2,preventDefault(){}});assert.deepEqual(events.map(event=>event[0]),['on','off']);
    const count=listeners.size;guide.dispose();guide=null;assert.equal(listeners.size,count-1);assert.equal($('beginner-controls'),null);assert.equal($('free-beginner-controls'),null);
  } finally {
    guide?.dispose();performanceView?.destroy();inputView?.destroy();shell?.destroy();
    for(const[name,descriptor]of prior)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
});

test('actual stage guide starts off, labels every physical pitch and preserves source, take, controls and key identity', async()=>{
  const score = originalScore('beginner-default-and-source'), app = await scoreApp(score);
  try {
    assert.equal(Boolean(app.$('beginner-enabled').checked), false);
    assert.equal(Boolean(app.$('free-beginner-enabled').checked), false);
    assert.equal(app.$('beginner-controls').hidden, false);
    assert.equal(app.$('beginner-controls').closest('dialog'), null, 'Beginner opt-in is available on the playing surface');
    assert.equal(app.document.querySelector('.beginner-note-label'), null);
    const piano = keys(app,'keyboard'), pc = keys(app,'keyboard-map','[data-note-midi]');
    const c4 = piano.find(node=>node.dataset.midi === '60'), shortcut = c4.querySelector('.key-shortcut');
    const beforeScore = await app.exported('export-button'), beforeTake = await app.exported('export-takes'), requests = app.requests.length;
    toggle(app,'beginner-enabled',true);
    assert.equal(app.$('free-beginner-enabled').checked, true);
    assert.match(app.$('beginner-reference').textContent, /Fixed C.*1 = C4/);
    assert.deepEqual(keys(app,'keyboard'),piano);
    assert.deepEqual(keys(app,'keyboard-map','[data-note-midi]'),pc);
    for (const node of piano) assertFixed(node,Number(node.dataset.midi));
    for (const node of pc) assertFixed(node,Number(node.dataset.noteMidi));
    assert.equal(c4.querySelector('.key-shortcut'), shortcut); assert.equal(shortcut.textContent,'R');
    assert.equal(c4.getAttribute('aria-label'),'Play C4');
    const c4Glyph = label(c4), description = c4.querySelector('.beginner-note-description');
    getAppI18n(app.document).setLocale('zh-CN');
    assert.equal(label(c4),c4Glyph); assert.equal(c4.querySelector('.beginner-note-description'),description);
    assert.match(description.textContent,/简谱/); assert.equal(c4.getAttribute('aria-label'),'弹奏 C4');
    getAppI18n(app.document).setLocale('en');
    toggle(app,'beginner-enabled',false);
    assert.equal(Boolean(app.$('free-beginner-enabled').checked),false);
    assert.equal(app.document.querySelector('.beginner-note-label'),null);
    assert.equal(c4.querySelector('.key-shortcut'),shortcut); assert.equal(c4.hasAttribute('aria-describedby'),false);
    assert.equal(app.requests.length,requests,'Guide and locale changes never compile, assess or alter the score');
    assert.deepEqual(await app.exported('export-button'),beforeScore); assert.deepEqual(beforeScore,score);
    assert.deepEqual(await app.exported('export-takes'),beforeTake);
  } finally {await app.close();}
});

test('guide and locale changes while holding a scored key retain its contact, DOM identity and recorder evidence', async()=>{
  const app = await scoreApp();
  try {
    choose(app,'session-mode','practice'); await app.until(()=>!app.$('play-button').disabled);
    await app.click('play-button');
    app.emit(app.$('stage-title'),'keydown',physicalC);
    const piano = app.document.querySelector('#keyboard [data-midi="60"]'), map = app.document.querySelector('#keyboard-map [data-code="KeyR"]');
    assert.ok(map.classList.contains('held'));
    const before = await app.exported('export-takes'), requests = app.requests.length;
    toggle(app,'beginner-enabled',true);
    const pianoGlyph = label(piano), mapGlyph = label(map);
    for (const locale of ['zh-CN','en']) {
      getAppI18n(app.document).setLocale(locale);
      assert.equal(app.document.querySelector('#keyboard [data-midi="60"]'),piano);
      assert.equal(app.document.querySelector('#keyboard-map [data-code="KeyR"]'),map);
      assert.equal(label(piano),pianoGlyph); assert.equal(label(map),mapGlyph);
      assert.ok(map.classList.contains('held'),'Changing display language does not release a held physical key');
    }
    toggle(app,'beginner-enabled',false); toggle(app,'beginner-enabled',true);
    assert.ok(map.classList.contains('held'));
    assert.deepEqual(await app.exported('export-takes'),before,'Display changes add no onset, release, pause or configuration event');
    assert.equal(app.requests.length,requests);
    app.emit(app.$('stage-title'),'keyup',physicalC);
    assert.equal(map.classList.contains('held'),false);
    const after = await app.exported('export-takes');
    assert.deepEqual(after.passes.at(-1).inputs.map(input=>input.midi),[60]);
    assert.equal(after.input_evidence.events.filter(event=>event.kind==='note_on').length,1);
    assert.equal(after.input_evidence.events.filter(event=>event.kind==='note_off').length,1);
  } finally {await app.close();}
});

test('a beginner held-key probe needs source-clock progress to preserve a scored onset',async()=>{
  // Pure DOM plus the production audio core, with an explicit clock. This
  // reproduces a live held key before the 50 ms anchor without a browser/server.
  let wall=1000;
  const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>wall});
  try{
    await app.click('import-tools-button');app.importFile(fixture);
    await app.until(()=>app.$('score-title').textContent===fixture.title&&app.$('practice-scope').textContent.includes('physical attacks'));
    app.$('import-tools-dialog').querySelector('[data-close-panel]').click();
    await app.click('home-single-player');await app.click('resume-session');
    await app.click('edit-song-mod');await app.click('song-mod-all-human');await app.click('song-mod-apply');
    await app.until(()=>!app.$('song-mod-dialog').open&&!app.$('play-button').disabled);
    app.$('count-in').checked=false;
    await app.click('play-button');await app.until(()=>app.sourceStartWall()!==null);app.frame();
    const anchor=app.sourceStartWall(),map=app.document.querySelector('#keyboard-map [data-code="KeyR"]');
    assert.ok(anchor>wall);
    assert.equal(readPlaybackClock(app.document).running,false);
    assert.equal(readPlaybackClock(app.document).phase,'preparing');
    assert.equal(readPlaybackClock(app.document).positionMs,0);
    app.emit(app.$('stage-title'),'keydown',physicalC);
    assert.equal(map.classList.contains('held'),true);
    const early=await app.exported('export-takes');
    assert.deepEqual(early.passes.at(-1).inputs,[],'A pre-anchor contact is live but cannot be assigned to the future take');
    assert.equal(early.input_evidence.events[0].kind,'note_on');
    assert.equal(early.input_evidence.events[0].onset_capture,null);

    // A complete render quantum can lead wall time; it must not start the
    // displayed take or manufacture another onset from this held contact.
    wall=anchor-1.2;app.renderAudioTo((wall-1000)/1000);
    for(const harness of app.audioHarnesses)harness.renderBlock(128);
    app.frame();assert.equal(readPlaybackClock(app.document).phase,'preparing');
    assert.equal(readPlaybackClock(app.document).running,false);assert.equal(map.classList.contains('held'),true);
    assert.deepEqual((await app.exported('export-takes')).passes.at(-1).inputs,[]);

    wall=anchor+60;app.renderAudioTo((wall-1000)/1000);app.frame();
    assert.equal(readPlaybackClock(app.document).running,true);
    assert.equal(readPlaybackClock(app.document).phase,'playing');
    assert.ok(readPlaybackClock(app.document).positionMs>0);
    assert.deepEqual((await app.exported('export-takes')).passes.at(-1).inputs,[],'Crossing the anchor cannot invent a later onset for a held key');
    app.emit(app.$('stage-title'),'keyup',physicalC);
    app.emit(app.$('stage-title'),'keydown',physicalC);
    const captured=await app.exported('export-takes');
    assert.deepEqual(captured.passes.at(-1).inputs,[{midi:60,at_ms:60,velocity:90}]);
    assert.equal(captured.input_evidence.events.at(-1).onset_capture.pass_id,captured.passes.at(-1).id);
    toggle(app,'beginner-enabled',true);toggle(app,'beginner-enabled',false);toggle(app,'beginner-enabled',true);
    assert.equal(app.document.querySelector('#keyboard-map [data-code="KeyR"]'),map);
    assert.equal(map.classList.contains('held'),true);
    assert.equal(readPlaybackClock(app.document).running,true);
    assert.deepEqual(await app.exported('export-takes'),captured,'Guide changes keep the scored contact and its clock/evidence unchanged');

    await app.click('settings-button');app.frame();
    assert.equal(app.$('settings-dialog').open,true);
    assert.equal(readPlaybackClock(app.document).running,false);
    assert.equal(map.classList.contains('held'),false,'The real Settings boundary must still clean up held input');
    const paused=await app.exported('export-takes');
    assert.deepEqual(paused.passes.at(-1).inputs,captured.passes.at(-1).inputs);
    assert.deepEqual(paused.input_evidence.events.filter(event=>event.kind==='synthetic_release').map(event=>event.reason),['pause']);
    app.emit(app.$('stage-title'),'keyup',physicalC);
    assert.deepEqual((await app.exported('export-takes')).passes.at(-1).inputs,captured.passes.at(-1).inputs);
    assert.deepEqual(await app.exported('export-button'),fixture);
  }finally{await app.close();}
});

test('input transposition labels sounded MIDI once while piano pitches, score key and source stay fixed', async()=>{
  const app = await scoreApp();
  try {
    toggle(app,'beginner-enabled',true);
    const score = await app.exported('export-button'), pianoC = app.document.querySelector('#keyboard [data-midi="60"]');
    key(app,{code:'ArrowRight',key:'ArrowRight'});
    let pc = app.document.querySelector('#keyboard-map [data-code="KeyR"]');
    assert.equal(pc.dataset.noteMidi,'61'); assertFixed(pc,61);
    assert.equal(app.document.querySelector('#keyboard [data-midi="60"]'),pianoC); assertFixed(pianoC,60);
    assert.equal(app.document.querySelector('#keyboard [data-midi="61"] .key-shortcut').textContent,'R');
    key(app,{code:'ArrowUp',key:'ArrowUp'});
    pc = app.document.querySelector('#keyboard-map [data-code="KeyR"]');
    assert.equal(pc.dataset.noteMidi,'73'); assertFixed(pc,73); assertFixed(pianoC,60);
    assert.match(app.$('beginner-reference').textContent,/1 = C4/);
    assert.deepEqual(await app.exported('export-button'),score);
    await app.click('back-to-library'); await app.click('start-free-practice');
    const free = app.document.querySelector('#free-practice-keys [data-code="KeyR"]');
    assert.equal(free.dataset.midi,'73'); assertFixed(free,73);
    assert.equal(app.$('free-beginner-enabled').checked,true);
    await app.click('free-start'); key(app,physicalC,app.$('free-practice-title')); await app.click('free-stop');
    const record = await app.exported('free-export-draft');
    assert.deepEqual(record.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),[73]);
    assert.equal(record.configuration.find(row=>row.key==='keyboard_configuration').value.transpose_semitones,13);
    assert.equal(record.score_context,null);
    toggle(app,'free-beginner-enabled',false); toggle(app,'free-beginner-enabled',true);
    getAppI18n(app.document).setLocale('zh-CN');
    assert.deepEqual(await app.exported('free-export-draft'),record,'Sealed free records never contain display-only beginner preferences');
  } finally {await app.close();}
});

test('free recording can opt in mid-contact without losing held keys, original legends or note-off ownership', async()=>{
  const app = await freePracticeApp();
  try {
    getAppI18n(app.document).setLocale('en');
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-start');
    assert.equal(app.$('free-beginner-controls').hidden,false);
    const free = app.document.querySelector('#free-practice-keys [data-code="KeyR"]'), legend = free.querySelector('kbd');
    const requests = app.requests.length;
    app.emit(app.$('free-practice-title'),'keydown',physicalC); assert.ok(free.classList.contains('held'));
    toggle(app,'free-beginner-enabled',true);
    assert.equal(app.$('beginner-enabled').checked,true); assertFixed(free,60);
    const node = label(free), description = free.querySelector('.beginner-note-description');
    for (const locale of ['zh-CN','en']) {
      getAppI18n(app.document).setLocale(locale);
      assert.equal(app.document.querySelector('#free-practice-keys [data-code="KeyR"]'),free);
      assert.equal(label(free),node); assert.equal(free.querySelector('.beginner-note-description'),description);
      assert.equal(free.querySelector('kbd'),legend); assert.ok(free.classList.contains('held'));
    }
    toggle(app,'free-beginner-enabled',false); assert.ok(free.classList.contains('held'));
    app.emit(app.$('free-practice-title'),'keyup',physicalC); assert.equal(free.classList.contains('held'),false);
    await app.click('free-stop'); const record = await app.exported('free-export-draft');
    assert.deepEqual(record.observations.events.filter(event=>['note_on','note_off'].includes(event.kind)).map(event=>event.kind),['note_on','note_off']);
    assert.equal(record.observations.events.filter(event=>event.kind==='synthetic_release').length,0);
    assert.equal(record.configuration.filter(row=>row.key==='keyboard_configuration').length,1);
    assert.equal(app.requests.length,requests); assert.deepEqual(app.audio(),{contexts:0,unlocks:0});
  } finally {await app.close();}
});

test('movable labels follow the active score signature and use an explicit fixed-C fallback for ambiguous key changes', async()=>{
  const initial = originalScore('beginner-D-major',2), app = await scoreApp(initial);
  try {
    choose(app,'jianpu-reference','movable'); toggle(app,'beginner-enabled',true);
    assert.match(app.$('beginner-reference').textContent,/Movable major.*1 = D4/);
    assert.deepEqual(glyph(app.document.querySelector('#keyboard [data-midi="62"]')),['1','','']);
    assert.deepEqual(glyph(app.document.querySelector('#keyboard [data-midi="60"]')),['♯6','','•']);
    key(app,{code:'ArrowRight',key:'ArrowRight'});
    assert.deepEqual(glyph(app.document.querySelector('#keyboard-map [data-code="KeyR"]')),['7','','•']);
    assert.match(app.$('beginner-reference').textContent,/1 = D4/);
    const minor = originalScore('beginner-A-minor',0,'minor'); await importScore(app,minor);
    assert.match(app.$('beginner-reference').textContent,/Movable minor.*1 = A4/);
    assert.deepEqual(glyph(app.document.querySelector('#keyboard [data-midi="72"]')),['3','','']);
    assert.deepEqual(await app.exported('export-button'),minor);
    const changes = originalScore('beginner-key-change-without-cursor',1);
    changes.keys.push({at:{numerator:3,denominator:2},fifths:2,mode:'major'});
    await importScore(app,changes);
    assert.match(app.$('beginner-reference').textContent,/fixed C.*1 = C4/i);
    assert.match(app.$('beginner-reference').textContent,/unknown|unavailable|not resolved|cursor|change|measure/i,'The ambiguity is explained instead of silently choosing a score key');
    assertFixed(app.document.querySelector('#keyboard [data-midi="60"]'),60);
    assert.deepEqual(await app.exported('export-button'),changes);
    const missing = originalScore('beginner-no-key'); missing.keys=[]; await importScore(app,missing);
    assert.match(app.$('beginner-reference').textContent,/No score key.*C4/);
    choose(app,'jianpu-reference','fixed');
    assert.match(app.$('beginner-reference').textContent,/Fixed C.*1 = C4/);
  } finally {await app.close();}
});

test('guitar/capo rebuilding labels actual fret pitches and disabled PC mapping cells receive no guide', async()=>{
  const app = await scoreApp();
  try {
    toggle(app,'beginner-enabled',true);
    choose(app,'instrument','guitar'); await app.until(()=>!app.$('play-button').disabled);
    assert.equal(app.$('guitar-stage').hidden,false);
    for (const fret of keys(app,'fretboard')) assertFixed(fret,Number(fret.dataset.midi));
    app.$('guitar-capo').value='2'; app.emit(app.$('guitar-capo'),'input'); await app.click('instrument-apply');
    await app.until(()=>app.document.querySelector('#fretboard [data-string="0"][data-fret="0"]')?.dataset.midi==='66');
    const fret = app.document.querySelector('#fretboard [data-string="0"][data-fret="0"]');
    assertFixed(fret,66); const node=label(fret);
    getAppI18n(app.document).setLocale('zh-CN'); assert.equal(label(fret),node);
    assert.match(fret.getAttribute('aria-label'),/第 1 弦/);
    app.$('keyboard-base-midi').value='127'; app.$('keyboard-input-offset').value='0'; await app.click('keyboard-settings-apply');
    const pc = keys(app,'keyboard-map','[data-code]');
    assert.equal(pc.filter(cell=>cell.dataset.enabled==='true').length,1);
    assertFixed(pc.find(cell=>cell.dataset.enabled==='true'),127);
    for(const disabled of pc.filter(cell=>cell.dataset.enabled==='false'))assert.equal(label(disabled),null);
    for(const key of keys(app,'fretboard'))assertFixed(key,Number(key.dataset.midi));
  } finally {await app.close();}
});
