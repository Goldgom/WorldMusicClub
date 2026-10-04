/* Original procedural reference sounds. No samples, soundfonts or GM claim. */
const family = (name, wave, harmonic, ratio) => Object.freeze({ name, wave, harmonic, ratio });
export const PROGRAM_FAMILIES = Object.freeze([
  family('Reference struck keys', 'triangle', 'sine', 2),
  family('Reference bright mallets', 'sine', 'sine', 3),
  family('Reference sustained organ', 'sine', 'sine', 2),
  family('Reference plucked strings', 'triangle', 'sine', 3),
  family('Reference low strings', 'triangle', 'sine', 0.5),
  family('Reference bowed strings', 'sawtooth', 'triangle', 2),
  family('Reference ensemble', 'triangle', 'sine', 1.005),
  family('Reference brass', 'sawtooth', 'sine', 2),
  family('Reference reed', 'square', 'sine', 3),
  family('Reference pipe', 'sine', 'triangle', 2),
  family('Reference lead', 'sawtooth', 'square', 0.5),
  family('Reference pad', 'triangle', 'sine', 1.003),
  family('Reference effects', 'sine', 'triangle', 2.7),
  family('Reference world strings', 'triangle', 'sine', 4),
  family('Reference struck effects', 'sine', 'square', 3.5),
  family('Reference sound effects', 'square', 'triangle', 1.5),
]);

// Each entry is a declared reference label and its own oscillator/noise recipe.
// Extended keys 85–87 are explicitly reference-only, never an inferred source kit.
const definitions = [
  [27, 'Dry click', 'noise', 1900], [28, 'Low scrape', 'noise', 450], [29, 'Soft scratch', 'noise', 750], [30, 'Hard scratch', 'noise', 1200],
  [31, 'Stick tap', 'tone', 620], [32, 'Square click', 'tone', 980], [33, 'Bell tick', 'metal', 1450], [34, 'Metal jingle', 'metal', 2100],
  [35, 'Deep kick', 'tone', 48], [36, 'Kick', 'tone', 60], [37, 'Side stick', 'tone', 430], [38, 'Dry snare', 'noise', 1450],
  [39, 'Clap', 'noise', 1100], [40, 'Bright snare', 'noise', 2200], [41, 'Low floor tom', 'tone', 75], [42, 'Closed hat', 'metal', 6700],
  [43, 'Floor tom', 'tone', 90], [44, 'Pedal hat', 'metal', 5400], [45, 'Low tom', 'tone', 110], [46, 'Open hat', 'metal', 6000],
  [47, 'Mid tom', 'tone', 135], [48, 'High tom', 'tone', 170], [49, 'Bright crash', 'metal', 4200], [50, 'Top tom', 'tone', 210],
  [51, 'Ride', 'metal', 3400], [52, 'Splashy crash', 'metal', 2500], [53, 'Ride bell', 'metal', 1800], [54, 'Jingle shake', 'metal', 5100],
  [55, 'Splash', 'metal', 5600], [56, 'Cowbell pulse', 'metal', 560], [57, 'Dark crash', 'metal', 3100], [58, 'Rattle', 'noise', 3200],
  [59, 'Dark ride', 'metal', 2800], [60, 'High hand drum', 'tone', 285], [61, 'Low hand drum', 'tone', 190],
  [62, 'Muted conga pulse', 'tone', 260], [63, 'Open conga pulse', 'tone', 230], [64, 'Low conga pulse', 'tone', 160],
  [65, 'High rim drum', 'tone', 410], [66, 'Low rim drum', 'tone', 320], [67, 'High bell block', 'metal', 850], [68, 'Low bell block', 'metal', 660],
  [69, 'Grain shake', 'noise', 4100], [70, 'Seed shake', 'noise', 5000], [71, 'Short whistle', 'tone', 2300], [72, 'Low whistle', 'tone', 1750],
  [73, 'Short rasp', 'noise', 700], [74, 'Long rasp', 'noise', 520], [75, 'Wood click', 'tone', 1900], [76, 'High wood block', 'tone', 1200],
  [77, 'Low wood block', 'tone', 800], [78, 'Muted membrane', 'tone', 350], [79, 'Open membrane', 'tone', 290],
  [80, 'Damped metal ping', 'metal', 3100], [81, 'Open metal ping', 'metal', 2600], [82, 'Fine shaker', 'noise', 6300],
  [83, 'Bright jingle', 'metal', 7400], [84, 'Bell cluster', 'metal', 950],
  [85, 'WMH low wood pulse', 'tone', 370], [86, 'WMH dry rim noise', 'noise', 1700], [87, 'WMH bright metal pulse', 'metal', 3900],
];
export const REFERENCE_PERCUSSION = Object.freeze(Object.fromEntries(definitions.map(([key, name, type, frequency]) =>
  [key, Object.freeze({ name: `Reference ${name}`, type, frequency })])));

export class ReferenceAudioReceiver {
  constructor(context, output, { maxVoices, ErrorType }) {
    this.context = context; this.output = output; this.maxVoices = maxVoices; this.ErrorType = ErrorType;
    this.voices = new Set(); this.noise = null;
  }
  prune(now) { for (const voice of [...this.voices]) if (voice.end <= now) voice.dispose(); }
  noiseBuffer() {
    if (this.noise) return this.noise;
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate / 2), this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x574d4801;
    for (let i = 0; i < data.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; data[i] = (state >>> 0) / 2147483648 - 1; }
    this.noise = buffer; return buffer;
  }
  schedule(note, start, end, { output = this.output, pitchSemitones = 0, strictPitchRange = false, preserveFrequency = false } = {}) {
    if (end <= start) return;
    this.prune(this.context.currentTime);
    if (this.voices.size >= this.maxVoices) throw new this.ErrorType('voice_budget_exceeded', 'Reference audio allocation budget exceeded; playback stops instead of stealing a voice.', { eventId: note.eventId, maxVoices: this.maxVoices });
    const nodes = [], sources = [], pitches = [], envelope = this.context.createGain(); nodes.push(envelope);
    const voice = { start, end, channel: note.channel, pitches, strictPitchRange, dispose: () => {
      this.voices.delete(voice);
      for (const source of sources) { source.onended = null; try { source.stop(this.context.currentTime); } catch { /* already ended */ } }
      for (const node of nodes) node.disconnect();
    } };
    // Register before constructing nodes so every partial failure is cleaned up.
    this.voices.add(voice);
    try {
      const addTone = (type, frequency, level) => {
        const oscillator = this.context.createOscillator();
        nodes.push(oscillator); sources.push(oscillator);
        const gain = this.context.createGain(); nodes.push(gain);
        oscillator.type = type;
        const bent = frequency * 2 ** (pitchSemitones / 12);
        if (strictPitchRange) this.checkPitch(bent);
        if (preserveFrequency && (!Number.isFinite(frequency) || frequency <= 0 || frequency > this.context.sampleRate * 0.45)) throw new this.ErrorType('unsupported_audio_sample_rate', 'The audio device cannot represent this reference frequency without clamping.');
        oscillator.frequency.setValueAtTime(strictPitchRange ? bent : preserveFrequency ? frequency : Math.min(frequency, this.context.sampleRate * 0.45), start);
        if (strictPitchRange) pitches.push({ parameter: oscillator.frequency, frequency });
        gain.gain.value = level; oscillator.connect(gain); gain.connect(envelope);
      };
      const drum = note.referencePercussion || (note.channel === 9 ? REFERENCE_PERCUSSION[note.key] : null);
      if (note.channel === 9 && !drum) throw new this.ErrorType('percussion_key_unmapped', 'No reference percussion recipe for this key.');
      if (drum) {
        if (drum.type !== 'noise') {
          addTone(drum.type === 'metal' ? 'square' : 'sine', drum.frequency, 0.7);
          if (drum.type === 'metal') addTone('sine', drum.frequency * 1.43, 0.3);
        }
        if (drum.type !== 'tone') {
          const source = this.context.createBufferSource();
          nodes.push(source); sources.push(source);
          const filter = this.context.createBiquadFilter(); nodes.push(filter);
          source.buffer = this.noiseBuffer(); source.loop = true;
          if (strictPitchRange) this.checkPitch(drum.frequency);
          filter.type = 'bandpass'; filter.frequency.setValueAtTime(strictPitchRange ? drum.frequency : Math.min(drum.frequency, this.context.sampleRate * 0.4), start); filter.Q.value = 0.7;
          source.connect(filter); filter.connect(envelope);
        }
      } else {
        const timbre = note.referenceTimbre || PROGRAM_FAMILIES[note.program >> 3], hz = 440 * 2 ** ((note.key - 69) / 12);
        if(timbre.singleTone)addTone(timbre.wave,hz,1);else{addTone(timbre.wave, hz, 0.8); addTone(timbre.harmonic, hz * timbre.ratio, 0.2);}
      }
      // A conservative reference level, not a loudness-normalization promise.
      const peak = 0.08 * note.velocity / 127;
      const attack = Math.min(0.004, (end - start) / 3), release = Math.min(0.02, (end - start) / 3);
      const sustainAt = drum ? Math.min(start + 0.12, end - release) : end - release;
      const sustain = drum ? peak * 0.12 : peak;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(peak, start + attack);
      envelope.gain.linearRampToValueAtTime(sustain, Math.max(start + attack, sustainAt));
      envelope.gain.setValueAtTime(sustain, end - release);
      envelope.gain.linearRampToValueAtTime(0, end);
      envelope.connect(output);
      for (const source of sources) {
        if (start < this.context.currentTime) throw new this.ErrorType('late_scheduler', 'Audio allocation missed the scheduled onset; playback stops without catch-up.', { eventId: note.eventId, lateSeconds: this.context.currentTime - start });
        source.start(start); source.stop(end);
      }
      sources[0].onended = voice.dispose;
    } catch (reason) { voice.dispose(); throw reason; }
    return voice;
  }
  silence() {
    for (const voice of [...this.voices]) voice.dispose();
  }
  checkPitch(frequency) {
    if (!Number.isFinite(frequency) || frequency < 20 || frequency > 18000 || frequency > this.context.sampleRate * 0.45) {
      throw new this.ErrorType('unsupported_pitch_range', 'The reference pitch exceeds its declared acoustic or device range; no frequency was clamped.');
    }
  }
  retune(channel, semitones, at) {
    const changes = [];
    for (const voice of this.voices) {
      if (!voice.strictPitchRange || voice.channel !== channel || voice.start > at || voice.end <= at) continue;
      for (const pitch of voice.pitches) {
        const frequency = pitch.frequency * 2 ** (semitones / 12);
        this.checkPitch(frequency); changes.push([pitch.parameter, frequency]);
      }
    }
    for (const [parameter, frequency] of changes) parameter.setValueAtTime(frequency, at);
  }
}
