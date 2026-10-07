import {assistanceEqual,defaultAssistanceSettings,assistancePresets,assistancePresetId,assistancePresetSettings} from './practice-assistance-receipt.js';
import {assistanceText} from './practice-assistance-locales.js';
import {setupPracticeProgressionView} from './practice-progression-view.js';
import {progressionText} from './practice-progression-locales.js';
export function assistanceSummary(checked,locale='en'){
  return checked?assistanceText(locale,'summary',{human:checked.coverage.human_target_count,machine:checked.coverage.machine_occurrence_count}):'';
}
/** Compact controls inside Song Mod. Check/Apply never starts transport. */
export function setupPracticeAssistanceView({document,parent,i18n,onChange=()=>{}}){
  const make=(tag,id,owner)=>{const node=document.createElement(tag);if(id)node.id=id;owner?.append(node);return node;};
  const root=make('section','song-mod-assistance',parent);root.className='song-mod-assistance';root.setAttribute('aria-labelledby','song-mod-assistance-title');root.hidden=true;
  const title=make('h3','song-mod-assistance-title',root),intro=make('p',null,root),modeLabel=make('label',null,root),modeText=make('span',null,modeLabel),mode=make('select','song-mod-assistance-mode',modeLabel);
  for(const value of ['original','automatic','progression']){const option=make('option',null,mode);option.value=value;}
  const presetLabel=make('label','song-mod-assistance-preset-label',root),presetText=make('span','song-mod-assistance-preset-text',presetLabel),preset=make('select','song-mod-assistance-preset',presetLabel),presets=assistancePresets();
  preset.setAttribute('aria-labelledby',presetText.id);preset.setAttribute('aria-describedby','song-mod-assistance-model');
  for(const {id} of [...presets,{id:'custom'}]){const option=make('option',null,preset);option.value=id;option.disabled=id==='custom';}
  const limits=make('div','song-mod-assistance-limits',root);limits.className='song-mod-assistance-limits';const inputs=new Map();
  for(const [field,min,max] of [['max_targets_per_onset',1,32],['min_onset_interval_ms',0,60000],['max_simultaneous_keys',1,32],['max_held_span_semitones',0,127]]){
    const label=make('label',null,limits),text=make('span',null,label),input=make('input',`song-mod-assistance-${field}`,label);input.type='number';input.min=String(min);input.max=String(max);input.step='1';inputs.set(field,{input,text});
  }
  const model=make('p','song-mod-assistance-model',root),availability=make('p','song-mod-assistance-availability',root),check=make('button','song-mod-assistance-check',root),preview=make('section','song-mod-assistance-preview',root),previewTitle=make('h4','song-mod-assistance-preview-title',preview),status=make('p','song-mod-assistance-status',preview),units=make('p','song-mod-assistance-units',preview),legend=make('div','song-mod-assistance-legend',preview),human=make('span',null,legend),machine=make('span',null,legend);
  preview.setAttribute('aria-labelledby',previewTitle.id);status.setAttribute('aria-atomic','true');
  check.type='button';check.className='button secondary compact';status.setAttribute('role','status');status.setAttribute('aria-live','polite');legend.className='song-mod-assistance-legend';human.dataset.assistanceRole='human';machine.dataset.assistanceRole='machine';
  const persistence=make('p','song-mod-assistance-persistence',root),replaceLabel=make('label','song-mod-assistance-replace-label',root),replace=make('input','song-mod-assistance-replace',replaceLabel),replaceText=make('span',null,replaceLabel),resetLabel=make('label','song-mod-assistance-reset-label',root),reset=make('input','song-mod-assistance-reset',resetLabel),resetText=make('span',null,resetLabel);replace.type=reset.type='checkbox';resetLabel.className='warning';
  const off=make('button','song-mod-assistance-off',root);off.type='button';off.className='button secondary compact';off.setAttribute('aria-describedby','song-mod-assistance-status');
  let disableRequested=false;
  let controller=null,initial=null,origin='preview',hasTakes=false,externalBusy=false,modReset=false,localError=null,checking=false,generation=0,rendering=false,explicitOptIn=false;
  const t=(key,params)=>assistanceText(i18n.locale,key,params),machineParts=new WeakMap();
  const progressionView=setupPracticeProgressionView({document,parent:root,i18n,onLayer:layer=>{if(!controller||externalBusy)return;generation++;checking=false;explicitOptIn=true;localError=null;reset.checked=false;controller.setDraft({mode:'progression',settings:null,layer});render();onChange();}});presetLabel.before(progressionView.root);
  function state(){return controller?.state()||null;}
  function changed(){
    const s=state();if(!s?.draft)return false;if(disableRequested)return true;
    // Existing unassisted Original Mod edits retain the established part-based
    // path. Merely changing its union must not opt into stricter note atoms.
    const defaultOriginal=s.draft.mode==='original'&&!s.active&&!s.persistence.recipe&&['default','off'].includes(s.persistence.status);
    if(defaultOriginal)return explicitOptIn;
    if(initial===null)return true;
    const pick=d=>({mode:d.mode,settings:d.settings,selection:d.selection,layer:d.layer});
    return s.replaceInvalidRequired||s.persistence.status==='unavailable'||!assistanceEqual(pick(s.draft),pick(initial))||(!s.active&&Boolean(s.persistence.recipe));
  }
  function checked(){if(disableRequested||localError)return null;const s=state();if(!s?.draft||s.error)return null;return s.prepared||(!changed()?s.active:null)||null;}
  function hasMachine(partId){const plan=checked();if(!plan)return false;let parts=machineParts.get(plan);if(!parts){parts=new Set(plan.source_ownership.filter(source=>source.owner==='machine').map(source=>source.part_id));machineParts.set(plan,parts);}return parts.has(partId);}
  function resetRequired(){const s=state(),assistanceChange=changed(),assisted=Boolean(s?.active||s?.persistence.recipe||assistanceChange);return origin==='stage'&&assisted&&Boolean(hasTakes||s?.active||s?.persistence.recipe)&&(modReset||assistanceChange);}
  function render(){
    if(rendering)return;rendering=true;
    try{
      root.hidden=!controller;if(!controller)return;const s=state(),draft=s.draft;previewTitle.textContent=t('preview');if(!draft){progressionView.render({visible:false});status.textContent=t('stale');status.dataset.phase='stale';preview.dataset.state='unchecked';units.hidden=true;units.textContent='';check.disabled=mode.disabled=preset.disabled=off.disabled=true;for(const {input}of inputs.values())input.disabled=true;return;}
      const automatic=draft.mode==='automatic',progressive=draft.mode==='progression',unsupported=draft.selection.profile.kind!=='piano',empty=!draft.selection.selected_part_ids.length,busy=externalBusy||checking||s.phase==='preparing',plan=busy?null:checked();
      off.textContent=t(disableRequested?'offUndo':'offAction');off.disabled=busy;off.setAttribute('aria-pressed',String(disableRequested));modeLabel.hidden=disableRequested;
      title.textContent=t('title');intro.textContent=t(disableRequested?'offExplanation':'explanation');modeText.textContent=t('mode');for(const option of mode.options)option.textContent=option.value==='progression'?progressionText(i18n.locale,'mode'):t(option.value);mode.value=draft.mode;mode.options[1].disabled=unsupported||empty;mode.options[2].disabled=!s.supportsProgression||unsupported||empty;
      progressionView.render({visible:!disableRequested&&progressive,layer:draft.layer,checked:plan?(s.preparedProgression||s.progression):null,disabled:externalBusy||unsupported||empty});mode.disabled=externalBusy;
      limits.hidden=disableRequested||!automatic;model.hidden=disableRequested||!automatic;model.textContent=t('model');const settings=draft.settings||defaultAssistanceSettings();
      presetLabel.hidden=disableRequested||!automatic;presetText.textContent=t('configuration');preset.disabled=externalBusy||unsupported||empty;
      for(const option of preset.options){const entry=presets.find(item=>item.id===option.value);option.textContent=entry?t('presetOption',{name:t('preset_'+entry.id),...entry.settings}):t('custom');}preset.value=assistancePresetId(settings);
      for(const [field,{input,text}] of inputs){text.textContent=t(field);if(document.activeElement!==input)input.value=String(settings[field]);input.disabled=externalBusy;}
      availability.hidden=disableRequested||!(unsupported||empty);availability.textContent=t(empty?'noHuman':'unsupported');
      check.hidden=disableRequested;check.textContent=t(busy?'checking':'check');check.disabled=busy||(automatic||progressive)&&(unsupported||empty);
      status.textContent=disableRequested?t('offDraft'):localError?t('error')+' '+localError.message:s.error?t('error')+' '+s.error.message:busy?t('checking'):plan?t('counts',{human:plan.coverage.human_target_count,machine:plan.coverage.machine_occurrence_count})+(plan.scored_mode_allowed?'':' · '+t('noScore')):s.persistence.status==='off'&&!changed()?t('off'):t('unchecked');status.dataset.phase=disableRequested?'off-draft':s.phase;
      preview.dataset.state=disableRequested?'off-draft':busy?'checking':plan?'checked':'unchecked';
      units.hidden=!plan;units.textContent=plan?t('units',{human:plan.coverage.human_source_unit_count,machine:plan.coverage.machine_source_unit_count,total:plan.coverage.source_unit_count}):'';
      human.textContent=t('human');machine.textContent=t('machine');persistence.hidden=!s.persistence.storageUnavailable&&!['invalid','unsaved','unavailable','off'].includes(s.persistence.status);persistence.textContent=persistence.hidden?'':t(s.active&&s.persistence.status==='off'?'session':s.persistence.storageUnavailable?'sessionDefault':s.persistence.status);
      replaceLabel.hidden=!s.replaceInvalidRequired;replaceText.textContent=t('replace');replace.disabled=externalBusy;
      resetLabel.hidden=!resetRequired();resetText.textContent=t('reset');reset.disabled=externalBusy;
    }finally{rendering=false;}
  }
  function edit(){
    if(!controller||externalBusy)return;disableRequested=false;if(['automatic','progression'].includes(mode.value))explicitOptIn=true;generation++;checking=false;localError=null;reset.checked=false;
    const settings=mode.value==='automatic'?{...defaultAssistanceSettings(),...Object.fromEntries([...inputs].map(([field,{input}])=>[field,input.value.trim()===''?NaN:Number(input.value)]))}:null;
    try{controller.setDraft({mode:mode.value,settings});}catch(error){localError=error;}render();onChange();
  }
  mode.addEventListener('change',edit);for(const{input}of inputs.values())input.addEventListener('input',edit);
  preset.addEventListener('change',()=>{
    if(!controller||externalBusy||preset.disabled||mode.value!=='automatic')return;
    generation++;checking=false;disableRequested=false;explicitOptIn=true;localError=null;reset.checked=false;
    try{const settings=assistancePresetSettings(preset.value);for(const [field,{input}] of inputs)input.value=String(settings[field]);controller.setDraft({mode:'automatic',settings});}catch(error){localError=error;}
    render();onChange();
  });
  for(const node of [reset,replace])node.addEventListener('change',()=>{render();onChange();});
  async function prepare({isCurrent=()=>true}={}){
    if(!controller)return null;const current=++generation;checking=true;localError=null;render();onChange();
    try{const result=await controller.prepareDraft();if(current!==generation||!isCurrent())return null;render();return result;}
    catch(error){if(current===generation){localError=error;render();}throw error;}
    finally{if(current===generation){checking=false;render();onChange();}}
  }
  off.addEventListener('click',()=>{if(!controller||externalBusy||checking)return;generation++;disableRequested=!disableRequested;localError=null;reset.checked=false;render();onChange();});
  check.addEventListener('click',()=>{if(!controller||externalBusy||checking)return;disableRequested=false;if(!explicitOptIn)reset.checked=false;explicitOptIn=true;prepare().catch(()=>{});});
  return{root,render,changed,checked,hasMachine,disabled:()=>disableRequested,explicitOptIn:()=>explicitOptIn,
    open(next,{where='preview',hasTakes:existingTakes=false,initialDraft=null,requireCheck=false}={}){generation++;disableRequested=false;explicitOptIn=false;controller=next||null;origin=where;hasTakes=Boolean(existingTakes);externalBusy=false;modReset=false;localError=null;checking=false;reset.checked=replace.checked=false;if(controller){const s=controller.beginDraft();initial=s?.draft||null;if(!initial)controller=null;else if(initialDraft){controller.setDraft(initialDraft);if(requireCheck){initial=null;explicitOptIn=true;}}}render();},
    update({selection,busy=false,requiresReset=false}={}){externalBusy=busy;modReset=requiresReset;if(controller&&selection){const s=state();if(s.draft&&!assistanceEqual(s.draft.selection,selection)){generation++;checking=false;reset.checked=false;localError=null;controller.setDraft({selection});}}render();},
    restoreOriginal(){if(controller){disableRequested=false;generation++;checking=false;localError=null;reset.checked=false;controller.setDraft({mode:'original',settings:null});render();onChange();}},
    canApply(){const s=state();return !controller||Boolean(s?.draft&&!checking&&!localError&&(!resetRequired()||reset.checked)&&(!s.replaceInvalidRequired||replace.checked)&&!(!disableRequested&&['automatic','progression'].includes(s.draft.mode)&&(s.draft.selection.profile.kind!=='piano'||!s.draft.selection.selected_part_ids.length)));},
    prepare,
    finishUnchanged(){controller?.cancelDraft();},
    resetConfirmed(){return !resetRequired()||reset.checked;},
    commit({isCurrent=()=>true}={}){return controller?.[disableRequested?'disableDraft':'commitDraft']({resetConfirmed:!resetRequired()||reset.checked,isCurrent,replaceInvalid:replace.checked})||null;},
    close({cancel=true}={}){generation++;checking=false;if(cancel)controller?.cancelDraft();controller=null;initial=null;disableRequested=false;explicitOptIn=false;localError=null;root.hidden=true;},
  };
}
