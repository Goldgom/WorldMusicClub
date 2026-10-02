import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {createI18n, LOCALE_STORAGE_KEY, MESSAGE_SCHEMA, validateLocaleCatalogs} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {localizeStatic, setupLocaleView} from '../web/locale-view.js';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView, performanceCue, previewMusicMetadata} from '../web/performance-view.js';
import {fixture} from './frontend-fixtures.js';

const html = await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const make = options => createI18n({onReport(){},...options});
function environment(markup = html) {
  const {document,window}=parseHTML(markup),saved=new Map(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries({document,window}))Object.defineProperty(globalThis,key,{configurable:true,value});
  let focused=null;
  window.HTMLElement.prototype.focus=function(){focused=this;};
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',Boolean(value));}});
  return {document,window,focused:()=>focused,close(){for(const[key,value]of saved)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}};
}
const marked = '[data-i18n], [data-i18n-aria-label], [data-i18n-title], [data-i18n-placeholder]';

function assertMarked(document,i18n) {
  for(const element of document.querySelectorAll(marked)) {
    if(element.hasAttribute('data-i18n')) {
      const key=element.getAttribute('data-i18n'),direct=[...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim();
      assert.ok(Object.hasOwn(MESSAGE_SCHEMA,key),key);
      assert.ok(direct.includes(i18n.t(key)),`${key}: ${direct}`);
    }
    for(const attribute of ['aria-label','title','placeholder'])if(element.hasAttribute(`data-i18n-${attribute}`))assert.equal(element.getAttribute(attribute),i18n.t(element.getAttribute(`data-i18n-${attribute}`)));
  }
}

test('every static marker has an exact paired schema contract and changes language',()=>{
  const {document}=parseHTML(html),i18n=make();
  assert.deepEqual(validateLocaleCatalogs(),[]);
  for(const locale of ['zh-CN','en','zh-CN']) {i18n.setLocale(locale);localizeStatic(document,i18n);assertMarked(document,i18n);}
  assert.ok(document.querySelectorAll('[data-i18n]').length>180);
});

test('static copy inventory requires explicit keys or source ownership, including hidden help and ARIA',()=>{
  const {document}=parseHTML(html);
  for(const element of document.querySelectorAll('*')) {
    if(['SCRIPT','STYLE','KBD','CODE'].includes(element.tagName))continue;
    const direct=[...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('');
    if(/[A-Za-z\u3400-\u9fff]/u.test(direct))assert.ok(element.hasAttribute('data-i18n')||element.hasAttribute('data-i18n-source'),`${element.tagName} #${element.id}: ${direct}`);
    for(const attribute of ['aria-label','title','placeholder'])if(element.hasAttribute(attribute))assert.ok(element.hasAttribute(`data-i18n-${attribute}`)||element.hasAttribute('data-i18n-source'),`${element.id} ${attribute}`);
  }
});

test('localization preserves nested controls, links, icons, drafts, listeners and all canonical values',()=>{
  const {document,window}=parseHTML(html),i18n=make();
  const elements=[...document.querySelectorAll('*')],controls=[...document.querySelectorAll('input,select,textarea,option')];
  const values=controls.map(element=>[element,element.value,element.getAttribute('value'),element.checked,element.selected]);
  const links=[...document.querySelectorAll('a')].map(element=>[element,element.href]);
  const input=document.getElementById('custom-lowest'),button=document.getElementById('import-button');input.value='<draft 半成品>';
  let clicked=0;button.addEventListener('click',()=>clicked++);
  const icon=button.querySelector('span'),details=document.getElementById('guitar-plan-controls');details.setAttribute('open','');
  for(const locale of ['en','zh-CN','en']) {i18n.setLocale(locale);localizeStatic(document,i18n);}
  assert.deepEqual([...document.querySelectorAll('*')],elements);
  assert.equal(button.querySelector('span'),icon);button.dispatchEvent(new window.Event('click'));assert.equal(clicked,1);
  assert.equal(input.value,'<draft 半成品>');assert.equal(details.hasAttribute('open'),true);
  for(const [element,value,attribute,checked,selected]of values){if(element!==input)assert.equal(element.value,value);assert.equal(element.getAttribute('value'),element===input?'<draft 半成品>':attribute);assert.equal(element.checked,checked);assert.equal(element.selected,selected);}
  for(const[element,url]of links)assert.equal(element.href,url);
  assert.equal(document.querySelector('.wanted-tracks a').firstChild.textContent,'拼凑的断音 ');
  assert.equal(document.getElementById('guitar-tuning').value,'E4 B3 G3 D3 A2 E2');
});

test('translation text cannot create markup and very long text preserves every nested element',()=>{
  const {document}=parseHTML('<label data-i18n="settings.language">Language<input id="draft" value="保留"><span id="icon">☆</span></label><button data-i18n-title="common.close" title="Close"><svg id="svg"></svg></button>');
  const input=document.getElementById('draft'),icon=document.getElementById('icon'),svg=document.getElementById('svg');
  const long='<img src=x onerror=alert(1)> & 长文字 '.repeat(180);
  localizeStatic(document,{t:()=>long});
  assert.equal(document.querySelector('label').firstChild.textContent,long);
  assert.equal(document.querySelector('button').title,long);
  assert.equal(document.querySelector('img'),null);
  assert.equal(document.getElementById('draft'),input);assert.equal(document.getElementById('icon'),icon);assert.equal(document.getElementById('svg'),svg);assert.equal(input.value,'保留');
});

test('runtime/source-owned replacement retires only its exact placeholder binding',()=>{
  const {document}=parseHTML('<h2 id="source" data-i18n="shell.chooseScore">Choose a score</h2><p id="runtime" data-i18n="shell.previewStatus">Status</p><label data-i18n="shell.search">Search<input title="Title" data-i18n-title="settings.language"></label>');
  const i18n=make();localizeStatic(document,i18n);
  const source=document.getElementById('source'),runtime=document.getElementById('runtime'),input=document.querySelector('input');
  source.textContent='原作 <script> score · Original';runtime.firstChild.textContent='runtime stable diagnostic code: source_17';input.title='Imported source title';
  i18n.setLocale('en');localizeStatic(document,i18n);i18n.setLocale('zh-CN');localizeStatic(document,i18n);
  assert.equal(source.textContent,'原作 <script> score · Original');assert.equal(runtime.textContent,'runtime stable diagnostic code: source_17');assert.equal(input.title,'Imported source title');assert.equal(document.querySelector('script'),null);
  assert.equal(document.querySelector('label').firstChild.textContent,'搜索乐谱');
});

test('shared service is per document, honors saved exact locale and has no shared cross-document state',()=>{
  const one=parseHTML('<html lang="fr"><body></body></html>').document,two=parseHTML('<html><body></body></html>').document;
  const old=Object.getOwnPropertyDescriptor(one.defaultView,'localStorage');
  try {
    const values=new Map([[LOCALE_STORAGE_KEY,'en']]);Object.defineProperty(one.defaultView,'localStorage',{configurable:true,value:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}});
    const first=getAppI18n(one);assert.equal(getAppI18n(one),first);assert.equal(first.locale,'en');assert.equal(one.documentElement.lang,'en');
    first.setLocale('zh-CN');assert.equal(values.get(LOCALE_STORAGE_KEY),'zh-CN');assert.equal(one.documentElement.lang,'zh-CN');
    const second=getAppI18n(two);assert.notEqual(first,second);second.setLocale('en');assert.equal(first.locale,'zh-CN');
  } finally {if(old)Object.defineProperty(one.defaultView,'localStorage',old);else delete one.defaultView.localStorage;}
});

test('picker persists exact values, updates html language, has one listener and clears recovered storage failure',()=>{
  const f=environment('<html><body><label data-i18n="settings.language">Language<select id="interface-language"><option value="zh-CN" data-i18n="settings.chinese">Chinese</option><option value="en" data-i18n="settings.english">English</option></select></label><p id="locale-storage-status" hidden></p></body></html>');
  try {
    let writes=0,failed=true;const i18n=make({storage:{getItem(){throw Error('unavailable');},setItem(key,value){assert.equal(key,LOCALE_STORAGE_KEY);assert.ok(['zh-CN','en'].includes(value));writes++;if(failed)throw Error('unavailable');}}});
    const view=setupLocaleView({document:f.document,i18n});assert.equal(setupLocaleView({document:f.document,i18n}),view);assert.equal(f.document.documentElement.lang,'zh-CN');
    const select=f.document.getElementById('interface-language');select.options[1].selected=true;select.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.equal(writes,1);assert.equal(i18n.locale,'en');assert.equal(f.document.documentElement.lang,'en');assert.equal(f.document.getElementById('locale-storage-status').hidden,false);assert.match(f.document.getElementById('locale-storage-status').textContent,/could not be saved/);
    failed=false;select.dispatchEvent(new f.window.Event('change',{bubbles:true}));assert.equal(writes,2);assert.equal(f.document.getElementById('locale-storage-status').hidden,true);
    let revisions=0;const unsubscribe=view.subscribe(()=>revisions++);i18n.invalidate();assert.equal(revisions,1);unsubscribe();view.destroy();view.destroy();select.dispatchEvent(new f.window.Event('change',{bubbles:true}));assert.equal(writes,2);
  } finally {f.close();}
});

test('open shell dialogs switch language without pausing, resetting, refocusing or replacing controls',()=>{
  const f=environment();let shell;
  try {
    const i18n=make(),events=[];shell=setupGameShell({i18n,pausePlayback:()=>events.push('pause'),onScreen:()=>events.push('screen'),onNotation:()=>events.push('notation')});
    shell.update({score:{title:'原作 <img> · Source'},mode:'practice',part:'part_ID · Original',passes:2});shell.open('settings');
    const dialog=f.document.getElementById('settings-dialog'),draft=f.document.getElementById('guitar-tuning');draft.value='D4 A3 F3 C3 G2 D2';draft.focus();
    const controls=[...f.document.querySelectorAll('input,select,button,dialog')],before=events.slice();
    for(const locale of ['en','zh-CN','en'])i18n.setLocale(locale);
    assert.deepEqual(events,before);assert.equal(dialog.open,true);assert.equal(f.focused(),draft);assert.equal(draft.value,'D4 A3 F3 C3 G2 D2');assert.deepEqual([...f.document.querySelectorAll('input,select,button,dialog')],controls);
    assert.equal(f.document.getElementById('settings-title').textContent,'Session settings');assert.equal(f.document.getElementById('results-button').textContent,'Results (2)');assert.equal(f.document.getElementById('stage-title').textContent,'原作 <img> · Source');assert.equal(f.document.querySelector('#stage-title img'),null);assert.match(f.document.getElementById('stage-subtitle').textContent,/part_ID · Original/);
    assert.equal(f.document.querySelector('.skip-link').textContent,'Skip to song selection');
    shell.update({hasSession:true,hasPerformanceRecords:true});assert.equal(f.document.getElementById('resume-session').hidden,false);assert.equal(f.document.getElementById('results-button').disabled,false);assert.equal(f.document.getElementById('score-tools-button').disabled,true);
  } finally {shell?.destroy();f.close();}
});

test('performance caches, cues, range and ARIA redraw on locale changes without altering the recorder',()=>{
  const f=environment();let shell,view;
  try {
    const i18n=make(),recorder={active:null,interruptions:[],latencyMs:0,toleranceMs:180},context={geometry:[{midi:60},{midi:61}],rangeLabel:'C4–C♯4',mode:'practice',position:0,segmentStart:0,countInBeatMs:500,running:false,hasStarted:true,completed:false,now:1000,recorder};
    f.document.querySelector('.keyboard-footer').classList.add('keyboard-input-footer');
    shell=setupGameShell({i18n,pausePlayback(){},onScreen(){},onNotation(){}});view=setupPerformanceView({i18n,getContext:()=>context});
    const before=structuredClone(recorder),cue=f.document.getElementById('stage-cue'),footer=f.document.querySelector('.keyboard-input-footer');
    assert.equal(footer.closest('dialog'),null);assert.equal(f.document.getElementById('stage-cue-main').textContent,'已暂停');assert.match(f.document.getElementById('keyboard-range-context').textContent,/2 键/);
    i18n.setLocale('en');assert.equal(f.document.getElementById('stage-cue-main').textContent,'PAUSED');assert.equal(f.document.getElementById('hud-label').textContent,'Ready to practice');assert.equal(f.document.querySelector('.performance-status').getAttribute('aria-label'),'Active take snapshot');assert.match(f.document.getElementById('keyboard-range-context').textContent,/2 keys/);
    i18n.setLocale('zh-CN');assert.equal(f.document.getElementById('stage-cue-main').textContent,'已暂停');assert.equal(f.document.getElementById('stage-cue'),cue);assert.equal(f.document.querySelector('.keyboard-input-footer'),footer);assert.deepEqual(recorder,before);assert.deepEqual(i18n.getReports(),[]);
    assert.equal(previewMusicMetadata(fixture,i18n),'起始：C 大调 · 每分钟 120 拍 · 1 个声部');assert.equal(performanceCue({...context,completed:true},i18n).main,'演奏已记录');
  } finally {view?.destroy();shell?.destroy();f.close();}
});
