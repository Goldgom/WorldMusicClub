import {fixture} from './frontend-fixtures.js';

// Original synthetic exercises only. No imported score, title or source data.
export function originalStaffRegisterScore(register = 'low') {
  const score = structuredClone(fixture), seed = score.parts[0].notes[0];
  score.id = `original-staff-register-${register}`;
  score.title = `Original ${register} staff register exercise`;
  score.provenance.attribution = 'WorldMusicHub original staff register regression fixture';
  score.parts[0].name = 'Original pitch guide';
  const pitches = {
    low: [['C', 1, 2], ['F', 1, 2], ['D', 0, 2], ['G', -1, 2], ['B', -2, 1], ['E', 0, 2], ['C', 2, 2], ['A', 0, 2]],
    high: [['C', 1, 7], ['F', 1, 7], ['D', 0, 7], ['G', -1, 7], ['B', -2, 6], ['E', 0, 7], ['C', 2, 7], ['A', 0, 7]],
    extremes: [['C', 0, -1], ['G', 0, 9], ['B', 1, -2], ['A', -2, 9]],
    chord: [['C', 0, 1], ['G', 1, 2], ['C', 0, 5], ['B', -2, 7], ['C', 0, 1]],
  }[register];
  if (!pitches) throw new Error('Unknown original staff register fixture');
  score.parts[0].notes = pitches.map(([step, alter, octave], index) => ({...structuredClone(seed),
    id: `register-${register}-${index}`, pitch: {step, alter, octave},
    at: {numerator: register === 'chord' ? 6 : index * 2, denominator: 4},
    duration: {numerator: 1, denominator: 4}, voice: register === 'chord' ? String(index + 1) : '1',
  }));
  score.parts[0].notes.push({...structuredClone(seed), id: `register-${register}-rest`, pitch: null,
    at: {numerator: 15, denominator: 4}, duration: {numerator: 1, denominator: 4}, velocity: 0});
  return score;
}
