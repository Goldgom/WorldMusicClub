import {PROGRESSION_LAYERS} from './practice-progression-receipt.js';
import {progressionText} from './practice-progression-locales.js';

export function setupPracticeProgressionView({document,parent,i18n,onLayer}){
  const make=(tag,id,owner)=>{const node=document.createElement(tag);if(id)node.id=id;owner?.append(node);return node;};
  const root=make('section','song-mod-progression',parent),label=make('label',null,root),text=make('span','song-mod-progression-label',label),select=make('select','song-mod-progression-layer',label),explanation=make('p','song-mod-progression-explanation',root),summary=make('ol','song-mod-progression-summary',root);
  root.hidden=true;select.setAttribute('aria-labelledby',text.id);select.setAttribute('aria-describedby',explanation.id);summary.setAttribute('aria-live','polite');summary.setAttribute('aria-atomic','true');
  for(const layer of PROGRESSION_LAYERS){const option=make('option',null,select);option.value=layer;}
  select.addEventListener('change',()=>{if(!select.disabled)onLayer(select.value);});
  return{root,render({visible=false,layer='single',checked=null,disabled=false}={}){
    root.hidden=!visible;const t=(key,values)=>progressionText(i18n.locale,key,values);text.textContent=t('stage');explanation.textContent=t('explanation');select.disabled=disabled;for(const option of select.options)option.textContent=t(option.value);select.value=layer;summary.replaceChildren();
    if(!visible)return;if(!checked){const item=make('li',null,summary);item.textContent=t('unchecked');return;}
    for(const row of checked.layers){const item=make('li',null,summary);item.dataset.layer=row.layer;item.dataset.selected=String(row.layer===layer);item.textContent=t('row',{name:t(row.layer),human:row.human_target_count,units:row.human_source_unit_count})+(row.equals_previous_layer?' · '+t('equal'):'')+(!row.human_target_count?' · '+t('empty'):'');if(row.layer===layer)item.setAttribute('aria-current','step');}
  }};
}
