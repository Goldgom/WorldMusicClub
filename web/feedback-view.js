/** Presentation only: Rust calculates matching, bias, variability and advice. */
export function feedbackView(assessment, expectedFallback) {
  const summary = assessment.summary || null;
  const expected = summary?.expected_notes ?? expectedFallback;
  const hits = assessment.hits.length;
  return {
    expected,
    accuracy: expected > 0 ? `${Math.round(assessment.accuracy_percent)}%` : '—',
    hits: String(hits),
    misses: `${assessment.misses.length} / ${assessment.extras.length}`,
    meanError: assessment.mean_abs_error_ms === null ? '—' : `${Math.round(assessment.mean_abs_error_ms)} ms`,
    coverage: expected > 0 ? `${Math.round(summary?.coverage_percent ?? hits / expected * 100)}%` : '—',
    bias: Number.isFinite(summary?.timing_bias_ms) ? `${summary.timing_bias_ms > 0 ? '+' : ''}${Math.round(summary.timing_bias_ms)} ms${summary.timing_bias_ms > 0 ? ' late' : summary.timing_bias_ms < 0 ? ' early' : ''}` : '—',
    spread: Number.isFinite(summary?.timing_stddev_ms) ? `${Math.round(summary.timing_stddev_ms)} ms` : '—',
    advice: expected === 0 ? [{severity:'warning',code:'empty_target',message:'No note-on targets in this range. This result does not demonstrate a successful take; select a range containing notes.'}, ...(summary?.advice || []).filter(item=>item.code!=='no_targets')] : summary?.advice || [],
    timingBiasMs: Number.isFinite(summary?.timing_bias_ms) ? summary.timing_bias_ms : null,
    hasSummary: Boolean(summary)
  };
}

function timingText(value,{signed=false}={}){
 if(value===null)return'—';
 const magnitude=Math.round(Math.abs(value)*10)/10;
 const amount=magnitude===0&&value!==0?'<0.1':String(magnitude);
 if(!signed)return`${amount} ms`;
 return value===0?'0 ms':`${amount} ms ${value<0?'early':'late'}`;
}
/** A bounded display of Rust's rows. Never infer substitutions or recalculate matching. */
export function pitchBreakdownView(assessment,expected){
 const unavailable=(messageCode,message)=>({available:false,rows:[],messageCode,message});
 const rows=assessment.pitch_breakdown;
 if(rows===undefined||rows===null)return unavailable('pitch_breakdown_absent','Per-pitch feedback is unavailable in this saved result or server response.');
 if(!Array.isArray(rows)||rows.length>128)return unavailable('pitch_breakdown_rows_invalid','Per-pitch feedback is unavailable because this response has invalid or excessive rows.');
 let last=-1,totalExpected=0,totalMatched=0,totalMissed=0,totalExtra=0;
 for(const row of rows){
  if(!row||!Number.isInteger(row.midi)||row.midi<0||row.midi>127||row.midi<=last||!['expected','matched','missed','extra'].every(key=>Number.isSafeInteger(row[key])&&row[key]>=0)||row.matched>row.expected||row.expected-row.matched!==row.missed||row.expected===0&&row.extra===0)return unavailable('pitch_breakdown_inconsistent','Per-pitch feedback is unavailable because the response is inconsistent.');
  if(row.matched===0?(row.mean_abs_error_ms!==null||row.timing_bias_ms!==null):(!Number.isFinite(row.mean_abs_error_ms)||row.mean_abs_error_ms<0||!Number.isFinite(row.timing_bias_ms)))return unavailable('pitch_breakdown_timing_invalid','Per-pitch timing is unavailable because the response is inconsistent.');
  last=row.midi;totalExpected+=row.expected;totalMatched+=row.matched;totalMissed+=row.missed;totalExtra+=row.extra;
 }
 if(totalExpected!==expected||totalMatched!==assessment.hits.length||totalMissed!==assessment.misses.length||totalExtra!==assessment.extras.length)return unavailable('pitch_breakdown_totals_mismatch','Per-pitch feedback is unavailable because its totals do not match this assessment.');
 return{available:true,messageCode:rows.length?'pitch_breakdown_ready':'pitch_breakdown_empty',message:rows.length?'Rust-derived rows for this take’s selected physical note-on targets.':'This assessment contains no expected or extra note-on attacks.',rows:rows.map(row=>({...row,sampleCode:row.matched===0?'pitch_sample_none':row.matched<5?'pitch_sample_small':'pitch_sample_matched',meanError:timingText(row.mean_abs_error_ms),bias:timingText(row.timing_bias_ms,{signed:true}),sample:row.matched===0?'No matched attacks':row.matched<5?`${row.matched} matched · small sample`:`${row.matched} matched`}))};
}
