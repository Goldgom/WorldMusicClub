import {stageFeedbackView} from './hud-feedback.js';

const gradeKeys=['perfect','good','early','late','missed','extra'];
const unavailable='Unavailable in this saved result or server response · 此结果未提供';
const phases={
  ready:'No checked result yet · 尚无检查结果',
  capturing:'Capturing notes; check this take after pausing · 记录中，暂停后检查',
  grace:'Receiving delayed input; previous counts are hidden · 接收延迟输入，暂不显示旧计数',
  pending:'Check pending for this input revision · 当前输入版本等待检查',
  error:'Check failed; retry in Results · 检查失败，请重试',
  assessed:'Previous check · 上次检查',
  review:'Provisional check; review boundary or clock-gap warnings below · 暂定结果，请查看下方边界或时钟中断提示',
  empty:'Unavailable: no note-on targets; this is not a successful take · 无目标音符，不能表示练习成功',
};

/** Present only the selected pass's checked Rust snapshot, with the HUD's freshness rules. */
export function resultsSummaryView({pass,now=0,running=false,interrupted=false,latencyMs=0,toleranceMs=180}){
  const checked=stageFeedbackView({mode:'practice',pass,now,running,interrupted,latencyMs,toleranceMs});
  const settled=['assessed','review'].includes(checked.phase);
  const missing=checked.phase==='empty'?'Unavailable: no note-on targets · 无目标音符':settled?unavailable:'Unavailable until this take is checked · 等待本次检查';
  const inconsistent=settled&&checked.message.includes('inconsistent');
  return{
    phase:checked.phase,passId:pass?.id??null,revision:pass?.revision??null,assessedRevision:pass?.assessedRevision??null,
    title:pass?.label||'No take selected · 未选择记录',
    status:phases[checked.phase]||phases.ready,
    revisionText:pass?.assessment?`Checked input revision ${pass.assessedRevision} · Current input revision ${pass.revision} · 已检查 / 当前输入版本`:'',
    grades:checked.grades,onsets:checked.onsets,
    gradeStatus:checked.grades?'Exclusive attack counts · 每次起音只计入一类':inconsistent?'Unavailable: inconsistent Rust summary · 结果计数不一致':missing,
    onsetStatus:checked.onsets?'Coverage in expected score order · 按乐谱顺序统计覆盖':inconsistent?'Unavailable: inconsistent Rust summary · 结果计数不一致':missing,
  };
}

/** Stable DOM updates avoid repeatedly announcing an unchanged assessment. */
export function setupResultsSummary(document){
  const $=id=>document.getElementById(id);let previous='';
  return context=>{
    const view=resultsSummaryView(context),signature=JSON.stringify(view);
    if(signature===previous)return;previous=signature;
    const region=$('result-summary');
    region.dataset.phase=view.phase;region.dataset.passId=String(view.passId??'');
    region.dataset.revision=String(view.revision??'');region.dataset.assessedRevision=String(view.assessedRevision??'');
    $('result-summary-take').textContent=view.title;
    $('result-summary-status').textContent=view.status;
    $('result-summary-revision').textContent=view.revisionText;
    $('result-grade-status').textContent=view.gradeStatus;
    $('result-onset-status').textContent=view.onsetStatus;
    for(const key of gradeKeys)$(`result-grade-${key}`).textContent=view.grades?String(view.grades[key]):'—';
    $('result-onsets-complete').textContent=view.onsets?`${view.onsets.complete} / ${view.onsets.total}`:'—';
    $('result-onsets-sequence').textContent=view.onsets?String(view.onsets.longest_complete_sequence):'—';
  };
}
