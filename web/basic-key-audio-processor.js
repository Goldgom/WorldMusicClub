import {BasicKeyAudioCore} from './basic-key-audio-core.js';

// A thin production shell. Tests execute this very class with an emulated
// AudioWorkletGlobalScope, as well as driving its exported core directly.
export class BasicKeyAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new BasicKeyAudioCore(sampleRate, {emit: message => this.port.postMessage(message)});
    this.port.onmessage = event => this.core.handleMessage(event.data, currentFrame);
  }
  process(inputs, outputs) { return this.core.process(outputs[0] || [], currentFrame); }
}
registerProcessor('wmh-basic-key-audio-v1', BasicKeyAudioProcessor);
