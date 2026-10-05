import {buildCanonicalAudioPlan} from './canonical-audio-plan.js';
import {CanonicalAudioReceiver} from './canonical-audio-receiver.js';
import {BasicKeyAudioError} from './basic-key-audio-plan.js';
export {CANONICAL_AUDIO_POLICY} from './canonical-audio-plan.js';
export const CANONICAL_AUDIO_TIMBRE=Object.freeze({name:'Canonical sine reference',wave:'sine',velocity:'compiled canonical velocity',timing:'floor/ceil Rust binary64 milliseconds',tailFrames:0,sourceTimbresPreserved:false});

/** Source-bound whole-song/range lifecycle. The audio thread owns bounded
 * loops; the UI/recorder consume event-time clocks and observed pass receipts.
 * Tempo/pitch changes require a fresh Rust profile and a freshly selected copy. */
export class CanonicalPlayer {
  constructor({onError=()=>{},onEnded=()=>{},onPass=()=>{},receiverFactory=CanonicalAudioReceiver.create.bind(CanonicalAudioReceiver)}={}){Object.assign(this,{onError,onEnded,onPass,receiverFactory});this.epoch=0;this.receiver=null;this.running=false;this.preparing=false;}
  select(compilation,profile){this.stop();this.compilation=compilation;this.profile=profile;}
  async prepare(options={}){
    this.stop();const epoch=this.epoch,{context,output,resumePositionMs=null}=options;
    if(!context||context.state!=='running'||!output)throw new BasicKeyAudioError('clean_audio_unavailable','Unlock the audio device before canonical playback.');
    this.preparing=true;this.context=context;
    this.contextListener=()=>{if(epoch===this.epoch&&context.state!=='running'){this.stop();this.onError(new BasicKeyAudioError('clean_clock_unavailable','The audio device stopped during canonical preparation.'));}};
    context.addEventListener?.('statechange',this.contextListener);let receiver;
    try{
      const plan=buildCanonicalAudioPlan(this.compilation,this.profile,{...options,sampleRate:context.sampleRate});
      receiver=await this.receiverFactory(context,output,{onError:error=>{if(epoch===this.epoch){this.stop();this.onError(error);}},onPass:receipt=>{if(epoch===this.epoch)this.onPass({...receipt,playerEpoch:epoch});},onEnded:result=>{if(epoch===this.epoch){this.running=false;this.onEnded(result);}}});
      if(epoch!==this.epoch){receiver.dispose();return null;}
      context.removeEventListener?.('statechange',this.contextListener);this.contextListener=null;this.receiver=receiver;
      const ready=await receiver.prepare(plan,{positionMs:resumePositionMs});if(epoch!==this.epoch){receiver.dispose();return null;}
      this.plan=plan;this.preparing=false;return ready;
    }catch(error){receiver?.dispose();if(epoch!==this.epoch)return null;this.stop();throw error;}
  }
  async startPrepared(options={}){const epoch=this.epoch,r=this.receiver;if(!r||this.preparing)throw new BasicKeyAudioError('clean_audio_unavailable','Prepare canonical playback first.');try{const result=await r.start(options);if(epoch!==this.epoch)return null;this.running=true;return result;}catch(error){if(epoch!==this.epoch)return null;this.stop();throw error;}}
  async pause(){const epoch=this.epoch;if(!this.receiver)return null;const result=await this.receiver.pause();if(epoch!==this.epoch)return null;this.running=false;return result;}
  async resume(options={}){const epoch=this.epoch;if(!this.receiver)return null;try{const result=await this.receiver.resume(options);if(epoch!==this.epoch)return null;this.running=true;return result;}catch(error){if(epoch!==this.epoch)return null;this.stop();throw error;}}
  sourcePositionMs(){return this.receiver?.sourcePositionMs()??null;}
  sourceClockAtTime(audioTime=this.context?.currentTime,{playerEpoch=this.epoch,...binding}={}){if(playerEpoch!==this.epoch)return null;const clock=this.receiver?.sourceClockAtTime(audioTime,binding);return clock?{...clock,playerEpoch:this.epoch}:null;}
  stop(){this.lastStopClock=this.sourceClockAtTime()??this.receiver?.lastStopClock??this.lastStopClock??null;this.epoch++;this.running=false;this.preparing=false;this.context?.removeEventListener?.('statechange',this.contextListener);this.contextListener=null;this.receiver?.dispose();this.receiver=null;this.plan=null;}
}
