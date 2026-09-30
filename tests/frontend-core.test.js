import test from 'node:test';
import assert from 'node:assert/strict';
import {PIANO_RANGES, keyboardGeometry, jianpu, pitchMidi, midiName, transposeTempo, renderNotation, fretPositions} from '../web/music.js';
import {Transport, Synth} from '../web/transport.js';

import {fixture} from './frontend-fixtures.js';

test('all keyboard ranges contain exact MIDI endpoints and bounded geometry', () => {
 for (const [count, endpoints] of Object.entries(PIANO_RANGES)) { const keys=keyboardGeometry(count); assert.equal(keys.length,Number(count)); assert.equal(keys[0].midi,endpoints[0]); assert.equal(keys.at(-1).midi,endpoints[1]); assert.ok(keys.every(k => k.x >= 0 && k.x + k.width <= 1.000001)); }
});
test('pitch spelling and fixed-C jianpu retain accidentals and octave information', () => {
 assert.equal(pitchMidi({step:'B',alter:-1,octave:3}),58); assert.equal(midiName(60),'C4'); assert.deepEqual(jianpu({step:'D',alter:1,octave:5}),{number:'2',accidental:'♯',octave:1}); assert.equal(jianpu(null).number,'0');
});
test('tempo change preserves relative tempo map and leaves source untouched', () => {
 const score=structuredClone(fixture); score.tempo.push({at:{numerator:4,denominator:1},bpm:60}); const modified=transposeTempo(score,90); assert.deepEqual(modified.tempo.map(t=>t.bpm),[90,45]); assert.equal(score.tempo[0].bpm,120);
});
test('notation escapes all score-provided SVG text and note identifiers', () => {
 const score=structuredClone(fixture); score.parts[0].name='<script>bad()</script>'; score.parts[0].notes[0].id='" onload="bad'; const svg=renderNotation(score); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&quot; onload=&quot;')); assert.ok(renderNotation(score,'jianpu').includes('Fixed C numbered pitch view'));
});
test('guitar options never invent frets outside instrument range', () => { assert.deepEqual(fretPositions(40),[{string:5,fret:0}]); assert.equal(fretPositions(90).length,0); assert.ok(fretPositions(64).every(p=>p.fret>=0&&p.fret<=12)); });
const notes=[{id:'one',start_ms:0,duration_ms:500},{id:'two',start_ms:500,duration_ms:500}];
test('transport count-in schedules exactly once, then resumes a sustained note', () => {
 const t=new Transport(); t.start(1000,notes,1000); assert.equal(t.time(1000),-1000); assert.deepEqual(t.due(1000,notes),[]); assert.equal(t.due(1950,notes)[0].delay_ms,50); assert.equal(t.due(1950,notes).length,0); t.pause(2200); assert.equal(t.position,200); t.start(5000,notes); const due=t.due(5000,notes); assert.equal(due.length,1); assert.equal(due[0].remaining_ms,300); assert.equal(t.time(5100),300);
});
test('transport repeated starts, reset and completion cannot accumulate clock drift', () => {
 const t=new Transport(); t.start(0,notes); t.start(50,notes); assert.equal(t.time(100),100); t.finish(1000); assert.equal(t.running,false); t.start(1200,notes); assert.equal(t.time(1200),0); t.reset(); assert.equal(t.position,0); assert.equal(t.cursor,0);
});
test('synth is silent until user gesture unlock and silence cancels all scheduled voices', async () => {
 const calls=[]; class Param {setValueAtTime(...a){calls.push(['value',...a])}linearRampToValueAtTime(){}exponentialRampToValueAtTime(){}setTargetAtTime(){}cancelScheduledValues(){calls.push(['cancel'])}}
 class Audio {state='running';currentTime=2;destination={};createGain(){return{gain:new Param(),connect(){},disconnect(){}}}createOscillator(){return{frequency:{},connect(){},disconnect(){},start(at){calls.push(['start',at])},stop(at){calls.push(['stop',at])}}}}
 const old=globalThis.AudioContext; globalThis.AudioContext=Audio; try {const synth=new Synth();synth.play('a',60);assert.equal(calls.length,0);await synth.unlock();synth.play('a',60,1000,500);synth.play('b',64,null);assert.equal(synth.voices.size,2);synth.silence();assert.equal(synth.voices.size,0);assert.equal(calls.filter(x=>x[0]==='cancel').length,2);assert.ok(calls.some(x=>x[0]==='stop'&&x[1]===2));}finally{globalThis.AudioContext=old}
});

import {validHex, validTheme, isDark} from '../web/themes.js';
import {parsePitch, reviewedScore} from '../web/image-review.js';
import {decodeMidi} from '../web/midi.js';
test('theme configuration rejects arbitrary CSS and falls back for corrupt storage', () => { assert.equal(validHex('url(https://bad)'),false);assert.equal(validHex('#aAbBcC'),true);assert.equal(validTheme({mode:'custom',accent:'red',background:'#111111'}).accent,'#326b4c');assert.equal(validTheme(null).mode,'system');assert.equal(isDark('#111111'),true);assert.equal(isDark('#ffffff'),false); });
test('review editor requires manually confirmed timing and validates pitch range', () => {assert.deepEqual(parsePitch('Bb3'),{step:'B',alter:-1,octave:3});assert.throws(()=>parsePitch('<script>'));assert.throws(()=>parsePitch('G#9'));assert.throws(()=>reviewedScore({title:'test',rows:[{pitch:'C4',duration:''}],filename:'example.png',originalImage:'data:',review:null,crop:null}),/duration/);});
test('image review preserves source, manual durations, rests and exact rational time', () => {const rows=[{pitch:'C4',duration:'0.5'},{pitch:'F#4',duration:'1'},{pitch:'0',duration:'0.25'}];const score=reviewedScore({title:'Reviewed',rows,filename:'notes.png',originalImage:'data:image/png;base64,original',review:{requires_review:true},crop:{x:0,y:0,width:10,height:20}});assert.deepEqual(score.parts[0].notes[1].at,{numerator:2,denominator:4});assert.equal(score.parts[0].notes[2].pitch,null);assert.equal(score.provenance.kind,'user_reviewed_image');assert.equal(JSON.parse(score.source.content).original_image_data_url,'data:image/png;base64,original');assert.deepEqual(JSON.parse(score.source.content).manual_notes,rows);});
test('MIDI parser handles note-off, zero-velocity note-on and rejects non-note messages', () => {assert.deepEqual(decodeMidi([0x92,64,90]),{kind:'on',channel:2,midi:64,velocity:90});assert.equal(decodeMidi([0x90,60,0]).kind,'off');assert.equal(decodeMidi([0x80,60,40]).kind,'off');assert.equal(decodeMidi([0xb0,64,127]),null);assert.equal(decodeMidi([0x90,129,100]),null);assert.equal(decodeMidi([0xf8]),null);});

import {notationPageCount} from '../web/music.js';
import {TimelineIndex} from '../web/transport.js';
test('notation windows keep huge or sparse score geometry bounded and preserve later pages', () => {const score=structuredClone(fixture);score.parts[0].notes[1].at={numerator:1000000,denominator:1};const svg=renderNotation(score);assert.ok(svg.length<4000);assert.ok(!svg.includes('data-note-id="e4"'));assert.equal(notationPageCount(score),62501);const later=renderNotation(score,'jianpu',{startBeat:1000000});assert.ok(later.includes('data-note-id="e4"'));assert.ok(!later.includes('data-note-id="c4"'));});
test('timeline index includes long overlapping sustains, chords, and exact note boundaries', () => {const notes=[{id:'long',start_ms:0,duration_ms:5000},{id:'a',start_ms:0,duration_ms:500},{id:'b',start_ms:500,duration_ms:500},{id:'c',start_ms:500,duration_ms:250},{id:'late',start_ms:2000,duration_ms:500}];const index=new TimelineIndex(notes);assert.deepEqual(index.range(500).map(n=>n.id),['long','b','c']);assert.deepEqual(index.range(1000,2100).map(n=>n.id),['long','late']);assert.deepEqual(index.range(5000),[]);});
test('timeline index matches a full scan over dense mixed-duration notes', () => {const notes=Array.from({length:10000},(_,i)=>({id:String(i),start_ms:i*8,duration_ms:50+(i%19)*10}));const index=new TimelineIndex(notes);for(let time=0;time<80000;time+=733){assert.deepEqual(index.range(time,time+1000).map(n=>n.id),notes.filter(n=>n.start_ms<=time+1000&&n.start_ms+n.duration_ms>time).map(n=>n.id));}});
