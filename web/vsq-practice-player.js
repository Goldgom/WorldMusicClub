import {ReferenceAudioReceiver,PROGRAM_FAMILIES} from './midi-reference-synth.js';
import {CleanSongError,isVsqSong} from './clean-song-package.js';
import {basicKeyAllocationBudget,BASIC_KEY_MAX_VOICES} from './basic-key-rendition.js';

// Deliberate reference recipes. These never derive from VSQ singer/voice fields.
export const VSQ_REFERENCE_ROUTES=Object.freeze({piano:PROGRAM_FAMILIES[0],guitar:PROGRAM_FAMILIES[3]});
/** Native timing only; no pitch bends, Dynamics mapping, singer synthesis or scoring. */
export class VsqPracticePlayer {
  constructor({getPositionMs,onError=()=>{},setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args),lookAheadMs=100}) {
    Object.assign(this,{getPositionMs,onError,setTimer,clearTimer,lookAheadMs});this.epoch=0;this.timer=null;this.lanes=new Map();this.song=null;
  }
  select(song){this.stop();this.song=song;}
  start({context,output,mode='listen',targetPart=null,mutedParts=null,soloParts=null,resumePositionMs=null,instrument='piano'}={}) {
    this.stop();const song=this.song;
    if(!isVsqSong(song)||!song.runtime||!song.compilation)throw new CleanSongError('vsq_choice_required','Choose base-note instrumental practice first.');
    if(!context||context.state!=='running'||!output)throw new CleanSongError('clean_audio_unavailable','Audio must be unlocked by a user gesture.');
    if(!VSQ_REFERENCE_ROUTES[instrument])throw new CleanSongError('vsq_reference_instrument','Choose a supported reference instrument.');
    if(mode==='practice'&&!song.runtime.parts.some(part=>part.part_id===targetPart))throw new CleanSongError('clean_target_required','Choose one human part.');
    if(song.runtime.parts.length>128)throw new CleanSongError('part_budget_exceeded','Too many reference parts.');
    Object.assign(this,{context,output,mode,targetPart,resumePositionMs,referenceTimbre:VSQ_REFERENCE_ROUTES[instrument],mutedParts:new Set(mutedParts||[]),soloParts:new Set(soloParts||[]),noteCursor:0,running:true});
    const allocations=basicKeyAllocationBudget(song.compilation.timeline.notes,{lookAheadMs:this.lookAheadMs,include:note=>!this.mutedParts.has(note.part_id)&&(!this.soloParts.size||this.soloParts.has(note.part_id))&&(mode!=='practice'||note.part_id!==targetPart)});
    if(allocations>BASIC_KEY_MAX_VOICES){this.running=false;throw new CleanSongError('voice_budget_exceeded',`This selected mix requires ${allocations} scheduled/active voices; the receiver supports ${BASIC_KEY_MAX_VOICES}.`,{allocations,maxVoices:BASIC_KEY_MAX_VOICES});}
    try{
      for(const part of song.runtime.parts){let gain;try{gain=context.createGain();gain.connect(output);const receiver=new ReferenceAudioReceiver(context,gain,{maxVoices:128,ErrorType:CleanSongError});this.lanes.set(part.part_id,{gain,receiver});gain.gain.value=1;}catch(error){gain?.disconnect();throw error;}}
      this.pump(this.epoch,true);
    }catch(error){this.stop();throw error;}
  }
  pump(epoch=this.epoch,initial=false){
    if(!this.running||epoch!==this.epoch)return;
    try{
      const {context}=this,position=this.getPositionMs(),now=context.currentTime,notes=this.song.runtime.notes;
      if(context.state!=='running'||!Number.isFinite(position))throw new CleanSongError('clean_clock_unavailable','Playback clock or audio context stopped.');
      while(this.noteCursor<notes.length&&notes[this.noteCursor].start_ms<=position+this.lookAheadMs){
        const note=notes[this.noteCursor++];
        if(note.end_ms<=position||this.mutedParts.has(note.part_id)||this.soloParts.size&&!this.soloParts.has(note.part_id)||(this.mode==='practice'&&note.part_id===this.targetPart))continue;
        if(!initial&&note.start_ms<position-30)throw new CleanSongError('clean_late_scheduler','A note missed its audio deadline.',{eventId:note.note_id});
        let count=0;for(const lane of this.lanes.values()){lane.receiver.prune(now);count+=lane.receiver.voices.size;}
        if(count>=128)throw new CleanSongError('voice_budget_exceeded','The reference exceeds its 128 voice limit.');
        const start=Math.max(note.start_ms,initial&&Number.isFinite(this.resumePositionMs)?this.resumePositionMs:note.start_ms);
        this.lanes.get(note.part_id).receiver.schedule({eventId:note.note_id,key:note.key,velocity:this.song.reference_velocity,referenceTimbre:this.referenceTimbre},now+Math.max(0,start-position)/1000,now+(note.end_ms-position)/1000);
      }
      this.timer=this.setTimer(()=>this.pump(epoch),20);
    }catch(error){this.stop();if(initial)throw error;this.onError(error);}
  }
  stop(){this.epoch++;this.running=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;for(const lane of this.lanes.values()){lane.receiver.silence();lane.gain.disconnect();}this.lanes.clear();}
}
