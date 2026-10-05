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
import {setupStageNotationLayout} from '../web/stage-notation-layout.js';

const onsetCount = record => record.observations.events.filter(event => event.kind === 'note_on').length;

function laneOverlayFixture(){
 const {document,window}=parseHTML('<main id="workspace" class="with-notation"><aside id="notation-dock"><section class="notation-panel"><div class="section-heading"></div><label><input id="engraving-follow" type="checkbox"></label><div id="notation"><svg><g data-note-id="exact-source-id"></g></svg></div><p id="engraving-fallback" role="status">Original rendering limitation</p><div id="engraving-view"><div class="engraving-scroll"><div id="engraved-staff"><svg></svg></div></div></div></section></aside><section class="play-panel" data-instrument="piano"><div id="piano-stage"><div class="piano-stage-toolbar"></div><div class="piano-lanes-shared"><canvas id="falling-notes"></canvas></div><div id="keyboard"><button data-midi="60" aria-pressed="true"></button></div></div></section></main>');
 const $=id=>document.getElementById(id),changes=[],layout=setupStageNotationLayout({document,i18n:createI18n({locale:'en'}),onChange:value=>changes.push(value)});$('notation-overlay-visible').checked=true;layout.refresh();return{document,window,$,layout,changes};
}
test('score paint lives inside the falling lane while every original page/follow control stays outside it',()=>{
 const {document,$,layout}=laneOverlayFixture();
 try{
  const overlay=$('notation-lane-overlay');assert.equal(overlay.parentElement.className,'piano-lanes-shared');assert.equal($('notation').parentElement,overlay);assert.equal($('engraved-staff').closest('.engraving-scroll').parentElement,overlay);
  assert.equal($('notation-dock').parentElement,$('notation-tools'));assert.equal($('engraving-follow').closest('#notation-lane-overlay'),null);assert.equal(overlay.querySelectorAll('button,input,select').length,0);
  assert.equal($('workspace').classList.contains('notation-above'),false);assert.equal($('workspace').style.getPropertyValue('--notation-band-height'),undefined);assert.equal($('notation').querySelector('[data-note-id]').dataset.noteId,'exact-source-id');
  for(const id of ['notation','engraved-staff','engraving-follow','falling-notes','keyboard'])assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
 }finally{layout.destroy();}
});
test('overlay refresh, viewport changes and closed controls preserve paint, follow preference and held key identity',()=>{
 const {document,window,$,layout,changes}=laneOverlayFixture();
 try{
  const key=$('keyboard').firstElementChild,canvas=$('falling-notes'),basic=$('notation'),engraved=$('engraved-staff'),overlay=$('notation-lane-overlay');$('engraving-follow').checked=false;
  const before=changes.length;for(const dimensions of [{width:1920,height:1080},{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){Object.assign(window,{innerWidth:dimensions.width,innerHeight:dimensions.height});$('notation-tools').open=true;layout.refresh();$('notation-tools').open=false;layout.refresh();assert.equal(overlay.hidden,false);}
  assert.equal(changes.length,before,'Viewport and control disclosure changes cannot restart rendering');assert.equal($('engraving-follow').checked,false);assert.equal($('keyboard').firstElementChild,key);assert.equal(key.getAttribute('aria-pressed'),'true');assert.equal($('falling-notes'),canvas);assert.equal($('notation'),basic);assert.equal($('engraved-staff'),engraved);
  $('notation-overlay-opacity').value='35';$('notation-overlay-opacity').dispatchEvent(new window.Event('input'));assert.equal(overlay.style.getPropertyValue('--notation-opacity'),'0.35');assert.equal(changes.length,before,'Opacity is paint-only and never signals a new notation surface');
  $('notation-overlay-visible').checked=false;$('notation-overlay-visible').dispatchEvent(new window.Event('change'));assert.equal(overlay.hidden,true);assert.equal($('notation-dock').hidden,false);$('notation-overlay-visible').checked=true;$('notation-overlay-visible').dispatchEvent(new window.Event('change'));assert.equal(overlay.hidden,false);assert.equal($('engraving-follow').checked,false);
  assert.equal(document.querySelectorAll('#notation-tools').length,1);
 }finally{layout.destroy();}
});
test('manual overlay navigation uses its own scrollers and guitar/disposal restore the exact original paint roots',()=>{
 const {document,window,$,layout}=laneOverlayFixture();const dock=$('notation-dock'),basic=$('notation'),engraved=$('engraved-staff').parentElement,overlay=$('notation-lane-overlay'),key=$('keyboard').firstElementChild;
 let manual=0;const scrolls=[];dock.addEventListener('notationmanualscroll',()=>manual++);Object.assign(overlay,{clientHeight:180,scrollBy:args=>scrolls.push(['overlay',args])});Object.assign(basic,{clientWidth:790,scrollBy:args=>scrolls.push(['basic',args])});basic.hidden=false;
 $('notation-pan-down').click();$('notation-pan-right').click();assert.equal(manual,2);assert.deepEqual(scrolls,[['overlay',{left:0,top:117,behavior:'auto'}],['basic',{left:513.5,top:0,behavior:'auto'}]]);
 document.querySelector('.play-panel').dataset.instrument='guitar';layout.refresh();assert.equal(dock.parentElement.id,'workspace');assert.equal(basic.closest('#notation-dock'),dock);assert.equal(engraved.parentElement,$('engraving-view'));assert.equal(overlay.hidden,true);assert.equal($('keyboard').firstElementChild,key);
 document.querySelector('.play-panel').dataset.instrument='piano';layout.refresh();assert.equal(basic.parentElement,overlay);assert.equal($('keyboard').firstElementChild,key);layout.destroy();layout.refresh();
 assert.equal($('notation-lane-overlay'),null);assert.equal($('notation-tools'),null);assert.equal(basic.closest('#notation-dock'),dock);assert.equal(engraved.parentElement,$('engraving-view'));assert.equal(document.querySelectorAll('#engraved-staff').length,1);assert.equal($('keyboard').firstElementChild,key);
});
test('the original fallback remains outside closed piano controls and returns to its guitar anchor',()=>{
 const {document,$,layout}=laneOverlayFixture(),fallback=$('engraving-fallback'),basic=$('notation');
 try{
  $('notation-tools').open=false;fallback.hidden=false;layout.refresh();assert.equal(fallback.parentElement.id,'piano-stage');assert.equal(fallback.closest('details'),null);assert.equal(fallback.closest('#notation-lane-overlay'),null);assert.equal(fallback.getAttribute('role'),'status');assert.equal(fallback.textContent,'Original rendering limitation');
  for(const instrument of ['guitar','piano','guitar','piano']){document.querySelector('.play-panel').dataset.instrument=instrument;layout.refresh();assert.ok($('engraving-fallback')===fallback);assert.equal(document.querySelectorAll('#engraving-fallback').length,1);assert.equal(fallback.hidden,false);if(instrument==='guitar')assert.ok(fallback.previousElementSibling===basic);else assert.equal(fallback.parentElement.id,'piano-stage');}
 }finally{layout.destroy();}
 assert.ok(fallback.previousElementSibling===basic);assert.equal(fallback.parentElement.className,'notation-panel');
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
    assert.equal(app.$('rhythm-location').textContent, '主菜单');
    await app.click('start-free-practice');
    const start = app.$('free-start'), state = app.$('free-state'), input = app.$('free-practice-keys').firstElementChild;
    assert.equal(start.closest('.rhythm-free-console')?.getAttribute('role'), 'group');
    assert.equal(app.$('rhythm-free-resume').hidden, true);
    await app.click('free-sound'); await app.click('free-start'); playKey(app);
    app.emit(app.document.querySelector('#shell-brand .brand'), 'click', {button:0});
    assert.equal(app.document.body.dataset.screen, 'home');
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
    const toolbarLabels=locale=>{
      const [title,midi,keyboard,background,opacity,options]=locale==='en'?['Piano','Connect MIDI','Edit key mapping','Score background','Opacity','Score options']:['钢琴','连接 MIDI','编辑按键映射','轨道背景乐谱','不透明度','读谱设置'];
      for(const [selector,expected]of [['#piano-stage .piano-stage-title',title],['#free-piano-stage .piano-stage-title',title],['#piano-connect-midi',midi],['#free-connect-midi',midi],['#piano-keyboard-settings',keyboard],['#free-keyboard-settings',keyboard],['[data-i18n="performance.scoreBackground"]',background],['[data-i18n="performance.scoreOpacity"]',opacity],['#notation-tools>summary',options]])assert.equal(app.document.querySelector(selector).textContent.trim(),expected,`${locale}: ${selector} has its actual translated label`);
    };
    toolbarLabels('zh-CN');
    i18n.setLocale('en');toolbarLabels('en');
    assert.equal(app.$('rhythm-location').textContent, 'Free practice');
    assert.equal(app.$('start-free-practice').textContent, 'Enter free practice →');
    assert.equal(console.getAttribute('aria-label'), 'Free performance recording and status');
    i18n.setLocale('zh-CN');toolbarLabels('zh-CN');
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
  for (const rule of rules) for (const selector of rule.selectorText.split(/,(?![^()]*\))/)) {
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
  const title = rules.find(rule => rule.selectorText === '.rhythm-shell.performance-layout .stage-heading:has(>.beginner-controls-compact)>:is(#stage-title,#free-practice-title)');
  const guide = rules.find(rule => rule.selectorText === '.rhythm-shell :is(#beginner-controls,#free-beginner-controls).beginner-controls-compact');
  const metadata = rules.find(rule => rule.selectorText === '.rhythm-shell .stage-heading:has(>.beginner-controls-compact)>.keyboard-stage-meta');
  assert.equal(heading.style.display, 'grid');
  assert.equal(heading.style['grid-template-columns'], 'minmax(64px,1fr) max-content', 'Title retains a useful minimum width beside the guide intrinsic width');
  assert.ok(parseFloat(heading.style['min-width']) >= 150);
  assert.equal(title.style['grid-column'], '1'); assert.equal(title.style['grid-row'], '1');
  assert.equal(title.style['padding-right'], '0', 'Text padding cannot serve as pointer separation');
  assert.equal(guide.style.position, 'static', 'Guide participates in the heading layout instead of overlaying the title');
  assert.equal(guide.style['grid-column'], '2'); assert.equal(guide.style['grid-row'], '1');
  assert.equal(metadata.style['grid-column'], '1/-1', 'The existing subtitle and keyboard status keep their shared full-width row');
  const guideCss=await readFile(new URL('../web/beginner-notes.css',import.meta.url),'utf8');
  const guideDocument=parseHTML(`<style>${guideCss}</style>`).document;
  const sharedGuide=[...guideDocument.querySelector('style').sheet.cssRules].find(rule=>rule.selectorText===':is(#beginner-controls,#free-beginner-controls).beginner-controls-compact');
  for(const [property,value]of Object.entries({padding:'0',margin:'0',gap:'4px','flex-wrap':'nowrap'}))assert.equal(sharedGuide.style[property],value,`Both mode guides discard the full-row ${property}`);
  for(const id of ['stage-title','free-practice-title'])assert.ok(title.selectorText.includes('#'+id));
  for(const id of ['beginner-controls','free-beginner-controls'])assert.ok(guide.selectorText.includes('#'+id)&&sharedGuide.selectorText.includes('#'+id));
  const stageCss=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8');
  const stageDocument=parseHTML(`<style>${stageCss}</style>`).document;
  const compactRules=[...stageDocument.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
  const intrinsic=compactRules.findLast(rule=>rule.selectorText==='.game-shell :is(.piano-workspace,:where(#workspace)) .piano-workspace-heading .stage-heading:has(>.beginner-controls-compact)');
  assert.equal(intrinsic.style['min-width'],'min-content','The heading cannot shrink below its 64px title plus the real guide label and help widths');
  const portraitRules=[...stageDocument.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-width:650px)').flatMap(rule=>[...rule.cssRules]);
  const portraitIntrinsic=portraitRules.findLast(rule=>rule.selectorText==='.game-shell .piano-workspace .piano-workspace-heading .stage-heading:has(>.beginner-controls-compact)');
  assert.equal(portraitIntrinsic?.style['min-width'],'min-content','The same title plus full guide minimum must protect 390px English and Chinese headers');
  const spacing=portraitRules.findLast(rule=>rule.selectorText==='.game-shell .piano-workspace .piano-workspace-heading');
  assert.ok(parseFloat(spacing.style.gap)<=6,'Compact row gaps leave the intrinsic title/guide track room beside all three normal-mode actions');
  const actions=portraitRules.findLast(rule=>rule.selectorText==='.game-shell .piano-workspace .piano-workspace-heading>.button');
  assert.ok(parseFloat(actions.style['padding-left'])<=4&&parseFloat(actions.style['padding-right'])<=4);
  for(const property of ['font-size','height','min-height','max-height','display','visibility','overflow','pointer-events'])assert.equal(actions.style.getPropertyValue(property),'',`Portrait spacing preserves button text, hit-target height and operation: ${property}`);
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
