import {BasicKeyAudioCore} from './basic-key-audio-core.js';
import {BasicKeyAudioError} from './basic-key-audio-plan.js';
import {CANONICAL_AUDIO_LIMITS as LIMITS,openCanonicalAudioTransfer,canonicalPlanHasher} from './canonical-audio-plan.js';
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const reject=(code,message)=>{throw new BasicKeyAudioError(code,message);};
const profile=Object.freeze({
  limits:LIMITS,prepareMaxRows:256,allowZeroVelocity:true,openTransfer:openCanonicalAudioTransfer,
  identity:(p,i)=>({occurrenceIndex:p.occurrences[i]}),compareIdentity:(p,a,b)=>p.occurrences[a]-p.occurrences[b],
  validIdentity:(p,i)=>int(p.occurrences[i],0,p.sourceOccurrences-1)&&p.roles[i]===0,
  beginValidation:canonicalPlanHasher,
  validateRow(p,i,h){h.gate(p.occurrences[i],p.starts[i],p.ends[i],p.keys[i],p.velocities[i]);},
  finishValidation(p,h){if(h.hex()!==p.planFingerprint)reject('canonical_audio_fingerprint','Transferred gates do not match the prepared frame-plan fingerprint.');},
});

/** Canonical clocks and pause continuity share the tested DSP/scheduler, while
 * its distinct profile validates numeric canonical identities and f64-ms gates.
 * Held voices keep oscillator phase and envelope age across a pause. No timer,
 * renderer callback, input event or scoring callback can schedule a note here. */
export class CanonicalAudioCore extends BasicKeyAudioCore {
  constructor(sampleRate,options={}){super(sampleRate,{...options,profile});this.pauseCount=0;this.totalPausedFrames=0;this.pauseSpans=new Float64Array(LIMITS.maxPauses*2);}
  snapshot(frame){return {...super.snapshot(frame),sourceFingerprint:this.plan?.sourceFingerprint??null,compiledFingerprint:this.plan?.compiledFingerprint??null,selectionFingerprint:this.plan?.selectionFingerprint??null,planFingerprint:this.plan?.planFingerprint??null,sourcePositionFrame:this.sourcePosition(frame),pauseCount:this.pauseCount,totalPausedFrames:this.totalPausedFrames};}
  sourcePosition(frame){if(this.state==='paused'||this.resumeFrame!=null&&frame<this.resumeFrame)return this.pausedPositionFrame;if(this.anchorFrame==null)return this.positionFrame??null;return Math.min(this.plan?.durationFrames??0,this.positionFrame+Math.max(0,frame-this.anchorFrame));}
  emitCompletion(type,frame,extra={}){
    // The full pause ledger is bounded separately from notes and transferred
    // only at completion. Indices continue to address the same immutable plan.
    const spans=this.pauseSpans.slice(0,this.pauseCount*2);
    super.emitCompletion(type,frame,{...extra,pauseSpans:spans,initialAnchorFrame:this.initialAnchorFrame??null});
  }
  handleMessage(message,frame){
    if(message?.type==='prepare'&&int(message.generation,this.generation+1,LIMITS.maxGeneration)){
      // Replaced completion must observe the old generation's pause ledger.
      super.handleMessage(message,frame);this.pauseCount=0;this.totalPausedFrames=0;this.initialAnchorFrame=null;this.pausedPositionFrame=null;this.pauseFrame=null;this.resumeFrame=null;return;
    }
    if(message?.type==='pause'||message?.type==='resume'){
      try{
        if(!int(frame,0,LIMITS.maxFrame)||!int(message.generation,1,LIMITS.maxGeneration))reject('invalid_audio_command','Invalid canonical pause generation or frame.');
        if(message.generation<this.generation){this.emit({type:'stale',generation:message.generation,requestId:message.requestId});return;}
        if(message.generation!==this.generation)reject('invalid_audio_command','Canonical pause generation was not prepared.');
        if(message.type==='pause'){
          if(this.state!=='running')reject('invalid_audio_command','Only running canonical playback can pause.');
          if(this.pauseCount>=LIMITS.maxPauses)reject('canonical_audio_budget','The 4096-pause ledger bound was reached; stop and prepare a new generation.');
          // Messages are admitted at a quantum boundary. Expire gates ending
          // exactly here, then freeze all remaining voices without releasing.
          for(let i=this.activeCount-1;i>=0;i--)if(this.voiceSlots[this.activeSlots[i]].end<=frame)this.finishVoice(i,frame,'gate');
          this.pausedPositionFrame=this.sourcePosition(frame);this.pauseFrame=frame;this.state='paused';
          this.pauseSpans[this.pauseCount*2]=frame;this.pauseSpans[this.pauseCount*2+1]=-1;this.pauseCount++;
          this.emit({type:'paused',requestId:message.requestId,...this.snapshot(frame)});return;
        }
        if(this.state!=='paused')reject('invalid_audio_command','Only paused canonical playback can resume.');
        const anchor=message.anchorFrame;
        if(!int(anchor,frame+1,Math.min(LIMITS.maxFrame,frame+Math.ceil(this.sampleRate*.1))))reject('clean_late_start','Canonical resume requires a future anchor within 100 ms.');
        const shift=anchor-this.pauseFrame;
        if(!int(this.anchorFrame+shift+this.plan.durationFrames-this.positionFrame,0,LIMITS.maxFrame))reject('invalid_audio_command','Resumed source exceeds the frame budget.');
        this.anchorFrame+=shift;
        for(let i=0;i<this.activeCount;i++){const v=this.voiceSlots[this.activeSlots[i]];v.start+=shift;v.end+=shift;}
        this.pauseSpans[(this.pauseCount-1)*2+1]=anchor;this.totalPausedFrames+=shift;
        this.resumeFrame=anchor;this.resumeExpectedFrame=frame;this.expectedFrame=null;this.previousBlockFrame=null;this.previousBlockLength=0;this.successfulBlocks=0;this.state='running';
        this.emit({type:'resumed',requestId:message.requestId,resumeFrame:anchor,...this.snapshot(frame)});return;
      }catch(error){this.fail(error,frame,message.requestId);return;}
    }
    super.handleMessage(message,frame);
    if(message?.type==='start'&&this.state==='running')this.initialAnchorFrame=this.anchorFrame;
  }
  process(channels,firstFrame){
    // The shared sample loop must not advance held phases in the lead to resume.
    // Preserve its contiguous render-frame check and skip the frozen prefix.
    if(this.state==='running'&&this.resumeFrame!=null){
      const length=channels[0]?.length??0;
      if(firstFrame!==this.resumeExpectedFrame){for(const c of channels)c.fill(0);try{this.discontinuity('block-frame',this.resumeExpectedFrame,firstFrame,length);}catch(error){this.fail(error,firstFrame);}return true;}
      this.resumeExpectedFrame=firstFrame+length;
      if(firstFrame+length<=this.resumeFrame){for(const c of channels)c.fill(0);return true;}
      const offset=Math.max(0,this.resumeFrame-firstFrame);this.resumeFrame=null;
      if(offset){for(const c of channels)c.fill(0);return super.process(channels.map(c=>c.subarray(offset)),firstFrame+offset);}
    }
    return super.process(channels,firstFrame);
  }
}
