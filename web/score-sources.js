import {getAppI18n} from './app-locale.js';

/** Small editorial directory, checked against these official pages on 2026-09-30. */
export const SCORE_SOURCES = Object.freeze([
  {id:'openscore-lieder',name:'OpenScore / Lieder',category:'Art songs · 艺术歌曲',url:'https://github.com/OpenScore/Lieder',rightsUrl:'https://github.com/OpenScore/Lieder/blob/main/LICENSE.txt',rightsLabel:'Repository CC0 license',formats:'MSCX source · MusicXML / MIDI / PDF export routes',routes:['musicxml','midi','image'],description:'The repository publishes CC0 score editions in MuseScore’s MSCX format. Its README describes individual exports and conversion with MuseScore.',rights:'Check the exact edition and retain the supplied credits. CC0 applies to the published corpus editions; the project asks for acknowledgment.',importNote:'WorldMusicHub does not import MSCX or MSCZ. Obtain a MusicXML/MXL export using an appropriate editor or the linked score page, then review the result. Export availability is not guaranteed.',keywords:'openscore lieder cc0 mscx mscz musescore voice vocal 艺术歌曲 声乐'},
  {id:'mutopia',name:'Mutopia Project',category:'Typeset editions · 排印乐谱',url:'https://www.mutopiaproject.org/',rightsUrl:'https://www.mutopiaproject.org/legal.html',rightsLabel:'Mutopia licensing guide',formats:'PDF · MIDI · LilyPond source',routes:['midi','image'],description:'A directory of typeset scores with PDF, MIDI and editable LilyPond files. Each piece lists its own license.',rights:'Check that piece’s public-domain dedication, CC BY or CC BY-SA terms and version. Keep attribution and any applicable share-alike requirements with the edition.',importNote:'MIDI may enter the bounded importer, but notation is inferred. PDF needs image/OMR review; LilyPond (.ly) is not imported directly. Some musical features may be rejected.',keywords:'mutopia pdf midi lilypond ly public domain cc by cc by-sa 公版 钢琴 吉他'},
  {id:'imslp',name:'IMSLP / Petrucci Music Library',category:'Score editions & scans · 乐谱版本与扫描',url:'https://imslp.org/wiki/Main_Page',rightsUrl:'https://imslp.org/wiki/IMSLP:Copyright_Made_Simple',rightsLabel:'IMSLP copyright guide',formats:'Primarily PDF editions and scans',routes:['image'],description:'A starting point for finding score editions and scans. A composer or work page can contain several different editions.',rights:'Check the exact file, editor, publication and your country. The site’s availability or a public-domain composition does not establish that every edition is usable everywhere.',importNote:'A PDF is not a playable score in this app. Export a suitable page or staff crop locally as PNG/JPEG, review uncertain recognition, and confirm every note. Complex pages need a suitable external workflow.',keywords:'imslp petrucci pdf scans editions copyright 公版 扫描 版本 总谱'}
].map(source=>Object.freeze({...source,routes:Object.freeze(source.routes)})));
export function filterScoreSources(query='',route='all') {
  const terms=String(query).normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SCORE_SOURCES.filter(source=>(route==='all'||source.routes.includes(route))&&terms.every(term=>`${source.name} ${source.category} ${source.formats} ${source.keywords}`.normalize('NFKC').toLowerCase().includes(term)));
}
/** Display copy is selected by stable format; original filenames are never rewritten. */
export function unsupportedImportHint(filename, i18n=getAppI18n()) {
  if(/\.pdf$/i.test(filename))return i18n.t('sourceDirectory.unsupported.pdf');
  if(/\.(mscx|mscz)$/i.test(filename))return i18n.t('sourceDirectory.unsupported.musescore');
  if(/\.(ly|ily)$/i.test(filename))return i18n.t('sourceDirectory.unsupported.lilypond');
  if(/\.(png|jpe?g)$/i.test(filename))return i18n.t('sourceDirectory.unsupported.image');
  return null;
}

export function setupSourceDirectory({document=globalThis.document,i18n=getAppI18n(document),pausePlayback,onScoreFile,onImageFile,onExternalOmr}) {
  const $=id=>document.getElementById(id),dialog=document.createElement('dialog');
  dialog.id='score-source-directory';dialog.className='review-dialog source-directory';dialog.setAttribute('aria-labelledby','source-directory-title');dialog.style.overflowWrap='anywhere';
  // Only fixed application markup enters this sink. All display text uses textContent.
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow" data-source-text="eyebrow"></span><h2 id="source-directory-title" data-source-text="title"></h2></div><button id="source-directory-close" class="button ghost">✕</button></div>
    <p class="review-explanation" data-source-text="explanation"></p>
    <div class="source-filters"><label for="source-search"><span data-source-text="search"></span><input id="source-search" type="search" maxlength="100" autocomplete="off"></label><label for="source-route"><span data-source-text="route"></span><select id="source-route"><option value="all" selected data-source-text="route.all"></option><option value="musicxml" data-source-text="route.musicxml"></option><option value="midi" data-source-text="route.midi"></option><option value="image" data-source-text="route.image"></option></select></label></div><p id="source-result-count" class="source-result-count" role="status"></p><div id="source-cards" class="source-cards"></div><p id="source-empty" class="review-explanation" data-source-text="empty" hidden></p>
    <section class="source-checklist" aria-labelledby="source-checklist-title"><h3 id="source-checklist-title" data-source-text="checklist"></h3><ol><li><strong data-source-text="checklist.rights.title"></strong><span data-source-text="checklist.rights.body"></span></li><li><strong data-source-text="checklist.original.title"></strong><span data-source-text="checklist.original.body"></span></li><li><strong data-source-text="checklist.route.title"></strong><span data-source-text="checklist.route.body"></span></li><li><strong data-source-text="checklist.review.title"></strong><span data-source-text="checklist.review.body"></span></li><li><strong data-source-text="checklist.archive.title"></strong><span data-source-text="checklist.archive.body"></span></li></ol></section>
    <p class="source-reviewed" data-source-text="reviewed"></p><div class="review-actions"><button id="source-directory-done" class="button secondary" data-source-text="close"></button><button id="source-review-external" class="button secondary" data-source-text="externalOmr"></button><button id="source-choose-image" class="button secondary" data-source-text="chooseImage"></button><button id="source-choose-score" class="button primary" data-source-text="chooseScore"></button></div>`;
  document.body.append(dialog);
  const bindings=[...dialog.querySelectorAll('[data-source-text]')].map(node=>({node,key:`sourceDirectory.${node.getAttribute('data-source-text')}`}));
  const bind=(node,key)=>bindings.push({node,key:`sourceDirectory.${key}`});
  const cards=new Map();
  let resultCount=SCORE_SOURCES.length;
  // Build each card once. Filtering and locale changes retain cards, links and focus.
  for(const source of SCORE_SOURCES){
    const card=document.createElement('article');card.className='source-card';card.setAttribute('data-source-id',source.id);
    const heading=document.createElement('h3');heading.textContent=source.name;
    const category=document.createElement('span');category.className='source-category';bind(category,`${source.id}.category`);
    const formats=document.createElement('p');formats.className='source-formats';bind(formats,`${source.id}.formats`);card.append(category,heading,formats);
    for(const [label,field]of [[null,'description'],['rightsLabel','rights'],['importLabel','importNote']]){
      const paragraph=document.createElement('p');
      if(label){const strong=document.createElement('strong');bind(strong,label);paragraph.append(strong)}
      const content=document.createElement('span');bind(content,`${source.id}.${field}`);paragraph.append(content);card.append(paragraph);
    }
    const links=document.createElement('div');links.className='source-card-links';
    for(const [key,url]of [['visit',source.url],[`${source.id}.rightsLink`,source.rightsUrl]]){
      const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';bind(link,key);links.append(link);
    }
    card.append(links);$('source-cards').append(card);cards.set(source.id,card);
  }
  function renderCount(){
    $('source-result-count').textContent=i18n.t('sourceDirectory.resultCount',{count:resultCount,total:SCORE_SOURCES.length});
    $('source-empty').hidden=resultCount>0;
  }
  function applyFilters(){
    const visible=new Set(filterScoreSources($('source-search').value,$('source-route').value).map(source=>source.id));
    resultCount=visible.size;
    for(const [id,card]of cards)card.hidden=!visible.has(id);
    renderCount();
  }
  function renderDisplay(){
    for(const button of dialog.querySelectorAll('button')){button.style.whiteSpace='normal';button.style.maxWidth='100%'}
    for(const {node,key}of bindings)node.textContent=i18n.t(key);
    $('source-directory-close').setAttribute('aria-label',i18n.t('sourceDirectory.closeAria'));
    $('source-search').setAttribute('placeholder',i18n.t('sourceDirectory.searchPlaceholder'));
    renderCount();
  }
  function close(){dialog.close()}
  const listeners=[];
  function listen(node,type,handler){node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener(type,handler))}
  for(const id of ['source-directory-button','mobile-sources-button'])listen($(id),'click',()=>{pausePlayback();applyFilters();dialog.showModal()});
  for(const id of ['source-directory-close','source-directory-done'])listen($(id),'click',close);
  listen($('source-search'),'input',applyFilters);listen($('source-route'),'change',applyFilters);
  listen($('source-review-external'),'click',()=>{close();onExternalOmr()});
  listen($('source-choose-score'),'click',()=>{close();onScoreFile()});listen($('source-choose-image'),'click',()=>{close();onImageFile()});
  renderDisplay();applyFilters();
  const unsubscribe=i18n.subscribe(renderDisplay);
  return{close,destroy(){unsubscribe();for(const remove of listeners)remove();dialog.remove()}};
}
