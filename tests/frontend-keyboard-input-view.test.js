import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {createKeyboardInput,DEFAULT_KEYBOARD_MAPPING} from '../web/keyboard-input.js';
import {setupKeyboardInputView} from '../web/keyboard-input-view.js';
import {createI18n} from '../web/i18n.js';

function fixture(options={},viewOptions={},short=false) {
  const {document,window}=parseHTML('<html><body><div class="stage-heading"><h1 id="stage-title">Score</h1><p id="stage-subtitle">Practice</p></div><dialog id="settings-dialog"><div class="shell-dialog-content"></div></dialog><section class="play-panel"><div class="piano-stage"><canvas id="falling-notes"></canvas><div id="keyboard"><button data-midi="60"><span class="key-shortcut"></span></button><button data-midi="36"><span class="key-shortcut"></span></button></div></div><div class="keyboard-footer"></div><div class="transport"><button id="play-button">Play</button><button id="stop-button">Stop</button></div></section><section id="free-practice-screen"><div class="free-practice-heading"><h1 id="free-practice-title">Free</h1></div><section id="free-piano-stage"></section><div class="free-stage-footer"></div></section></body></html>');
  const mediaListeners=new Set(),media={matches:short,addEventListener(type,listener){assert.equal(type,'change');mediaListeners.add(listener);},removeEventListener(type,listener){assert.equal(type,'change');mediaListeners.delete(listener);}};
  window.matchMedia=query=>{assert.equal(query,'(max-height:600px) and (min-width:651px), (max-width:650px)');return media;};
  const setShortLandscape=matches=>{media.matches=matches;for(const listener of mediaListeners)listener({matches});};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  const $=id=>document.getElementById(id), events=[],i18n=createI18n({locale:'en',onReport:()=>{}});let view;
  const stageNodes=['falling-notes','keyboard','play-button','stop-button'].map(id=>[id,$(id),$(id).parentElement]);
  const controller=createKeyboardInput({getContext:()=>({screen:'stage'}),pressNote:(...args)=>events.push(['on',...args]),releaseNote:(...args)=>events.push(['off',...args]),releaseMatching:(...args)=>events.push(['cleanup',...args]),onChange:next=>view?.render(next),...options});
  view=setupKeyboardInputView({document,controller,i18n,getVisualRange:()=>({low:48,high:72}),...viewOptions});
  const emit=(target,type,properties={})=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,properties);target.dispatchEvent(event);return event;};
  return {document,window,$,controller,view,events,i18n,emit,stageNodes,setShortLandscape,setViewport:(width,height)=>setShortLandscape(width<=650||height<=600&&width>=651),mediaListeners};
}

test('wide physical mapping is available, with accurate matching piano labels and separate display range',()=>{
  const {document,$,controller}=fixture();
  assert.equal(document.querySelectorAll('#keyboard-map [data-code]').length,47);
  assert.equal($('keyboard-active-range').dataset.lowMidi,'36');assert.equal($('keyboard-active-range').dataset.highMidi,'82');
  assert.match($('keyboard-active-range').textContent,/C2.*A♯5/);assert.match($('keyboard-visual-range').textContent,/C3.*C5/);
  assert.match($('keyboard-key-counts').textContent,/47 playable.*47 mapped.*0 outside/);
  assert.equal(document.querySelector('#keyboard [data-midi="60"] .key-shortcut').textContent,'R');
  assert.equal(document.querySelector('#keyboard [data-midi="36"] .key-shortcut').textContent,'Z');
  assert.equal(controller.snapshot().bindings.find(binding=>binding.code==='KeyR').midi,60);
  assert.equal($('keyboard-input-settings').dataset.keyboardInput,'off');
  assert.equal($('typing-octave'),null);
});

test('the stage footer starts compact while its native disclosure retains the full map and help',()=>{
  const {$,document,stageNodes}=fixture(),details=$('keyboard-performance-details');
  assert.equal(details.tagName,'DETAILS');assert.equal(details.hasAttribute('open'),false);
  assert.equal(details.firstElementChild,$('keyboard-map-label'));assert.equal($('keyboard-map-label').tagName,'SUMMARY');
  for(const id of ['keyboard-map','keyboard-key-counts','keyboard-visual-range','keyboard-input-shortcuts','keyboard-offset-reset','keyboard-open-settings']){
    assert.equal($(id).closest('details'),details,id);
  }
  for(const id of ['keyboard-active-range','keyboard-current-offset','keyboard-octave-down','keyboard-semitone-down','keyboard-semitone-up','keyboard-octave-up']){
    assert.equal($(id).closest('details'),null,id);
  }
  assert.equal(document.querySelectorAll('#keyboard-map [data-code]').length,47);
  assert.equal($('keyboard-map').getAttribute('aria-labelledby'),$('keyboard-map-label').id);
  for(const[id,node,parent]of stageNodes){assert.equal($(id),node,id);assert.equal(node.parentElement,parent,`${id} stays in place`);}
  assert.equal(document.querySelector('#keyboard').children.length,2);
  assert.equal(document.querySelector('.keyboard-input-footer').nextElementSibling,document.querySelector('.transport'));
});

test('compact range and transpose controls retain their full localized accessible names',()=>{
  const {$,i18n}=fixture();
  assert.equal($('keyboard-active-range').textContent,'C2–A♯5');assert.equal($('keyboard-current-offset').textContent,'+0');
  assert.equal($('keyboard-current-offset').tagName,'OUTPUT');
  for(const locale of ['en','zh-CN']){
    i18n.setLocale(locale);
    assert.equal($('keyboard-active-range').getAttribute('aria-label'),i18n.t('keyboard.span',{low:'C2',high:'A♯5'}));
    assert.equal($('keyboard-current-offset').getAttribute('aria-label'),i18n.t('keyboard.offset',{semitones:0}));
    for(const[id,key,symbol]of [['keyboard-octave-down','keyboard.octaveDown','−12'],['keyboard-semitone-down','keyboard.transposeDown','−1'],['keyboard-semitone-up','keyboard.transposeUp','+1'],['keyboard-octave-up','keyboard.octaveUp','+12']]){
      assert.equal($(id).textContent,symbol);assert.equal($(id).getAttribute('aria-label'),i18n.t(key));assert.equal($(id).title,i18n.t(key));
    }
    assert.equal($('keyboard-map-label').textContent,i18n.t('keyboard.map'));
  }
  $('keyboard-semitone-down').click();assert.equal($('keyboard-current-offset').textContent,'−1');
  assert.equal($('keyboard-current-offset').getAttribute('aria-label'),i18n.t('keyboard.offset',{semitones:-1}));
  assert.deepEqual(i18n.getReports(),[]);
});

test('short landscape uses Settings for the same keyboard controls and keeps live range in the existing header row',()=>{
  let configured=0,scrolled=0;
  const {$,document,controller,i18n,emit,stageNodes,setShortLandscape}=fixture({}, {onConfigure:()=>{configured++;}});
  $('keyboard-input-settings').scrollIntoView=options=>{assert.equal(options.block,'start');scrolled++;};
  const footer=document.querySelector('.keyboard-input-footer'),details=$('keyboard-performance-details'),mapKey=document.querySelector('#keyboard-map [data-code="KeyR"]'),subtitle=$('stage-subtitle'),indicator=$('keyboard-compact-status');
  details.setAttribute('open','');$('keyboard-map').scrollLeft=73;
  $('keyboard-mapping-editor').value='[unfinished';emit($('keyboard-mapping-editor'),'input');
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
  const before=controller.exportConfigurationData();
  for(let cycle=0;cycle<2;cycle++){
    setShortLandscape(true);
    assert.equal(footer.parentElement,$('keyboard-input-settings'));
    assert.equal(footer.nextElementSibling.className,'keyboard-input-fields');
    assert.equal(document.querySelector('.play-panel>.keyboard-input-footer'),null);
    assert.equal(indicator.hidden,false);assert.equal(indicator.previousElementSibling,subtitle);
    assert.equal(indicator.textContent,'⌨ C2–A♯5 +0');
    indicator.click();assert.equal(configured,cycle+1);assert.equal(scrolled,cycle+1,'The range button reveals its controls in Settings');
    i18n.setLocale(cycle?'en':'zh-CN');
    for(const text of [i18n.t('keyboard.title'),i18n.t('keyboard.span',{low:'C2',high:'A♯5'}),i18n.t('keyboard.offset',{semitones:0}),i18n.t('keyboard.configure')])assert.ok(indicator.getAttribute('aria-label').includes(text));
    setShortLandscape(false);
    assert.equal(indicator.hidden,true);assert.equal(footer.nextElementSibling,document.querySelector('.transport'));
    assert.equal(details.hasAttribute('open'),true);assert.equal($('keyboard-map').scrollLeft,73);
    assert.equal(document.querySelector('#keyboard-map [data-code="KeyR"]'),mapKey);assert.equal(mapKey.classList.contains('held'),true);
    assert.equal($('keyboard-mapping-editor').value,'[unfinished');
    assert.deepEqual(controller.exportConfigurationData(),before,'Responsive presentation never changes input history');
    assert.equal(document.querySelectorAll('#keyboard-map').length,1);assert.equal(document.querySelectorAll('#keyboard-compact-status').length,1);
    for(const[id,node,parent]of stageNodes){assert.equal($(id),node);assert.equal(node.parentElement,parent);}
  }
  setShortLandscape(true);
  controller.keyup({code:'KeyR',timeStamp:2});
  controller.keydown({code:'ArrowUp',target:document.body,timeStamp:3,preventDefault(){}});
  controller.keydown({code:'ArrowLeft',target:document.body,timeStamp:4,preventDefault(){}});
  assert.equal(indicator.textContent,'⌨ B2–A6 +11');
  assert.equal($('keyboard-current-offset').textContent,'+11');
  assert.equal($('keyboard-active-range').textContent,'B2–A6');
  assert.ok(indicator.getAttribute('aria-label').includes(i18n.t('keyboard.offset',{semitones:11})));
});

test('390 portrait resizes preserve one Settings footer, clickable range, disclosure and input ownership in both modes',()=>{
  let configured=0;
  const {document,$,view,controller,events,setViewport}=fixture({}, {onConfigure:()=>configured++});
  const footer=document.querySelector('.keyboard-input-footer'),map=$('keyboard-map'),details=$('keyboard-performance-details'),badge=$('keyboard-compact-status');details.setAttribute('open','');
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});const before=controller.exportConfigurationData();
  for(const mode of ['stage','free','stage']){
    view.setScreen(mode);setViewport(390,844);assert.equal(footer.parentElement,$('keyboard-input-settings'));assert.equal(badge.hidden,false);badge.click();
    assert.equal(badge.closest(mode==='free'?'.free-practice-heading':'.stage-heading')!==null,true);
    assert.equal($('keyboard-map'),map);assert.equal(details.hasAttribute('open'),true);assert.deepEqual(controller.exportConfigurationData(),before);
    setViewport(1280,900);assert.notEqual(footer.parentElement,$('keyboard-input-settings'));assert.equal(badge.hidden,true);
  }
  assert.equal(configured,3);assert.equal(events.filter(row=>row[0]==='on').length,1);assert.equal(events.filter(row=>row[0]==='off').length,0);
  controller.keyup({code:'KeyR',timeStamp:2});assert.equal(events.filter(row=>row[0]==='off').length,1);view.destroy();
});

test('one existing keyboard footer and mapping disclosure move between modes and retain the compact Settings home',()=>{
  const {document,$,view,controller,i18n,emit,setShortLandscape}=fixture();
  const footer=document.querySelector('.keyboard-input-footer'),details=$('keyboard-performance-details'),mapKey=document.querySelector('#keyboard-map [data-code="KeyR"]'),indicator=$('keyboard-compact-status');
  const ids=['keyboard-active-range','keyboard-current-offset','keyboard-octave-down','keyboard-semitone-down','keyboard-semitone-up','keyboard-octave-up','keyboard-performance-details','keyboard-map','keyboard-offset-reset','keyboard-open-settings'];
  const nodes=new Map(ids.map(id=>[id,$(id)]));details.setAttribute('open','');$('keyboard-map').scrollLeft=41;$('keyboard-mapping-editor').value='[unfinished';emit($('keyboard-mapping-editor'),'input');const before=controller.exportConfigurationData();
  const unique=()=>{assert.equal(document.querySelectorAll('.keyboard-input-footer').length,1);for(const [id,node]of nodes){assert.equal(document.querySelectorAll(`#${id}`).length,1);assert.ok($(id)===node,`${id} keeps the original control/listener`);}};
  for(const locale of ['zh-CN','en']){
    view.setScreen('free');unique();assert.equal(footer.previousElementSibling.id,'free-piano-stage');i18n.setLocale(locale);assert.equal($('keyboard-map-label').textContent,i18n.t('keyboard.map'));assert.ok(document.querySelector('#keyboard-map [data-code="KeyR"]')===mapKey);assert.equal(details.hasAttribute('open'),true);assert.equal($('keyboard-map').scrollLeft,41);assert.equal($('keyboard-mapping-editor').value,'[unfinished');
    setShortLandscape(true);unique();assert.equal(footer.parentElement.id,'keyboard-input-settings');assert.ok(indicator.closest('.free-practice-heading'));assert.equal(indicator.hidden,false);
    view.setScreen('stage');unique();assert.equal(footer.parentElement.id,'keyboard-input-settings');assert.ok(indicator.closest('.keyboard-stage-meta'));
    setShortLandscape(false);unique();assert.equal(footer.nextElementSibling.className,'transport');assert.equal(indicator.hidden,true);
  }
  assert.deepEqual(controller.exportConfigurationData(),before,'Moving and localizing controls does not configure input or create recordings');
  view.setScreen('free');for(const [id,expected]of [['keyboard-octave-up',12],['keyboard-semitone-down',11],['keyboard-semitone-up',12],['keyboard-octave-down',0]]){$(id).click();assert.equal(controller.snapshot().transpose,expected,`The original ${id} handler works in free mode`);}
  view.destroy();assert.equal(footer.closest('.play-panel')!==null,true);assert.equal(footer.nextElementSibling.className,'transport');
});

test('an initially short viewport restores the original stage footer and subtitle when the view is destroyed',()=>{
  const {$,document,view,setShortLandscape,mediaListeners}=fixture({}, {},true),footer=document.querySelector('.keyboard-input-footer'),subtitle=$('stage-subtitle');
  assert.equal(footer.closest('dialog').id,'settings-dialog');assert.equal($('keyboard-compact-status').hidden,false);assert.equal(mediaListeners.size,1);
  view.destroy();assert.equal(mediaListeners.size,0);assert.equal(footer.closest('.play-panel')!==null,true);assert.equal(footer.nextElementSibling,document.querySelector('.transport'));
  assert.equal($('keyboard-input-settings'),null);assert.equal($('keyboard-compact-status'),null);assert.equal(subtitle.parentElement.className,'stage-heading');
  setShortLandscape(false);assert.equal(footer.closest('.play-panel')!==null,true);
});

test('disclosure state, mapping identity, drafts and settings action survive held-note and locale renders',()=>{
  let configured=0;
  const {$,document,controller,i18n,emit}=fixture({}, {onConfigure:()=>{configured++;}}),details=$('keyboard-performance-details');
  details.setAttribute('open','');
  const key=document.querySelector('#keyboard-map [data-code="KeyR"]');
  $('keyboard-mapping-editor').value='[draft';emit($('keyboard-mapping-editor'),'input');
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
  i18n.setLocale('zh-CN');
  assert.equal(details.hasAttribute('open'),true);assert.equal(document.querySelector('#keyboard-map [data-code="KeyR"]'),key);assert.equal(key.classList.contains('held'),true);
  assert.equal($('keyboard-mapping-editor').value,'[draft');
  $('keyboard-open-settings').click();assert.equal(configured,1);
  $('keyboard-semitone-up').click();assert.equal(details.hasAttribute('open'),true);assert.equal($('keyboard-mapping-editor').value,'[draft');
  details.removeAttribute('open');i18n.setLocale('en');assert.equal(details.hasAttribute('open'),false);
});

test('compact footer CSS reserves one toolbar row and expands mapping only when requested',async()=>{
  // Structural CSS assertions only; Node DOM does not validate 844×390 geometry.
  const css=await readFile(new URL('../web/keyboard-input-view.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
  const style=selector=>rules.find(rule=>rule.selectorText===selector).style;
  assert.equal(style('.keyboard-footer.keyboard-input-footer').display,'grid');
  assert.equal(style('.keyboard-footer.keyboard-input-footer')['grid-template-columns'],'minmax(0, 1fr) auto auto');
  assert.equal(style('.keyboard-input-status')['flex-wrap'],'nowrap');
  assert.equal(style('.keyboard-transpose-actions')['flex-wrap'],'nowrap');
  assert.equal(style('.keyboard-transpose-actions').margin,'0');
  assert.equal(style('.keyboard-transpose-actions .button')['min-height'],'28px');
  assert.equal(style('.keyboard-performance-details[open]')['grid-column'],'1 / -1');
  assert.equal(style('.keyboard-performance-details>summary')['list-style-position'],'inside');
  assert.equal(style('#keyboard-input-settings>.keyboard-input-footer')['max-height'],'none');
  assert.equal(style('#keyboard-input-settings>.keyboard-input-footer').overflow,'visible','The Settings dialog owns scrolling for the complete map');
  assert.equal(style('.keyboard-stage-meta').display,'contents');
  assert.equal(style('.keyboard-compact-status')['white-space'],'nowrap');
  const compact=rules.find(rule=>/max-height:\s*600px/.test(rule.media?.mediaText||''));
  const footer=[...compact.cssRules].find(rule=>rule.selectorText==='.keyboard-footer.keyboard-input-footer').style;
  assert.equal(footer.padding,'3px 10px');assert.equal(footer['max-height'],'min(180px, 40dvh)');
  const meta=[...compact.cssRules].find(rule=>rule.selectorText==='.keyboard-stage-meta').style;
  assert.equal(meta.display,'flex');assert.equal(meta['flex-wrap'],undefined,'The live range shares the subtitle row without wrapping into another stage row');
});

test('octave, semitone, base and legacy preset controls update input without score operations',()=>{
  const {$,controller,document,emit}=fixture();
  $('keyboard-octave-up').click();assert.equal(controller.snapshot().transpose,12);
  $('keyboard-semitone-down').click();assert.equal(controller.snapshot().transpose,11);
  $('keyboard-offset-reset').click();assert.equal(controller.snapshot().transpose,0);
  $('keyboard-base-midi').value='48';$('keyboard-input-offset').value='-1';$('keyboard-settings-apply').click();
  assert.equal(controller.snapshot().range.low,47);assert.equal(controller.snapshot().range.high,93);
  $('keyboard-preset').value='legacy';emit($('keyboard-preset'),'change');
  assert.equal(controller.snapshot().baseMidi,60);assert.equal(controller.snapshot().bindings.length,17);
  assert.equal(document.querySelector('#keyboard [data-midi="60"] .key-shortcut').textContent,'A');
  assert.equal(controller.exportConfigurationData().events.at(-1).reason,'keyboard_preset_changed');
});

test('mapping editor validates JSON and duplicate keys atomically; explicit pitch aliases get labels',()=>{
  const {$,controller,document,emit}=fixture();
  const original=controller.exportConfigurationData();
  $('keyboard-mapping-editor').value='not JSON';$('keyboard-mapping-apply').click();
  assert.match($('keyboard-configuration-error').textContent,/JSON/);assert.deepEqual(controller.exportConfigurationData(),original);
  const aliases=[{code:'KeyA',offset:24,label:'A',row:'custom'},{code:'KeyB',offset:24,label:'B',row:'custom'}];
  $('keyboard-mapping-editor').value=JSON.stringify(aliases);$('keyboard-mapping-apply').click();
  assert.match($('keyboard-configuration-error').textContent,/same pitch/);assert.deepEqual(controller.exportConfigurationData(),original);
  $('keyboard-allow-aliases').checked=true;emit($('keyboard-allow-aliases'),'change');$('keyboard-mapping-apply').click();
  assert.equal($('keyboard-configuration-error').hidden,true);assert.equal(controller.snapshot().noteCount,1);
  assert.equal(document.querySelector('#keyboard [data-midi="60"] .key-shortcut').textContent,'A / B');
  assert.equal($('keyboard-preset').value,'custom');
  $('keyboard-mapping-editor').value=JSON.stringify([aliases[0],aliases[0]]);$('keyboard-mapping-apply').click();
  assert.match($('keyboard-configuration-error').textContent,/more than once/);assert.equal(controller.snapshot().bindings.length,2);
});

test('map changes release owned physical contacts and valid out-of-display MIDI stays enabled',()=>{
  const {$,controller,document,events}=fixture();
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
  const source=events[0][1];assert.equal(events[0][2],60);
  assert.equal(document.querySelector('#keyboard-map [data-code="KeyR"]').classList.contains('held'),true);
  $('keyboard-base-midi').value='100';$('keyboard-input-offset').value='0';$('keyboard-settings-apply').click();
  assert.equal(events[1][0],'cleanup');assert.equal(events[1][1],'key:');
  assert.equal(controller.snapshot().held.length,0);assert.equal(controller.snapshot().range.low,100);assert.equal(controller.snapshot().range.high,127);
  assert.equal(controller.snapshot().disabledKeyCount,19);assert.match($('keyboard-key-counts').textContent,/28 playable.*19 outside/);
  assert.equal(document.querySelector('#keyboard-map [data-code="KeyR"]').dataset.enabled,'true');
  controller.keyup({code:'KeyR',timeStamp:2});assert.equal(events.at(-1)[1],source);
  controller.keydown({code:'KeyZ',key:'z',target:document.body,timeStamp:3,preventDefault(){}});assert.equal(events.at(-1)[2],100);
});

test('locale and held-note redraws preserve edited settings, mapping drafts and node identity',()=>{
  const {$,controller,document,emit,i18n}=fixture();
  const mapNode=document.querySelector('#keyboard-map [data-code="KeyR"]');
  $('keyboard-base-midi').value='61';$('keyboard-input-offset').value='4';
  $('keyboard-mapping-editor').value='[unfinished';emit($('keyboard-mapping-editor'),'input');
  i18n.setLocale('zh-CN');assert.equal($('keyboard-input-title').textContent,i18n.t('keyboard.title'));
  assert.equal($('keyboard-base-midi').value,'61');assert.equal($('keyboard-input-offset').value,'4');assert.equal($('keyboard-mapping-editor').value,'[unfinished');
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
  assert.equal(document.querySelector('#keyboard-map [data-code="KeyR"]'),mapNode);assert.equal($('keyboard-mapping-editor').value,'[unfinished');
  $('keyboard-semitone-up').click();assert.equal($('keyboard-mapping-editor').value,'[unfinished');
  $('keyboard-mapping-reset').click();assert.deepEqual(JSON.parse($('keyboard-mapping-editor').value),DEFAULT_KEYBOARD_MAPPING);
});

test('invalid manual pitch values do not release input or alter configuration; export warns on bounded history',()=>{
  const {$,controller,document,events}=fixture({configurationLimit:2});
  controller.keydown({code:'KeyR',key:'r',target:document.body,timeStamp:1,preventDefault(){}});
  const original=controller.snapshot().configurationId;
  $('keyboard-base-midi').value='';$('keyboard-settings-apply').click();
  assert.equal(controller.snapshot().configurationId,original);assert.equal(events.length,1);assert.equal($('keyboard-configuration-error').hidden,false);
  $('keyboard-offset-reset').click();$('keyboard-semitone-up').click();$('keyboard-semitone-up').click();
  assert.equal($('keyboard-configuration-limit').hidden,false);assert.equal(controller.exportConfigurationData().omitted_configurations,1);
});
