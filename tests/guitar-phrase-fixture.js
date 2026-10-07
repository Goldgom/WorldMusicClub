import {fixture} from './frontend-fixtures.js';

export const phraseBeat=(numerator,denominator=1)=>({numerator,denominator});
export const GUITAR_PHRASE_SCOPE=Object.freeze({version:1,from:phraseBeat(5,2),to:phraseBeat(4)});
export const GUITAR_PHRASE_OLD_SCOPE=Object.freeze({version:1,from:phraseBeat(2),to:phraseBeat(7,2)});
export const GUITAR_PHRASE_LOCKS=Object.freeze([
  {source_note_id:'entry-e-tail',string:2,fret:5,finger:3},
  {source_note_id:'outside-after',string:5,fret:0,finger:0},
]);

// Self-authored boundary/tie exercise. No third-party score, audio or artwork.
export function originalGuitarPhraseStudy(suffix='') {
  const score=structuredClone(fixture),seed=score.parts[0].notes[0],q=phraseBeat;
  const note=(id,step,octave,at,duration,extra={})=>({...structuredClone(seed),id,pitch:{step,alter:0,octave},at,duration,...extra});
  score.id='original-guitar-phrase-union'+suffix;
  score.title='Original exact guitar phrase'+suffix;
  score.composer='WorldMusicClub regression study';
  score.provenance={kind:'original_exercise',attribution:'Original exact-boundary tied E/G and open A/D browser study',source_url:null,license:null};
  score.source={format:'original-test-text',filename:'original-phrase.txt',content:'Original E/G phrase study.\r\nKeep the full tie and the source. 原稿\n'};
  score.tempo=[{at:q(0),bpm:60}];
  score.measures=[{number:1,at:q(0),length:q(4)},{number:2,at:q(4),length:q(4)}];
  score.parts=[
    {id:'A',name:'Entry and boundaries',instrument:'guitar',notes:[
      note('outside-before','C',4,q(0),q(5,2),{voice:'2'}),
      note('entry-e','E',4,q(1),q(2),{tie_start:true}),
      note('entry-e-tail','E',4,q(3),q(2),{tie_stop:true}),
      note('outside-after','A',2,q(4),q(1),{voice:'2'}),
    ]},
    {id:'B',name:'Inside G tail',instrument:'guitar',notes:[note('inside-g','G',4,q(3),q(3,2))]},
    {id:'C',name:'Machine D',instrument:'guitar',notes:[note('machine-d','D',3,q(11,4),q(1))]},
  ];
  return score;
}
