import {pitchMidi, beat} from '../web/music.js';

/** Mocked browser-backend fixture, not a score compiler or Rust evidence.
 * Keep the legacy one-tempo/two-beat timing model and source occurrence order;
 * supply the identities and velocities required by production audio admission. */
export function compileBrowserFixture(score) {
  return {
    score,
    timeline: {
      notes: score.parts.flatMap(part => part.notes.filter(note => note.pitch).map(note => ({
        id: note.id,
        part_id: part.id,
        source_note_id: note.id,
        source_note_ids: [note.id],
        midi: pitchMidi(note.pitch),
        velocity: note.velocity,
        start_ms: beat(note.at) * 60000 / score.tempo[0].bpm,
        duration_ms: beat(note.duration) * 60000 / score.tempo[0].bpm,
        voice: note.voice,
        staff: note.staff,
      }))),
      duration_ms: 1000 * 120 / score.tempo[0].bpm,
    },
    diagnostics: [],
  };
}
