import {BasicKeyAudioReceiver} from './basic-key-audio-receiver.js';
import {BasicKeyAudioError} from './basic-key-audio-plan.js';
import {CANONICAL_AUDIO_PROTOCOL,CANONICAL_AUDIO_LIMITS as LIMITS,validateCanonicalAudioPlan,createCanonicalAudioTransfer,canonicalIdentity} from './canonical-audio-plan.js';
const error=(code,message)=>new BasicKeyAudioError(code,message);

/** Same bounded load/ack, output fencing and generation lifecycle as Basic/VSQ;
 * source identities, immutable evidence and held-envelope pause are canonical. */
export class CanonicalAudioReceiver extends BasicKeyAudioReceiver {
  static processorProtocol=CANONICAL_AUDIO_PROTOCOL;
  static create(context,output,options={}){return super.create(context,output,{...options,moduleUrl:options.moduleUrl||new URL('./canonical-audio-processor.js',import.meta.url)});}
  constructor(context,output,node,options={}){super(context,output,node,options);this.onPaused=options.onPaused||(()=>{});this.onResumed=options.onResumed||(()=>{});this.planArchive=new Map();this.prepareTimeoutMs=30000;}
  async prepare(input,{positionMs=0}={}){
    this.requireOpen();if(this.context.state!=='running')throw error('clean_audio_unavailable','Unlock the audio device before preparing canonical playback.');
    if(this.prepareInFlight)throw error('audio_prepare_pending','The previous preparation has not been acknowledged.');
    const plan=validateCanonicalAudioPlan(input),positionFrame=Math.round(positionMs*plan.sampleRate/1000);
    if(plan.sampleRate!==this.context.sampleRate||!Number.isFinite(positionMs)||!Number.isSafeInteger(positionFrame)||positionFrame< -600*plan.sampleRate||positionFrame>plan.durationFrames)throw error('invalid_canonical_audio_plan','The canonical sample rate or source position does not match this device.');
    const packed=createCanonicalAudioTransfer(plan);
    this.detach();this.rejectPending(error('audio_canceled','A new canonical preparation replaced the previous generation.'));
    this.nextGeneration();this.planGeneration=this.generation;this.plan=plan;this.planArchive.set(this.planGeneration,plan);while(this.planArchive.size>2)this.planArchive.delete(this.planArchive.keys().next().value);
    this.positionFrame=positionFrame;this.clockAnchor=null;this.pausedSourceFrame=null;this.state='preparing';this.prepareInFlight=this.generation;
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
  sourcePositionMs(){
    if(!this.plan||['idle','canceled','error','disposed'].includes(this.state))return null;
    if(this.state==='ended')return this.plan.durationFrames*1000/this.plan.sampleRate;
    if(['paused','resuming'].includes(this.state)||this.clockAnchor?.resumeFrame>this.context.currentTime*this.plan.sampleRate)return this.pausedSourceFrame*1000/this.plan.sampleRate;
    if(!this.clockAnchor)return this.positionFrame*1000/this.plan.sampleRate;
    return Math.min(this.plan.durationFrames,this.positionFrame+Math.max(0,this.context.currentTime*this.plan.sampleRate-this.clockAnchor.anchorFrame))*1000/this.plan.sampleRate;
  }
  receive(message){
    if(this.disposed||!message||!Number.isSafeInteger(message.generation))return;
    if(message.generation===this.generation&&['ready','started','paused','resumed','snapshot','audit','ended'].includes(message.type)&&message.planGeneration!==this.planGeneration){this.fail(error('canonical_audio_fingerprint','The processor acknowledged an unexpected plan generation.'));return;}
    const bound=this.planArchive.get(message.planGeneration);
    if(bound&&['ready','started','paused','resumed','snapshot','audit','ended','canceled'].includes(message.type)){
      if(message.sampleRate!==bound.sampleRate||['sourceFingerprint','compiledFingerprint','selectionFingerprint','planFingerprint'].some(k=>message[k]!==bound[k])){this.fail(error('canonical_audio_fingerprint','The processor acknowledgement belongs to another source, selection or frame plan.'));return;}
    }
    if(message.generation===this.generation){
      if(message.type==='paused'){
        if(this.state!=='pausing'||!Number.isSafeInteger(message.sourcePositionFrame)){this.fail(error('invalid_audio_command','Unexpected canonical pause acknowledgement.'));return;}
        this.state='paused';this.pausedSourceFrame=message.sourcePositionFrame;this.outputGate.gain.setValueAtTime(0,this.context.currentTime);
        this.takePending(message.requestId)?.resolve(message);this.onPaused(message);return;
      }
      if(message.type==='resumed'){
        if(this.state!=='resuming'||this.context.state!=='running'||!Number.isSafeInteger(message.resumeFrame)||this.context.currentTime*this.context.sampleRate>=message.resumeFrame){this.fail(error('clean_late_start','The resume acknowledgement missed its audio anchor; playback was canceled.'));return;}
        this.state='running';this.clockAnchor=message;message={...message,resumeTime:message.resumeFrame/message.sampleRate,anchorTime:message.anchorFrame/message.sampleRate,positionMs:message.positionFrame*1000/message.sampleRate};
        this.takePending(message.requestId)?.resolve(message);this.onResumed(message);return;
      }
      if(message.type==='started')this.clockAnchor=message;
    }
    super.receive(message);
  }
  completionAudit(offset,count){
    const completion=this.lastCompletion,p=this.planArchive.get(completion?.planGeneration);
    if(!p||!Number.isSafeInteger(offset)||offset<0||offset>p.count||!Number.isSafeInteger(count)||count<1||count>LIMITS.maxAuditRows||!completion?.ledger)throw error('invalid_audio_command','The canonical completion audit page is invalid or no longer retained.');
    const end=Math.min(p.count,offset+count),rows=[];
    for(let i=offset;i<end;i++){const n=p.notes[i];rows.push({index:i,...canonicalIdentity(p,i),startFrame:n[1],endFrame:n[2],actualStartFrame:completion.ledger.actualStarts[i],actualEndFrame:completion.ledger.actualEnds[i]});}
    return {...completion,type:'audit',ledger:undefined,offset,nextOffset:end,rows};
  }
  async audit(options={}){
    const result=await super.audit(options);if(!result.rows)return result;
    const p=this.planArchive.get(result.planGeneration);if(!p)throw error('invalid_audio_command','Canonical audit source mapping is no longer retained.');
    return {...result,rows:result.rows.map(r=>({...r,...canonicalIdentity(p,r.index)}))};
  }
}
