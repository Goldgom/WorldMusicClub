import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {setupThemes} from '../web/themes.js';
import {PRACTICE_SETTING_MESSAGE_KEYS,compensateInput,parseBeatInput,readLatencyPreference,writeLatencyPreference,saveLatency,loadLatency} from '../web/practice-settings.js';
import {renderNotation} from '../web/music.js';
import {fixture as scoreFixture} from './frontend-fixtures.js';
import en from '../web/locales/preferences-runtime-en.js';
import zh from '../web/locales/preferences-runtime-zh-CN.js';
import schema from '../web/locales/preferences-runtime-schema.js';

function themeFixture({stored=null,readFailure=false,writeFailure=false,dark=false,locale='zh-CN',shared=false}={}) {
  const {document,window}=parseHTML('<html><body><select id="theme-mode"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option><option value="custom">Custom</option></select><div id="custom-theme-controls"><input id="theme-accent" type="color"><input id="theme-background" type="color"></div><p id="theme-storage-status"></p><textarea id="score-draft"></textarea><input id="latency-offset"><button id="held-key" class="pressed" aria-pressed="true"></button></body></html>');
  const $=id=>document.getElementById(id),mode=$('theme-mode');
  Object.defineProperty(mode,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  const counts={read:0,write:0,colors:0},listeners=new Set();
  const media={matches:dark,addEventListener(_name,listener){listeners.add(listener)},removeEventListener(_name,listener){listeners.delete(listener)},emit(value){this.matches=value;for(const listener of listeners)listener()}};
  const storage={value:stored,getItem(key){assert.equal(key,'worldmusichub.theme');counts.read++;if(readFailure)throw Error('read failed');return this.value},setItem(key,value){assert.equal(key,'worldmusichub.theme');counts.write++;if(writeFailure)throw Error('write failed');this.value=value}};
  const style=document.documentElement.style,setProperty=style.setProperty.bind(style);style.setProperty=(...args)=>{counts.colors++;setProperty(...args)};
  const i18n=shared?getAppI18n(document):createI18n({locale,onReport:report=>assert.fail(JSON.stringify(report))});
  const view=setupThemes({document,...(shared?{}:{i18n}),storage,matchMedia:()=>media});
  const destroy=view.destroy;view.destroy=()=>{destroy();assert.deepEqual(i18n.getReports(),[])};
  const event=(id,type)=>$(id).dispatchEvent(new window.Event(type));
  const snapshot=()=>({counts:{...counts},style:style.cssText,dataset:{...document.documentElement.dataset},mode:mode.value,accent:$('theme-accent').value,background:$('theme-background').value,stored:storage.value,customHidden:$('custom-theme-controls').hidden});
  return {document,window,$,i18n,view,storage,media,counts,event,snapshot,setWriteFailure(value){writeFailure=value}};
}

test('preference bundles have exact typed keys and selected-language stable-code coverage',()=>{
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());assert.deepEqual(Object.keys(en).sort(),Object.keys(schema).sort());
  for(const [locale,catalog] of [['en',en],['zh-CN',zh]]){
    const i18n=createI18n({locale,onReport:report=>assert.fail(JSON.stringify(report))});
    for(const key of Object.values(PRACTICE_SETTING_MESSAGE_KEYS))assert.equal(i18n.t(key),catalog[key]);assert.deepEqual(i18n.getReports(),[]);
  }
});

test('theme locale redraw only changes retained status and preserves draft controls, colors, focus and input state',()=>{
  const f=themeFixture({readFailure:true,dark:true});try{
    assert.equal(f.$('theme-storage-status').textContent,zh['preferences.theme.storageUnavailable']);
    const option=f.$('theme-mode').querySelector('option[value="custom"]');
    f.$('theme-mode').value='custom';f.$('theme-accent').value='#abcdef';f.$('theme-background').value='#123456';
    f.$('score-draft').value='<part id="source">原文 & notes</part>';f.$('latency-offset').value='-032';f.document.activeElement=f.$('theme-accent');
    const before=f.snapshot(),draft=f.$('score-draft'),held=f.$('held-key');
    for(const locale of ['en','zh-CN','en']){
      f.i18n.setLocale(locale);assert.deepEqual(f.snapshot(),before);assert.equal(f.document.activeElement,f.$('theme-accent'));
      assert.equal(f.$('theme-mode').querySelector('option[value="custom"]'),option);assert.equal(f.$('score-draft'),draft);assert.equal(draft.value,'<part id="source">原文 & notes</part>');assert.equal(f.$('latency-offset').value,'-032');assert.equal(f.$('held-key'),held);assert.equal(held.getAttribute('aria-pressed'),'true');assert.equal(held.className,'pressed');
      assert.equal(f.$('theme-storage-status').textContent,(locale==='en'?en:zh)['preferences.theme.storageUnavailable']);
    }
    f.event('theme-mode','change');assert.equal(f.counts.write,1);assert.deepEqual(JSON.parse(f.storage.value),{mode:'custom',accent:'#abcdef',background:'#123456'});assert.equal(f.$('theme-storage-status').hidden,true);
  }finally{f.view.destroy()}
});

test('theme save failures translate in place and only explicit successful save clears the retained warning',()=>{
  const f=themeFixture({writeFailure:true});try{
    f.$('theme-mode').value='dark';f.event('theme-mode','change');
    assert.equal(f.$('theme-storage-status').textContent,zh['preferences.theme.unsaved']);const before=f.snapshot();
    f.i18n.setLocale('en');assert.deepEqual(f.snapshot(),before);assert.equal(f.$('theme-storage-status').textContent,en['preferences.theme.unsaved']);
    f.setWriteFailure(false);f.i18n.invalidate();assert.equal(f.counts.write,1);assert.equal(f.$('theme-storage-status').hidden,false);
    f.event('theme-mode','change');assert.equal(f.counts.write,2);assert.equal(f.$('theme-storage-status').hidden,true);assert.equal(f.$('theme-storage-status').textContent,'');
    const saved=f.snapshot();f.i18n.setLocale('zh-CN');assert.deepEqual(f.snapshot(),saved);assert.equal(f.$('theme-storage-status').hidden,true);
  }finally{f.view.destroy()}
});

test('invalid theme restoration reports exactly substituted colors and never repairs storage on locale changes',()=>{
  for(const [stored,key,params] of [
    ['{broken','preferences.theme.unreadable',{}],
    ['{"mode":"future"}','preferences.theme.invalid',{}],
    ['{"mode":"custom","accent":"green","background":"#121212"}','preferences.theme.accentInvalid',{accent:'#326b4c'}],
    ['{"mode":"custom","accent":"#ab1245"}','preferences.theme.backgroundInvalid',{background:'#f4f6f1'}],
    ['{"mode":"custom","accent":"<script>bad</script>","background":null}','preferences.theme.colorsInvalid',{accent:'#326b4c',background:'#f4f6f1'}],
  ]){
    const f=themeFixture({stored});try{
      assert.equal(f.$('theme-storage-status').textContent,f.i18n.t(key,params));const before=f.snapshot();
      f.i18n.setLocale('en');assert.deepEqual(f.snapshot(),before);assert.equal(f.storage.value,stored);assert.equal(f.counts.write,0);assert.equal(f.$('theme-storage-status').textContent,f.i18n.t(key,params));assert.equal(f.$('theme-storage-status').querySelector('script'),null);
    }finally{f.view.destroy()}
  }
});

test('themes default to the document shared Chinese service and destruction detaches locale and control handlers',()=>{
  const f=themeFixture({shared:true,readFailure:true});
  assert.equal(f.i18n.locale,'zh-CN');assert.equal(f.$('theme-storage-status').textContent,zh['preferences.theme.storageUnavailable']);
  getAppI18n(f.document).setLocale('en');assert.equal(f.$('theme-storage-status').textContent,en['preferences.theme.storageUnavailable']);
  f.view.destroy();const before=f.snapshot(),message=f.$('theme-storage-status').textContent;f.i18n.setLocale('zh-CN');f.event('theme-mode','change');f.media.emit(true);assert.deepEqual(f.snapshot(),before);assert.equal(f.$('theme-storage-status').textContent,message);
});

test('an unavailable theme storage accessor is reported without preventing tab-local theme changes',()=>{
  const f=themeFixture();f.view.destroy();
  const i18n=createI18n({onReport:report=>assert.fail(JSON.stringify(report))});let accesses=0;
  const view=setupThemes({document:f.document,i18n,storage:()=>{accesses++;throw Error('storage access denied')},matchMedia:()=>f.media});
  try{
    assert.equal(f.$('theme-storage-status').textContent,zh['preferences.theme.storageUnavailable']);assert.equal(accesses,1);
    f.$('theme-mode').value='dark';f.event('theme-mode','change');assert.equal(f.document.documentElement.dataset.theme,'dark');assert.equal(f.$('theme-storage-status').textContent,zh['preferences.theme.unsaved']);assert.equal(accesses,2);
    i18n.setLocale('en');assert.equal(accesses,2);assert.equal(f.$('theme-storage-status').textContent,en['preferences.theme.unsaved']);assert.deepEqual(i18n.getReports(),[]);
  }finally{view.destroy()}
});

test('latency preference descriptors retain exact legacy messages and numeric serialization through errors and retry',()=>{
  const read=stored=>readLatencyPreference({storage:{getItem:()=>stored}});
  assert.deepEqual(read(null),{value:0,message:''});assert.deepEqual(read('"-040"'),{value:-40,message:''});
  for(const stored of ['true','[140]','null','""','{broken','501'])assert.deepEqual(read(stored),{value:0,code:'latency_preference_invalid',message:'Saved latency was invalid and was not applied. Offset starts at 0 ms; enter a reviewed value to replace it.'});
  const denied=()=>{throw Error('private storage failure')};
  assert.deepEqual(readLatencyPreference({storage:denied}),{value:0,code:'latency_storage_read_failed',message:'Latency starts at 0 ms. Browser storage is unavailable; changes apply to this tab.'});
  assert.equal(loadLatency({storage:{getItem:()=>'-500'}}),-500);
  const writes=[],storage={setItem:(...args)=>writes.push(args)};
  assert.deepEqual(writeLatencyPreference('-0040',{storage}),{saved:true,message:''});assert.deepEqual(writes,[['worldmusichub.latency','-40']]);
  assert.equal(writeLatencyPreference([40],{storage}).code,'latency_offset_invalid');assert.equal(writes.length,1);
  const failure=writeLatencyPreference(500,{storage:denied});assert.equal(failure.saved,false);assert.equal(failure.code,'latency_storage_write_failed');assert.equal(saveLatency(500,{storage:denied}),false);assert.equal(saveLatency('500',{storage}),true);assert.deepEqual(writes.at(-1),['worldmusichub.latency','500']);
  const i18n=createI18n({onReport:report=>assert.fail(JSON.stringify(report))});const original=structuredClone(failure);
  assert.equal(i18n.t(PRACTICE_SETTING_MESSAGE_KEYS[failure.code]),zh['preferences.latency.unsaved']);i18n.setLocale('en');assert.equal(i18n.t(PRACTICE_SETTING_MESSAGE_KEYS[failure.code]),en['preferences.latency.unsaved']);assert.deepEqual(failure,original);
});

test('practice parsing emits stable codes without changing diagnostic messages, rational values or compensation',()=>{
  for(const value of ['-1','1e5','word','1.1234567',''])assert.throws(()=>parseBeatInput(value),{code:'practice_beat_syntax',message:'Use a non-negative beat number such as 0, 4, 1.5 or 3/2.'});
  for(const value of ['1/0','1000000001','1/1000001'])assert.throws(()=>parseBeatInput(value),{code:'practice_beat_range',message:'Beat value is outside the supported rational range.'});
  assert.deepEqual(parseBeatInput(' 6/4 '),{numerator:6,denominator:4});assert.deepEqual(parseBeatInput('1.250'),{numerator:1250,denominator:1000});assert.deepEqual(parseBeatInput('0.000001'),{numerator:1,denominator:1000000});
  assert.throws(()=>compensateInput(10,501),{code:'latency_input_invalid',message:'Input time and latency offset must be finite; offset must be a whole number from −500 to 500 ms.'});assert.equal(compensateInput(10,20),-10);assert.equal(compensateInput(10,'-020'),30);
});

test('basic staff switches only owned labels, retains exact source data and preserves musical SVG geometry',()=>{
  const score=structuredClone(scoreFixture);score.parts[0].name='Original 原名 <script>x</script> & "Piano"';score.parts[0].notes[0].id='source" onload="bad & 原文';
  const before=structuredClone(score),i18n=createI18n({onReport:report=>assert.fail(JSON.stringify(report))});
  const chinese=renderNotation(score,'staff',{i18n,width:288,spanBeats:4});i18n.setLocale('en');const english=renderNotation(score,'staff',{i18n,width:288,spanBeats:4});
  assert.equal(chinese.replace(zh['notation.basicStaffAria'],en['notation.basicStaffAria']),english);
  for(const [svgText,label] of [[chinese,zh['notation.basicStaffAria']],[english,en['notation.basicStaffAria']]]){
    const svg=parseHTML(svgText).document.querySelector('svg');assert.equal(svg.getAttribute('aria-label'),label);assert.equal(svg.querySelector('.part-name').textContent,score.parts[0].name);assert.equal(svg.querySelector('.score-note').dataset.noteId,score.parts[0].notes[0].id);assert.equal(svg.querySelector('script'),null);assert.equal(svg.querySelector('[onload]'),null);
  }
  assert.deepEqual(score,before);
  const {document}=parseHTML('<html></html>');assert.match(renderNotation(score,'staff',{document}),/aria-label="基础高音谱表音高视图"/);getAppI18n(document).setLocale('en');assert.match(renderNotation(score,'staff',{document}),/aria-label="Basic treble staff pitch view"/);
});

test('basic staff safely escapes generated translations and localizes the dense-page disclosure without dropping source notes',()=>{
  const score=structuredClone(scoreFixture);score.parts[0].notes=Array.from({length:1001},(_,index)=>({...score.parts[0].notes[0],id:`source-${index}`}));const before=structuredClone(score);
  const i18n=createI18n({onReport:report=>assert.fail(JSON.stringify(report))});
  for(const locale of ['zh-CN','en']){i18n.setLocale(locale);const svg=parseHTML(renderNotation(score,'staff',{i18n})).document.querySelector('svg');assert.equal(svg.querySelectorAll('.score-note').length,1000);assert.equal(svg.lastElementChild.textContent,i18n.t('notation.eventLimit'));}
  const literal='" onload="bad"><script>bad()</script>& 原文';
  const svg=parseHTML(renderNotation(score,'staff',{i18n:{t:()=>literal}})).document.querySelector('svg');assert.equal(svg.getAttribute('aria-label'),literal);assert.equal(svg.lastElementChild.textContent,literal);assert.equal(svg.querySelector('script'),null);assert.equal(svg.querySelector('[onload]'),null);assert.deepEqual(score,before);
});
