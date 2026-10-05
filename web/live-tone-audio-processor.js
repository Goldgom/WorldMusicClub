import {LiveToneCore, LIVE_TONE_PROTOCOL} from './live-tone-core.js';

/** Only the browser's real AudioWorklet frame clock enters the live renderer. */
export class LiveToneAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new LiveToneCore(sampleRate, {emit: message => this.port.postMessage(message)});
    this.port.onmessage = event => this.core.handleMessage(event.data, currentFrame);
  }
  process(inputs, outputs) { return this.core.process(outputs[0] || [], currentFrame); }
}
registerProcessor(LIVE_TONE_PROTOCOL, LiveToneAudioProcessor);
