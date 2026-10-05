import {CleanSongError,isBasicKeysSong} from './clean-song-package.js';
import {BASIC_KEY_RENDITION} from './basic-key-rendition.js';
import {buildBasicKeyAudioPlan} from './basic-key-audio-plan.js';
import {BasicKeyAudioReceiver} from './basic-key-audio-receiver.js';
export {BASIC_KEY_RENDITION};
export const BASIC_KEY_TIMBRE=Object.freeze({name:'WMH basic sine',wave:'sine',harmonic:'sine',ratio:1,singleTone:true});
export const BASIC_KEY_PERCUSSION=Object.freeze({name:'WMH basic percussion pulse',type:'noise',frequency:1500});

/** Prepares native gates before transport admission. The audio thread owns every gate. */
export class BasicKeyPlayer {
  constructor({getPositionMs,onError=()=>{},lookAheadMs=100}={}) {
    Object.assign(this,{getPositionMs,onError,lookAheadMs});this.epoch=0;this.song=null;this.receiver=null;this.running=false;this.preparing=false;this.anchor=null;
  }
  select(song){this.stop();this.song=song;}
  buildPlan({context,mode='listen',targetPart=null,practiceSelection,mutedParts=null,soloParts=null,acceptedPolicyId}={}) {
    const song=this.song,rendition=song?.runtime?.rendition;
    if(!isBasicKeysSong(song)||!rendition||rendition.policy_id!==BASIC_KEY_RENDITION)throw new CleanSongError('clean_renderer_unsupported','A native complete basic-key rendition is required.');
    if(acceptedPolicyId!==rendition.policy_id)throw new CleanSongError('reference_policy_required','Select the disclosed basic-key interpretation before playback.');
    if(this.lookAheadMs!==rendition.policy.allocation_lookahead_ms)throw new CleanSongError('reference_policy_required','The renderer allocation budget must match the declared native policy.');
    return buildBasicKeyAudioPlan(song,{sampleRate:context.sampleRate,mode,targetPart,practiceSelection,mutedParts:mutedParts||[],soloParts:soloParts||[]});
  }
  async prepare(options={}) {
    this.stop();const epoch=this.epoch,{context,output,resumePositionMs=0}=options;
    if(!context||context.state!=='running'||!output)throw new CleanSongError('clean_audio_unavailable','Audio must be unlocked by a user gesture.');
    this.preparing=true;this.context=context;
    // A suspended then resumed device during module loading is still an interruption.
    this.contextListener=()=>{if(epoch===this.epoch&&context.state!=='running'){this.stop();this.onError(new CleanSongError('clean_clock_unavailable','The audio device stopped during playback preparation.'));}};
    context.addEventListener?.('statechange',this.contextListener);
    let receiver;
    try{
      // This full-source work completes before requesting the 50 ms start lead.
      const plan=this.buildPlan(options);
      receiver=await BasicKeyAudioReceiver.create(context,output,{onError:error=>{if(epoch!==this.epoch)return;this.stop();this.onError(error);},onEnded:()=>{if(epoch===this.epoch)this.running=false;}});
      if(epoch!==this.epoch){receiver.dispose();return null;}
      context.removeEventListener?.('statechange',this.contextListener);this.contextListener=null;
      this.receiver=receiver;
      const prepared=await receiver.prepare(plan,{positionMs:resumePositionMs??0});
      if(epoch!==this.epoch){receiver.dispose();return null;}
      this.preparing=false;this.plan=plan;return prepared;
    }catch(error){receiver?.dispose();if(epoch!==this.epoch)return null;this.stop();throw error;}
  }
  async startPrepared({anchorTime=this.context?.currentTime+.05}={}) {
    const epoch=this.epoch,receiver=this.receiver;
    if(!receiver||this.preparing)throw new CleanSongError('clean_audio_unavailable','Prepare the audio-thread rendition before playback.');
    try{
      const anchor=await receiver.start({anchorTime});
      if(epoch!==this.epoch||receiver!==this.receiver)return null;
      if(this.context.state!=='running'){throw new CleanSongError('clean_clock_unavailable','Playback clock or audio context stopped.');}
      if(this.context.currentTime>=anchor.anchorTime)throw new CleanSongError('clean_late_start','The audio anchor elapsed before shared transport admission.');
      this.anchor=anchor;this.running=true;return anchor;
    }catch(error){if(epoch!==this.epoch)return null;this.stop();throw error;}
  }
  async start(options={}) {
    const preparing=this.prepare(options),epoch=this.epoch;
    const prepared=await preparing;if(!prepared||epoch!==this.epoch)return null;
    return this.startPrepared({anchorTime:options.anchorTime??this.context.currentTime+.05});
  }
  stop(){this.epoch++;this.running=false;this.preparing=false;this.context?.removeEventListener?.('statechange',this.contextListener);this.contextListener=null;this.receiver?.dispose();this.receiver=null;this.plan=null;this.anchor=null;}
}
