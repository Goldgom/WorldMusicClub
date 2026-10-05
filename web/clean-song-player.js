import {hasValidZeroSmpteOffsets} from './clean-song-timecode.js';
import {ReferenceAudioReceiver} from './midi-reference-synth.js';
import {createReferenceRoom} from './clean-song-reverb.js';
import {VsqPracticePlayer} from './vsq-practice-player.js';
import {BasicKeyPlayer,BASIC_KEY_RENDITION} from './basic-key-player.js';
import {basicKeyInstrumentOverrides} from './basic-key-audio-plan.js';
import {CleanSongError,isCleanSong,isVsqSong,isBasicKeysSong} from './clean-song-package.js';
import {INITIAL_SENSITIVITY_KIND,validInitialSensitivity,applyInitialSensitivity,unbentReferenceKey} from './clean-song-initial-sensitivity.js';
import {INITIAL_SENSITIVITY12_KIND,validInitialSensitivity12Song,applyInitialSensitivity12,centeredPitchState,unbentReferenceKey12} from './clean-song-initial-sensitivity12.js';
import {inspectLogicalDeviceRoute,isDeviceName,isUnsupportedRouteCommand,LOGICAL_DEVICE_POLICY_SUFFIX} from './clean-song-device-routing.js';
const metadata=new Set(['tempo','meter','key_signature','text','sequence_number','track_end','smpte_offset']);
const supported=new Set(['instrument_program','volume','pan','expression','reverb_send','initial_controller_reset','initial_sustain_off']);
export const CLEAN_RENDITION = 'wmh-procedural-reference-v1';
export function inspectCleanRendition(song) {
  const blockers=[];
  if(!isCleanSong(song))return{supported:false,blockers:['clean_package_invalid'],rendition:CLEAN_RENDITION};
  if(isBasicKeysSong(song)){const ready=song.runtime.rendition?.policy_id===BASIC_KEY_RENDITION;return{supported:ready,blockers:ready?[]:['basic_keys_reference_unavailable'],rendition:ready?BASIC_KEY_RENDITION:null};}
  if(isVsqSong(song))return{supported:Boolean(song.runtime)&&song.runtime.parts.length<=128,blockers:!song.runtime?['vsq_choice_required']:song.runtime.parts.length>128?['part_budget_exceeded']:[],rendition:'wmh-vsq-base-note-reference-v1'};
  if(!hasValidZeroSmpteOffsets(song.runtime))blockers.push('invalid_smpte_offset');
  if(song.score.performance.parts.length>128)blockers.push('part_budget_exceeded');
  const sensitivityValid=validInitialSensitivity(song);
  if(!sensitivityValid)blockers.push('initial_pitch_bend_sensitivity_invalid');
  const sensitivity12Valid=validInitialSensitivity12Song(song);
  if(!sensitivity12Valid)blockers.push('initial_pitch_bend_sensitivity12_invalid');
  const routing=inspectLogicalDeviceRoute(song.score,song.runtime,{strict:true});
  if(routing.blocker)blockers.push(routing.blocker);
  for(const event of song.runtime.events){const command=event.command;
    if(isDeviceName(command)||isUnsupportedRouteCommand(command))continue;
    if(command.kind===INITIAL_SENSITIVITY_KIND&&sensitivityValid)continue;
    if(command.kind===INITIAL_SENSITIVITY12_KIND&&sensitivity12Valid)continue;
    if(metadata.has(command.kind)||supported.has(command.kind))continue;
    if(['bank_select','chorus_send'].includes(command.kind)&&command.value===0)continue;
    blockers.push(command.kind);
  }
  return{supported:!blockers.length,blockers:[...new Set(blockers)],rendition:CLEAN_RENDITION+(routing.logical_device_mapping?LOGICAL_DEVICE_POLICY_SUFFIX:''),logical_device_mapping:routing.logical_device_mapping,logical_device_route_reason:routing.reason};
}
const defaults=()=>({program:0,volume:100,expression:127,pan:64,reverb_send:0,...centeredPitchState()});
function apply(state,command){if(command.kind===INITIAL_SENSITIVITY_KIND)applyInitialSensitivity(state,command.step);else if(command.kind===INITIAL_SENSITIVITY12_KIND)applyInitialSensitivity12(state,command.step);else if(command.kind==='instrument_program')state.program=command.program;else if(command.kind==='initial_controller_reset')state.expression=127;else if(['volume','expression','pan','reverb_send'].includes(command.kind))state[command.kind]=command.value;}
/** Schedules against the app Transport. Never owns human-input or scoring APIs. */
export class CleanSongPlayer {
  get audioThreadRunning(){return this.basicKeys.running||this.vsq.running;}
  constructor({getPositionMs,onError=()=>{},setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args),lookAheadMs=100}={}) {
    if(typeof getPositionMs!=='function')throw new TypeError('The shared transport clock is required.');
    this.vsq=new VsqPracticePlayer({getPositionMs,onError,setTimer,clearTimer,lookAheadMs});
    this.basicKeys=new BasicKeyPlayer({getPositionMs,onError,setTimer,clearTimer,lookAheadMs});
    Object.assign(this,{getPositionMs,onError,setTimer,clearTimer,lookAheadMs});this.epoch=0;this.timer=null;this.lanes=new Map();this.song=null;this.running=false;
  }
  select(song){this.stop();this.song=song;this.profile=inspectCleanRendition(song);this.programs=new Map();this.vsq.select(isVsqSong(song)?song:null);this.basicKeys.select(isBasicKeysSong(song)?song:null);if(!song||isVsqSong(song)||isBasicKeysSong(song))return;
    if(!this.profile.supported)return;
    const merged=[...song.runtime.events.map(event=>({...event,type:'command'})),...song.runtime.notes.map(note=>({at_ms:note.start_ms,origin:note.attack,note,type:'note'}))].sort((a,b)=>a.at_ms-b.at_ms||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
    const channels=new Map();for(const item of merged){const channel=item.command?.channel??item.note?.channel;const state=channels.get(channel)||defaults();channels.set(channel,state);if(item.type==='command')apply(state,item.command);else this.programs.set(item.note.event_id,state.program);}
  }
  prepare(options={}) {
    if(isBasicKeysSong(this.song))return this.basicKeys.prepare(options);
    if(isVsqSong(this.song))return this.vsq.prepare(options);
    basicKeyInstrumentOverrides([],options.instrumentOverrides);
    return null;
  }
  startPrepared(options={}) {return (isVsqSong(this.song)?this.vsq:this.basicKeys).startPrepared(options);}
  start({context,output,mode='listen',targetPart=null,practiceSelection,mutedParts=null,soloParts=null,resumePositionMs=null,instrument='piano',instrumentOverrides={},acceptedPolicyId}={}) {
    if(isBasicKeysSong(this.song))return this.basicKeys.start({context,output,mode,targetPart,practiceSelection,mutedParts,soloParts,resumePositionMs,instrumentOverrides,acceptedPolicyId});
    if(isVsqSong(this.song))return this.vsq.start({context,output,mode,targetPart,practiceSelection,mutedParts,soloParts,resumePositionMs,instrument,instrumentOverrides});
    this.stop();basicKeyInstrumentOverrides([],instrumentOverrides);if(!this.song||!this.profile.supported)throw new CleanSongError('clean_renderer_unsupported','The reference renderer cannot represent these retained commands.',{blockers:this.profile?.blockers});
    if(this.profile.logical_device_mapping&&acceptedPolicyId!==this.profile.rendition)throw new CleanSongError('reference_policy_required','Select the disclosed logical device mapping to this procedural receiver.');
    if(!context||context.state!=='running'||!output)throw new CleanSongError('clean_audio_unavailable','Audio must be unlocked by a user gesture.');
    if(mode==='practice'&&!this.song.score.performance.parts.some(part=>part.id===targetPart))throw new CleanSongError('clean_target_required','Choose one human part.');
    this.resumePositionMs=resumePositionMs;this.context=context;this.output=output;this.mode=mode;this.targetPart=targetPart;this.mutedParts=new Set(mutedParts||[]);this.channels=new Map();this.running=true;
    const position=this.getPositionMs(),events=this.song.runtime.events;this.eventCursor=0;this.noteCursor=0;
    try{
      for(const part of this.song.score.performance.parts){let gain,pan,room;try{gain=context.createGain();pan=context.createStereoPanner();room=createReferenceRoom(context,output);gain.connect(pan);pan.connect(room.input);const receiver=new ReferenceAudioReceiver(context,gain,{maxVoices:128,ErrorType:CleanSongError});this.lanes.set(part.id,{part,gain,pan,room,receiver});}catch(error){gain?.disconnect();pan?.disconnect();room?.close();throw error;}}
      while(this.eventCursor<events.length&&events[this.eventCursor].at_ms<position)this.command(events[this.eventCursor++],context.currentTime);
      while(this.noteCursor<this.song.runtime.notes.length&&this.song.runtime.notes[this.noteCursor].end_ms<=position)this.noteCursor++;
      for(const lane of this.lanes.values())this.updateLane(lane,context.currentTime);
      this.pump(this.epoch,true);
    }catch(error){this.stop();throw error;}
  }
  updateLane(lane,at){const state=this.channels.get(lane.part.channel)||defaults();const silent=this.mutedParts.has(lane.part.id)||(this.mode==='practice'&&this.targetPart===lane.part.id);lane.gain.gain.setValueAtTime(silent?0:(state.volume/127)*(state.expression/127),at);lane.pan.pan.setValueAtTime(Math.max(-1,(state.pan-64)/63),at);lane.room.set(silent?0:state.reverb_send,at);}
  command(event,at){const command=event.command;if(command.channel===undefined)return;const state=this.channels.get(command.channel)||defaults();apply(state,command);this.channels.set(command.channel,state);for(const lane of this.lanes.values())if(lane.part.channel===command.channel)this.updateLane(lane,at);}
  pump(epoch=this.epoch,initial=false){
    if(!this.running||epoch!==this.epoch)return;
    try{
      const context=this.context,position=this.getPositionMs(),now=context.currentTime;
      if(context.state!=='running'||!Number.isFinite(position))throw new CleanSongError('clean_clock_unavailable','Playback clock or audio context stopped.');
      const events=this.song.runtime.events,notes=this.song.runtime.notes,limit=position+this.lookAheadMs;
      while(this.eventCursor<events.length&&events[this.eventCursor].at_ms<=limit){const event=events[this.eventCursor++];if(!initial&&event.at_ms<position-30)throw new CleanSongError('clean_late_scheduler','A performance event missed its audio deadline.',{eventId:event.event_id});this.command(event,now+Math.max(0,event.at_ms-position)/1000);}
      while(this.noteCursor<notes.length&&notes[this.noteCursor].start_ms<=limit){const note=notes[this.noteCursor++];if(note.end_ms<=Math.max(position,initial&&Number.isFinite(this.resumePositionMs)?this.resumePositionMs:position))continue;if(this.mutedParts.has(note.part_id)||(this.mode==='practice'&&note.part_id===this.targetPart))continue;
        if(!initial&&note.start_ms<position-30)throw new CleanSongError('clean_late_scheduler','A note missed its audio deadline.',{eventId:note.event_id});
        let count=0;for(const lane of this.lanes.values()){lane.receiver.prune(now);count+=lane.receiver.voices.size;}if(count>=128)throw new CleanSongError('voice_budget_exceeded','The full reference exceeds its 128 voice limit.');
        const state=this.channels.get(note.channel)||defaults();
        const key=state.sensitivity12_steps?unbentReferenceKey12(state,note.key):unbentReferenceKey(state,note.key);
        this.lanes.get(note.part_id).receiver.schedule({eventId:note.event_id,key,velocity:note.velocity,program:this.programs.get(note.event_id),percussion:false},now+Math.max(0,Math.max(note.start_ms,initial&&Number.isFinite(this.resumePositionMs)?this.resumePositionMs:note.start_ms)-position)/1000,now+(note.end_ms-position)/1000);
      }
      this.timer=this.setTimer(()=>this.pump(epoch),20);
    }catch(error){this.stop();if(initial)throw error;this.onError(error);}
  }
  pause(){this.stop();}
  stop(){this.vsq.stop();this.basicKeys.stop();this.epoch++;this.running=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;for(const lane of this.lanes.values()){lane.receiver.silence();lane.gain.disconnect();lane.pan.disconnect();lane.room.close();}this.lanes.clear();}
  destroy(){this.stop();this.song=null;}
}
