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
    hasSummary: Boolean(summary)
  };
}
