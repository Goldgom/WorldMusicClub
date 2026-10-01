const grades=['perfect','good','early','late'];
const count=value=>Number.isSafeInteger(value)&&value>=0;

/** Validate a supplied Rust snapshot; this never matches notes or invents grades. */
export function rustSnapshotSummary(assessment,expected){
  const result={grades:null,onsets:null,onsetHelp:null,accuracy:null,available:false,message:'Rust grade and onset summaries are unavailable in this response.'};
  if(!assessment||!count(expected)||!Array.isArray(assessment.hits)||!Array.isArray(assessment.misses)||!Array.isArray(assessment.extras))return result;
  const supplied=assessment.grade_counts,onsets=assessment.onset_completion;
  if(supplied!==undefined&&supplied!==null){
    const keys=[...grades,'missed','extra'];
    if(!keys.every(key=>count(supplied[key]))||grades.reduce((sum,key)=>sum+supplied[key],0)!==assessment.hits.length||supplied.missed!==assessment.misses.length||supplied.extra!==assessment.extras.length||assessment.hits.length+supplied.missed!==expected||grades.some(key=>assessment.hits.filter(hit=>hit.grade===key).length!==supplied[key]))return{...result,message:'The supplied Rust grade totals are inconsistent; open Results to inspect this response.'};
    result.grades=Object.fromEntries(keys.map(key=>[key,supplied[key]]));
  }
  if(onsets!==undefined&&onsets!==null){
    if(!['total','complete','longest_complete_sequence'].every(key=>count(onsets[key]))||onsets.total>expected||onsets.complete>onsets.total||onsets.longest_complete_sequence>onsets.complete||(expected>0&&onsets.total===0)||(onsets.complete>0&&onsets.longest_complete_sequence===0))return{...result,grades:null,message:'The supplied Rust onset summary is inconsistent; open Results to inspect this response.'};
    result.onsets={...onsets};
    result.onsetHelp='A complete onset group means every target at that expected onset matched within the timing window. Inputs need not arrive simultaneously; this does not grade chord synchronization.';
  }
  if(expected>0&&Number.isFinite(assessment.accuracy_percent)&&assessment.accuracy_percent>=0&&assessment.accuracy_percent<=100)result.accuracy=`${Math.round(assessment.accuracy_percent)}%`;
  result.available=Boolean(result.grades||result.onsets);
  if(result.available)result.message='Assessed onset snapshot. The match rate includes extra inputs; timing grades remain separate. A 100% match rate does not mean perfect timing. Onset sequences describe coverage, not a combo or an error-free streak. Very late timestamps can revise this snapshot.';
  return result;
}

/** Scope the HUD to one recorder/pass revision, including delayed input grace. */
export function stageFeedbackView({mode,pass=null,now=0,running=false,interrupted=false,latencyMs=0,toleranceMs=180}){
  const captured=pass?.inputs?.length||0,base={phase:'ready',label:mode==='practice'?'Ready to practice · 准备练习':'Listen & explore · 聆听',captured,passId:pass?.id??null,revision:pass?.revision??null,accuracy:null,grades:null,onsets:null,onsetHelp:null,message:'Play your part, then open Results to check this take. Key lights show input or scheduled notes.'};
  if(mode!=='practice')return{...base,phase:'listen',captured:0,message:'Listening preserves every source note. Switch to Practice for note-on assessment.'};
  if(!pass)return base;
  if(pass.error)return{...base,phase:'error',label:`${pass.label} · Check failed · 检查失败`,message:'Inputs are retained. Open Results to retry or export this take.'};
  if(running&&pass.closedWall===null)return{...base,phase:'capturing',label:`${pass.label} · Capturing notes · 记录音符`,message:'Captured note count is provisional. Pause and check this take to see pitch and timing feedback.'};
  const segmentEnd=pass.segments?.at(-1)?.wallEnd;
  const pauseDeadline=pass.captureEnabled!==false&&pass.closedWall===null&&Number.isFinite(segmentEnd)?segmentEnd+Math.max(0,latencyMs)+toleranceMs:null;
  const grace=pass.manualDeadline!==null&&pass.manualDeadline>now||pass.deadline!==null&&pass.deadline>now||pauseDeadline!==null&&pauseDeadline>now;
  if(grace)return{...base,phase:'grace',label:`${pass.label} · Receiving delayed input · 接收延迟输入`,message:'This pause can still receive delayed input. Previous checked values stay hidden until its latency and timing-window buffer has passed.'};
  if(pass.inFlight||pass.manualDeadline!==null||pass.assessedRevision!==pass.revision)return{...base,phase:'pending',label:`${pass.label} · Check pending · 等待检查`,message:'Rust has not checked this input revision. Open Results to check a paused take or inspect pending work.'};
  if(!pass.assessment)return base;
  const expected=pass.timeline?.notes?.length||0,summary=rustSnapshotSummary(pass.assessment,expected);
  if(expected===0)return{...base,phase:'empty',label:`${pass.label} · No targets · 无目标音符`,message:'This snapshot contains no note-on targets and does not demonstrate a successful take.'};
  const review=Boolean(pass.boundaryReviews?.length||interrupted);
  return{...base,phase:review?'review':'assessed',label:`${pass.label} · ${review?'Provisional check · 暂定结果':'Previous check · 上次检查'}`,accuracy:summary.accuracy,grades:summary.grades,onsets:summary.onsets,onsetHelp:summary.onsetHelp,message:review?'This snapshot needs boundary or clock-gap review. Corrected-clock ownership is deterministic; continuous cross-pass matching has not been evaluated. All events remain in the take export.':summary.message};
}
