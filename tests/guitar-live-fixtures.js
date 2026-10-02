import {fixture} from './frontend-fixtures.js';

/** Original chords for exact-source live route regression. */
export function originalGuitarChordTransitions(){
  const score=structuredClone(fixture),seed=score.parts[0].notes[0],q=n=>({numerator:n,denominator:1});
  score.id='original-complete-guitar-chords';score.title='Original complete guitar chord transitions';score.parts[0].name='Guitar';score.parts[0].instrument='guitar';
  const open=[['E',4],['B',3],['G',3],['D',3],['A',2],['E',2]],second=[['F',1,4],['C',1,4],['A',0,3],['E',0,3],['B',0,2],['F',1,2]],third=[['A',0,4],['E',0,4],['C',0,4],['G',0,3],['D',0,3],['A',0,2]];
  score.parts[0].notes=[open.map(([step,octave])=>[step,0,octave]),second,third].flatMap((chord,group)=>chord.map(([step,alter,octave],string)=>({...structuredClone(seed),id:`chord-${group}-${string}`,at:q(group*4),duration:q(3),pitch:{step,alter,octave},voice:String(string+1)})));
  score.measures=Array.from({length:3},(_,i)=>({number:i+1,at:q(i*4),length:q(4)}));return score;
}

