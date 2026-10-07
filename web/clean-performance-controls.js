import { REFERENCE_RECEIVER_POLICY } from './midi-reference-player.js';
import { createReferenceRoom } from './clean-song-reverb.js';

// This policy is selected only when a complete performance needs the additional
// controls. Existing control-free v1 reference renditions keep their sound.
export const COMPLETE_CONTROLS_POLICY = Object.freeze({
  ...REFERENCE_RECEIVER_POLICY,
  id: 'wmh-original-reference-fifo-controls-v2',
  sameKey: 'Each attack creates a layer. A key release removes the oldest still-key-held layer (FIFO). Sustain values 64–127 defer that layer’s sound end until the next value 0–63. Unmatched releases are acknowledged. These gates are never source note durations.',
  controls: 'Channel volume and expression multiply as (volume/127)*(expression/127), initially 100 and 127. Pan maps 0/64/127 to left/center/right. Controls affect all sounding layers on that channel, including pedal-held layers. Reverb uses WMH Reference Room v1; tails are cut at pause, stop and global end.',
  initialization: 'A reviewed tick-zero reset restores expression 127 and sustain off before any keys, followed immediately by explicit sustain zero. Program, bank, volume, pan and reverb remain. Repeated valid initial groups are retained.',
  banks: 'Only zero MSB and LSB banks are rendered, using the declared procedural program families. Nonzero bank values and nonzero chorus sends block this receiver. No original instrument or kit is inferred.',
  resume: 'Pause disconnects all sources and effect tails. Resume rebuilds channel control state from every earlier event and restarts each remaining FIFO or pedal-held gate with a fresh reference envelope. Events at the resume position then run in original order.',
});

const defaults = () => ({ volume: 100, expression: 127, pan: 64, reverb_send: 0 });
export const MIX_CONTROL_KINDS = new Set(['volume', 'expression', 'pan', 'reverb_send', 'initial_controller_reset']);
export const EXTENDED_CONTROL_KINDS = new Set([...MIX_CONTROL_KINDS, 'sustain', 'bank_select', 'chorus_send']);

/** One channel bus, shared by every source track using that channel. Muting is
 * a voice-allocation decision; it never changes or removes channel state. */
export class CompletePerformanceMixer {
  constructor(context, output, { reverbChannels = [], end } = {}) {
    this.context = context; this.output = output; this.channels = Array.from({ length: 16 }, defaults);
    this.lanes = new Map(); this.reverbChannels = new Set(reverbChannels); this.end = end; this.master = null;
  }
  command(command, at) {
    if (!MIX_CONTROL_KINDS.has(command.kind)) return;
    const state = this.channels[command.channel];
    if (command.kind === 'initial_controller_reset') state.expression = 127;
    else state[command.kind] = command.value;
    const lane = this.lanes.get(command.channel);
    if (lane) this.update(lane, state, at);
  }
  update(lane, state, at) {
    lane.gain.gain.setValueAtTime((state.volume / 127) * (state.expression / 127), at);
    lane.pan.pan.setValueAtTime(state.pan <= 64 ? (state.pan - 64) / 64 : (state.pan - 64) / 63, at);
    lane.room?.set(state.reverb_send, at);
  }
  outputFor(channel, at) {
    if (this.lanes.has(channel)) return this.lanes.get(channel).gain;
    let gain, pan, room;
    try {
      // A downstream scheduled gate cuts convolution tails at the exact song
      // end even if the polling callback that disposes nodes runs later.
      if (!this.master) {
        this.master = this.context.createGain(); this.master.connect(this.output);
        this.master.gain.setValueAtTime(1, at); this.master.gain.setValueAtTime(0, this.end);
      }
      gain = this.context.createGain(); pan = this.context.createStereoPanner();
      if (this.reverbChannels.has(channel)) room = createReferenceRoom(this.context, this.master);
      gain.connect(pan); pan.connect(room?.input || this.master);
      const lane = { gain, pan, room }; this.lanes.set(channel, lane);
      this.update(lane, this.channels[channel], at);
      return gain;
    } catch (error) {
      this.lanes.delete(channel); gain?.disconnect(); pan?.disconnect(); room?.close(); throw error;
    }
  }
  close() {
    // The master is downstream of every dry and wet lane. Disconnect it first
    // so per-channel/source cleanup cannot leave later layers sounding.
    this.master?.disconnect(); this.master = null;
    for (const lane of this.lanes.values()) { lane.gain.disconnect(); lane.pan.disconnect(); lane.room?.close(); }
    this.lanes.clear();
  }
}
