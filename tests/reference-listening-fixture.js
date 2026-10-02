import {createHash} from 'node:crypto';

// Newly authored synthetic events, not a transcription or third-party MIDI.
// This small SMF is shared by the real-Rust browser check and mocked-transport
// DOM tests. Expected records come from this explicit fixture specification;
// no application MIDI parser, interpreter, player or locale catalog is used.
const name = 'original-reference-overlap.mid';
const ppq = 120;
const endTick = 1440;
const tempo = 500000;
const channel = (number, message) => ({kind:'channel',channel:number,message});
const program = (number, value) => [[0xc0 | number,value],channel(number,{kind:'program_change',program:value})];
const noteOn = (number, key, velocity) => [[0x90 | number,key,velocity],channel(number,{kind:'note_on',key,velocity})];
const noteOff = (number, key, velocity) => [[0x80 | number,key,velocity],channel(number,{kind:'note_off',key,velocity})];
const trackName = text => {
  const data = [...Buffer.from(text,'utf8')];
  return [[0xff,3,data.length,...data],{kind:'meta',meta_type:3,data}];
};
const end = [[0xff,0x2f,0],{kind:'meta',meta_type:47,data:[]}];
const at = (tick, [encoding, kind]) => ({tick,encoding,kind});
const tracks = [
  [
    at(0,trackName('Original upper · 原稿')),
    at(0,[[0xff,0x51,3,0x07,0xa1,0x20],{kind:'tempo',microseconds_per_quarter:tempo}]),
    at(0,program(0,0)),
    at(0,noteOn(0,60,96)),
    at(120,noteOn(0,60,80)),
    at(240,noteOff(0,60,64)),
    at(360,noteOn(0,60,0)),
    at(720,noteOn(0,64,88)),
    at(960,noteOff(0,64,45)),
    at(endTick,end),
  ],
  [
    at(0,trackName('Original lower')),
    at(0,program(1,32)),
    at(0,noteOn(1,48,72)),
    at(480,noteOff(1,48,30)),
    at(840,noteOn(1,52,76)),
    at(1080,noteOff(1,52,40)),
    at(endTick,end),
  ],
  [
    at(0,trackName('Original percussion')),
    at(0,program(9,118)),
    at(0,noteOn(9,36,110)),
    at(120,noteOn(9,36,90)),
    at(240,noteOff(9,36,50)),
    at(360,noteOn(9,36,0)),
    at(720,noteOn(9,42,75)),
    at(780,noteOff(9,42,32)),
    at(endTick,end),
  ],
];

function vlq(value) {
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}
function fraction(numerator, denominator, decimal = false) {
  let a = numerator, b = denominator;
  while (b) [a,b] = [b,a % b];
  return {numerator:decimal ? String(numerator / a) : numerator / a,denominator:denominator / a};
}

const chunks = [Buffer.from([0x4d,0x54,0x68,0x64,0,0,0,6,0,1,0,3,0,ppq])];
const records = [];
let sourceOffset = 14;
for (const [trackIndex, events] of tracks.entries()) {
  const data = [];
  let previousTick = 0;
  for (const [eventIndex, event] of events.entries()) {
    const delta = event.tick - previousTick;
    const encoded = [...vlq(delta),...event.encoding];
    const start = sourceOffset + 8 + data.length;
    data.push(...encoded);
    records.push({id:{track_index:trackIndex,event_index:eventIndex},tick:event.tick,delta_ticks:delta,
      beat:fraction(event.tick,ppq),relative_microseconds:fraction(event.tick * tempo,ppq,true),
      source_range:{start,end:start + encoded.length},kind:event.kind});
    previousTick = event.tick;
  }
  const header = Buffer.alloc(8);
  header.write('MTrk');header.writeUInt32BE(data.length,4);
  chunks.push(header,Buffer.from(data));sourceOffset += header.length + data.length;
}

export const originalReferenceMidiBytes = Buffer.concat(chunks);
const hash = createHash('sha256').update(originalReferenceMidiBytes).digest('hex');
const id = (track_index, event_index) => ({source_sha256:hash,track_index,event_index});
const diagnostic = (code, message, occurrences, first_event) => ({code,message,occurrences,first_event});

// Exact response expected from /api/midi/events, including original byte spans,
// identities, rational timing, zero-velocity NoteOn and diagnostics. Keeping this
// complete makes a silently omitted event or rewritten MIDI value fail loudly.
export const originalReferenceMidiTimeline = {
  source_sha256:hash,format:1,track_count:3,ppq,end_tick:endTick,relative_clock_available:true,
  events:records.map(event => ({...event,id:id(event.id.track_index,event.id.event_index)}))
    .sort((a,b) => a.tick - b.tick || a.id.track_index - b.id.track_index || a.id.event_index - b.id.event_index),
  diagnostics:[
    diagnostic('raw_events_only','All events and original bytes are retained. This is not playable notation, a synthesizer schedule, or a gradeable target set; no notes are paired and no instrument sounds are inferred.',1,null),
    diagnostic('percussion_mapping_unresolved','Channel 10 events and keys are retained unchanged. No percussion kit, pitched instrument, or General MIDI interpretation is assumed.',7,id(2,1)),
    diagnostic('program_mapping_unresolved','Program numbers are retained as zero-based MIDI values. Bank, sound set, and program-to-instrument mapping are not resolved.',3,id(0,2)),
    diagnostic('metadata_uninterpreted','Other metadata is retained byte-for-byte, including text and unknown/sequencer-specific metadata; its semantics are not inferred.',3,id(0,0)),
  ],
};

export const originalReferenceMidiExpected = {
  trackCount:3,eventCount:26,onsetCount:8,durationSeconds:6,
  tracks:[
    {trackIndex:0,name:'Original upper · 原稿',channel:0,program:0,eventCount:10,onsetCount:3},
    {trackIndex:1,name:'Original lower',channel:1,program:32,eventCount:7,onsetCount:2},
    {trackIndex:2,name:'Original percussion',channel:9,program:118,eventCount:9,onsetCount:3},
  ],
  // The declared original receiver uses two oscillators per melodic voice,
  // one per key-36 kick, and two plus a noise source per key-42 closed hat.
  oscillatorCount:14,oscillatorCountWithoutLower:10,
};

export function originalReferenceMidiFixture() {
  return {name,bytes:Buffer.from(originalReferenceMidiBytes),timeline:structuredClone(originalReferenceMidiTimeline),
    expected:structuredClone(originalReferenceMidiExpected)};
}
