import {BasicKeyAudioReceiver} from './basic-key-audio-receiver.js';
import {BasicKeyAudioError} from './basic-key-audio-plan.js';
import {CANONICAL_AUDIO_PROTOCOL,CANONICAL_AUDIO_LIMITS as LIMITS,validateCanonicalAudioPlan,createCanonicalAudioTransfer,canonicalIdentity} from './canonical-audio-plan.js';
const error=(code,message)=>new BasicKeyAudioError(code,message);

/** Same bounded load/ack, output fencing and generation lifecycle as Basic/VSQ;
 * source identities, immutable evidence and held-envelope pause are canonical. */
export class CanonicalAudioReceiver extends BasicKeyAudioReceiver {
  static processorProtocol=CANONICAL_AUDIO_PROTOCOL;
  static create(context,output,options={}){return super.create(context,output,{...options,moduleUrl:options.moduleUrl||new URL('./canonical-audio-processor.js',import.meta.url)});}
  constructor(context,output,node,options={}){super(context,output,node,options);this.onPaused=options.onPaused||(()=>{});this.onResumed=options.onResumed||(()=>{});this.planArchive=new Map();this.prepareTimeoutMs=30000;this.onPass=options.onPass||(()=>{});this.clockPauses=[];this.initialAnchorFrame=null;}
  async prepare(input,{positionMs=null}={}){
    this.requireOpen();if(this.context.state!=='running')throw error('clean_audio_unavailable','Unlock the audio device before preparing canonical playback.');
    if(this.prepareInFlight)throw error('audio_prepare_pending','The previous preparation has not been acknowledged.');
    const plan=validateCanonicalAudioPlan(input);positionMs??=plan.rangeMode?(plan.initialPositionFrame-plan.initialCountInFrames)*1000/plan.sampleRate:0;const positionFrame=Math.round(positionMs*plan.sampleRate/1000);
    if(plan.sampleRate!==this.context.sampleRate||!Number.isFinite(positionMs)||!Number.isSafeInteger(positionFrame)||positionFrame< -600*plan.sampleRate||positionFrame>plan.durationFrames)throw error('invalid_canonical_audio_plan','The canonical sample rate or source position does not match this device.');
    if(plan.rangeMode&&positionFrame!==plan.initialPositionFrame-plan.initialCountInFrames)throw error('invalid_canonical_audio_plan','A range generation starts at its fingerprinted A/count-in position.');
    const packed=createCanonicalAudioTransfer(plan);
    this.detach();this.rejectPending(error('audio_canceled','A new canonical preparation replaced the previous generation.'));
    this.nextGeneration();this.planGeneration=this.generation;this.plan=plan;this.planArchive.set(this.planGeneration,plan);while(this.planArchive.size>2)this.planArchive.delete(this.planArchive.keys().next().value);
    this.positionFrame=positionFrame;this.clockAnchor=null;this.pausedSourceFrame=null;this.clockPauses=[];this.initialAnchorFrame=null;this.state='preparing';this.prepareInFlight=this.generation;
    this.node.connect(this.outputGate);this.connected=true;
    return this.request('prepare',{wire:packed.wire,positionFrame},packed.transfer);
  }
  pause(){this.requireOpen();if(this.state!=='running')return Promise.reject(error('invalid_audio_command','Only running canonical playback can pause.'));this.state='pausing';return this.request('pause');}
  resume({anchorTime=this.context.currentTime+.05}={}){
    this.requireOpen();if(this.state!=='paused'||this.context.state!=='running')return Promise.reject(error('clean_audio_unavailable','Only paused canonical playback on a running device can resume.'));
    const anchorFrame=Math.ceil(anchorTime*this.context.sampleRate),now=Math.floor(this.context.currentTime*this.context.sampleRate);
    if(!Number.isSafeInteger(anchorFrame)||anchorFrame<=now||anchorFrame-now>Math.ceil(this.context.sampleRate*.1))return Promise.reject(error('clean_late_start','Canonical resume requires a future anchor within 100 ms.'));
    this.outputGate.gain.setValueAtTime(1,anchorFrame/this.context.sampleRate);this.state='resuming';return this.request('resume',{anchorFrame});
  }
  sourcePositionMs(){return this.sourceClockAtTime()?.positionMs??null;}
  sourceClockAtTime(audioTime=this.context.currentTime,{generation=this.planGeneration,planFingerprint=this.plan?.planFingerprint}={}){
    const p=this.plan;if(!p||generation!==this.planGeneration||planFingerprint!==p.planFingerprint||!Number.isFinite(audioTime)||audioTime<0||['idle','canceled','error','disposed'].includes(this.state))return null;
    const frame=Math.round(audioTime*p.sampleRate),initial=this.initialAnchorFrame;
    if(initial==null)return {positionMs:this.positionFrame*1000/p.sampleRate,sourcePositionMs:this.positionFrame*1000/p.sampleRate,passIndex:-1,absoluteFrame:frame,sampleRate:p.sampleRate,initialAnchorFrame:null,phase:'preparing',inCountIn:this.positionFrame<0,paused:false,ended:false,generation:this.planGeneration,planFingerprint:p.planFingerprint};
    let held=0,paused=false;for(const span of this.clockPauses){if(frame<span.start)break;const end=span.end??Infinity;held+=Math.max(0,Math.min(frame,end)-span.start);if(frame>=span.start&&frame<end)paused=true;}
    const elapsed=Math.max(0,frame-initial-held),rangeStart=p.rangeMode?p.rangeStartFrame:0,rangeEnd=p.rangeMode?p.rangeEndFrame:p.durationFrames,length=rangeEnd-rangeStart;
    let passIndex=0,positionFrame,inCountIn,ended,cycleStartElapsed=0,passStartElapsed=0,nextBoundaryElapsed;
    if(p.rangeMode){
      const firstEnd=p.initialCountInFrames+rangeEnd-p.initialPositionFrame,cycle=p.countInFrames+length,total=firstEnd+(p.maxPasses-1)*cycle;
      ended=elapsed>=total;
      if(elapsed<firstEnd||p.maxPasses===1){positionFrame=ended?rangeEnd:p.initialPositionFrame+elapsed-p.initialCountInFrames;inCountIn=!ended&&elapsed<p.initialCountInFrames;passStartElapsed=p.initialCountInFrames;nextBoundaryElapsed=firstEnd;}
      else {passIndex=Math.min(p.maxPasses-1,1+Math.floor((elapsed-firstEnd)/cycle));cycleStartElapsed=firstEnd+(passIndex-1)*cycle;const offset=elapsed-cycleStartElapsed;positionFrame=ended?rangeEnd:rangeStart+offset-p.countInFrames;inCountIn=!ended&&offset<p.countInFrames;passStartElapsed=cycleStartElapsed+p.countInFrames;nextBoundaryElapsed=cycleStartElapsed+cycle;}
    }else{
      const countIn=Math.max(0,-this.positionFrame),offset=Math.max(0,this.positionFrame),musical=elapsed-countIn+offset;inCountIn=musical<0;ended=musical>=p.durationFrames;positionFrame=ended?p.durationFrames:musical;passIndex=inCountIn?-1:0;passStartElapsed=countIn-offset;nextBoundaryElapsed=countIn+p.durationFrames-offset;
    }
    const absoluteBoundary=target=>{let at=initial+target;for(const span of this.clockPauses){if(span.start>at)break;if(span.end==null)return null;at+=span.end-span.start;}return at;};
    const cycleStartFrame=absoluteBoundary(cycleStartElapsed),passStartFrame=absoluteBoundary(passStartElapsed),nextBoundaryFrame=absoluteBoundary(nextBoundaryElapsed);
    return {positionMs:positionFrame*1000/p.sampleRate,sourcePositionMs:positionFrame*1000/p.sampleRate,passIndex,absoluteFrame:frame,sampleRate:p.sampleRate,initialAnchorFrame:initial,cycleStartFrame,passStartFrame,nextBoundaryFrame,rangeStartFrame:rangeStart,rangeEndFrame:rangeEnd,inCountIn,paused,ended,phase:frame<initial?'scheduled':paused?'paused':inCountIn?'count-in':ended?'ended':'playing',generation:this.planGeneration,planFingerprint:p.planFingerprint};
  }
  cancel(reason='stop',options={}){this.lastStopClock=this.sourceClockAtTime()??this.lastStopClock??null;return super.cancel(reason,options);}
  receive(message){
    if(this.disposed||!message||!Number.isSafeInteger(message.generation))return;
    if(message.generation===this.generation&&['ready','started','paused','resumed','snapshot','audit','ended','pass_started'].includes(message.type)&&message.planGeneration!==this.planGeneration){this.fail(error('canonical_audio_fingerprint','The processor acknowledged an unexpected plan generation.'));return;}
    const bound=this.planArchive.get(message.planGeneration);
    if(bound&&['ready','started','paused','resumed','snapshot','audit','ended','canceled','pass_started'].includes(message.type)){
      if(message.sampleRate!==bound.sampleRate||['sourceFingerprint','compiledFingerprint','selectionFingerprint','planFingerprint'].some(k=>message[k]!==bound[k])){this.fail(error('canonical_audio_fingerprint','The processor acknowledgement belongs to another source, selection or frame plan.'));return;}
    }
    if(message.generation===this.generation){
      if(message.type==='pass_started'){
        if(!Number.isSafeInteger(message.passIndex)||message.passIndex<0||message.passIndex>=this.plan.maxPasses||!Number.isSafeInteger(message.frame)){this.fail(error('invalid_audio_command','The loop pass receipt is invalid.'));return;}
        this.lastPassReceipt=message;this.onPass(message);return;
      }
      if(message.type==='paused'){
        if(this.state!=='pausing'||!Number.isSafeInteger(message.sourcePositionFrame)){this.fail(error('invalid_audio_command','Unexpected canonical pause acknowledgement.'));return;}
        const span=this.clockPauses.at(-1);
        if(message.resumedLeadCanceled){if(!span||span.start!==message.pauseFrame||span.end==null||span.end<message.frame){this.fail(error('invalid_audio_command','The canceled resume lead does not match its existing pause interval.'));return;}span.end=null;}
        else {if(span&&(span.end==null||span.end>message.frame)){this.fail(error('invalid_audio_command','Canonical pause intervals must not overlap.'));return;}this.clockPauses.push({start:message.pauseFrame??message.frame,end:null});}
        this.state='paused';this.pausedSourceFrame=message.sourcePositionFrame;this.outputGate.gain.cancelScheduledValues(this.context.currentTime);this.outputGate.gain.setValueAtTime(0,this.context.currentTime);
        this.takePending(message.requestId)?.resolve(message);this.onPaused(message);return;
      }
      if(message.type==='resumed'){
        if(this.state!=='resuming'||this.context.state!=='running'||!Number.isSafeInteger(message.resumeFrame)||this.context.currentTime*this.context.sampleRate>=message.resumeFrame){this.fail(error('clean_late_start','The resume acknowledgement missed its audio anchor; playback was canceled.'));return;}
        const span=this.clockPauses.at(-1);if(!span||span.start!==message.pauseFrame||span.end!==null){this.fail(error('invalid_audio_command','The resume acknowledgement does not match its paused source interval.'));return;}span.end=message.resumeFrame;
        this.state='running';this.clockAnchor=message;message={...message,resumeTime:message.resumeFrame/message.sampleRate,anchorTime:message.anchorFrame/message.sampleRate,positionMs:message.positionFrame*1000/message.sampleRate};
        this.takePending(message.requestId)?.resolve(message);this.onResumed(message);return;
      }
      if(message.type==='started'){this.clockAnchor=message;this.initialAnchorFrame=message.anchorFrame;}
    }
    super.receive(message);
  }
  completionAudit(offset,count){
    const completion=this.lastCompletion,p=this.planArchive.get(completion?.planGeneration);
    const ranged=completion?.ledgerLayout==='range-pass-major',limit=ranged?completion.recordCount:p?.count;
    if(!p||!Number.isSafeInteger(limit)||limit<0||limit>(ranged?p.recordCapacity:p.count)||!Number.isSafeInteger(offset)||offset<0||offset>limit||!Number.isSafeInteger(count)||count<1||count>LIMITS.maxAuditRows||!completion?.ledger)throw error('invalid_audio_command','The canonical completion audit page is invalid or no longer retained.');
    const end=Math.min(limit,offset+count),rows=[];
    for(let i=offset;i<end;i++){const first=i<p.firstGateCount,noteIndex=ranged?(first?p.firstRangeOrder[i]:p.rangeOrder[(i-p.firstGateCount)%p.rangeGateCount]):i,n=p.notes[noteIndex];rows.push({index:i,noteIndex,passIndex:ranged?(first?0:1+Math.floor((i-p.firstGateCount)/p.rangeGateCount)):0,...canonicalIdentity(p,noteIndex),startFrame:ranged?Math.max(first?p.initialPositionFrame:p.rangeStartFrame,n[1]):n[1],endFrame:ranged?Math.min(p.rangeEndFrame,n[2]):n[2],actualStartFrame:completion.ledger.actualStarts[i],actualEndFrame:completion.ledger.actualEnds[i]});}
    return {...completion,type:'audit',ledger:undefined,offset,nextOffset:end,rows};
  }
  async audit(options={}){
    const result=await super.audit(options);if(!result.rows)return result;
    const p=this.planArchive.get(result.planGeneration);if(!p)throw error('invalid_audio_command','Canonical audit source mapping is no longer retained.');
    return {...result,rows:result.rows.map(r=>({...r,...canonicalIdentity(p,r.noteIndex??r.index)}))};
  }
}
