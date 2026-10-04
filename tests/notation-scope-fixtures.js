import {fixture} from './frontend-fixtures.js';
const rational=numerator=>({numerator,denominator:1});
/** Original authored arithmetic exercise. No imported music or private source.
 * Twelve distinct parts, a held note crossing pages, and late part entries. */
export function originalMultipartNotation({partCount=12,measures=24}={}) {
  const score=structuredClone(fixture);
  score.id='original-multipart-notation';score.title='Original twelve-part notation reachability';score.composer='WorldMusicHub test authors';
  score.provenance={kind:'original_exercise',attribution:'Original authored notation layout regression',source_url:null,license:'CC0-1.0'};
  score.measures=Array.from({length:measures},(_,index)=>({number:index+1,at:rational(index*4),length:rational(4)}));
  score.parts=Array.from({length:partCount},(_,index)=>({id:`original-part-${index+1}`,name:`Original part ${index+1}`,instrument:'piano',notes:[
    {...structuredClone(fixture.parts[0].notes[0]),id:`original-held-${index+1}`,at:rational(0),duration:rational(12),pitch:{step:['C','D','E','G'][index%4],alter:0,octave:3+index%3}},
    ...Array.from({length:Math.max(1,measures-3)},(_,bar)=>({...structuredClone(fixture.parts[0].notes[0]),id:`original-p${index+1}-m${bar+4}`,at:rational((bar+3)*4+index%3),duration:rational(1),pitch:{step:['C','D','E','G'][(index+bar)%4],alter:0,octave:3+index%3}}))
  ]}));
  return score;
}
