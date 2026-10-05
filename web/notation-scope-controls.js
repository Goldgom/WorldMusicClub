import {resolveNotationScope,planNotationPartBatch} from './notation-scope.js';

export function notationScopeRestrictionText(i18n,reason){
  if(reason==='solo')return i18n.locale==='en'?'Solo practice shows only your human part. Choose Complete practice or return to the library and Open score to see other parts.':'声部独奏仅显示人演奏声部。查看其他声部，请选择完整演奏，或回曲库打开乐谱。';
  if(reason==='hidden_others')return i18n.locale==='en'?'Other parts are hidden. Turn on Show accompaniment notes to choose a wider notation view.':'其他声部已隐藏。开启“显示其他声部音符”后，可选择更多谱面声部。';
  return '';
}

/** Renderer context enters through notationscopecontext; user view choices
 * leave through notationscopechange. This controller cannot change playback. */
export function setupNotationScopeControls({document,stage,dock,options,i18n}) {
  const window=document.defaultView,t=(key,params)=>i18n.t(`notationRuntime.${key}`,params);
  let context=null,fit=null;
  const controls=document.createElement('div');controls.className='notation-scope-controls';controls.dataset.keyboardInput='off';controls.hidden=true;
  const label=document.createElement('label'),labelText=document.createElement('span'),select=document.createElement('select');select.id='notation-scope';
  for(const value of ['current','all','part']){const option=document.createElement('option');option.value=value;select.append(option);}label.append(labelText,select);
  const part=document.createElement('select');part.id='notation-scope-part';
  const paging=document.createElement('div');paging.className='notation-scope-pages';
  const previous=document.createElement('button'),next=document.createElement('button'),range=document.createElement('span');
  for(const button of [previous,next]){button.type='button';button.className='button secondary compact';}
  previous.id='notation-parts-prev';previous.textContent='←';next.id='notation-parts-next';next.textContent='→';paging.append(previous,range,next);
  const status=document.createElement('p');status.id='notation-scope-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  select.setAttribute('aria-describedby',status.id);controls.append(label,part,paging,status);dock.querySelector('.section-heading').after(controls);
  const summary=document.createElement('span');summary.id='notation-scope-summary';summary.className='notation-scope-summary';summary.hidden=true;options.append(summary);
  function redraw() {
    labelText.textContent=t('scopeLabel');
    for(const option of select.children)option.textContent=t({current:'scopeCurrent',all:'allParts',part:'scopeSelected'}[option.value]);
    part.setAttribute('aria-label',t('scopeSelected'));previous.setAttribute('aria-label',t('scopePreviousParts'));next.setAttribute('aria-label',t('scopeNextParts'));
    if(!context)return;
    const scope=resolveNotationScope(context),batch=planNotationPartBatch(scope.partIds,{firstPart:context.firstPart||0,maxParts:context.maxParts||4});
    const restriction=notationScopeRestrictionText(i18n,context.practiceDisplayRestriction);select.disabled=part.disabled=Boolean(restriction);select.title=part.title=restriction;for(const option of select.children)option.disabled=Boolean(restriction)&&option.value!=='current';
    select.value=scope.scope;part.hidden=scope.scope!=='part';part.value=context.selectedPartId||'';
    paging.hidden=batch.partPages<=1;previous.disabled=batch.previousPart===null;next.disabled=batch.nextPart===null;
    const page=context.page||1,totalPages=context.totalPages||1;
    range.textContent=t('scopePartPage',{page:batch.partPage,count:batch.partPages});
    const rendered=new Set((context.renderedPartIds||[]).filter(id=>scope.partIds.includes(id))),label=scope.scope==='all'?t('allParts'):scope.scope==='current'?t('scopeCurrent'):t('scopeSelected');
    const name=scope.partId?context.parts.find(item=>item.id===scope.partId)?.name||scope.partId:'';
    const text=scope.status==='choose_current_part'?t('scopeChooseCurrent'):scope.status==='choose_part'?t('scopeChoosePart'):scope.status==='empty'?t('scopeEmpty'):
      t('scopeCoverage',{scope:label+(name?` · ${name}`:''),shown:rendered.size,total:scope.totalParts,page,count:totalPages})+(batch.partPages>1?' '+t('scopePartPage',{page:batch.partPage,count:batch.partPages}):'');
    const fitText=fit?.status==='scroll'?t('fitScroll',{percent:Math.round(fit.scale*100)}):fit?.status==='fit'?t('fitReady',{percent:Math.round(fit.scale*100)}):'';
    const limitation=context.status==='page_limit'?t('scopePageLimit'):context.status==='partial'?t('scopePartial'):'';
    status.textContent=[restriction,text,fitText,limitation].filter(Boolean).join(' ');
    summary.textContent=scope.status==='ready'?t('scopeCompact',{shown:rendered.size,total:scope.totalParts,page,count:totalPages}):t('scopeNeedsChoice');summary.title=status.textContent;
    controls.dataset.scope=scope.scope;controls.dataset.scopeStatus=scope.status;controls.dataset.renderedParts=String(rendered.size);controls.dataset.totalParts=String(scope.totalParts);
    controls.hidden=false;summary.hidden=false;
  }
  function update(value) {
    if(!value||!Array.isArray(value.parts))return;
    resolveNotationScope(value);context={...value,parts:value.parts.map(item=>({id:item.id,name:item.name})),renderedPartIds:[...(value.renderedPartIds||[])]};
    const signature=JSON.stringify(context.parts);if(part.dataset.inventory!==signature){part.dataset.inventory=signature;part.replaceChildren();for(const item of context.parts){const option=document.createElement('option');option.value=item.id;option.textContent=item.name||item.id;part.append(option);}}
    redraw();
  }
  function change(scope,selectedPartId,firstPart=0) {
    if(!context)return;
    const resolved=resolveNotationScope({...context,scope,selectedPartId});
    stage.dispatchEvent(new window.CustomEvent('notationscopechange',{detail:{...resolved,selectedPartId,firstPart}}));
  }
  select.addEventListener('change',()=>change(select.value,context?.selectedPartId||part.value||null));
  part.addEventListener('change',()=>change('part',part.value));
  const turn=direction=>{if(!context)return;const resolved=resolveNotationScope(context),batch=planNotationPartBatch(resolved.partIds,{firstPart:context.firstPart||0,maxParts:context.maxParts||4}),firstPart=direction<0?batch.previousPart:batch.nextPart;if(firstPart!==null)change(context.scope,context.selectedPartId,firstPart);};
  previous.addEventListener('click',()=>turn(-1));next.addEventListener('click',()=>turn(1));
  const receive=event=>update(event.detail);stage.addEventListener('notationscopecontext',receive);const unsubscribe=i18n.subscribe(redraw);redraw();
  return {update,setFit(value){fit=value;redraw();},destroy(){stage.removeEventListener('notationscopecontext',receive);unsubscribe();controls.remove();summary.remove();}};
}
