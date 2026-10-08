import {BasicKeyAudioCore} from './basic-key-audio-core.js';
import {MAX_AUDIO_START_LEAD_SECONDS} from './audio-start-lead.js';
import {BasicKeyAudioError} from './basic-key-audio-plan.js';
import {CANONICAL_AUDIO_LIMITS as LIMITS,CANONICAL_SYNTHETIC_INSTRUMENTS,openCanonicalAudioTransfer,canonicalPlanHasher} from './canonical-audio-plan.js';
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const TAU=2*Math.PI;
// Basic synthetic colors, not acoustic instrument models. Harmonics above
// Nyquist are excluded for each pitch; nine terms bound sample-loop work.
const TRIANGLE=Object.freeze([0,1,0,-1/9,0,1/25,0,-1/49,0,1/81]);
const REED=Object.freeze([0,1,.55,.4,.2,.15,.1,.08,.05,.03]);
const rangeDuration=p=>p.initialCountInFrames+p.rangeEndFrame-p.initialPositionFrame+(p.maxPasses-1)*(p.countInFrames+p.rangeEndFrame-p.rangeStartFrame);
const reject=(code,message)=>{throw new BasicKeyAudioError(code,message);};
const profile=Object.freeze({
  limits:LIMITS,prepareMaxRows:256,allowZeroVelocity:true,openTransfer:openCanonicalAudioTransfer,
  identity:(p,i)=>({occurrenceIndex:p.occurrences[i]}),compareIdentity:(p,a,b)=>p.occurrences[a]-p.occurrences[b],
  validIdentity:(p,i)=>int(p.occurrences[i],0,p.sourceOccurrences-1)&&p.roles[i]===0,
  validatePosition(p,position){if(p.rangeMode&&position!==p.initialPositionFrame-p.initialCountInFrames)reject('invalid_audio_command','The range position differs from its fingerprinted A/count-in.');},
  scratchCount:p=>p.rangeMode?p.maxPasses:0,
  initializeScratch(p,index){if(p.rangeMode&&index<p.maxPasses)p.passFrames[index]=-1;},
  eligibleGate:(p,i,position)=>p.rangeMode?p.initialPositionFrame<p.rangeEndFrame&&p.ends[i]>p.initialPositionFrame:p.ends[i]>position,
  beginValidation(p){const h=canonicalPlanHasher(p);h.rangeCount=0;h.firstCount=0;return h;},
  audibleGate:(p,i)=>!p.rangeMode||p.ends[i]>p.rangeStartFrame&&p.starts[i]<p.rangeEndFrame,
  validateRow(p,i,h){h.gate(p.occurrences[i],p.starts[i],p.ends[i],p.keys[i],p.velocities[i]);if(p.instruments){if(!int(p.instruments[i],0,CANONICAL_SYNTHETIC_INSTRUMENTS.length-1))reject('invalid_canonical_audio_plan','A transferred synthetic instrument is unsupported.');h.number(p.instruments[i]);}if(p.ends[i]>p.rangeStartFrame&&p.starts[i]<p.rangeEndFrame){if(p.rangeMode)p.rangeOrder[h.rangeCount]=i;h.rangeCount++;if(p.initialPositionFrame<p.rangeEndFrame&&p.ends[i]>p.initialPositionFrame)h.firstCount++;}},
  finishValidation(p,h){if(h.hex()!==p.planFingerprint||h.rangeCount!==p.rangeGateCount||h.firstCount!==p.firstGateCount)reject('canonical_audio_fingerprint','Transferred gates do not match the prepared frame-plan fingerprint.');},
});

/** Canonical clocks and pause continuity share the tested DSP/scheduler, while
 * its distinct profile validates numeric canonical identities and f64-ms gates.
 * Held voices keep oscillator phase and envelope age across a pause. No timer,
 * renderer callback, input event or scoring callback can schedule a note here. */
export class CanonicalAudioCore extends BasicKeyAudioCore {
  constructor(sampleRate,options={}){super(sampleRate,{...options,profile});this.pauseCount=0;this.totalPausedFrames=0;this.pauseSpans=new Float64Array(LIMITS.maxPauses*2);for(const voice of this.voiceSlots){voice.recordIndex=-1;voice.syntheticInstrument=0;voice.harmonicLimit=1;voice.harmonicScale=1;}}
  snapshot(frame){return {...super.snapshot(frame),sourceFingerprint:this.plan?.sourceFingerprint??null,compiledFingerprint:this.plan?.compiledFingerprint??null,selectionFingerprint:this.plan?.selectionFingerprint??null,planFingerprint:this.plan?.planFingerprint??null,sourcePositionFrame:this.sourcePosition(frame),pauseCount:this.pauseCount,totalPausedFrames:this.totalPausedFrames,rangeMode:this.plan?.rangeMode??false,rangePolicyId:this.plan?.rangePolicyId??null,rangeStartFrame:this.plan?.rangeStartFrame??0,rangeEndFrame:this.plan?.rangeEndFrame??0,countInFrames:this.plan?.countInFrames??0,rangeGateCount:this.plan?.rangeGateCount??0,firstGateCount:this.plan?.firstGateCount??0,initialPositionFrame:this.plan?.initialPositionFrame??0,initialCountInFrames:this.plan?.initialCountInFrames??0,requestedPasses:this.plan?.requestedPasses??1,maxPasses:this.plan?.maxPasses??1,budgetLimited:(this.plan?.maxPasses??1)<(this.plan?.requestedPasses??1),recordCapacity:this.plan?.recordCapacity??0,passIndex:this.state==='paused'||this.resumeFrame!=null&&frame<this.resumeFrame?this.pausedPassIndex??-1:this.plan?.rangeMode&&this.anchorFrame!=null?this.rangeClock(frame).passIndex:this.rangePassIndex??-1};}
  sourcePosition(frame){if(this.state==='paused'||this.resumeFrame!=null&&frame<this.resumeFrame)return this.pausedPositionFrame;if(this.anchorFrame==null)return this.positionFrame??null;
    if(this.plan?.rangeMode)return this.rangeClock(frame).position;
    return Math.min(this.plan?.durationFrames??0,this.positionFrame+Math.max(0,frame-this.anchorFrame));}
  rangeClock(frame){
    const p=this.plan,elapsed=Math.max(0,frame-this.anchorFrame),firstLength=p.rangeEndFrame-p.initialPositionFrame,cycle=p.countInFrames+p.rangeEndFrame-p.rangeStartFrame;
    if(elapsed<p.initialCountInFrames)return {position:p.initialPositionFrame+elapsed-p.initialCountInFrames,passIndex:0};
    const first=elapsed-p.initialCountInFrames;if(first<firstLength)return {position:p.initialPositionFrame+first,passIndex:0};
    const remaining=first-firstLength;if(p.maxPasses===1||remaining>=(p.maxPasses-1)*cycle)return {position:p.rangeEndFrame,passIndex:p.maxPasses-1};
    return {position:p.rangeStartFrame+remaining%cycle-p.countInFrames,passIndex:1+Math.floor(remaining/cycle)};
  }
  emitCompletion(type,frame,extra={}){
    // The full pause ledger is bounded separately from notes and transferred
    // only at completion. Indices continue to address the same immutable plan.
    const spans=this.pauseSpans.slice(0,this.pauseCount*2);
    if(this.plan?.rangeMode&&this.validated){
      const p=this.plan,ledger=this.rangeLedgerTransferred?null:{actualStarts:p.loopStarts,actualEnds:p.loopEnds};
      const transfer=ledger?[p.loopStarts.buffer,p.loopEnds.buffer,p.passFrames.buffer,spans.buffer]:[spans.buffer];
      this.rangeLedgerTransferred=true;this.actualStarts=null;this.actualEnds=null;
      this.emit({type,...extra,...this.snapshot(frame),ledger,pauseSpans:spans,initialAnchorFrame:this.initialAnchorFrame??null,ledgerLayout:'range-pass-major',recordCount:this.startedCount,passCount:this.rangeCycleCount??0,observedPassCount:this.observedPassCount??0,completedPasses:this.state==='ended'?this.plan.maxPasses:Math.max(0,(this.rangeCycleCount??0)-1),passFrames:ledger?p.passFrames:null},transfer);return;
    }
    super.emitCompletion(type,frame,{...extra,pauseSpans:spans,initialAnchorFrame:this.initialAnchorFrame??null});
  }
  handleMessage(message,frame){
    if(message?.type==='prepare'&&int(message.generation,this.generation+1,LIMITS.maxGeneration)){
      // Replaced completion must observe the old generation's pause ledger.
      super.handleMessage(message,frame);this.pauseCount=0;this.totalPausedFrames=0;this.initialAnchorFrame=null;this.pausedPositionFrame=null;this.pauseFrame=null;this.resumeFrame=null;this.rangePassIndex=-1;this.rangeLedgerTransferred=false;this.rangeCycleCount=0;this.observedPassCount=0;return;
    }
    if(message?.type==='audit'&&this.plan?.rangeMode&&message.generation===this.generation){
      try{
        const p=this.plan;if(!this.validated||!int(message.offset,0,this.startedCount)||!int(message.count,1,LIMITS.maxAuditRows))reject('invalid_audio_command','The range audit page is invalid.');
        if(this.rangeLedgerTransferred){this.emit({type:'audit_transferred',requestId:message.requestId,...this.snapshot(frame),offset:message.offset,count:message.count});return;}
        const end=Math.min(this.startedCount,message.offset+message.count),rows=[];
        for(let index=message.offset;index<end;index++){const first=index<p.firstGateCount,noteIndex=first?p.playOrder[index]:p.rangeOrder[(index-p.firstGateCount)%p.rangeGateCount];rows.push({index,noteIndex,passIndex:first?0:1+Math.floor((index-p.firstGateCount)/p.rangeGateCount),occurrenceIndex:p.occurrences[noteIndex],startFrame:Math.max(first?p.initialPositionFrame:p.rangeStartFrame,p.starts[noteIndex]),endFrame:Math.min(p.rangeEndFrame,p.ends[noteIndex]),actualStartFrame:p.loopStarts[index],actualEndFrame:p.loopEnds[index]});}
        this.emit({type:'audit',requestId:message.requestId,...this.snapshot(frame),offset:message.offset,nextOffset:end,rows});return;
      }catch(error){this.fail(error,frame,message.requestId);return;}
    }
    if(message?.type==='pause'||message?.type==='resume'){
      try{
        if(!int(frame,0,LIMITS.maxFrame)||!int(message.generation,1,LIMITS.maxGeneration))reject('invalid_audio_command','Invalid canonical pause generation or frame.');
        if(message.generation<this.generation){this.emit({type:'stale',generation:message.generation,requestId:message.requestId});return;}
        if(message.generation!==this.generation)reject('invalid_audio_command','Canonical pause generation was not prepared.');
        if(message.type==='pause'){
          if(this.state!=='running')reject('invalid_audio_command','Only running canonical playback can pause.');
          // No sample has resumed while resumeFrame remains in the future.
          // Reopen the existing pause rather than booking its lead twice.
          if(this.resumeFrame!=null&&frame<=this.resumeFrame){
            const index=this.pauseCount-1,start=this.pauseSpans[index*2],end=this.pauseSpans[index*2+1],shift=end-start;
            this.anchorFrame-=shift;this.totalPausedFrames-=shift;
            for(let i=0;i<this.activeCount;i++){const voice=this.voiceSlots[this.activeSlots[i]];voice.start-=shift;voice.end-=shift;}
            if(this.plan.rangeMode){this.rangePassAnchor-=shift;this.rangeCycleAnchor-=shift;this.rangeBoundary-=shift;}
            this.pauseSpans[index*2+1]=-1;this.pauseFrame=start;this.resumeFrame=null;this.state='paused';
            this.emit({type:'paused',requestId:message.requestId,pauseFrame:start,resumedLeadCanceled:true,...this.snapshot(frame)});return;
          }
          if(this.pauseCount>=LIMITS.maxPauses)reject('canonical_audio_budget','The 4096-pause ledger bound was reached; stop and prepare a new generation.');
          // Messages are admitted at a quantum boundary. Expire gates ending
          // exactly here, then freeze all remaining voices without releasing.
          for(let i=this.activeCount-1;i>=0;i--)if(this.voiceSlots[this.activeSlots[i]].end<=frame)this.finishVoice(i,frame,'gate');
          this.pausedPositionFrame=this.sourcePosition(frame);this.pausedPassIndex=this.plan.rangeMode?this.rangeClock(frame).passIndex:0;this.pauseFrame=frame;this.state='paused';
          this.pauseSpans[this.pauseCount*2]=frame;this.pauseSpans[this.pauseCount*2+1]=-1;this.pauseCount++;
          this.emit({type:'paused',requestId:message.requestId,pauseFrame:frame,resumedLeadCanceled:false,...this.snapshot(frame)});return;
        }
        if(this.state!=='paused')reject('invalid_audio_command','Only paused canonical playback can resume.');
        const anchor=message.anchorFrame;
        if(!int(anchor,frame+1,Math.min(LIMITS.maxFrame,frame+Math.ceil(this.sampleRate*MAX_AUDIO_START_LEAD_SECONDS))))reject('clean_late_start','Canonical resume requires a future anchor within the bounded 500 ms acknowledgement window.');
        const shift=anchor-this.pauseFrame;
        if(!int(this.anchorFrame+shift+this.plan.durationFrames-this.positionFrame,0,LIMITS.maxFrame))reject('invalid_audio_command','Resumed source exceeds the frame budget.');
        if(this.plan.rangeMode&&!int(this.anchorFrame+shift+rangeDuration(this.plan),0,LIMITS.maxFrame))reject('invalid_audio_command','The resumed complete loop exceeds the frame budget.');
        this.anchorFrame+=shift;if(this.plan.rangeMode){this.rangePassAnchor+=shift;this.rangeCycleAnchor+=shift;this.rangeBoundary+=shift;}
        for(let i=0;i<this.activeCount;i++){const v=this.voiceSlots[this.activeSlots[i]];v.start+=shift;v.end+=shift;}
        this.pauseSpans[(this.pauseCount-1)*2+1]=anchor;this.totalPausedFrames+=shift;
        this.resumeFrame=anchor;this.resumeExpectedFrame=frame;this.expectedFrame=null;this.previousBlockFrame=null;this.previousBlockLength=0;this.successfulBlocks=0;this.state='running';
        this.emit({type:'resumed',requestId:message.requestId,resumeFrame:anchor,pauseFrame:this.pauseFrame,...this.snapshot(frame)});return;
      }catch(error){this.fail(error,frame,message.requestId);return;}
    }
    if(message?.type==='start'&&this.plan?.rangeMode&&message.generation===this.generation){
      const p=this.plan;if(!int(message.anchorFrame+rangeDuration(p),0,LIMITS.maxFrame)){this.fail(new BasicKeyAudioError('invalid_audio_command','The complete loop exceeds the anchored frame budget.'),frame,message.requestId);return;}
    }
    const acceptedStart=message?.type==='start'&&message.generation===this.generation&&this.state==='ready';
    super.handleMessage(message,frame);
    if(acceptedStart&&message?.type==='start'&&this.state==='running'){this.initialAnchorFrame=this.anchorFrame;if(this.plan.rangeMode){this.rangePassIndex=0;this.rangeCycleCount=0;this.observedPassCount=0;this.rangeCycleAnchor=this.anchorFrame;this.rangePassAnchor=this.anchorFrame+this.plan.initialCountInFrames;this.rangeBoundary=this.rangePassAnchor+this.plan.rangeEndFrame-this.plan.initialPositionFrame;this.rangePassOpened=false;this.cursor=0;}}
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
      if(offset){for(const c of channels)c.fill(0);return this.render(channels.map(c=>c.subarray(offset)),firstFrame+offset);}
    }
    return this.render(channels,firstFrame);
  }
  render(channels,firstFrame){return this.plan?.rangeMode&&this.state==='running'?this.processRange(channels,firstFrame):super.process(channels,firstFrame);}
  attack(index,frame){
    const record=this.startedCount,p=this.plan;if(p.rangeMode&&record>=p.recordCapacity)reject('canonical_audio_budget','The complete pass ledger is exhausted.');
    super.attack(index,frame);const voice=this.voiceSlots[this.activeSlots[this.activeCount-1]];
    voice.syntheticInstrument=p.instruments?.[index]??0;
    if(voice.syntheticInstrument){
      const harmonics=voice.syntheticInstrument===1?TRIANGLE:REED;voice.harmonicLimit=Math.min(9,Math.ceil(Math.PI/voice.step)-1);
      let gain=0;for(let h=1;h<=voice.harmonicLimit;h++)gain+=Math.abs(harmonics[h]);voice.harmonicScale=1/gain;
    }
    if(!p.rangeMode)return;
    voice.end=this.rangePassAnchor+Math.min(p.ends[index],p.rangeEndFrame)-(this.rangePassIndex===0?p.initialPositionFrame:p.rangeStartFrame);voice.recordIndex=record;
    p.loopStarts[record]=frame;p.loopEnds[record]=-1;
  }
  sample(voice,frame){
    if(!voice.syntheticInstrument)return super.sample(voice,frame);
    // Match the sine reference's midpoint phase and gate-only envelope. Pause
    // freezes this phase; loops rearticulate through the same attack method.
    const length=voice.end-voice.start,age=frame-voice.start+.5,attack=Math.min(.004*this.sampleRate,length/3),release=Math.min(.02*this.sampleRate,length/3);
    const level=age<attack?voice.peak*age/attack:age<length-release?voice.peak:voice.peak*(length-age)/release;
    const harmonics=voice.syntheticInstrument===1?TRIANGLE:REED,multiple=2*Math.cos(voice.phase);let previous=0,current=Math.sin(voice.phase),value=current;
    // The sine recurrence bounds trig work to two calls per voice/sample.
    for(let h=2;h<=voice.harmonicLimit;h++){const next=multiple*current-previous;previous=current;current=next;value+=harmonics[h]*current;}
    voice.phase+=voice.step;if(voice.phase>=TAU)voice.phase-=TAU;
    return value*voice.harmonicScale*level;
  }
  finishVoice(activeIndex,frame,reason){const voice=this.voiceSlots[this.activeSlots[activeIndex]];if(this.plan?.rangeMode)this.plan.loopEnds[voice.recordIndex]=frame;super.finishVoice(activeIndex,frame,reason);}
  processRange(channels,firstFrame){
    for(const channel of channels)channel.fill(0);const length=channels[0]?.length??0;
    try{
      if(!int(firstFrame,0,LIMITS.maxFrame)||!length||channels.some(c=>c.length!==length))reject('audio_processor_error','The range render block is invalid.');
      if(this.expectedFrame!==null&&firstFrame!==this.expectedFrame)this.discontinuity('block-frame',this.expectedFrame,firstFrame,length);
      this.expectedFrame=firstFrame+length;const p=this.plan,passLength=p.rangeEndFrame-p.rangeStartFrame;
      const terminal=this.anchorFrame+rangeDuration(p);
      for(let offset=0;offset<length;offset++){
        const frame=firstFrame+offset;
        for(let i=this.activeCount-1;i>=0;i--)if(this.voiceSlots[this.activeSlots[i]].end<=frame)this.finishVoice(i,frame,'gate');
        if(frame<this.anchorFrame)continue;
        if(!this.rangeCycleCount)this.rangeCycleCount=1;
        if(frame>=terminal){
          if(this.activeCount||this.rangePassIndex>=0&&this.cursor!==this.eligibleCount)reject('audio_processor_error','The range terminal disagrees with the complete pass ledger.');
          this.state='ended';this.emitCompletion('ended',frame,{reason:p.loopEnabled?'loop_budget_end':'range_end'});break;
        }
        if(frame===this.rangeBoundary){
          if(this.activeCount||this.cursor!==this.eligibleCount)reject('audio_processor_error','A loop boundary disagrees with its complete gate plan.');
          this.rangePassIndex++;this.rangeCycleCount++;this.rangeCycleAnchor=frame;this.rangePassAnchor=frame+p.countInFrames;this.rangeBoundary=this.rangePassAnchor+passLength;this.rangePassOpened=false;this.order=p.rangeOrder;this.eligibleCount=p.rangeGateCount;this.cursor=0;
        }
        if(frame<this.rangePassAnchor)continue;
        if(!this.rangePassOpened){
          this.rangePassOpened=true;this.observedPassCount++;p.passFrames[this.rangePassIndex]=frame;
          this.emit({type:'pass_started',...this.snapshot(frame),passIndex:this.rangePassIndex,frame,cycleStartFrame:this.rangeCycleAnchor,passStartFrame:frame,nextBoundaryFrame:this.rangeBoundary});
        }
        const origin=this.rangePassIndex===0?p.initialPositionFrame:p.rangeStartFrame;
        while(this.cursor<this.eligibleCount){const index=this.order[this.cursor],onset=this.rangePassAnchor+Math.max(p.starts[index],origin)-origin;if(onset>frame)break;if(onset<frame)this.discontinuity('missed-attack',onset,frame,length,index);this.attack(index,frame);this.cursor++;}
        let sum=0;for(let i=0;i<this.activeCount;i++)sum+=this.sample(this.voiceSlots[this.activeSlots[i]],frame);for(const channel of channels)channel[offset]=sum;
      }
      this.previousBlockFrame=firstFrame;this.previousBlockLength=length;this.successfulBlocks=Math.min(LIMITS.maxFrame,this.successfulBlocks+1);
    }catch(error){for(const channel of channels)channel.fill(0);this.fail(error,firstFrame);}
    return true;
  }
}
