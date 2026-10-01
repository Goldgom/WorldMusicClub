import {NotationNavigationIndex} from './notation-follow.js';

/** Index Rust's written-event clock. Never derive tempo, repeats or scoring here. */
export class WrittenCursorIndex {
  constructor(cursor, navigation) {
    const fail = () => { throw Error('Written-note following does not match this complete score/navigation response. Static notation and playback remain available.'); };
    if (!cursor || cursor.version !== 1 || !Array.isArray(cursor.source_note_ids)
      || !Array.isArray(cursor.spans) || cursor.spans.length > 1000000
      || !navigation?.sourceNotes || !Array.isArray(navigation.occurrences)
      || typeof navigation.at !== 'function') fail();
    const sourceIds = cursor.source_note_ids;
    if (sourceIds.length !== navigation.sourceNotes.size || new Set(sourceIds).size !== sourceIds.length
      || sourceIds.some(id => typeof id !== 'string' || !navigation.sourceNotes.has(id))) fail();
    const compare = (a, b) => BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
    const noteEnd = note => ({numerator: BigInt(note.at.numerator) * BigInt(note.duration.denominator) + BigInt(note.duration.numerator) * BigInt(note.at.denominator), denominator: BigInt(note.at.denominator) * BigInt(note.duration.denominator)});
    const expected = navigation.occurrences.map(occurrence => new Set([...occurrence.written_note_ids, ...occurrence.continuing_note_ids]));
    const rows = navigation.occurrences.map(() => []);
    this.navigation = navigation;
    for (const span of cursor.spans) {
      if (!span || typeof span !== 'object' || !Number.isInteger(span.source_note_index) || span.source_note_index < 0 || span.source_note_index >= sourceIds.length
        || !Number.isInteger(span.measure_occurrence_index) || span.measure_occurrence_index < 0 || span.measure_occurrence_index >= rows.length) fail();
      const sourceNoteId = sourceIds[span.source_note_index];
      const occurrence = navigation.occurrences[span.measure_occurrence_index];
      const source = navigation.sourceNotes.get(sourceNoteId), note = source.note;
      if (!expected[span.measure_occurrence_index].delete(sourceNoteId)
        || !Number.isFinite(span.start_ms) || !Number.isFinite(span.end_ms)
        || span.start_ms < occurrence.start_ms || span.end_ms > occurrence.end_ms || span.end_ms <= span.start_ms) fail();
      // Exact rational membership and boundary equality; interior wall-clock
      // values remain the Rust response, never an independent JS tempo estimate.
      const end = noteEnd(note);
      if (compare(note.at, occurrence.source_to) >= 0n || compare(end, occurrence.source_from) <= 0n
        || compare(note.at, occurrence.source_from) <= 0n && span.start_ms !== occurrence.start_ms
        || compare(end, occurrence.source_to) >= 0n && span.end_ms !== occurrence.end_ms) fail();
      rows[span.measure_occurrence_index].push(Object.freeze({
        sourceNoteId, partId: source.partId, note, sourceMeasureIndex: occurrence.source_measure_index,
        measureOccurrenceId: occurrence.id, startMs: span.start_ms, endMs: span.end_ms,
      }));
    }
    if (expected.some(ids => ids.size)) fail();
    this.byOccurrence = new Map(navigation.occurrences.map((occurrence, index) => {
      const entries = rows[index].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
      let end = -Infinity;
      const maxEnds = entries.map(entry => (end = Math.max(end, entry.endMs)));
      return [occurrence.id, {entries, maxEnds}];
    }));
  }

  /** Half-open written segments, including rests. Caller applies part/target scope. */
  at(position) {
    const occurrence = this.navigation.at(position);
    if (!occurrence) return {occurrence: null, entries: []};
    const {entries, maxEnds} = this.byOccurrence.get(occurrence.id);
    let low = 0, high = entries.length;
    while (low < high) { const middle = (low + high) >>> 1; if (maxEnds[middle] <= position) low = middle + 1; else high = middle; }
    const first = low;
    high = entries.length;
    while (low < high) { const middle = (low + high) >>> 1; if (entries[middle].startMs <= position) low = middle + 1; else high = middle; }
    return {occurrence, entries: entries.slice(first, low).filter(entry => position < entry.endMs)};
  }
}

/** Lazy score-scoped preparation. A failed response is retried only explicitly. */
export function setupWrittenCursor({api, getContext, onStatus = () => {}}) {
  let target = null, timeline = null, index = null, controller = null, pending = null;
  let generation = 0, status = 'idle', message = 'Current-note following is idle.';
  const publish = (next, text) => { status = next; message = text; onStatus({status, message}); };
  function reset() {
    generation++; controller?.abort(); controller = null; pending = null;
    target = null; timeline = null; index = null;
    publish('idle', 'Current-note following is idle.');
  }
  function prepare({retry = false} = {}) {
    const context = getContext();
    if (!context?.score || !context.timeline) { if (target) reset(); return Promise.resolve(null); }
    if (target !== context.score || timeline !== context.timeline) {
      reset(); target = context.score; timeline = context.timeline;
    }
    if (index) return Promise.resolve(index);
    if (pending) return pending;
    if (status === 'unavailable' && !retry) return Promise.resolve(null);
    const current = ++generation, score = target, compiled = timeline;
    controller = new AbortController(); const signal = controller.signal;
    publish('loading', 'Preparing exact current-note positions…');
    const isCurrent = () => current === generation && !signal.aborted && getContext()?.score === score && getContext()?.timeline === compiled;
    pending = (async () => {
      try {
        const response = await api('/api/notation-navigation', score, signal);
        if (!isCurrent()) return null;
        const navigation = new NotationNavigationIndex(response, score, compiled);
        if (!response.written_cursor) throw Error(response.diagnostics?.find(item => item.code === 'notation_written_cursor_unavailable')?.message || 'This server response has no complete written-note cursor. Restart with a current server build.');
        const prepared = new WrittenCursorIndex(response.written_cursor, navigation);
        if (!isCurrent()) return null;
        index = prepared;
        publish('ready', 'Expected written notes follow the Rust clock. Held inputs and assessment are separate.');
        return index;
      } catch (error) {
        if (isCurrent()) publish('unavailable', `Current-note following unavailable: ${error.message} Static notation and playback remain available.`);
        return null;
      }
    })().finally(() => {
      if (current === generation) { pending = null; controller = null; }
    });
    return pending;
  }
  return {
    prepare, reset,
    state: () => ({status, message}),
    at(position) {
      const context = getContext();
      return index && context?.score === target && context?.timeline === timeline ? index.at(position) : null;
    },
  };
}
