import {assistanceEqual,defaultAssistanceSettings} from './practice-assistance-receipt.js';
import {assistanceText} from './practice-assistance-locales.js';
export function assistanceSummary(checked,locale='en'){
  return checked?assistanceText(locale,'summary',{human:checked.coverage.human_target_count,machine:checked.coverage.machine_occurrence_count}):'';
}
/** Compact controls inside Song Mod. Check/Apply never starts transport. */
export function setupPracticeAssistanceView({document,parent,i18n,onChange=()=>{}}){
  const make=(tag,id,owner)=>{const node=document.createElement(tag);if(id)node.id=id;owner?.append(node);return node;};
  const root=make('section','song-mod-assistance',parent);root.className='song-mod-assistance';root.setAttribute('aria-labelledby','song-mod-assistance-title');root.hidden=true;
  const title=make('h3','song-mod-assistance-title',root),intro=make('p',null,root),modeLabel=make('label',null,root),modeText=make('span',null,modeLabel),mode=make('select','song-mod-assistance-mode',modeLabel);
  for(const value of ['original','automatic']){const option=make('option',null,mode);option.value=value;}
  const limits=make('div','song-mod-assistance-limits',root);limits.className='song-mod-assistance-limits';const inputs=new Map();
  for(const [field,min,max] of [['max_targets_per_onset',1,32],['min_onset_interval_ms',0,60000],['max_simultaneous_keys',1,32],['max_held_span_semitones',0,127]]){
    const label=make('label',null,limits),text=make('span',null,label),input=make('input',`song-mod-assistance-${field}`,label);input.type='number';input.min=String(min);input.max=String(max);input.step='1';inputs.set(field,{input,text});
  }
  const model=make('p',null,root),availability=make('p','song-mod-assistance-availability',root),check=make('button','song-mod-assistance-check',root),status=make('p','song-mod-assistance-status',root),units=make('p','song-mod-assistance-units',root),legend=make('div','song-mod-assistance-legend',root),human=make('span',null,legend),machine=make('span',null,legend);
  check.type='button';check.className='button secondary compact';status.setAttribute('role','status');status.setAttribute('aria-live','polite');legend.className='song-mod-assistance-legend';human.dataset.assistanceRole='human';machine.dataset.assistanceRole='machine';
  const persistence=make('p','song-mod-assistance-persistence',root),replaceLabel=make('label','song-mod-assistance-replace-label',root),replace=make('input','song-mod-assistance-replace',replaceLabel),replaceText=make('span',null,replaceLabel),resetLabel=make('label','song-mod-assistance-reset-label',root),reset=make('input','song-mod-assistance-reset',resetLabel),resetText=make('span',null,resetLabel);replace.type=reset.type='checkbox';resetLabel.className='warning';
  let controller=null,initial=null,origin='preview',hasTakes=false,externalBusy=false,modReset=false,localError=null,checking=false,generation=0,rendering=false,explicitOptIn=false;
  const t=(key,params)=>assistanceText(i18n.locale,key,params),machineParts=new WeakMap();
  function state(){return controller?.state()||null;}
  function changed(){
    const s=state();if(!s?.draft)return false;
    // Existing unassisted Original Mod edits retain the established part-based
    // path. Merely changing its union must not opt into stricter note atoms.
    const defaultOriginal=s.draft.mode==='original'&&!s.active&&!s.persistence.recipe&&s.persistence.status==='default';
    if(defaultOriginal)return explicitOptIn;
    const pick=d=>({mode:d.mode,settings:d.settings,selection:d.selection});
    return s.replaceInvalidRequired||s.persistence.status==='unavailable'||!assistanceEqual(pick(s.draft),pick(initial))||(!s.active&&Boolean(s.persistence.recipe));
  }
  function checked(){const s=state();return s?.prepared||(!changed()?s?.active:null)||null;}
  function hasMachine(partId){const plan=checked();if(!plan)return false;let parts=machineParts.get(plan);if(!parts){parts=new Set(plan.source_ownership.filter(source=>source.owner==='machine').map(source=>source.part_id));machineParts.set(plan,parts);}return parts.has(partId);}
  function resetRequired(){const s=state();return origin==='stage'&&Boolean(hasTakes||s?.active||s?.persistence.recipe)&&(modReset||changed());}
  function render(){
    if(rendering)return;rendering=true;
    try{
      root.hidden=!controller;if(!controller)return;const s=state(),draft=s.draft;if(!draft){status.textContent=t('stale');check.disabled=mode.disabled=true;for(const {input}of inputs.values())input.disabled=true;return;}
      const automatic=draft.mode==='automatic',unsupported=draft.selection.profile.kind!=='piano',empty=!draft.selection.selected_part_ids.length,busy=externalBusy||checking||s.phase==='preparing',plan=checked();
      title.textContent=t('title');intro.textContent=t('explanation');modeText.textContent=t('mode');for(const option of mode.options)option.textContent=t(option.value);mode.value=draft.mode;mode.options[1].disabled=unsupported||empty;mode.disabled=externalBusy;
      limits.hidden=!automatic;model.hidden=!automatic;model.textContent=t('model');const settings=draft.settings||defaultAssistanceSettings();
      for(const [field,{input,text}] of inputs){text.textContent=t(field);if(document.activeElement!==input)input.value=String(settings[field]);input.disabled=externalBusy;}
      availability.hidden=!(unsupported||empty);availability.textContent=t(empty?'noHuman':'unsupported');
      check.textContent=t(busy?'checking':'check');check.disabled=busy||automatic&&(unsupported||empty);
      status.textContent=localError?t('error')+' '+localError.message:s.error?t('error')+' '+s.error.message:busy?t('checking'):plan?t('counts',{human:plan.coverage.human_target_count,machine:plan.coverage.machine_occurrence_count})+(plan.scored_mode_allowed?'':' · '+t('noScore')):t('unchecked');status.dataset.phase=s.phase;
      units.hidden=!plan;units.textContent=plan?t('units',{human:plan.coverage.human_source_unit_count,machine:plan.coverage.machine_source_unit_count,total:plan.coverage.source_unit_count}):'';
      human.textContent=t('human');machine.textContent=t('machine');persistence.hidden=!['invalid','unsaved','unavailable'].includes(s.persistence.status);persistence.textContent=persistence.hidden?'':t(s.persistence.status);
      replaceLabel.hidden=!s.replaceInvalidRequired;replaceText.textContent=t('replace');replace.disabled=externalBusy;
      resetLabel.hidden=!resetRequired();resetText.textContent=t('reset');reset.disabled=externalBusy;
    }finally{rendering=false;}
  }
  function edit(){
    if(!controller||externalBusy)return;if(mode.value==='automatic')explicitOptIn=true;generation++;checking=false;localError=null;reset.checked=false;
    const settings=mode.value==='automatic'?{...defaultAssistanceSettings(),...Object.fromEntries([...inputs].map(([field,{input}])=>[field,input.value.trim()===''?NaN:Number(input.value)]))}:null;
    try{controller.setDraft({mode:mode.value,settings});}catch(error){localError=error;}render();onChange();
  }
  mode.addEventListener('change',edit);for(const{input}of inputs.values())input.addEventListener('input',edit);
  for(const node of [reset,replace])node.addEventListener('change',()=>{render();onChange();});
  async function prepare({isCurrent=()=>true}={}){
    if(!controller)return null;const current=++generation;checking=true;localError=null;render();onChange();
    try{const result=await controller.prepareDraft();if(current!==generation||!isCurrent())return null;render();return result;}
    catch(error){if(current===generation){localError=error;render();}throw error;}
    finally{if(current===generation){checking=false;render();onChange();}}
  }
  check.addEventListener('click',()=>{if(!controller||externalBusy||checking)return;if(!explicitOptIn)reset.checked=false;explicitOptIn=true;prepare().catch(()=>{});});
  return{root,render,changed,checked,hasMachine,explicitOptIn:()=>explicitOptIn,
    open(next,{where='preview',hasTakes:existingTakes=false}={}){generation++;explicitOptIn=false;controller=next||null;origin=where;hasTakes=Boolean(existingTakes);externalBusy=false;modReset=false;localError=null;checking=false;reset.checked=replace.checked=false;if(controller){const s=controller.beginDraft();initial=s?.draft||null;if(!initial)controller=null;}render();},
    update({selection,busy=false,requiresReset=false}={}){externalBusy=busy;modReset=requiresReset;if(controller&&selection){const s=state();if(s.draft&&!assistanceEqual(s.draft.selection,selection)){generation++;checking=false;reset.checked=false;localError=null;controller.setDraft({selection});}}render();},
    restoreOriginal(){if(controller){generation++;checking=false;localError=null;reset.checked=false;controller.setDraft({mode:'original',settings:null});render();onChange();}},
    canApply(){const s=state();return !controller||Boolean(s?.draft&&!checking&&!localError&&(!resetRequired()||reset.checked)&&(!s.replaceInvalidRequired||replace.checked)&&!(s.draft.mode==='automatic'&&(s.draft.selection.profile.kind!=='piano'||!s.draft.selection.selected_part_ids.length)));},
    prepare,
    finishUnchanged(){controller?.cancelDraft();},
    resetConfirmed(){return !resetRequired()||reset.checked;},
    commit({isCurrent=()=>true}={}){return controller?.commitDraft({resetConfirmed:!resetRequired()||reset.checked,isCurrent,replaceInvalid:replace.checked})||null;},
    close({cancel=true}={}){generation++;checking=false;if(cancel)controller?.cancelDraft();controller=null;initial=null;explicitOptIn=false;localError=null;root.hidden=true;},
  };
}
