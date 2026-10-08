import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createPartActivityView, partActivityEligible, PART_ACTIVITY_VIEW_LIMIT, PART_ACTIVITY_PAGE_SIZE} from '../web/part-activity-view.js';
import {PART_ACTIVITY_STATES, partActivityText} from '../web/part-activity-locales.js';

const context = {screen: 'stage', layout: 'complete', mode: 'practice', showOtherParts: true};
const machine = (index, extra = {}) => ({partId: `p${index}`, label: `Part ${index}`, owner: 'machine', visible: true, state: 'ready', ...extra});
function setup() {
  const {document, window} = parseHTML('<html><body><main></main></body></html>');
  const i18n = {locale: 'en'};
  return {document, window, i18n, view: createPartActivityView({document, parent: document.querySelector('main'), i18n})};
}
function key(window, target, type, value, code = value, repeat = false) {
  const event = new window.Event(type, {bubbles: true, cancelable: true});
  Object.assign(event, {key: value, code, repeat}); target.dispatchEvent(event); return event;
}

test('activity is display-only and restricted to complete practice machine rows', () => {
  const {view} = setup();
  assert.equal(PART_ACTIVITY_VIEW_LIMIT, 128); assert.equal(PART_ACTIVITY_PAGE_SIZE, 1);
  assert.equal(view.root.hidden, true);
  for (const patch of [{screen:'home'}, {layout:'solo'}, {mode:'listen'}, {mode:'free'}, {showOtherParts:false}, {showOtherParts:undefined}, {hideOtherParts:true}]) {
    assert.equal(partActivityEligible({...context,...patch}), false);
    view.update({rows:[machine(1)]}, {...context,...patch}); assert.equal(view.root.hidden,true);
  }
  view.update({rows:[machine(0,{owner:'human'}),machine(1,{visible:false}),machine(2)]},context);
  assert.equal(view.root.hidden,false); assert.equal(view.root.querySelector('.part-activity-label').textContent,'Part 2');
  assert.equal(view.root.querySelectorAll('.part-activity-row').length,1);
  assert.equal(view.root.querySelectorAll('input,select,canvas,svg').length,0);
  assert.equal(view.root.getAttribute('data-keyboard-input'),'off');
  view.update({rows:[]},context); assert.equal(view.root.hidden,true);
});

test('initially hidden strip has localized accessible name and unchanged hidden frames do not write DOM', async () => {
  const {view,i18n,window}=setup();assert.equal(view.root.hidden,true);assert.equal(view.root.getAttribute('aria-label'),partActivityText('en','title'));
  const writes=[],observer=new window.MutationObserver(records=>writes.push(...records));observer.observe(view.root,{attributes:true,childList:true,characterData:true,subtree:true});
  for(let index=0;index<20;index++)view.update(null,{...context,layout:'solo'});
  await Promise.resolve();assert.equal(writes.length,0,'Initial hidden renders must be no-op writes');
  i18n.locale='zh-CN';view.update(null,{...context,mode:'listen'});await Promise.resolve();assert.equal(view.root.hidden,true);assert.equal(view.root.getAttribute('aria-label'),partActivityText('zh-CN','title'));assert.deepEqual(writes.map(record=>record.attributeName),['aria-label']);writes.length=0;
  for(let index=0;index<20;index++)view.update({rows:[]},context);
  await Promise.resolve();assert.equal(writes.length,0,'Unchanged locale and hidden frames must not write');
  i18n.locale='en';view.update({rows:[]},context);await Promise.resolve();assert.equal(view.root.getAttribute('aria-label'),partActivityText('en','title'));assert.deepEqual(writes.map(record=>record.attributeName),['aria-label']);observer.disconnect();view.destroy();
});

test('one-row paging reaches every admitted part in source order and clamps shrink', () => {
  const {view} = setup(); const rows = Array.from({length:130},(_,index)=>machine(index));
  view.update({rows},context);
  const previous=view.root.querySelector('.part-activity-previous'),next=view.root.querySelector('.part-activity-next');
  assert.equal(previous.disabled,true); assert.match(view.root.querySelector('.part-activity-limit').textContent,/128/);
  for(let index=0;index<128;index++) {
    assert.equal(view.root.querySelector('.part-activity-label').textContent,`Part ${index}`);
    assert.equal(view.root.querySelectorAll('.part-activity-row').length,1);
    if(index<127)next.click();
  }
  assert.equal(next.disabled,true); assert.equal(view.root.querySelector('.part-activity-page').textContent,'Page 128 of 128');
  previous.click(); assert.equal(view.root.querySelector('.part-activity-label').textContent,'Part 126');
  view.update({rows:rows.slice(0,2)},context);assert.equal(view.root.querySelector('.part-activity-label').textContent,'Part 1');
  assert.equal(next.disabled,true); assert.equal(view.root.querySelector('.part-activity-limit').hidden,true);
});

test('all eight explicit states are localized; invalid state never invents playing', () => {
  const {view,i18n}=setup();
  for(const locale of ['en','zh-CN']) {
    i18n.locale=locale;
    for(const state of PART_ACTIVITY_STATES) {
      view.update({rows:[machine(0,{state})],positionMs:999999},context);
      assert.equal(view.root.querySelector('.part-activity-state').textContent,partActivityText(locale,state));
      assert.equal(view.root.querySelector('.part-activity-row').getAttribute('data-state'),state);
    }
  }
  view.update({rows:[machine(0,{state:'unknown'})]},context);
  assert.equal(view.root.querySelector('.part-activity-row').getAttribute('data-state'),'unavailable');
});

test('source labels remain bounded literal evidence with unidentified and subset copy', () => {
  const {view}=setup();
  const label='<img src=x onerror=alert(1)>\u202e'+'x'.repeat(500);
  view.update({rows:[machine(0,{label,sourceInstrumentSummary:'<script>attack</script>'+'z'.repeat(500),machineSubset:true})]},context);
  assert.equal(view.root.querySelectorAll('img,script').length,0);
  assert.equal(view.root.querySelector('.part-activity-label').textContent.length,160);
  assert.equal(view.root.querySelector('.part-activity-source').textContent.length,300);
  assert.equal(view.root.querySelector('.part-activity-label').textContent.includes('\u202e'),false);
  assert.match(view.root.querySelector('.part-activity-subset').textContent,/human part/);
  view.update({rows:[machine(0,{label:{toString(){throw Error('untrusted coercion');}},sourceInstrumentSummary:null})]},context);
  assert.equal(view.root.querySelector('.part-activity-label').textContent,'p0');
  assert.equal(view.root.querySelector('.part-activity-source').textContent,'Original instrument: not identified');
});

test('unchanged frames and clock movement perform zero DOM writes; only paging is live', async () => {
  const {view,window}=setup(); const rows=[machine(0),machine(1)];view.update({rows,positionMs:0},context);
  const writes=[]; const observer=new window.MutationObserver(records=>writes.push(...records));
  observer.observe(view.root,{attributes:true,childList:true,characterData:true,subtree:true});
  for(let frame=1;frame<100;frame++)view.update({rows:rows.map(row=>({...row})),positionMs:frame},context);
  await Promise.resolve(); assert.equal(writes.length,0); observer.disconnect();
  const live=view.root.querySelectorAll('[aria-live]');assert.equal(live.length,1);assert.equal(live[0].classList.contains('part-activity-page'),true);
  assert.equal(live[0].getAttribute('aria-live'),'polite');
});

test('native pager activation owns only its key pair and preserves held releases and focusout', () => {
  const {view,window,document}=setup();view.update({rows:[machine(0),machine(1)]},context);
  const next=view.root.querySelector('.part-activity-next'); const events=[];
  for(const type of ['keydown','keyup','focusout'])document.addEventListener(type,event=>events.push(event.type));
  assert.equal(key(window,next,'keydown','Enter').defaultPrevented,false);
  key(window,next,'keyup','Enter');assert.deepEqual(events,[]);
  key(window,next,'keydown',' ','Space');key(window,next,'keyup',' ','Space');assert.deepEqual(events,[]);
  key(window,next,'keyup','Enter');key(window,next,'keyup','a','KeyA');
  next.dispatchEvent(new window.Event('focusout',{bubbles:true}));
  assert.deepEqual(events,['keyup','keyup','focusout']);
  key(window,next,'keydown','Tab');assert.equal(events.at(-1),'keydown');
  const root=view.root;view.destroy();assert.equal(root.parentNode,null);view.destroy();
});


test('repeat arriving from a held musical key never steals its release', () => {
  const {view,window,document}=setup();view.update({rows:[machine(0),machine(1)]},context);
  const next=view.root.querySelector('.part-activity-next'),events=[];
  document.addEventListener('keyup',event=>events.push(event.code));
  key(window,next,'keydown',' ','Space',true);key(window,next,'keyup',' ','Space');
  assert.deepEqual(events,['Space']);
  key(window,next,'keydown',' ','Space');key(window,next,'keydown',' ','Space',true);key(window,next,'keyup',' ','Space');
  assert.deepEqual(events,['Space'],'Repeats of an owned navigation press still stay owned');
});

test('input inspection stops before index 128 even when all bounded rows are hidden', () => {
  const {view}=setup(); const rows=Array.from({length:10000},(_,i)=>machine(i,{visible:false}));
  Object.defineProperty(rows,128,{get(){throw Error('Read beyond bounded source window');}});
  view.update({rows},context);assert.equal(view.root.hidden,true);
  rows[0]=machine(0);rows[1]=machine(0);rows[2]=machine(2,{partId:null});rows[3]=machine(3,{partId:''});
  view.update({rows},context);assert.equal(view.root.hidden,false);
  assert.equal(view.root.querySelector('.part-activity-pages').hidden,true);
  assert.equal(view.root.querySelector('.part-activity-page-label').textContent,'Page 1 of 1');
  assert.equal(view.root.querySelector('.part-activity-limit').hidden,false);
});

test('restored accessibility selectors and bounded titles expose literal source evidence', () => {
  const {view}=setup();view.update({rows:[machine(0,{label:'literal source',sourceInstrumentSummary:'source declaration'}),machine(1)]},context);
  assert.equal(view.root.getAttribute('aria-live'),'off');
  assert.equal(view.root.querySelector('.part-activity-name').getAttribute('title'),'literal source');
  assert.equal(view.root.querySelector('.part-activity-source').getAttribute('title'),'source declaration');
  assert.equal(view.root.querySelector('.part-activity-machine').textContent,'Machine');
  assert.equal(view.root.querySelector('.part-activity-previous').getAttribute('aria-label'),'Previous accompaniment parts');
  assert.equal(view.root.querySelector('.part-activity-next').getAttribute('aria-label'),'Next accompaniment parts');
});

test('Arrow, Home and End page within the bounded list and own both event edges', () => {
  const {view,window,document}=setup();view.update({rows:Array.from({length:4},(_,i)=>machine(i))},context);
  const next=view.root.querySelector('.part-activity-next'),seen=[];
  document.addEventListener('keydown',()=>seen.push('down'));document.addEventListener('keyup',()=>seen.push('up'));
  for(const [value,expected] of [['End','Part 3'],['ArrowLeft','Part 2'],['Home','Part 0'],['ArrowRight','Part 1']]) {
    assert.equal(key(window,next,'keydown',value).defaultPrevented,true);
    key(window,next,'keyup',value);
    assert.equal(view.root.querySelector('.part-activity-name').textContent,expected);
  }
  assert.deepEqual(seen,[]);
});

test('source-name collisions remain distinct pages and sanitized-empty labels fall back to raw source ID',()=>{
 const {view}=setup();
 view.update({rows:[machine(0,{label:'Shared authored name'}),machine(1,{label:'Shared authored name'})]},context);
 assert.equal(view.root.querySelector('.part-activity-page').textContent,'Page 1 of 2');
 view.root.querySelector('.part-activity-next').click();
 assert.equal(view.root.querySelector('.part-activity-row').getAttribute('data-part-id'),'p1');
 assert.equal(view.root.querySelector('.part-activity-label').textContent,'Shared authored name');
 for(const label of [undefined,'', '\u202e\u0000\u2066']){
  view.update({rows:[machine(0,{partId:'midi-t3-c3-r0',label})]},context);
  assert.equal(view.root.querySelector('.part-activity-label').textContent,'midi-t3-c3-r0');
  assert.equal(view.root.querySelector('.part-activity-label').title,'midi-t3-c3-r0');
 }
});
