import {fixture} from './frontend-fixtures.js';

/** Original regression exercise, not a transcription of the reported source. */
export function densePianoforte() {
  const score = structuredClone(fixture), base = score.parts[0].notes[0];
  const rational = (numerator, denominator = 1) => ({numerator, denominator});
  score.id = 'original-numbered-layout-regression';
  score.title = 'Original dense numbered-layout regression';
  score.provenance.attribution = 'WorldMusicHub original numbered-layout regression fixture';
  score.parts[0].name = 'Pianoforte';
  score.parts[0].notes = [];
  score.measures = Array.from({length: 12}, (_, index) => ({number: index + 1, at: rational(index * 4), length: rational(4)}));
  for (let onset = 0; onset < 32; onset++) for (let voice = 1; voice <= 2; voice++) for (let chord = 0; chord < 3; chord++) {
    score.parts[0].notes.push({...structuredClone(base), id: `dense-${onset}-${voice}-${chord}`, at: rational(512 + onset, 16),
      pitch: {step: ['B', 'F', 'D'][chord], alter: (onset + chord) % 2 ? -2 : 1, octave: voice === 1 ? 4 + chord % 2 : 2 + chord % 2},
      voice: String(voice), staff: voice, duration: rational(1, onset % 2 ? 16 : 2)});
  }
  score.parts[0].notes.push({...structuredClone(base), id: 'bass-rest', at: rational(65, 2), pitch: null,
    voice: '3', staff: 2, duration: rational(3, 4), velocity: 0});
  return score;
}
