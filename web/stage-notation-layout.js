import {getAppI18n} from './app-locale.js';
import {setupNotationFit} from './notation-fit.js';
import {setupNotationScopeControls} from './notation-scope-controls.js';
/** Move the existing score paint into the lane background. Controllers, exact
 * source IDs, page selection and renderer instances retain their original nodes.
 * All interactive controls stay outside the pointer-inert paint layer. */
export function setupStageNotationLayout({document,i18n=getAppI18n(document),onChange=()=>{}}) {
  const $=id=>document.getElementById(id),window=document.defaultView,stage=$('workspace'),play=stage.querySelector('.play-panel');
  const dock=$('notation-dock'),lane=$('piano-stage').querySelector('.piano-lanes-shared'),toolbar=$('piano-stage').querySelector('.piano-stage-toolbar');
  const fallback=$('engraving-fallback'),fallbackHome=document.createComment('Engraving fallback home');fallback?.before(fallbackHome);
  const basic=$('notation'),engraved=document.querySelector('.engraving-scroll'),engravingView=$('engraving-view');
  const renditionEvents=$('basic-rendition-events'),eventsHome=document.createComment('Rendition events home');renditionEvents?.before(eventsHome);
  const basicHome=document.createComment('Basic notation home'),engravedHome=document.createComment('Engraved notation home'),dockHome=document.createComment('Notation controls home');
  basic.before(basicHome);engraved.before(engravedHome);dock.before(dockHome);
  const overlay=document.createElement('div');overlay.id='notation-lane-overlay';overlay.className='notation-lane-overlay';overlay.setAttribute('data-i18n-aria-label','performance.scoreBackground');overlay.setAttribute('aria-label',i18n.t('performance.scoreBackground'));overlay.dataset.keyboardInput='off';overlay.hidden=true;lane.append(overlay);
  const options=document.createElement('div');options.className='notation-overlay-options';options.dataset.keyboardInput='off';
  options.innerHTML='<label><input id="notation-overlay-visible" type="checkbox" checked><span data-i18n="performance.scoreBackground"></span></label><label><span data-i18n="performance.scoreOpacity"></span><input id="notation-overlay-opacity" type="range" min="15" max="100" step="5" value="60"><output id="notation-overlay-opacity-value" for="notation-overlay-opacity">60%</output></label>';
  for(const node of options.querySelectorAll('[data-i18n]'))node.textContent=i18n.t(node.getAttribute('data-i18n'));
  const tools=document.createElement('details');tools.className='notation-tools';tools.id='notation-tools';tools.dataset.keyboardInput='off';
  const summary=document.createElement('summary');summary.className='button secondary';summary.setAttribute('data-i18n','performance.scoreOptions');summary.textContent=i18n.t('performance.scoreOptions');tools.append(summary);
  const pan=document.createElement('div');pan.className='notation-pan-controls';pan.dataset.keyboardInput='off';pan.setAttribute('role','group');pan.setAttribute('data-i18n-aria-label','performance.scoreScroll');
  for(const [direction,glyph]of [['left','←'],['up','↑'],['down','↓'],['right','→']]){
    const button=document.createElement('button');button.type='button';button.id=`notation-pan-${direction}`;button.className='button secondary compact';button.textContent=glyph;button.setAttribute('data-i18n-aria-label',`performance.scoreScroll.${direction}`);
    button.addEventListener('click',()=>{dock.dispatchEvent(new window.Event('notationmanualscroll'));const root=stage.classList.contains('notation-on-lanes')?overlay:dock;const horizontal=basic.hidden?engraved:basic;const target=['left','right'].includes(direction)?horizontal:root;target.scrollBy?.({left:direction==='left'?-target.clientWidth*.65:direction==='right'?target.clientWidth*.65:0,top:direction==='up'?-target.clientHeight*.65:direction==='down'?target.clientHeight*.65:0,behavior:'auto'});});pan.append(button);
  }
  dock.querySelector('.section-heading').after(pan);toolbar.append(options,tools);
  const scope=setupNotationScopeControls({document,stage,dock,options,i18n});
  const fit=setupNotationFit({viewport:overlay,getSurface:()=>basic.hidden?$('engraved-staff'):basic,getReservedHeight:()=>renditionEvents&&!renditionEvents.hidden?renditionEvents.getBoundingClientRect().height:0,onChange(plan){scope.setFit(plan);stage.dispatchEvent(new window.Event('notationviewportchange'));}});
  const visible=$('notation-overlay-visible'),opacity=$('notation-overlay-opacity'),value=$('notation-overlay-opacity-value');let last=null,lastVisible=null,disposed=false;
  function refresh(){
    if(disposed)return;
    const piano=play.dataset.instrument!=='guitar';stage.classList.toggle('notation-on-lanes',piano);
    if(piano){if(fallback&&fallback.parentElement!==$('piano-stage'))$('piano-stage').append(fallback);if(dock.parentElement!==tools)tools.append(dock);if(basic.parentElement!==overlay)overlay.append(basic);if(engraved.parentElement!==overlay)overlay.append(engraved);if(renditionEvents&&renditionEvents.parentElement!==overlay)overlay.append(renditionEvents);dock.removeAttribute('tabindex');}
    else{if(fallback&&fallback.previousSibling!==fallbackHome)fallbackHome.after(fallback);if(dock.previousSibling!==dockHome)dockHome.after(dock);if(basic.previousSibling!==basicHome)basicHome.after(basic);if(engraved.previousSibling!==engravedHome)engravedHome.after(engraved);if(renditionEvents&&renditionEvents.previousSibling!==eventsHome)eventsHome.after(renditionEvents);dock.tabIndex=0;}
    const enabled=piano&&!dock.hidden&&visible.checked;overlay.hidden=!enabled;engraved.hidden=piano?engravingView.hidden:false;options.hidden=!piano;tools.hidden=!piano||dock.hidden;pan.hidden=!piano;
    opacity.disabled=!visible.checked;overlay.style.setProperty('--notation-opacity',String(Number(opacity.value)/100));value.textContent=`${opacity.value}%`;opacity.setAttribute('aria-valuetext',value.textContent);
    if(lastVisible!==enabled){lastVisible=enabled;stage.dispatchEvent(new window.Event('notationviewportchange'));}
    const signature=JSON.stringify([piano,engravingView.hidden]);if(signature!==last){last=signature;onChange(enabled);}
    fit.refresh();
  }
  visible.addEventListener('change',refresh);opacity.addEventListener('input',refresh);
  const observer=window.MutationObserver?new window.MutationObserver(refresh):null;
  for(const node of [dock,engravingView])observer?.observe(node,{attributes:true,attributeFilter:['hidden']});
  refresh();return {refresh,setScopeContext:scope.update,destroy(){disposed=true;observer?.disconnect();fit.destroy();scope.destroy();visible.removeEventListener('change',refresh);opacity.removeEventListener('input',refresh);basicHome.after(basic);engravedHome.after(engraved);dockHome.after(dock);if(fallback)fallbackHome.after(fallback);if(renditionEvents)eventsHome.after(renditionEvents);eventsHome.remove();fallbackHome.remove();engraved.hidden=false;stage.classList.remove('notation-on-lanes');overlay.remove();options.remove();tools.remove();pan.remove();basicHome.remove();engravedHome.remove();dockHome.remove();}};
}
