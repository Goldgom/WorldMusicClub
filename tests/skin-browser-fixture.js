import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {DEFAULT_SKIN} from '../web/skin-format.js';
import {fixture} from './frontend-fixtures.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Original procedural INPUT artwork. This never creates or alters a browser
// screenshot, and is not retained as visual acceptance evidence.
export function originalSkinPng({replacement = false} = {}) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8);
    result.writeUInt32BE(data.length);body.copy(result, 4);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte;for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);return result;
  };
  const header = Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(16, 4);header[8] = 8;header[9] = 2;
  const pixels = Buffer.alloc(16 * (1 + 16 * 3));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const offset = y * 49 + 1 + x * 3, dark = Boolean(((x >> 2) + (y >> 2)) % 2) !== replacement,
      color = dark ? [16, 90, 110] : [240, 180, 50];
    pixels.set(color, offset);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export function originalBrowserSkin({replacement = false} = {}) {
  const png = originalSkinPng({replacement}), manifest = structuredClone(DEFAULT_SKIN);
  Object.assign(manifest, {id: 'original-browser-skin', name: 'Original browser checker', author: 'WorldMusicClub contributors', license: 'MIT',
    attribution: 'Original procedural 16 by 16 checker and test palette. No third-party artwork or music.'});
  manifest.notes.human.marker = 'square';manifest.notes.machine.marker = 'triangle';manifest.notes.machine.pattern = 'solid';
  if (replacement) {
    manifest.id = 'original-browser-replacement';manifest.name = 'Original replacement checker';
    [manifest.notes.human.fill, manifest.notes.machine.fill] = [manifest.notes.machine.fill, manifest.notes.human.fill];
  }
  manifest.layout = {notation_height: .28, piano_height: .24, side_margin: .04, note_width_scale: .8};
  manifest.background = {asset: 'checker', fit: 'tile', opacity: .2};
  manifest.assets = [{id: 'checker', path: 'assets/checker.png', media_type: 'image/png', bytes: png.length, width: 16, height: 16}];
  const json = Buffer.from(JSON.stringify(manifest));
  return {manifest, json, png, jsonSha256: sha256(json), pngSha256: sha256(png)};
}

export function originalSkinScore() {
  const score = structuredClone(fixture), seed = score.parts[0].notes[0];
  score.id = 'original-browser-skin-roles';score.title = 'Original skin role study';score.composer = 'WorldMusicClub';
  score.provenance = {kind: 'original_exercise', attribution: 'Original sustained two-part role and input regression', source_url: null, license: 'MIT'};
  score.tempo[0].bpm = 60;
  score.measures = Array.from({length: 16}, (_, i) => ({number: i + 1, at: {numerator: i * 4, denominator: 1}, length: {numerator: 4, denominator: 1}}));
  score.parts = [['human', 'C'], ['machine', 'G']].map(([id, step]) => ({id, name: id === 'human' ? 'Human piano' : 'Accompaniment piano', instrument: 'piano', notes: [
    {...structuredClone(seed), id: `${id}-sustain`, duration: {numerator: 8, denominator: 1}, pitch: {step, alter: 0, octave: 4}},
    {...structuredClone(seed), id: `${id}-tail`, at: {numerator: 63, denominator: 1}, pitch: {step: 'E', alter: 0, octave: 4}},
  ]}));
  score.source = {format: 'original-test-text', filename: 'original-skin-roles.txt', content: '\uFEFFOriginal skin input study · 原稿\r\nC4 human and G4 accompaniment at 0/1 for 8/1; E4 tails at 63/1. Preserve exact source.'};
  return score;
}
