import { INITIAL_SENSITIVITY12_KIND, centeredPitchState, applyInitialSensitivity12 } from './clean-song-initial-sensitivity12.js';
import { COMPLETE_CONTROLS_POLICY } from './clean-performance-controls.js';
import { PROGRAM_FAMILIES } from './midi-reference-synth.js';

// MIDI 1.0's value is LSB + 128*MSB, center 8192. Uniform /8192 scaling
// deliberately leaves +8191 one step below the positive limit. Two semitones
// is this receiver's declared default, never an inferred source-device range.
export const COMPLETE_PITCH_POLICY = Object.freeze({
  ...COMPLETE_CONTROLS_POLICY,
  id: 'wmh-original-reference-fifo-pitch-v3',
  pitch: 'Retained 14-bit bend values use (value-8192)/8192 times the channel range. This receiver declares a two-semitone default; only the reviewed initial twelve-semitone RPN setup changes it. Each event sets pitch at its source time for all sounding layers, including pedal-held layers. No interpolation, source-key changes, original-device tuning or timbre fidelity is claimed.',
  pitchLimits: 'Bend channels must be track-local. Percussion bends remain unsupported. Every melodic oscillator must fit 20–18000 Hz throughout the declared channel range, and the audio device must provide enough sample rate. Unsupported ranges stop playback instead of clamping frequencies.',
});

/** Bounded channel state shared by preparation and transport reconstruction.
 * Initial reset nulls selection and centers displacement, not stored parameters.
 * Validation separately keeps reset/setup combinations and later RPN writes held.
 */
export class ReferencePitchChannels {
  constructor() { this.channels = Array.from({ length: 16 }, centeredPitchState); }
  command(command) {
    const state = this.channels[command.channel];
    if (command.kind === INITIAL_SENSITIVITY12_KIND) applyInitialSensitivity12(state, command.step);
    else if (command.kind === 'pitch_bend') {
      if (!Number.isInteger(command.value) || command.value < 0 || command.value > 16383) throw new Error('Invalid 14-bit bend');
      state.pitch_bend = (command.value - 8192) / 8192;
    } else if (command.kind === 'initial_controller_reset') {
      state.pitch_bend = 0;
      state.rpn_most_significant = 127; state.rpn_least_significant = 127;
    } else return false;
    return true;
  }
  range(channel) { const s = this.channels[channel]; return s.sensitivity_semitones + s.sensitivity_cents / 100; }
  offset(channel) { return this.channels[channel].pitch_bend * this.range(channel); }
}

export function referencePitchFits(key, program, range) {
  const ratio = PROGRAM_FAMILIES[program >> 3].ratio;
  const low = 440 * 2 ** ((key - range - 69) / 12) * Math.min(1, ratio);
  const high = 440 * 2 ** ((key + range - 69) / 12) * Math.max(1, ratio);
  return low >= 20 && high <= 18000;
}
