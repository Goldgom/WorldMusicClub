import {stageFeedbackView} from './hud-feedback.js';
import {getAppI18n} from './app-locale.js';
import {localizeStatic} from './locale-view.js';

const gradeKeys=['perfect','good','early','late','missed','extra'];
const phases=new Set(['ready','capturing','grace','pending','error','assessed','review','empty']);
const inconsistentReasons=new Set(['grade_counts_inconsistent','onset_counts_inconsistent']);

/** Present only the selected pass's checked Rust snapshot, with the HUD's freshness rules. */
export function resultsSummaryView({pass,passLabel,now=0,running=false,interrupted=false,latencyMs=0,toleranceMs=180},i18n=getAppI18n()){
  const checked=stageFeedbackView({mode:'practice',pass,now,running,interrupted,latencyMs,toleranceMs});
  const settled=['assessed','review'].includes(checked.phase);
  const missing=i18n.t(checked.phase==='empty'?'resultSummary.noTargets':settled?'resultSummary.unavailable':'resultSummary.notChecked');
  const inconsistent=settled&&inconsistentReasons.has(checked.summaryReasonCode);
  let title=pass?.label||i18n.t('resultSummary.noSelection');
  // An explicit app-owned display adapter may localize generated take names.
  // Retain canonical/source labels unchanged, including when the adapter fails.
  if(pass){
    try{
      const display=typeof passLabel==='function'?passLabel():passLabel;
      if(typeof display==='string'&&display.length>0)title=display;
    }catch{/* A display callback cannot prevent checked counters from rendering. */}
  }
  return{
    phase:checked.phase,summaryReasonCode:checked.summaryReasonCode,passId:pass?.id??null,revision:pass?.revision??null,assessedRevision:pass?.assessedRevision??null,
    title,
    status:i18n.t(`resultSummary.phase.${phases.has(checked.phase)?checked.phase:'ready'}`),
    revisionText:pass?.assessment?i18n.t('resultSummary.revisions',{checked:pass.assessedRevision,current:pass.revision}):'',
    grades:checked.grades,onsets:checked.onsets,
    gradeStatus:checked.grades?i18n.t('resultSummary.gradeStatus'):inconsistent?i18n.t('resultSummary.inconsistent'):missing,
    onsetStatus:checked.onsets?i18n.t('resultSummary.onsetStatus'):inconsistent?i18n.t('resultSummary.inconsistent'):missing,
  };
}

/** Stable DOM updates avoid repeatedly announcing an unchanged assessment. */
export function setupResultsSummary(document,{i18n=getAppI18n(document)}={}){
  const $=id=>document.getElementById(id);let previous='',context=null,disposed=false;
  function render(next){
    if(disposed)return;
    if(next)context=next;
    const region=$('result-summary');
    localizeStatic(region,i18n);
    if(!context)return;
    const view=resultsSummaryView(context,i18n),signature=JSON.stringify([i18n.revision,view]);
    if(signature===previous)return;previous=signature;
    region.dataset.phase=view.phase;region.dataset.passId=String(view.passId??'');
    region.dataset.revision=String(view.revision??'');region.dataset.assessedRevision=String(view.assessedRevision??'');
    $('result-summary-take').textContent=view.title;
    $('result-summary-status').textContent=view.status;
    $('result-summary-revision').textContent=view.revisionText;
    $('result-grade-status').textContent=view.gradeStatus;
    $('result-onset-status').textContent=view.onsetStatus;
    for(const key of gradeKeys)$(`result-grade-${key}`).textContent=view.grades?i18n.formatNumber(view.grades[key]):'—';
    $('result-onsets-complete').textContent=view.onsets?i18n.t('resultSummary.onsetCount',{complete:view.onsets.complete,total:view.onsets.total}):'—';
    $('result-onsets-sequence').textContent=view.onsets?i18n.formatNumber(view.onsets.longest_complete_sequence):'—';
  }
  render();
  const unsubscribe=i18n.subscribe(()=>render());
  render.destroy=()=>{if(disposed)return;disposed=true;unsubscribe();};
  return render;
}
