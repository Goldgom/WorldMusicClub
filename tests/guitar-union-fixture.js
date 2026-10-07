import {fixture} from './frontend-fixtures.js';

// Original C/E/G study, composed for this regression. No imported music.
export function originalGuitarUnionStudy() {
  const score=structuredClone(fixture),seed=score.parts[0].notes[0],beat=n=>({numerator:n,denominator:1});
  score.id='original-guitar-human-union';score.title='Original C E G human union study';score.composer='WorldMusicClub regression study';
  score.provenance={kind:'original_exercise',attribution:'Original C/E/G held-string browser regression',source_url:null,license:null};
  score.tempo=[{at:beat(0),bpm:60}];
  score.measures=[{number:1,at:beat(0),length:beat(4)},{number:2,at:beat(4),length:beat(4)}];
  score.parts=[['A','Held E','held-e','E',0,8],['B','Later G','later-g','G',4,4],['C','Middle C','middle-c','C',2,4]].map(([id,name,noteId,step,at,duration])=>({
    id,name,instrument:'guitar',notes:[{...structuredClone(seed),id:noteId,pitch:{step,alter:0,octave:4},at:beat(at),duration:beat(duration)}],
  }));
  return score;
}
