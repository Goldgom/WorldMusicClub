import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createI18n, MESSAGE_SCHEMA, LOCALE_CATALOGS} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import {SCORE_SOURCES, filterScoreSources, setupSourceDirectory, unsupportedImportHint} from '../web/score-sources.js';
import en from '../web/locales/source-directory-en.js';
import zhCN from '../web/locales/source-directory-zh-CN.js';
import schema from '../web/locales/source-directory-schema.js';

function fixture({locale='zh-CN',shared=false,transform}={}) {
  const {document,window}=parseHTML('<html><body><button id="source-directory-button"></button><button id="mobile-sources-button"></button><input id="unrelated-draft" value="原始 / 1/3"></body></html>');
  const reports=[],base=shared?getAppI18n(document):createI18n({locale,onReport:report=>reports.push(report)});
  const i18n=transform?{t:(key,params)=>transform(key,base.t(key,params)),subscribe:base.subscribe}:base;
  const counts={pause:0,score:0,image:0,external:0,open:0,close:0,fetch:0};
  window.fetch=()=>{counts.fetch++;throw new Error('A local directory must not fetch')};
  const view=setupSourceDirectory({document,...(shared?{}:{i18n}),pausePlayback:()=>counts.pause++,onScoreFile:()=>counts.score++,onImageFile:()=>counts.image++,onExternalOmr:()=>counts.external++});
  const $=id=>document.getElementById(id),dialog=$('score-source-directory'),route=$('source-route');
  // Linkedom does not implement browser modal/focus behavior or select setters.
  dialog.showModal=()=>{counts.open++;dialog.open=true;dialog.setAttribute('open','')};
  dialog.close=()=>{counts.close++;dialog.open=false;dialog.removeAttribute('open')};
  Object.defineProperty(route,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value??''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===value)}});
  return {document,window,base,i18n,reports,counts,view,dialog,$};
}
const visibleIds=f=>[...f.$('source-cards').children].filter(card=>!card.hidden).map(card=>card.getAttribute('data-source-id'));

test('source directory catalogs are frozen, complete and integrated with the shared schema',()=>{
  const keys=Object.keys(schema).sort();assert.equal(keys.length,54);
  for(const [locale,catalog]of [['en',en],['zh-CN',zhCN]]){
    assert.ok(Object.isFrozen(catalog));assert.deepEqual(Object.keys(catalog).sort(),keys);
    for(const key of keys){assert.equal(LOCALE_CATALOGS[locale][key],catalog[key]);assert.deepEqual(MESSAGE_SCHEMA[key],schema[key]);assert.ok(Object.isFrozen(schema[key]));assert.ok(Object.isFrozen(schema[key].params))}
  }
  assert.ok(Object.isFrozen(schema));assert.deepEqual(schema['sourceDirectory.resultCount'].params,{count:'count',total:'count'});
});

test('source directory defaults to the document locale and translates all owned text in both locales',()=>{
  const f=fixture({shared:true});
  try {
    assert.equal(f.base.locale,'zh-CN');assert.equal(f.$('source-directory-title').textContent,'几个找谱的起点。');
    for(const locale of ['en','zh-CN']){
      f.base.setLocale(locale);const messages=locale==='en'?en:zhCN;
      for(const node of f.dialog.querySelectorAll('[data-source-text]'))assert.equal(node.textContent,messages[`sourceDirectory.${node.getAttribute('data-source-text')}`]);
      assert.equal(f.$('source-directory-close').getAttribute('aria-label'),messages['sourceDirectory.closeAria']);
      assert.equal(f.$('source-search').getAttribute('placeholder'),messages['sourceDirectory.searchPlaceholder']);
      assert.equal(f.$('source-result-count').textContent,f.base.t('sourceDirectory.resultCount',{count:3,total:3}));
      for(const source of SCORE_SOURCES){
        const card=f.dialog.querySelector(`[data-source-id="${source.id}"]`),paragraphs=card.querySelectorAll('p');
        assert.equal(card.querySelector('.source-category').textContent,messages[`sourceDirectory.${source.id}.category`]);
        assert.equal(paragraphs[0].textContent,messages[`sourceDirectory.${source.id}.formats`]);
        assert.equal(paragraphs[1].textContent,messages[`sourceDirectory.${source.id}.description`]);
        assert.equal(paragraphs[2].textContent,messages['sourceDirectory.rightsLabel']+messages[`sourceDirectory.${source.id}.rights`]);
        assert.equal(paragraphs[3].textContent,messages['sourceDirectory.importLabel']+messages[`sourceDirectory.${source.id}.importNote`]);
        assert.equal(card.querySelectorAll('a')[1].textContent,messages[`sourceDirectory.${source.id}.rightsLink`]);
      }
      assert.doesNotMatch(f.dialog.textContent,/找谱与核对|Rights check ·|Import route ·|All three sources ·/);
    }
    assert.deepEqual(f.base.getReports(),[]);
  }finally{f.view.destroy()}
});

test('open-directory locale changes retain controls, focus, links, filters, drafts and source records without side effects',()=>{
  const f=fixture(),original=JSON.stringify(SCORE_SOURCES);
  try {
    f.$('source-directory-button').click();
    const search=f.$('source-search'),route=f.$('source-route'),draft=f.$('unrelated-draft');
    search.value='ＭＩＤＩ';search.dispatchEvent(new f.window.Event('input'));
    route.value='image';route.dispatchEvent(new f.window.Event('change'));
    draft.value='<原始 draft & 11/7>';search.selectionStart=2;search.selectionEnd=4;
    const controls=[search,route,...route.children,...f.dialog.querySelectorAll('button')],cards=[...f.$('source-cards').children],links=[...f.dialog.querySelectorAll('a')];
    const focused=links[0];f.document.activeElement=focused;f.dialog.scrollTop=140;
    const before={...f.counts},visible=visibleIds(f);
    assert.deepEqual(visible,['openscore-lieder','mutopia']);
    for(const locale of ['en','zh-CN','en']){
      f.base.setLocale(locale);
      assert.equal(f.dialog.open,true);assert.equal(f.document.activeElement,focused);assert.equal(f.dialog.scrollTop,140);
      assert.deepEqual([f.$('source-search'),f.$('source-route'),...route.children,...f.dialog.querySelectorAll('button')],controls);
      assert.deepEqual([...f.$('source-cards').children],cards);assert.deepEqual([...f.dialog.querySelectorAll('a')],links);
      assert.equal(search.value,'ＭＩＤＩ');assert.equal(route.value,'image');assert.equal(draft.value,'<原始 draft & 11/7>');
      assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,4);assert.deepEqual(visibleIds(f),visible);
      assert.equal(f.$('source-result-count').textContent,f.base.t('sourceDirectory.resultCount',{count:2,total:3}));
      assert.deepEqual(f.counts,before);assert.equal(JSON.stringify(SCORE_SOURCES),original);
    }
    // Locale display updates must not submit a changed-but-undispatched filter draft.
    search.value='private unsent search';route.value='musicxml';f.base.setLocale('zh-CN');
    assert.deepEqual(visibleIds(f),visible);assert.equal(search.value,'private unsent search');assert.equal(route.value,'musicxml');
    search.dispatchEvent(new f.window.Event('input'));assert.deepEqual(visibleIds(f),[]);assert.equal(f.$('source-empty').hidden,false);
    f.base.setLocale('en');assert.equal(f.$('source-empty').textContent,en['sourceDirectory.empty']);
    assert.deepEqual(f.reports,[]);
  }finally{f.view.destroy()}
});

test('local source filters retain original bilingual search semantics and stable route values across locales',()=>{
  const f=fixture();
  try {
    const search=f.$('source-search'),route=f.$('source-route'),cards=[...f.$('source-cards').children];
    for(const locale of ['zh-CN','en']){
      f.base.setLocale(locale);
      assert.deepEqual([...route.children].map(option=>option.value),['all','musicxml','midi','image']);
      for(const [query,value]of [['艺术歌曲','all'],['cc BY-SA','all'],['ＭＩＤＩ','all'],['PDF','image'],['','musicxml'],['not a source','midi'],['','all']]){
        search.value=query;route.value=value;search.dispatchEvent(new f.window.Event('input'));
        assert.deepEqual(visibleIds(f),filterScoreSources(query,value).map(source=>source.id));
        assert.deepEqual([...f.$('source-cards').children],cards);
      }
    }
    assert.deepEqual(f.counts,{pause:0,score:0,image:0,external:0,open:0,close:0,fetch:0});assert.deepEqual(f.reports,[]);
  }finally{f.view.destroy()}
});

test('directory display text stays literal and complete while names, source IDs and official links stay untouched',()=>{
  const prefix='<img src=x onerror="bad()"> & 原文 '+ '很长的说明 '.repeat(80),f=fixture({transform:(_key,text)=>prefix+text});
  try {
    const title=f.$('source-directory-title'),cards=[...f.$('source-cards').children];
    for(const locale of ['zh-CN','en']){
      f.base.setLocale(locale);
      assert.equal(title.textContent,prefix+(locale==='en'?en:zhCN)['sourceDirectory.title']);assert.equal(title.querySelector('img'),null);
      assert.equal(f.dialog.querySelector('img'),null);assert.equal(f.dialog.querySelector('script'),null);
      for(const [index,source]of SCORE_SOURCES.entries()){
        const card=cards[index],links=card.querySelectorAll('a');
        assert.equal(card.getAttribute('data-source-id'),source.id);assert.equal(card.querySelector('h3').textContent,source.name);
        assert.equal(links[0].getAttribute('href'),source.url);assert.equal(links[1].getAttribute('href'),source.rightsUrl);
        for(const link of links){assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.querySelector('img'),null)}
      }
      assert.equal(f.$('source-search').getAttribute('placeholder'),prefix+(locale==='en'?en:zhCN)['sourceDirectory.searchPlaceholder']);
    }
    assert.deepEqual(f.reports,[]);
  }finally{f.view.destroy()}
});

test('directory actions preserve handlers after locale changes and destroy removes subscriptions and listeners',()=>{
  const f=fixture();
  f.base.setLocale('en');f.$('mobile-sources-button').click();f.$('source-choose-score').click();
  f.base.setLocale('zh-CN');f.$('source-directory-button').click();f.$('source-choose-image').click();
  f.$('source-directory-button').click();f.base.setLocale('en');f.$('source-review-external').click();
  f.$('source-directory-button').click();f.$('source-directory-close').click();
  f.$('source-directory-button').click();f.$('source-directory-done').click();
  assert.deepEqual(f.counts,{pause:5,score:1,image:1,external:1,open:5,close:5,fetch:0});
  const title=f.$('source-directory-title'),lastText=title.textContent;f.view.destroy();
  f.base.setLocale('zh-CN');f.$('source-directory-button').click();f.$('mobile-sources-button').click();
  assert.equal(title.textContent,lastText);assert.equal(f.$('score-source-directory'),null);assert.equal(f.counts.pause,5);assert.deepEqual(f.reports,[]);
});

test('unsupported import hints use the selected shared or explicit locale without changing filenames or format support',()=>{
  const reports=[],i18n=createI18n({onReport:report=>reports.push(report)}),names=[['scan.PDF','pdf'],['原始.mscx','musescore'],['score.MSCZ','musescore'],['source.ly','lilypond'],['source.ILY','lilypond'],['<image>.png','image'],['staff.jpeg','image'],['staff.JPG','image']];
  for(const locale of ['zh-CN','en']){
    i18n.setLocale(locale);const catalog=locale==='en'?en:zhCN;
    for(const [filename,key]of names)assert.equal(unsupportedImportHint(filename,i18n),catalog[`sourceDirectory.unsupported.${key}`]);
    for(const filename of ['score.json','score.musicxml','score.mxl','score.mid','score.jianpu','scan.pdf.zip'])assert.equal(unsupportedImportHint(filename,i18n),null);
  }
  const previous=globalThis.document,{document}=parseHTML('<html><body></body></html>');
  try {
    globalThis.document=document;const shared=getAppI18n(document);
    assert.equal(unsupportedImportHint('scan.pdf'),zhCN['sourceDirectory.unsupported.pdf']);shared.setLocale('en');
    assert.equal(unsupportedImportHint('scan.pdf'),en['sourceDirectory.unsupported.pdf']);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
  assert.deepEqual(reports,[]);
});
