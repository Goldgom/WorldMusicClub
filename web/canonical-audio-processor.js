import {CanonicalAudioCore} from './canonical-audio-core.js';
export class CanonicalAudioProcessor extends AudioWorkletProcessor {
  constructor(){super();this.core=new CanonicalAudioCore(sampleRate,{emit:(message,transfer=[])=>this.port.postMessage(message,transfer)});this.port.onmessage=e=>this.core.handleMessage(e.data,currentFrame);}
  process(inputs,outputs){return this.core.process(outputs[0]||[],currentFrame);}
}
registerProcessor('wmh-canonical-audio-v1',CanonicalAudioProcessor);
