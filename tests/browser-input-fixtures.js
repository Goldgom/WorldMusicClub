import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';

// Independent expected physical layout: never derive expected pitches from the
// implementation under test, the browser labels, or a mutable locale catalog.
const rows = [
  ['bottom', 'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash'.split(' '), 'z x c v b n m , . /'.split(' ')],
  ['home', 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote'.split(' '), "a s d f g h j k l ; '".split(' ')],
  ['upper', 'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash'.split(' '), 'q w e r t y u i o p [ ] \\'.split(' ')],
  ['number', 'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal'.split(' '), '` 1 2 3 4 5 6 7 8 9 0 - ='.split(' ')],
];
export const wideKeyboardBindings = Object.freeze(rows.flatMap(([row,codes,keys]) => codes.map((code,index) => ({row,code,key:keys[index]}))).map((binding,index) => Object.freeze({...binding,midi:36+index})));

// Original C4/E4/G4 quarter notes, not a transcription. All three FF51 events
// occur in one track at tick zero; the last declaration makes each quarter 600 ms.
export function orderedInitialTempoBrowserMidi() {
  const title = Buffer.from('Original ordered tempo study');
  const events = [0, 0xff, 0x03, title.length, ...title,
    0, 0xff, 0x58, 4, 3, 2, 24, 8, // Explicit 3/4 meter.
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 500,000 us/quarter.
    0, 0xff, 0x51, 3, 0x0b, 0x71, 0xb0, // 750,000 us/quarter.
    0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0]; // 600,000 us/quarter.
  for (const midi of [60, 64, 67]) events.push(0, 0x90, midi, 80, 96, 0x80, midi, 0);
  events.push(0, 0xff, 0x2f, 0);
  const track = Buffer.from(events), length = Buffer.alloc(4);
  length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from('MThd'), Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 0, 96]), Buffer.from('MTrk'), length, track]);
}

export async function selectLegacyEnglish(page, {fresh = false} = {}) {
  const picker = page.locator('#interface-language');
  await picker.waitFor({state:'attached'});
  if (fresh) {
    assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN','A fresh browser starts in Simplified Chinese');
    assert.equal(await picker.inputValue(),'zh-CN');
    assert.equal(await page.locator('#settings-button').textContent(),'设置');
    assert.equal(await picker.getAttribute('aria-label'),'界面语言');
  }
  if (await picker.inputValue() === 'en') return;
  await page.locator('#settings-button').click();
  await picker.selectOption('en');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await picker.getAttribute('aria-label'),'Interface language');
  await page.locator('#settings-dialog [data-close-panel]').click();
}

export function keyboardBrowserScore(id = 'original-keyboard-browser') {
  const score = structuredClone(fixture);
  score.id = id; score.title = 'Original keyboard browser exercise';
  score.tempo[0].bpm = 60;
  score.parts[0].notes[1].at = {numerator:63,denominator:1};
  score.measures = Array.from({length:16},(_,index) => ({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));
  score.source = {format:'original-test-text',filename:'original-keyboard.txt',content:'\uFEFFOriginal input exercise · 原稿\r\nC4 at 0/1; E4 at 63/1. Preserve exact source.'};
  return score;
}

// Observe the real audio implementation without replacing rendering or its clock.
export function observeRealAudio(target = window) {
  target.audioObservation = {construct:0,resume:0,oscillator:0,start:0,stop:0};
  target.audioObservedContexts = [];
  const Audio = target.AudioContext || target.webkitAudioContext;
  if (!Audio) throw new Error('The real browser must expose an AudioContext');
  const resume = Audio.prototype.resume, oscillator = Audio.prototype.createOscillator;
  Audio.prototype.resume = function(...args) { target.audioObservation.resume++; return resume.apply(this,args); };
  Audio.prototype.createOscillator = function(...args) {
    target.audioObservation.oscillator++;const node=oscillator.apply(this,args),start=node.start,stop=node.stop;
    node.start=function(...values){target.audioObservation.start++;return start.apply(this,values);};
    node.stop=function(...values){target.audioObservation.stop++;return stop.apply(this,values);};
    return node;
  };
  const observed = new Proxy(Audio,{construct(constructor,args,newTarget) { target.audioObservation.construct++;const context=Reflect.construct(constructor,args,newTarget);target.audioObservedContexts.push(context);return context; }});
  if (target.AudioContext) target.AudioContext = observed;
  if (target.webkitAudioContext) target.webkitAudioContext = observed;
}


export function guitarPhraseBrowserScore() {
  const score=structuredClone(fixture),beat=n=>({numerator:n,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-browser-guitar-phrase';score.title='Original guitar phrase boundaries';score.tempo[0].bpm=60;
  score.measures=[{number:1,at:beat(0),length:beat(4)},{number:2,at:beat(4),length:beat(4)}];
  score.parts[0].notes=[
    {...structuredClone(seed),id:'outside-before',at:beat(0),duration:beat(1)},
    {...structuredClone(seed),id:'entry-e',at:beat(1),duration:beat(4),pitch:{step:'E',alter:0,octave:4}},
    {...structuredClone(seed),id:'inside-g',at:beat(3),duration:beat(1),pitch:{step:'G',alter:0,octave:4},voice:'2'},
    {...structuredClone(seed),id:'outside-after',at:beat(7),duration:beat(1),pitch:{step:'A',alter:0,octave:4}},
  ];
  score.source={format:'original-test-text',filename:'phrase-source.txt',content:'\uFEFFOriginal phrase fixture · 原稿\r\nKeep entering E4 through beat 5; G4 attacks at beat 3. The score and playback loop remain complete.'};
  return score;
}

// Original synthetic on-screen observations for testing a preview window without
// waiting two minutes. This is a file fixture, never a hardware performance claim.
export function boundedPreviewBrowserRecord() {
  const recorder=new FreePracticeRecorder({id:'original-browser-preview-window',createdAt:'2026-10-02T00:00:00.000Z'});
  recorder.start(100);
  for(const [index,wall] of [120,120121].entries()){
    const observation={source:`preview-fixture-${index}`,inputKind:'on_screen_keyboard',midi:60+index*4,velocity:90,eventWall:wall,receivedWall:wall,encoding:'key_down'};
    recorder.observe('note_on',observation);
    recorder.observe('note_off',{...observation,midi:null,velocity:null,eventWall:wall+10,receivedWall:wall+10,encoding:'key_up'});
  }
  return recorder.stop(120200,'2026-10-02T00:02:00.100Z');
}
