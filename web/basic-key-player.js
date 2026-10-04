import {ReferenceAudioReceiver} from './midi-reference-synth.js';
import {CleanSongError,isBasicKeysSong} from './clean-song-package.js';

import {BASIC_KEY_RENDITION,BASIC_KEY_MAX_VOICES,exactBasicKeyAllocationBudget,basicKeyExactMilliseconds,basicKeyRenditionNotes} from './basic-key-rendition.js';
export {BASIC_KEY_RENDITION};
export const BASIC_KEY_TIMBRE=Object.freeze({name:'WMH basic sine',wave:'sine',harmonic:'sine',ratio:1,singleTone:true});
export const BASIC_KEY_PERCUSSION=Object.freeze({name:'WMH basic percussion pulse',type:'noise',frequency:1500});

/** Native-derived voice gates only. No source parsing, input capture or grading. */
export class BasicKeyPlayer {
  constructor({getPositionMs,onError=()=>{},setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args),lookAheadMs=100}) {
    Object.assign(this,{getPositionMs,onError,setTimer,clearTimer,lookAheadMs});this.epoch=0;this.timer=null;this.song=null;this.receiver=null;this.running=false;
  }
  select(song){this.stop();this.song=song;}
  start({context,output,mode='listen',targetPart=null,mutedParts=null,soloParts=null,resumePositionMs=null,acceptedPolicyId}={}) {
    this.stop();const song=this.song,rendition=song?.runtime?.rendition;
    if(!isBasicKeysSong(song)||!rendition||rendition.policy_id!==BASIC_KEY_RENDITION)throw new CleanSongError('clean_renderer_unsupported','A native complete basic-key rendition is required.');
    if(acceptedPolicyId!==rendition.policy_id)throw new CleanSongError('reference_policy_required','Select the disclosed basic-key interpretation before playback.');
    if(!context||context.state!=='running'||!output)throw new CleanSongError('clean_audio_unavailable','Audio must be unlocked by a user gesture.');
    if(mode==='practice'&&!song.runtime.parts.some(part=>part.id===targetPart))throw new CleanSongError('clean_target_required','Choose one human part.');
    const muted=new Set(mutedParts||[]),solo=new Set(soloParts||[]);
    const audible=note=>!muted.has(note.part_id)&&(!solo.size||solo.has(note.part_id))&&(mode!=='practice'||note.part_id!==targetPart);
    // Resolve voices before output selection. A muted release-origin track never
    // changes another part's native FIFO interpretation or human target timing.
    const evidence=new Map([...basicKeyRenditionNotes(rendition)].map(note=>[note.note_id,{role:note.role,attack:note.attack,endMs:basicKeyExactMilliseconds(note.end)}]));
    const notes=song.compilation.timeline.notes;
    if(this.lookAheadMs!==rendition.policy.allocation_lookahead_ms)throw new CleanSongError('reference_policy_required','The renderer lookahead must match the declared native policy.');
    const audibleIds=new Set(notes.filter(audible).map(note=>note.id)),allocations=exactBasicKeyAllocationBudget(rendition,{include:id=>audibleIds.has(id)});
    if(allocations>BASIC_KEY_MAX_VOICES)throw new CleanSongError('voice_budget_exceeded',`This selected mix requires ${allocations} scheduled/active voices; the receiver supports ${BASIC_KEY_MAX_VOICES}.`,{allocations,maxVoices:BASIC_KEY_MAX_VOICES});
    for(const note of notes)if(audible(note)&&evidence.get(note.id).role==='melodic_key'&&440*2**((note.midi-69)/12)>context.sampleRate*0.45)throw new CleanSongError('unsupported_audio_sample_rate','The audio device cannot represent every retained key without clamping.');
    Object.assign(this,{context,output,notes,evidence,audible,resumePositionMs,noteCursor:0,running:true});
    this.receiver=new ReferenceAudioReceiver(context,output,{maxVoices:BASIC_KEY_MAX_VOICES,ErrorType:CleanSongError});
    try{this.pump(this.epoch,true);}catch(error){this.stop();throw error;}
  }
  pump(epoch=this.epoch,initial=false){
    if(!this.running||epoch!==this.epoch)return;
    try{
      const {context,notes}=this,position=this.getPositionMs(),now=context.currentTime;
      if(context.state!=='running'||!Number.isFinite(position))throw new CleanSongError('clean_clock_unavailable','Playback clock or audio context stopped.');
      this.receiver.prune(now);
      while(this.noteCursor<notes.length&&notes[this.noteCursor].start_ms<=position+this.lookAheadMs){
        const note=notes[this.noteCursor++];
        const evidence=this.evidence.get(note.id),end=evidence.endMs;
        if(end<=position||!this.audible(note))continue;
        if(!initial&&note.start_ms<position-30)throw new CleanSongError('clean_late_scheduler','A basic-key note missed its audio deadline.',{eventId:`midi:${this.song.score.source.sha256}:t${evidence.attack.track}:e${evidence.attack.event}`});
        const start=Math.max(note.start_ms,initial&&Number.isFinite(this.resumePositionMs)?this.resumePositionMs:note.start_ms);
        this.receiver.schedule({eventId:`midi:${this.song.score.source.sha256}:t${evidence.attack.track}:e${evidence.attack.event}`,key:note.midi,velocity:note.velocity,referenceTimbre:BASIC_KEY_TIMBRE,...(evidence.role==='percussion_selector'?{referencePercussion:BASIC_KEY_PERCUSSION}:{})},now+Math.max(0,start-position)/1000,now+(end-position)/1000,{preserveFrequency:true});
      }
      if(position>=this.song.runtime.rendition.duration_ms){this.stop();return;}
      this.timer=this.setTimer(()=>this.pump(epoch),20);
    }catch(error){this.stop();if(initial)throw error;this.onError(error);}
  }
  stop(){this.epoch++;this.running=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;this.receiver?.silence();this.receiver=null;}
}
