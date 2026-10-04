import {setupRhythmShell} from './rhythm-shell.js';
import {setupFullscreen} from './fullscreen.js';
import {getAppI18n} from './app-locale.js';
import {setupLocaleView} from './locale-view.js';

/** One persistent set of controls, moved into accessible secondary surfaces. */
export function setupGameShell({pausePlayback,onScreen,onNotation,onPanel=()=>{},i18n=getAppI18n()}) {
  const $=id=>document.getElementById(id),root=document.querySelector('.app-shell'),stage=$('workspace'),sidebar=document.querySelector('.sidebar');
  const localeView=setupLocaleView({document,i18n});
  const header=document.createElement('header');header.className='shell-header';
  header.innerHTML='<div id="shell-brand"></div><nav data-i18n-aria-label="nav.sessionTools" aria-label="演奏工具"><button id="library-button-slot" hidden></button><button id="import-tools-button" class="button secondary" aria-haspopup="dialog" data-i18n="nav.import">导入</button><button id="score-tools-button" class="button secondary" aria-haspopup="dialog" data-i18n="nav.score">乐谱与来源</button><button id="settings-button" class="button secondary" aria-haspopup="dialog" data-i18n="nav.settings">设置</button><button id="results-button" class="button secondary" aria-haspopup="dialog">结果</button></nav>';
  const lobby=document.createElement('section');lobby.id='song-lobby';lobby.setAttribute('aria-labelledby','lobby-title');
  lobby.innerHTML=`<div class="lobby-heading"><div><span class="eyebrow" data-i18n="shell.selectScore">选择乐谱</span><h1 id="lobby-title" tabindex="-1" data-i18n="nav.library">曲库</h1></div><button id="start-free-practice" type="button" class="button primary" data-i18n="free.title" aria-controls="free-practice-screen">自由练习</button><button id="resume-session" class="button secondary" data-i18n="nav.resumeSession" hidden>返回演奏</button></div>
    <div class="lobby-grid"><section class="song-browser" data-i18n-aria-label="shell.bundledList" aria-label="附带乐谱列表"><div class="song-filters"><label data-i18n="shell.search">搜索乐谱<input id="catalog-search" type="search" data-i18n-placeholder="shell.searchPlaceholder" placeholder="曲名或作曲者" maxlength="160"></label><label data-i18n="shell.edition">版本<select id="catalog-origin"><option value="all" data-i18n="shell.allEditions">所有版本</option><option value="original" data-i18n="shell.originalEditions">原创练习</option><option value="edition" data-i18n="shell.sourceEditions">来源版本</option></select></label></div><div id="lobby-catalog"></div></section>
    <section class="song-preview" aria-labelledby="preview-title"><div class="preview-art" aria-hidden="true"><span>♪</span><i></i><i></i><i></i></div><div class="preview-copy"><span class="eyebrow" data-i18n="shell.selectedScore">所选乐谱</span><h2 id="preview-title" data-i18n="shell.chooseScore">选择第一首乐谱</h2><p id="preview-meta" data-i18n="shell.previewMeta">浏览列表或导入本地乐谱。</p><p id="preview-status" role="status" data-i18n="shell.previewStatus">浏览不会更改当前演奏会话。</p><label id="preview-part-label" hidden data-i18n="shell.targetPart">目标声部<select id="preview-part"><option value="" data-i18n="shell.allParts">所有声部</option></select></label><p id="preview-gate" role="status"></p><details id="preview-notices" hidden><summary id="preview-notices-title" data-i18n="shell.notices">来源与准备提示</summary><ul id="preview-notice-list"></ul><p data-i18n="shell.noticesHelp">启用后，可在“乐谱与来源”中查看完整提示。</p></details><div class="preview-actions"><button id="start-listen" class="button secondary" disabled data-i18n="shell.startListen">▶ 开始聆听</button><button id="start-practice" class="button primary" disabled data-i18n="shell.startPractice">▶ 开始练习</button></div><p class="preview-footnote" data-i18n="shell.previewFootnote">浏览会保留暂停的演奏记录。</p><button id="preview-setup" class="button ghost" data-i18n="shell.instrumentSetup">乐器设置</button></div></section></div>`;
  root.prepend(header,lobby);lobby.setAttribute('role','main');
  const skip=document.querySelector('.skip-link');skip.href='#lobby-title';skip.removeAttribute('data-i18n');
  $('shell-brand').append(sidebar.querySelector('.brand'));$('library-button-slot').replaceWith($('library-button'));
  const fullscreenTools=document.createElement('div');fullscreenTools.className='fullscreen-tools';fullscreenTools.innerHTML='<button id="fullscreen-button" type="button" class="button secondary" aria-describedby="fullscreen-status"></button><span id="fullscreen-status" role="status" aria-live="polite" class="fullscreen-status"></span>';header.querySelector('nav').append(fullscreenTools);
  const fullscreen=setupFullscreen({button:$('fullscreen-button'),status:$('fullscreen-status'),i18n});
  for(const selector of ['.library-heading','#catalog-status','#catalog'])$('lobby-catalog').append(sidebar.querySelector(selector));
  const dialogs=new Map();let screen='home',notation=false,notationChosen=false,current={};
  function dialog(name,titleKey,nodes) {
    const el=document.createElement('dialog');el.id=`${name}-dialog`;el.className='shell-dialog';el.setAttribute('aria-labelledby',`${name}-title`);
    const heading=document.createElement('header');heading.className='shell-dialog-heading';
    const h=document.createElement('h2');h.id=`${name}-title`;h.setAttribute('data-i18n',titleKey);h.textContent=i18n.t(titleKey);
    const close=document.createElement('button');close.className='button secondary';close.dataset.closePanel=name;close.setAttribute('data-i18n','common.close');close.textContent=i18n.t('common.close');heading.append(h,close);el.append(heading);
    const content=document.createElement('div');content.className='shell-dialog-content';for(const node of nodes)if(node)content.append(node);el.append(content);document.body.append(el);dialogs.set(name,el);
    // Native dialog closing restores its opener. A queued close handler must not
    // refocus the opener after the user has already moved to another control.
    close.addEventListener('click',()=>el.close());return el;
  }
  const piece=document.querySelector('.piece-panel');
  const scoreSettings=[piece.querySelector('.control-grid'),$('instrument-settings'),document.querySelector('.practice-target-row'),$('physical-target-note'),document.querySelector('.practice-options')];
  const settings=dialog('settings','shell.dialog.settings',[...scoreSettings,sidebar.querySelector('.theme-settings'),$('midi-help')]);
  const language=document.createElement('div');language.className='language-settings';
  language.innerHTML='<label data-i18n="settings.language">界面语言<select id="interface-language" data-i18n-aria-label="settings.language" aria-label="界面语言"><option value="zh-CN" data-i18n="settings.chinese">简体中文</option><option value="en" data-i18n="settings.english">英语</option></select></label><p id="locale-storage-status" class="settings-storage-status" role="status" hidden></p>';
  settings.querySelector('.shell-dialog-content').prepend(language);
  dialog('score-tools','shell.dialog.score',[piece,$('score-details'),$('engraving-license-note')]);
  const importDialog=dialog('import-tools','shell.dialog.import',[sidebar.querySelector('.import-box'),sidebar.querySelector('.wanted-tracks'),document.querySelector('.mobile-import')]);
  const importNotice=document.createElement('p');importNotice.className='notice';importNotice.setAttribute('data-i18n','shell.importNotice');importNotice.textContent=i18n.t('shell.importNotice');importDialog.querySelector('.shell-dialog-content').prepend(importNotice);
  dialog('results','shell.dialog.results',[document.querySelector('.feedback-panel')]);
  sidebar.remove();document.querySelector('.topbar')?.remove();document.querySelector('.page-footer')?.remove();
  const hud=document.createElement('div');hud.className='stage-hud';hud.innerHTML='<button id="back-to-library" class="button secondary" data-i18n="shell.backLibrary">← 曲库</button><div class="stage-heading"><h1 id="stage-title" tabindex="-1"></h1><p id="stage-subtitle"></p></div><button id="notation-toggle" class="button secondary" aria-expanded="false" aria-controls="notation-dock"></button>';
  const dock=document.createElement('aside');dock.id='notation-dock';dock.hidden=true;dock.append(document.querySelector('.notation-panel'));stage.prepend(hud);document.querySelector('.play-panel').before(dock);
  const notice=$('notice');header.after(notice);stage.hidden=true;lobby.hidden=true;document.body.dataset.screen='home';
  function open(name){const el=dialogs.get(name);if(!el)return;pausePlayback();onPanel(name);if(!el.open)el.showModal();}
  for(const name of dialogs.keys())$(`${name}-button`).addEventListener('click',()=>open(name));
  $('preview-setup').addEventListener('click',()=>open('settings'));
  const rhythm=setupRhythmShell({document,i18n,show,open});
  function render(){
    const {score,mode,part,passes=0,hasSession=Boolean(score),hasPerformanceRecords=false}=current;
    rhythm.update({screen,hasSession});
    for(const node of scoreSettings)node?.classList.toggle('free-score-settings-hidden',screen==='free');
    $('resume-session').hidden=!hasSession;$('score-tools-button').disabled=!score;$('results-button').disabled=!score&&!hasPerformanceRecords;
    $('stage-title').textContent=score?.title||i18n.t('shell.stageTitle');
    const modeText=i18n.t(mode==='practice'?'shell.practice':'shell.listen'),partText=part||i18n.t('shell.allParts');
    $('stage-subtitle').textContent=score?i18n.t(passes?'shell.stageSubtitleWithTakes':'shell.stageSubtitle', {mode:modeText,part:partText,...(passes?{takes:i18n.t('shell.takeCount',{count:passes})}:{})}):'';
    $('results-button').textContent=passes?i18n.t('shell.resultsCount',{count:passes}):i18n.t('shell.results');
    if(score)$('resume-session').title=i18n.t('shell.returnTitle',{title:score.title});else $('resume-session').removeAttribute('title');
    skip.textContent=i18n.t(screen==='authoring'?'rhythm.authoring':screen==='free'?'free.title':screen==='stage'?'nav.skipStage':screen==='home'?'rhythm.home':'nav.skipLibrary');
    $('notation-toggle').textContent=i18n.t(notation?'shell.closeNotation':'nav.notation');
  }
  function setNotation(visible){notation=visible;dock.hidden=!notation;$('notation-toggle').setAttribute('aria-expanded',String(notation));stage.classList.toggle('with-notation',notation);render();onNotation(notation)}
  function show(next){if(!['home','library','stage','free','authoring'].includes(next))return;pausePlayback();for(const el of dialogs.values())if(el.open)el.close();screen=next;stage.hidden=next!=='stage';lobby.hidden=next!=='library';$('game-home').hidden=next!=='home';document.body.dataset.screen=next;const heading=next==='authoring'?'song-authoring-title':next==='free'?'free-practice-title':next==='stage'?'stage-title':next==='home'?'home-title':'lobby-title';skip.href=`#${heading}`;if(next==='stage'&&!notationChosen&&!notation&&$('instrument').value==='piano'&&document.defaultView.innerWidth>650&&document.defaultView.innerHeight>=700)setNotation(true);render();onScreen(next);$(heading)?.focus();}
  $('start-free-practice').addEventListener('click',()=>show('free'));
  $('back-to-library').addEventListener('click',()=>show('library'));$('resume-session').addEventListener('click',()=>show('stage'));
  $('notation-toggle').addEventListener('click',()=>{notationChosen=true;setNotation(!notation)});
  skip.href='#home-title';localeView.refresh();render();const unsubscribe=i18n.subscribe(render);
  return {show,open,screen:()=>screen,notationVisible:()=>notation,localeView,
    update(value){current=value;render();},
    destroy(){unsubscribe();rhythm.destroy();fullscreen.destroy();localeView.destroy();}
  };
}
