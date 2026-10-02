import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {freePracticeApp, fixtureScoreServer} from './free-practice-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {validateLocaleCatalogs, createI18n} from '../web/i18n.js';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView} from '../web/performance-view.js';
import {Transport} from '../web/transport.js';
import {contrastRatio} from '../web/themes.js';
import {notationBandHeight, setupStageNotationLayout} from '../web/stage-notation-layout.js';

const onsetCount = record => record.observations.events.filter(event => event.kind === 'note_on').length;

test('above-key score budget preserves the whole instrument and rejects impossible compact layouts', () => {
  const desktop={width:1280,availableHeight:626,instrumentHeight:230,controlsHeight:97};
  assert.equal(notationBandHeight(desktop),287);
  assert.ok(notationBandHeight({width:1280,availableHeight:626,instrumentHeight:260,controlsHeight:116})>=240,'Laptop budget includes collapsed fingering, beginner and input rows plus full transport targets');
  assert.equal(notationBandHeight({...desktop,controlsHeight:200}),null,'An expanded guide or blocking notice cannot squeeze the music');
  assert.equal(notationBandHeight({width:1033,availableHeight:319,instrumentHeight:198,controlsHeight:82}),null,'The short reference-sized window retains its usable side layout');
  assert.equal(notationBandHeight({width:844,availableHeight:290,instrumentHeight:224,controlsHeight:78}),null);
  assert.equal(notationBandHeight({width:390,availableHeight:702,instrumentHeight:230,controlsHeight:125}),322);
  assert.equal(notationBandHeight({...desktop,instrument:'guitar'}),null,'The existing guitar layout is unchanged');
  assert.equal(notationBandHeight({...desktop,availableHeight:NaN}),null);
  for (const width of [390,844,1033,1280,1920]) for (const availableHeight of [250,500,626,900]) {
    const input={width,availableHeight,instrumentHeight:268,controlsHeight:137},band=notationBandHeight(input);
    if(band!==null){assert.ok(band >= (width<=650?300:240));assert.ok(band<=360);assert.ok(band+input.instrumentHeight+input.controlsHeight<=availableHeight);}
  }
});

test('responsive score placement keeps controls, follow preference and shared keyboard nodes through resize and disposal', () => {
  const {document,window}=parseHTML('<main id="workspace" class="with-notation"><header class="stage-hud"></header><aside id="notation-dock"><input id="engraving-follow" type="checkbox"></aside><section class="play-panel" data-instrument="piano"><div class="performance-status"></div><div class="performance-field"><div id="piano-surface"><canvas id="falling-notes"></canvas><div class="strike-line"></div><div id="keyboard"><button data-midi="60"></button></div></div></div><div class="keyboard-pan"></div><div id="beginner-controls"></div><div class="transport"></div></section></main>');
  const stage=document.getElementById('workspace'),play=stage.querySelector('.play-panel'),keyboard=document.getElementById('keyboard'),follow=document.getElementById('engraving-follow'),canvas=document.getElementById('falling-notes');
  const queue=new Map(),observed=[],changes=[];let id=0,disconnected=false;
  const names=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(window,name)]));
  Object.assign(stage,{clientWidth:1280,clientHeight:720});
  const heights=new Map([[stage.querySelector('.stage-hud'),46],[play.querySelector('.transport'),57],[play.querySelector('.keyboard-pan'),42],[play.querySelector('#beginner-controls'),30]]);
  for(const node of stage.querySelectorAll('*'))node.getBoundingClientRect=()=>({height:heights.get(node)||0});
  window.getComputedStyle=node=>({display:'block',position:node.classList.contains('performance-status')?'absolute':'static',paddingTop:node===stage?'12px':'0',paddingBottom:node===stage?'16px':'0',rowGap:'10px',height:node===keyboard?'110px':'0',minWidth:node.id==='piano-surface'?'792px':'0',borderTopWidth:node===play?'1px':'0',borderBottomWidth:node===play?'1px':'0',getPropertyValue:key=>key==='--keybed-height'?'110px':''});
  window.requestAnimationFrame=callback=>{queue.set(++id,callback);return id;};window.cancelAnimationFrame=frame=>queue.delete(frame);
  window.ResizeObserver=class{constructor(callback){this.callback=callback;}observe(node){observed.push(node);}disconnect(){disconnected=true;}};
  const flush=()=>{for(const [key,callback]of [...queue]){queue.delete(key);callback();}};
  const layout=setupStageNotationLayout({document,onChange:above=>changes.push(above)});
  try {
    const heldKey=keyboard.firstElementChild;heldKey.classList.add('pressed');heldKey.setAttribute('aria-pressed','true');
    follow.checked=false;flush();assert.equal(stage.classList.contains('notation-above'),true);assert.equal(stage.style.getPropertyValue('--notation-band-height'),'287px');
    assert.equal(observed.includes(keyboard),true);assert.equal(observed.includes(play.querySelector('.performance-field')),true);
    for(const dimensions of [{clientWidth:1033,clientHeight:403},{clientWidth:1280,clientHeight:720}]){Object.assign(stage,dimensions);layout.refresh();layout.refresh();assert.equal(queue.size,1);flush();}
    assert.deepEqual(changes,[true,false,true]);assert.equal(heldKey.classList.contains('pressed'),true);assert.equal(heldKey.getAttribute('aria-pressed'),'true');assert.equal(keyboard.firstElementChild,heldKey);assert.equal(follow.checked,false);assert.equal(document.getElementById('keyboard'),keyboard);assert.equal(document.getElementById('falling-notes'),canvas);
    play.dataset.instrument='guitar';layout.refresh();flush();assert.equal(stage.classList.contains('notation-above'),false);assert.equal(stage.style.getPropertyValue('--notation-band-height'),undefined);
    layout.refresh();layout.destroy();flush();assert.equal(disconnected,true);assert.equal(queue.size,0);
    stage.dispatchEvent(new window.Event('click'));assert.equal(queue.size,0);
  } finally {layout.destroy();for(const[name,descriptor]of originals)if(descriptor)Object.defineProperty(window,name,descriptor);else delete window[name];}
});

test('portrait placement budgets revealed guidance and wrapped controls without observer oscillation', () => {
  for(const expanded of ['guidance','beginner','pan','status']){
    const {document,window}=parseHTML('<main id="workspace" class="with-notation"><header class="stage-hud"></header><aside id="notation-dock"></aside><section class="play-panel" data-instrument="piano"><div class="performance-status"></div><div id="practice-gate"></div><div class="performance-field"><div id="piano-stage"><details id="piano-fingering-guidance"><summary>Guidance</summary></details><div id="piano-scroll"><div id="piano-surface"><div id="keyboard"></div></div></div></div></div><div class="keyboard-pan"><span id="keyboard-range-context">Short range</span></div><div id="beginner-controls"></div><div class="transport"></div></section></main>');
    const stage=document.getElementById('workspace'),play=stage.querySelector('.play-panel'),pan=play.querySelector('.keyboard-pan'),guidance=document.getElementById('piano-fingering-guidance'),dock=document.getElementById('notation-dock'),piano=document.getElementById('piano-scroll'),panLabel=document.getElementById('keyboard-range-context'),candidateLabel='Wide localized range and keyboard panning help';
    Object.assign(stage,{clientWidth:390,clientHeight:expanded==='status'?840:812});
    document.getElementById('practice-gate').hidden=expanded!=='status';pan.hidden=true;dock.scrollTop=180;piano.scrollLeft=210;
    const original=new Map(['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(window,key)]));
    const queue=new Map(),samples=[],changes=[];let next=0,observer;
    const above=()=>stage.classList.contains('notation-above');
    for(const node of stage.querySelectorAll('*'))node.getBoundingClientRect=()=>({height:node.classList.contains('stage-hud')?90:node.classList.contains('transport')?76:node.id==='practice-gate'?28:node===guidance?(above()&&expanded==='guidance'?31:0):node.id==='beginner-controls'?(above()?(expanded==='beginner'?70:38):0):node===pan?(above()?(expanded==='pan'&&panLabel.textContent===candidateLabel?80:42):0):node.classList.contains('performance-status')?(above()&&expanded==='status'?45:0):0});
    window.getComputedStyle=node=>{
      if(node===stage&&stage.classList.contains('notation-budget-probe')){dock.scrollTop=0;piano.scrollLeft=0;}
      return {display:'block',position:node.classList.contains('performance-status')&&expanded!=='status'?'absolute':'static',paddingTop:node===stage?'8px':'0',paddingBottom:node===stage?'8px':'0',rowGap:'8px',height:node.id==='keyboard'?'105px':'0',minWidth:node.id==='piano-surface'?'792px':'0',borderTopWidth:node===play?'1px':'0',borderBottomWidth:node===play?'1px':'0',getPropertyValue:key=>key==='--keybed-height'?'105px':''};
    };
    window.requestAnimationFrame=callback=>{queue.set(++next,callback);return next;};window.cancelAnimationFrame=id=>queue.delete(id);
    window.ResizeObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){}};
    const layout=setupStageNotationLayout({document,getPanLabel:()=>candidateLabel,onChange:value=>{changes.push(value);panLabel.textContent=value?candidateLabel:'Short range';observer();}});
    try {
      for(let frame=0;frame<8;frame++){observer();for(const[id,callback]of [...queue]){queue.delete(id);callback();}samples.push(above());}
      assert.deepEqual(samples,Array(8).fill(false),`${expanded}: hidden fallback content must not repeatedly enable an undersized score band`);
      assert.deepEqual(changes,[]);assert.equal(stage.classList.contains('notation-budget-probe'),false);
      assert.equal(dock.scrollTop,180,'Rejected probes restore manual score scrolling after a simulated layout clamp');assert.equal(piano.scrollLeft,210,'Rejected probes preserve keyboard panning');assert.equal(pan.hidden,true,'Measuring a needed pan row does not mutate its controller-owned visibility');assert.equal(panLabel.textContent,'Short range','Rejected probes restore controller-owned label copy');
      stage.clientHeight=1000;layout.refresh();for(const[id,callback]of [...queue]){queue.delete(id);callback();}
      assert.equal(above(),true,`${expanded}: a genuinely larger viewport can enable the band`);
      assert.ok(parseFloat(stage.style.getPropertyValue('--notation-band-height'))>=300);
      for(let frame=0;frame<8;frame++){observer();for(const[id,callback]of [...queue]){queue.delete(id);callback();}}
      assert.deepEqual(changes,[true],`${expanded}: observer feedback reaches a fixed placement`);
      assert.equal(queue.size,0,`${expanded}: the final height causes no further layout notification`);
    }finally{layout.destroy();for(const[key,descriptor]of original)if(descriptor)Object.defineProperty(window,key,descriptor);else delete window[key];}
  }
});
function playKey(app) {
  const properties = {code:'KeyR', key:'r'};
  app.emit(app.$('free-practice-title'), 'keydown', properties);
  app.emit(app.$('free-practice-title'), 'keyup', properties);
}

test('rhythm entry keeps real controls, records silently and retains a draft across brand navigation', async () => {
  const app = await freePracticeApp();
  try {
    assert.ok(app.document.body.classList.contains('rhythm-shell'));
    assert.equal(app.$('start-free-practice').closest('section').className, 'rhythm-free-entry');
    assert.equal(app.document.querySelectorAll('#start-free-practice').length, 1);
    assert.equal(app.$('rhythm-location').textContent, '练习大厅');
    await app.click('start-free-practice');
    const start = app.$('free-start'), state = app.$('free-state'), input = app.$('free-practice-keys').firstElementChild;
    assert.equal(start.closest('.rhythm-free-console')?.getAttribute('role'), 'group');
    assert.equal(app.$('rhythm-free-resume').hidden, true);
    await app.click('free-sound'); await app.click('free-start'); playKey(app);
    app.emit(app.document.querySelector('#shell-brand .brand'), 'click', {button:0});
    assert.equal(app.document.body.dataset.screen, 'library');
    assert.equal(app.$('free-practice-screen').dataset.state, 'paused');
    await app.click('start-free-practice');
    assert.equal(app.$('free-start'), start); assert.equal(app.$('free-state'), state);
    assert.equal(app.$('free-practice-keys').firstElementChild, input);
    assert.equal(app.document.querySelectorAll('.rhythm-free-console').length, 1);
    await app.click('free-resume'); playKey(app); await app.click('free-stop');
    const record = await app.exported('free-export-draft');
    assert.equal(onsetCount(record), 2); assert.equal(record.segments.length, 2);
    app.$('free-record-label').value = '节奏练习 / rhythm'; await app.click('free-save');
    assert.equal(app.$('free-record-select').options.length, 1);
    assert.deepEqual(await app.exported('free-export-record'), record);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
    assert.equal(app.midiRequests(), 0);
  } finally { await app.close(); }
});

test('stage to free to retained stage preserves the original score take and uses existing pause boundaries', async () => {
  const app = await freePracticeApp({fetchResult:await fixtureScoreServer()});
  try {
    await app.until(() => !app.$('start-practice').disabled);
    const i18n = getAppI18n(app.document); i18n.setLocale('en');
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-exit');
    app.$('count-in').checked = false; await app.click('start-practice');
    await app.until(() => app.document.body.dataset.screen === 'stage' && app.$('play-button').textContent.includes('Pause'));
    const scoreNode = app.$('score-title'), originalTitle = scoreNode.textContent, sourceExport = app.$('export-button');
    await app.click('rhythm-stage-free');
    assert.equal(app.document.body.dataset.screen, 'free');
    assert.equal(app.$('rhythm-free-resume').hidden, false);
    const scoreBefore = await app.exported('export-takes');
    await app.click('free-start'); playKey(app); await app.click('free-stop');
    const freeBefore = await app.exported('free-export-draft');
    await app.click('rhythm-free-resume');
    assert.equal(app.document.body.dataset.screen, 'stage');
    assert.equal(app.$('score-title'), scoreNode); assert.equal(scoreNode.textContent, originalTitle);
    assert.equal(app.$('export-button'), sourceExport);
    assert.doesNotMatch(app.$('play-button').textContent, /Pause/);
    assert.deepEqual(await app.exported('export-takes'), scoreBefore);
    await app.click('rhythm-stage-free');
    assert.deepEqual(await app.exported('free-export-draft'), freeBefore);
    assert.equal(app.document.querySelectorAll('#rhythm-free-resume').length, 1);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
  } finally { await app.close(); }
});

test('language redraw preserves recording, focusable controls, authored labels and console identity', async () => {
  const app = await freePracticeApp();
  try {
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-start'); playKey(app);
    const i18n = getAppI18n(app.document), console = app.document.querySelector('.rhythm-free-console');
    const input = app.$('free-record-label'), mapping = app.$('free-practice-keys').firstElementChild;
    input.value = 'Keep my original title 原题';
    const audio = app.audio(), requests = app.requests.length;
    i18n.setLocale('en');
    assert.equal(app.$('rhythm-location').textContent, 'Free practice');
    assert.equal(app.$('start-free-practice').textContent, 'Enter free practice →');
    assert.equal(console.getAttribute('aria-label'), 'Free performance recording and status');
    i18n.setLocale('zh-CN');
    assert.equal(app.$('start-free-practice').textContent, '进入自由练习 →');
    assert.equal(app.document.querySelector('.rhythm-free-console'), console);
    assert.equal(app.$('free-practice-keys').firstElementChild, mapping);
    assert.equal(input.value, 'Keep my original title 原题');
    assert.equal(app.$('free-practice-screen').dataset.state, 'recording');
    assert.deepEqual(app.audio(), audio); assert.equal(app.requests.length, requests);
    assert.equal(i18n.getReports().filter(report => report.key?.startsWith('rhythm.')).length, 0);
    assert.deepEqual(validateLocaleCatalogs(), []);
  } finally { await app.close(); }
});

test('rhythm CSS scopes visual changes, reserves the falling field and leaves compact guitar rows intact', async () => {
  const css = await readFile(new URL('../web/rhythm-shell.css', import.meta.url), 'utf8');
  const {document} = parseHTML(`<style>${css}</style>`);
  const flatten = rules => [...rules].flatMap(rule => rule.cssRules ? flatten(rule.cssRules) : [rule]);
  const rules = flatten(document.querySelector('style').sheet.cssRules);
  for (const rule of rules) for (const selector of rule.selectorText.split(',')) {
    assert.match(selector, /\.rhythm-shell(?:\b|[.# ])/);
    assert.doesNotMatch(selector, /\.stage-heading\s+(?:>|)\s*span\b/);
  }
  const fields = rules.filter(rule => rule.selectorText === '.rhythm-shell #falling-notes');
  assert.ok(fields.length >= 2); for (const field of fields) assert.equal(field.style['min-height'], '100px');
  assert.equal(rules.find(rule => rule.selectorText === '.rhythm-shell .guitar-scroll').style['min-height'], '56px');
  const colors = [['#272438','#ffffff'],['#625d77','#f5f4fa'],['#6450a4','#f5f4fa'],['#f0eef9','#171b27'],['#abb4cc','#0e111a'],['#c2aff6','#0e111a'],['#122923','#80e0cb']];
  for (const [foreground, background] of colors) assert.ok(contrastRatio(foreground, background) >= 4.5, `${foreground}/${background}`);
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/rhythm-shell.css') > html.indexOf('/free-practice.css'));
});

test('accepted160 beginner controls and saved appearance survive rhythm screen and locale round trips', async () => {
  const app = await freePracticeApp({fetchResult:await fixtureScoreServer()});
  try {
    await app.until(() => !app.$('start-listen').disabled);
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-exit');
    app.$('count-in').checked = false; await app.click('start-listen');
    await app.until(() => app.document.body.dataset.screen === 'stage'); await app.click('reset-button');
    const i18n = getAppI18n(app.document);
    const ids = ['beginner-controls','beginner-enabled','beginner-reference','beginner-numbered-mode','free-beginner-controls','free-beginner-enabled','keyboard-compact-status','theme-mode','interface-language'];
    const nodes = new Map(ids.map(id => [id, app.$(id)]));
    assert.equal(app.$('keyboard-compact-status').parentElement.className, 'keyboard-stage-meta');
    assert.equal(app.$('stage-subtitle').parentElement, app.$('keyboard-compact-status').parentElement);
    for (const [id, node] of nodes) assert.ok(node, `${id} must survive the integration`);
    app.$('beginner-enabled').checked = true; app.emit(app.$('beginner-enabled'), 'change');
    assert.equal(app.$('free-beginner-enabled').checked, true);
    const originalScore = await app.exported('export-button'), originalTake = await app.exported('export-takes');
    app.$('theme-mode').value = 'custom'; app.emit(app.$('theme-mode'), 'change');
    app.$('theme-accent').value = '#514798'; app.emit(app.$('theme-accent'), 'input');
    app.$('theme-background').value = '#f5f0ff'; app.emit(app.$('theme-background'), 'input');
    const originalTheme = app.document.documentElement.getAttribute('style');
    const requests = app.requests.length;
    for (const locale of ['en','zh-CN','en']) {
      await app.click('rhythm-stage-free');
      i18n.setLocale(locale);
      assert.equal(app.$('free-beginner-enabled').checked, true);
      assert.ok(app.document.querySelector('#free-practice-keys .beginner-note-label'));
      await app.click('rhythm-free-resume');
      for (const [id, node] of nodes) {
        assert.equal(app.$(id), node, `${id} keeps its original controller attachment`);
        assert.equal(app.document.querySelectorAll(`#${id}`).length, 1);
      }
      assert.equal(app.$('beginner-enabled').checked, true);
      assert.ok(app.document.querySelector('#keyboard .beginner-note-label'));
      assert.equal(app.document.documentElement.getAttribute('data-theme-mode'), 'custom');
      assert.equal(app.document.documentElement.getAttribute('style'), originalTheme);
    }
    assert.equal(app.requests.length, requests, 'Presentation navigation does not recompile or remap');
    assert.deepEqual(await app.exported('export-button'), originalScore);
    assert.deepEqual(await app.exported('export-takes'), originalTake);
    assert.deepEqual(app.audio(), {contexts:0, unlocks:0});
    assert.equal(app.midiRequests(), 0);
  } finally { await app.close(); }
});


test('compact rhythm title and guide reserve separate real hit boxes without hiding controls', async () => {
  const css = await readFile(new URL('../web/rhythm-shell.css', import.meta.url), 'utf8');
  const {document} = parseHTML(`<style>${css}</style>`);
  const rules = [...document.querySelector('style').sheet.cssRules];
  const heading = rules.find(rule => rule.selectorText === '.rhythm-shell.performance-layout .stage-heading:has(>.beginner-controls-compact)');
  const title = rules.find(rule => rule.selectorText === '.rhythm-shell.performance-layout .stage-heading:has(>.beginner-controls-compact)>#stage-title');
  const guide = rules.find(rule => rule.selectorText === '.rhythm-shell #beginner-controls.beginner-controls-compact');
  const metadata = rules.find(rule => rule.selectorText === '.rhythm-shell .stage-heading:has(>.beginner-controls-compact)>.keyboard-stage-meta');
  assert.equal(heading.style.display, 'grid');
  assert.equal(heading.style['grid-template-columns'], 'minmax(64px,1fr) max-content', 'Title retains a useful minimum width beside the guide intrinsic width');
  assert.ok(parseFloat(heading.style['min-width']) >= 150);
  assert.equal(title.style['grid-column'], '1'); assert.equal(title.style['grid-row'], '1');
  assert.equal(title.style['padding-right'], '0', 'Text padding cannot serve as pointer separation');
  assert.equal(guide.style.position, 'static', 'Guide participates in the heading layout instead of overlaying the title');
  assert.equal(guide.style['grid-column'], '2'); assert.equal(guide.style['grid-row'], '1');
  assert.equal(metadata.style['grid-column'], '1/-1', 'The existing subtitle and keyboard status keep their shared full-width row');
  for (const rule of [heading,title,guide,metadata]) {
    assert.notEqual(rule.style['pointer-events'], 'none');
    assert.notEqual(rule.style.display, 'none');
    assert.notEqual(rule.style.visibility, 'hidden');
  }
});


test('cue display state follows pause, resumed countdown, playback, completion and reset without stale paused state', async () => {
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const originals=new Map(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries({document,window})) Object.defineProperty(globalThis,key,{configurable:true,value});
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  const i18n=createI18n({locale:'en'}), transport=new Transport();
  let now=0, view, shell;
  const context={instrument:'piano',mode:'listen',segmentStart:0,countInBeatMs:500,recorder:{active:null,interruptions:[]}};
  try {
    shell=setupGameShell({i18n,pausePlayback(){},onNotation(){},onScreen:screen=>view?.screenChanged(screen)});
    view=setupPerformanceView({i18n,getContext:()=>({...context,now,position:transport.time(now),running:transport.running,hasStarted:transport.hasStarted,completed:transport.completed})});
    shell.show('stage');
    const cue=document.getElementById('stage-cue'), main=document.getElementById('stage-cue-main');
    const state=(expected,text)=>{view.update();assert.equal(cue.getAttribute('data-cue-state'),expected);assert.equal(cue.hidden,expected===null);assert.equal(main.textContent,text);};
    state('ready','READY');
    transport.start(now,[],2000);state('countdown','4');
    now=500;transport.pause(now);state('paused','PAUSED');
    i18n.setLocale('zh-CN');state('paused',i18n.t('performance.paused'));
    i18n.setLocale('en');now=2000;transport.start(now,[],2000);state('countdown','3');
    now=3500;state(null,'');assert.equal(cue.hasAttribute('data-cue-state'),false,'Playing clears the prior display-state attribute');
    transport.pause(now);state('paused','PAUSED');
    transport.start(now,[]);state(null,'');
    transport.finish(5000);state('complete','LISTEN COMPLETE');
    transport.reset();state('ready','READY');
    transport.start(now,[],2000);state('countdown','4');
    context.instrument='guitar';view.update();assert.equal(document.querySelector('.play-panel').dataset.instrument,'guitar');state('countdown','4');
    assert.equal(document.getElementById('stage-cue'),cue,'Display states never recreate the cue or transport controls');
  } finally {
    view?.destroy();shell?.destroy();
    for (const [key,descriptor] of originals) if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('only a paused piano cue in the rhythm shell is visually suppressed by reduced motion', async () => {
  const css=await readFile(new URL('../web/rhythm-shell.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
  const selector='.rhythm-shell .play-panel[data-instrument=piano] #stage-cue[data-cue-state=paused]';
  const matches=[];
  const visit=(rows,media=null)=>{for(const rule of rows)if(rule.cssRules)visit([...rule.cssRules],rule.media?.mediaText??media);else if(rule.selectorText.includes('#stage-cue'))matches.push({rule,media});};
  visit(rules);
  assert.equal(matches.length,1,'The override must not hide ready/countdown/completion or other instruments');
  assert.equal(matches[0].media,'(prefers-reduced-motion:reduce)');
  assert.equal(matches[0].rule.selectorText,selector);assert.equal(matches[0].rule.style.display,'none');
  assert.equal(matches[0].rule.style.length,1,'No transport, pointer, timing, or motion behavior is overridden');
});


test('compact notation budget reclaims chrome padding while retaining canvas, extreme keybed and control minima', async () => {
  const css=await readFile(new URL('../web/rhythm-shell.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style>`);
  const compact=[...document.querySelector('style').sheet.cssRules].find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)');
  const nav=[...compact.cssRules].find(rule=>rule.selectorText==='.rhythm-shell.performance-layout #workspace.with-notation .stage-hud nav .button');
  const transport=[...compact.cssRules].find(rule=>rule.selectorText==='.rhythm-shell.performance-layout #workspace.with-notation .play-panel[data-instrument=piano]>.transport');
  for(const rule of [nav,transport]){
    assert.equal(rule.style['padding-top'],'2px');assert.equal(rule.style['padding-bottom'],'2px');
    for(const property of ['font-size','line-height','height','max-height','overflow','pointer-events','display','visibility'])assert.equal(rule.style.getPropertyValue(property),'',`Preserve control behavior and text: ${property}`);
  }
  assert.equal(nav.style['min-height'],undefined,'Navigation keeps its inherited 34px hit targets');
  assert.equal(transport.style['min-height'],'40px','A 34px button plus padding and borders fits without a 48px chrome floor');
  const performance=await readFile(new URL('../web/performance-stage.css',import.meta.url),'utf8');
  assert.match(performance,/\.performance-layout #workspace\.with-notation \.transport \.button\{[^}]*min-height:34px/);
  const beginner=await readFile(new URL('../web/beginner-notes.css',import.meta.url),'utf8');
  assert.match(beginner,/--keybed-height:104px/,'Extreme octave guides retain the complete keybed');
  assert.match(css,/\.rhythm-shell #falling-notes \{min-height:100px\}/,'The existing canvas minimum is unchanged');
});
