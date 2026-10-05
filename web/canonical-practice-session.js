import {resolvePracticeSelection} from './practice-selection.js';
import {windowNotes} from './practice-settings.js';
import {CanonicalPlayer,CANONICAL_AUDIO_POLICY} from './canonical-player.js';
import {buildCanonicalAudioPlan} from './canonical-audio-plan.js';

/** The legacy single-part control is only a display/navigation anchor. The
 * explicit selection remains the owner of every human target and export. */
export function canonicalPracticeOptions(parts,{practiceSelection,practiceLayout='solo',showOthers=true,part=null}={}) {
  const selection=resolvePracticeSelection(parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]}));
  return {practiceSelection:selection,practiceLayout,showOthers,part:selection.kind==='all'?null:selection.part_ids[0]};
}

/** Machine display follows the same half-open range as the audio renderer.
 * Clip copies only; source occurrence IDs and tie references remain intact. */
export function canonicalDisplayNotes(timeline,loop=null) {
  return loop?windowNotes(timeline.notes,loop.start_ms,loop.end_ms):timeline.notes;
}

/** One selected canonical compilation owns its evidence and renderer. Neither
 * physical target deduplication nor view filtering may enter this boundary. */
export class CanonicalPracticeSession {
  constructor({api,onError=()=>{},onEnded=()=>{},onPass=()=>{},playerFactory=options=>new CanonicalPlayer(options)}={}) {
    this.api=api;this.onError=onError;this.onEnded=onEnded;this.epoch=0;
    this.player=playerFactory({onError:error=>{this.phase='stopped';this.errorClock=this.player.lastStopClock;this.onError(error);},onPass:receipt=>{this.passReceipts?.push(receipt);onPass(receipt);},onEnded:result=>{this.phase='ended';this.completion=result;this.onEnded(result);}});
  }
  select(compilation) {this.stop();this.compilation=compilation;this.profile=null;this.interpretation=null;}
  stop() {this.epoch++;this.controller?.abort();this.controller=null;this.player.stop();this.completion=null;this.preparing=false;this.phase='stopped';this.errorClock=null;this.silentPlan=null;}
  get running(){return this.player.running;}
  get plan(){return this.player.plan||this.silentPlan;}
  sourcePositionMs(){return this.player.sourcePositionMs()??this.errorClock?.positionMs??null;}
  sourceClock(){return this.player.sourceClockAtTime?.()??null;}
  get held(){return ['pausing','paused','resuming'].includes(this.phase);}
  get paused(){return this.phase==='paused';}
  get pausePending(){return this.phase==='pausing';}
  wallAtFrame(frame){return this.clockOrigin?this.clockOrigin.wallTime+(frame/this.clockOrigin.sampleRate-this.clockOrigin.audioTime)*1000:null;}
  async prepare({soundEnabled=true,context,output,mode='practice',practiceSelection,audiblePartIds,instrumentOverrides,mutedPartIds,range,countInMs=0,loop,resumePositionMs=undefined}={}) {
    this.stop();const epoch=this.epoch,compilation=this.compilation,controller=new AbortController();this.controller=controller;this.preparing=true;
    const current=()=>epoch===this.epoch&&!controller.signal.aborted&&compilation===this.compilation;
    try {
      let profile=this.profile;
      if(!profile)try{profile=await this.api('/api/canonical-audio-profile',compilation.score,controller.signal);}catch(error){if(error.name==='AbortError')throw error;throw Object.assign(new Error('The canonical source audio profile could not be prepared.',{cause:error}),{code:error.code||'canonical_audio_profile'});}
      if(!current())return null;
      const options={context,output,mode,practiceSelection,audiblePartIds,instrumentOverrides,mutedPartIds,range,...(range?{countInMs}:{}),loop,resumePositionMs,acceptedPolicyId:CANONICAL_AUDIO_POLICY};
      // Silent practice still validates exact compiler evidence and keeps the
      // complete source clock. It never manufactures an audio-device claim.
      let plan;
      if(soundEnabled){this.player.select(compilation,profile);const result=await this.player.prepare(options);if(!result||!current())return null;plan=this.player.plan;}
      else plan=buildCanonicalAudioPlan(compilation,profile,{...options,sampleRate:context?.sampleRate||48000});
      if(!current())return null;
      this.profile=profile;this.silentPlan=soundEnabled?null:plan;this.passReceipts=[];
      this.interpretation={source_fingerprint:profile.source_fingerprint,source_fingerprint_scope:'normalized_canonical_score',compiled_fingerprint:profile.compiled_fingerprint,runtime_profile:profile.profile,policy_id:CANONICAL_AUDIO_POLICY,selection_fingerprint:plan.selectionFingerprint,plan_fingerprint:plan.planFingerprint,source_clock_available:true,source_duration_ms:profile.duration_ms,sound_enabled:soundEnabled,reference_timbre:'sine',source_timbres_preserved:false,timing:'Rust compiled binary64 milliseconds; floor attacks and ceil ends to device sample frames',sample_rate:plan.sampleRate,range:range?structuredClone(range):null,loop:loop?structuredClone(loop):null,count_in_ms:countInMs};
      if(plan.synthesisPolicyId){this.interpretation.synthesis_policy_id=plan.synthesisPolicyId;this.interpretation.instrument_overrides={...plan.instrumentOverrides};this.interpretation.reference_timbre='per-part synthetic';this.interpretation.timbre_description='Basic sine, triangle-like, and reed-like additive synthesis; not acoustic instrument reproduction';}
      if(plan.mutedPartIds.length)this.interpretation.muted_part_ids=[...plan.mutedPartIds];
      if(plan.rangeMode)this.interpretation.loop_budget={requested_passes:plan.requestedPasses,max_passes:plan.maxPasses,budget_limited:plan.budgetLimited,range_gate_count:plan.rangeGateCount,first_gate_count:plan.firstGateCount,record_capacity:plan.recordCapacity,range_start_frame:plan.rangeStartFrame,range_end_frame:plan.rangeEndFrame,count_in_frames:plan.countInFrames,initial_position_frame:plan.initialPositionFrame,initial_count_in_frames:plan.initialCountInFrames};
      this.phase='ready';return {plan,interpretation:this.interpretation};
    }catch(error){if(!current()||error.name==='AbortError')return null;throw error;}
    finally{if(epoch===this.epoch){this.preparing=false;this.controller=null;}}
  }
  async startPrepared(options){const epoch=this.epoch,result=await this.player.startPrepared(options);if(epoch!==this.epoch||!result)return null;this.phase='running';return result;}
  bindWallClock({wallTime,audioTime,sampleRate}){this.clockOrigin={wallTime,audioTime,sampleRate};}
  async pause(){
    if(!this.running)return null;
    const epoch=this.epoch;this.phase='pausing';
    const pending=this.player.pause();this.pendingPause=pending;
    try{const result=await pending;if(epoch!==this.epoch||!result)return null;this.phase='paused';return {...result,positionMs:result.sourcePositionFrame*1000/result.sampleRate,wallTime:this.wallAtFrame(result.frame)};}
    catch(error){if(epoch!==this.epoch)return null;this.stop();throw error;}
    finally{if(this.pendingPause===pending)this.pendingPause=null;}
  }
  async resume(options){
    if(!this.paused)return null;
    const epoch=this.epoch,positionMs=this.sourcePositionMs();this.phase='resuming';
    try{const result=await this.player.resume(options);if(epoch!==this.epoch||!result)return null;this.phase='running';return {...result,positionMs,anchorTime:result.resumeTime};}
    catch(error){if(epoch!==this.epoch)return null;this.stop();throw error;}
  }
  // Page lifecycle cleanup also covers BFCache. A later explicit Play may
  // prepare the still-selected score again, but no receiver survives pagehide.
  destroy(){this.stop();}
}
