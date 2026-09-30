/** Validate the Rust target plan without inferring or grouping attacks in JavaScript. */
export function validateTargetPlan(plan, sourceTimeline) {
  const fail = () => { throw new Error('The physical target plan is incomplete or changes source attacks. Recheck the selection with Rust.'); };
  if (!plan || !plan.timeline || !Array.isArray(plan.timeline.notes) || !Array.isArray(plan.groups) || !Array.isArray(plan.diagnostics) || typeof plan.playable !== 'boolean' || plan.source_note_count !== sourceTimeline.notes.length || plan.target_count !== plan.timeline.notes.length || plan.groups.length !== plan.target_count || plan.timeline.duration_ms !== sourceTimeline.duration_ms) fail();
  const sources = new Map(sourceTimeline.notes.map(note=>[note.id,note]));
  const targets = new Map(plan.timeline.notes.map(note=>[note.id,note]));
  if (sources.size !== sourceTimeline.notes.length || targets.size !== plan.target_count) fail();
  const visited = new Set(); const groupIds = new Set();
  for (const group of plan.groups) {
    if (!group || !Array.isArray(group.source_occurrence_ids) || !group.source_occurrence_ids.length || !Array.isArray(group.source_note_ids) || !Array.isArray(group.part_ids) || groupIds.has(group.target_id)) fail();
    groupIds.add(group.target_id);
    const target = targets.get(group.target_id); if (!target) fail();
    const expectedSources = new Set(), expectedParts = new Set(); let maxDuration=0;
    for (const id of group.source_occurrence_ids) {
      const source = sources.get(id);
      if (!source || visited.has(id) || source.midi !== target.midi || source.start_ms !== target.start_ms) fail();
      visited.add(id);maxDuration=Math.max(maxDuration,source.duration_ms);expectedParts.add(source.part_id);
      for(const sourceId of source.source_note_ids?.length?source.source_note_ids:[source.source_note_id||source.id])expectedSources.add(sourceId);
    }
    const actualSources = new Set(group.source_note_ids), actualParts = new Set(group.part_ids);
    if (target.duration_ms !== maxDuration || actualSources.size !== expectedSources.size || [...actualSources].some(id=>!expectedSources.has(id)) || actualParts.size !== expectedParts.size || [...actualParts].some(id=>!expectedParts.has(id))) fail();
  }
  if (visited.size !== sources.size || (plan.playable && plan.target_count === 0)) fail();
  return plan;
}
export function mappedSourceIds(note, group = null) {
  return group?.source_note_ids || (note.source_note_ids?.length ? note.source_note_ids : [note.source_note_id || note.id]);
}
