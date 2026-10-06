/* Acceptance-only passive live-tone observation. This never makes a note,
 * substitutes a clock, feeds the recorder, or changes a product callback.
 * The fixed analyser is connected in create's first promise continuation,
 * before the application's await can prepare its accompaniment receiver. */
async function observeLiveToneAudio(document,{Receiver,root=globalThis,readSource=()=>({}),keyCode,midi}={}) {
 Receiver ||= (await import('/live-tone-receiver.js')).LiveToneReceiver;
 const NativeNode=root.AudioWorkletNode,NativePort=root.MessagePort,NativeEvent=root.MessageEvent,audioProto=root.AudioNode?.prototype;
 if(![NativeNode,NativePort,NativeEvent].every(value=>typeof value==='function')||!audioProto)throw Error('Live-tone acceptance requires native AudioWorkletNode and MessagePort');
 const create=Receiver.create,play=Receiver.prototype.play,request=Receiver.prototype.request,connect=audioProto.connect,disconnect=audioProto.disconnect;
 const entries=[],edges=new Map(),ids=new WeakMap(),errors=[],cleanupErrors=[];let active=true,overflow=false,sequence=0,graphRevision=0,nextId=0,current=null,pending=null;
 const id=node=>{if(!ids.has(node))ids.set(node,++nextId);return ids.get(node);},copy=value=>structuredClone(value),now=()=>root.performance.now();
 const error=value=>{if(errors.length<16)errors.push(String(value?.message||value).slice(0,512));else overflow=true;};
 const safely=operation=>{try{return operation();}catch(value){error(value);}};
 const push=(rows,row,max=128)=>{if(rows.length<max)rows.push(row);else overflow=true;};
 const event=()=>({sequence:++sequence,wallMs:now(),graphRevision});
 function connected(...args){const result=Reflect.apply(connect,this,args);if(active)safely(()=>{if(edges.size>=2048&&!edges.has(this)){overflow=true;return;}if(!edges.has(this))edges.set(this,new Set());edges.get(this).add(args[0]);graphRevision++;});return result;}
 function disconnected(...args){const result=Reflect.apply(disconnect,this,args);if(active)safely(()=>{if(!args.length||typeof args[0]==='number')edges.delete(this);else edges.get(this)?.delete(args[0]);graphRevision++;});return result;}
 audioProto.connect=connected;audioProto.disconnect=disconnected;
 function path(node,destination,seen=new Set()) {if(!node||seen.has(node)||seen.size>=32)return null;seen.add(node);const row={id:id(node),type:node.constructor.name,gain:node.gain?.value??null};if(node===destination)return[row];for(const next of edges.get(node)||[]){const tail=path(next,destination,seen);if(tail)return[row,...tail];}return null;}
 function requested(...args){if(active&&args[0]==='initialize')safely(()=>{const node=this.node;
  if(entries.length>=4){overflow=true;return;}const entry={id:entries.length+1,node,owner:null,ready:null,analyser:null,created:event()};entries.push(entry);
  entry.listener=message=>{if(!active)return;safely(()=>{const value=message.data;if(!value||!['ready','started','ended','error'].includes(value.type))return;
   const row={...event(),receiverId:entry.id,nodeId:id(node),nativeMessage:message instanceof NativeEvent,nativePort:node.port instanceof NativePort,isTrusted:message.isTrusted===true,portMatches:message.target===node.port&&message.currentTarget===node.port,record:copy(value)};
   if(value.type==='ready'){if(entry.ready)error('Duplicate live-tone ready ACK');entry.ready=row;}
   else if(value.type==='error')error(value.message||'Live-tone processor error');
   else if(current)push(current.receipts,row);
  });};node.port.addEventListener('message',entry.listener,true);
  entry.processorError=()=>error('Live-tone native processorerror');node.addEventListener('processorerror',entry.processorError);
 });return Reflect.apply(request,this,args);}
 Receiver.prototype.request=requested;
 function created(...args){const result=Reflect.apply(create,this,args);if(result&&typeof result.then==='function')Reflect.apply(Promise.prototype.then,result,[owner=>{if(active)safely(()=>{
  const entry=entries.find(value=>value.node===owner.node);if(!entry)throw Error('Live-tone receiver does not own an observed native node');entry.owner=owner;
  // Retain a short output history across ordinary main-thread long frames.
  // Samples still must overlap this exact native token; no clock is inferred.
  const analyser=owner.context.createAnalyser();analyser.fftSize=16384;owner.outputGate.connect(analyser);entry.analyser=analyser;entry.tapReady={...event(),source:source(),receiver:describe(entry)};
 });},reason=>{if(active)error(reason);}]);else if(active)error('Live-tone create did not return its ready promise');return result;}
 Receiver.create=created;
 const source=()=>{const state=readSource();return{activeReceivers:state.activeReceivers,pendingReceivers:state.pendingReceivers,started:state.started,ownedNodes:copy(state.ownedNodes||[]),errors:copy(state.errors||[]),overflow:state.overflow};};
 const describe=entry=>{const owner=entry.owner,node=entry.node;return{receiverId:entry.id,nodeId:id(node),gateId:id(owner.outputGate),destinationId:id(owner.context.destination),generation:owner.generation,state:owner.state,disposed:owner.disposed,contextState:owner.context.state,sampleRate:owner.context.sampleRate,audioTime:owner.context.currentTime,nativeNode:node instanceof NativeNode,nativePort:node.port instanceof NativePort,contextMatches:node.context===owner.context&&owner.outputGate.context===owner.context,numberOfInputs:node.numberOfInputs,numberOfOutputs:node.numberOfOutputs,graphToDestination:path(node,owner.context.destination),tapConnected:edges.get(owner.outputGate)?.has(entry.analyser)===true};};
 const boundary=label=>({...event(),label,source:source(),nodes:entries.length,receiver:describe(current.entry)});
 function played(...args){const result=Reflect.apply(play,this,args);if(active&&current)safely(()=>{const entry=entries.find(value=>value.owner===this);if(!entry)throw Error('Live-tone play has no native receiver');push(current.calls,{...event(),receiverId:entry.id,generation:this.generation,token:result,id:args[0],midi:args[1],duration:args[2]??null,delay:args[3]??0,timbre:args[4]??'piano',velocity:args[5]??90,inputSequence:current.inputs.filter(row=>row.type==='keydown').at(-1)?.sequence??null,source:source()});});return result;}
 Receiver.prototype.play=played;
 function input(value){if(!active||!current||value.code!==keyCode)return;safely(()=>{push(current.inputs,{...event(),type:value.type,code:value.code,isTrusted:value.isTrusted===true,repeat:Boolean(value.repeat),surface:value.target?.closest?.('[data-keyboard-performance]')?.id||null,eventTime:value.timeStamp,source:source()},8);});}
 document.addEventListener('keydown',input,true);document.addEventListener('keyup',input,true);
 // Navigation observation uses the same fixed tap. Checkpoints never create a
 // node, command a receiver, or make a terminal receipt stand in for output PCM.
 function action(value){if(!active||!current)return;const control=value.target?.closest?.('button')?.id;if(!control)return;safely(()=>push(current.actions,{...event(),type:value.type,control,isTrusted:value.isTrusted===true,eventTime:value.timeStamp},32));}
 document.addEventListener('pointerdown',action,true);document.addEventListener('click',action,true);
 const pcmWindow=()=>({method:'passive-fixed-live-gate-analyser',fftSize:16384,blocks:[]});
 const zero=block=>block.contextState==='running'&&block.peak===0&&block.energy===0&&block.nonzeroSamples===0;
 function capture(force=false){
  const entry=current.entry,owner=entry.owner,row=current.checkpoints.at(-1),pcm=row?.pcm||current.pcm;
  if(!current.calls.length||row&&row.sampling!=='observing')return;
  if(pcm.blocks.length>=64)return;
  // At most 50 samples/second, slower at low sample rates, so a finite
  // block cap cannot exhaust before FFT history drains on any supported rate.
  if(!force&&row&&pcm.blocks.length&&owner.context.currentTime-pcm.blocks.at(-1).audioTime<Math.max(.02,(pcm.fftSize+256)/owner.context.sampleRate/40))return;
  const values=new Float32Array(entry.analyser.fftSize);entry.analyser.getFloatTimeDomainData(values);let peak=0,energy=0,nonzeroSamples=0;
  for(const value of values){if(!Number.isFinite(value))throw Error('Nonfinite live output PCM');peak=Math.max(peak,Math.abs(value));energy+=value*value;if(value!==0)nonzeroSamples++;}
  const block={...event(),audioTime:owner.context.currentTime,contextState:owner.context.state,peak,energy,nonzeroSamples,samples:values.length,tapConnected:edges.get(owner.outputGate)?.has(entry.analyser)===true,graphToDestination:path(entry.node,owner.context.destination)};push(pcm.blocks,block,64);
  if(current.silenceEstablished&&!zero(block)&&!current.silenceFailure){current.silenceFailure=true;error('Live output became nonzero or suspended after established silence');}
  // The last slot may close an explicit window. Consuming it in an open RAF
  // window is exhaustion, never an implicit indefinitely valid silence result.
  if(row&&!force&&pcm.blocks.length===64){row.sampling='exhausted';error(`Live-tone PCM window ${row.label} exhausted before it was sealed`);}
 }
 function sample(){if(!active||!current)return;safely(()=>capture());const row=current.checkpoints.at(-1);if(row?row.sampling==='observing':current.pcm.blocks.length<64)pending=root.requestAnimationFrame(sample);}
 function quietBlocks(row){if(current.silenceEstablished)return row.pcm.blocks.filter(block=>block.sequence>=current.silenceEstablished.sequence);const ends=current.receipts.filter(value=>value.record.type==='ended').map(value=>value.record.actualEndFrame);if(!ends.length)return[];const rate=row.receiver.sampleRate,after=Math.max(row.receiver.audioTime*rate,...ends)+row.pcm.fftSize+256;return row.pcm.blocks.filter(block=>block.audioTime*rate>=after);}
 function quiet(label){const row=current?.checkpoints.at(-1),last=row?.pcm.blocks.at(-1),context=current?.entry.owner.context;if(!row||row.label!==label||row.sampling!=='observing'||errors.length||!last||context.state!=='running')return false;
  // Both clocks must still be current. A stopped RAF or frozen audio clock
  // cannot turn an old finite observation into a claim about the present.
  if(now()-last.wallMs>100||context.currentTime-last.audioTime>.1)return false;
  const blocks=quietBlocks(row),silent=blocks.length>=3&&blocks.at(-1).audioTime-blocks[0].audioTime>=.1&&blocks.every(zero);if(silent&&!current.silenceEstablished)current.silenceEstablished={sequence:blocks[0].sequence,audioTime:blocks[0].audioTime};return silent;
 }
 function sealCheckpoint(label,{requireSilence=true}={}){const row=current?.checkpoints.at(-1);if(!row||row.label!==label||row.sampling!=='observing'||errors.length)throw Error('A fresh observing live-tone window is required to seal');
  capture(true);if(errors.length||requireSilence&&!quiet(label))throw Error('Fresh live-tone PCM does not prove silence at window completion');
  if(requireSilence&&!current.silenceEstablished){const first=quietBlocks(row)[0];current.silenceEstablished={sequence:first.sequence,audioTime:first.audioTime};}
  row.closed=boundary(`${label}-sealed`);row.sampling='sealed';root.cancelAnimationFrame(pending);return copy(row);
 }
 function checkpoint(label){if(!current)throw Error('Missing live-tone observation');if(errors.length)throw Error('Failed live-tone observation cannot open another window');if(typeof label!=='string'||!label||current.checkpoints.length>=8||current.checkpoints.some(row=>row.label===label))throw Error('Invalid or duplicate live-tone checkpoint');
  const previous=current.checkpoints.at(-1);if(previous?.sampling==='observing')sealCheckpoint(previous.label,{requireSilence:false});else if(previous&&previous.sampling!=='sealed')throw Error('Previous live-tone window was not sealed');
  root.cancelAnimationFrame(pending);const row={...boundary(label),callCount:current.calls.length,sampling:'observing',pcm:pcmWindow()};current.checkpoints.push(row);sample();return copy(row);
 }
 const settled=()=>Boolean(current&&current.inputs.filter(row=>row.type==='keydown').length===1&&current.inputs.filter(row=>row.type==='keyup').length===1&&current.calls.length===1&&current.receipts.some(row=>row.record.type==='ended'&&row.record.token===current.calls[0].token&&row.record.generation===current.calls[0].generation&&row.record.id===current.calls[0].id)&&current.pcm.blocks.some(row=>row.nonzeroSamples>0&&row.peak>1e-6&&row.energy>1e-10));
 return{failureEvidence(){return{version:1,errors:copy(errors),overflow,receivers:entries.map(entry=>({created:copy(entry.created),ready:copy(entry.ready),tapReady:copy(entry.tapReady),receiver:entry.owner?describe(entry):null})),current:current?{ready:copy(current.ready),inputs:copy(current.inputs),actions:copy(current.actions),calls:copy(current.calls),receipts:copy(current.receipts),pcm:copy(current.pcm),checkpoints:copy(current.checkpoints),silenceEstablished:copy(current.silenceEstablished??null),after:boundary('failure')}:null};},assertHealthy(){if(errors.length)throw Error(`Live-tone observation failed: ${errors.join("; ")}`);},begin(){if(current)throw Error('Live-tone key observation already active');const ready=entries.filter(entry=>entry.owner?.state==='ready'&&!entry.owner.disposed&&entry.analyser&&entry.ready);if(ready.length!==1)throw Error('Exactly one ready persistent live-tone receiver required');current={entry:ready[0],inputs:[],actions:[],calls:[],receipts:[],checkpoints:[],pcm:pcmWindow()};current.ready=boundary('ready');sample();return copy(current.ready);},settled,checkpoint,quiet,sealCheckpoint,sounding(){return Boolean(current?.calls.length===1&&current.receipts.some(row=>row.record.type==='started'&&row.record.token===current.calls[0].token)&&current.pcm.blocks.some(row=>row.nonzeroSamples>0&&row.peak>1e-6&&row.energy>1e-10));},finish(){if(!current)throw Error('Missing live-tone observation');if(current.checkpoints.length)sealCheckpoint(current.checkpoints.at(-1).label);root.cancelAnimationFrame(pending);const result={version:1,expected:{keyCode,midi},initialization:{created:copy(current.entry.created),ready:copy(current.entry.ready),tapReady:copy(current.entry.tapReady)},ready:copy(current.ready),after:boundary('after'),inputs:copy(current.inputs),actions:copy(current.actions),calls:copy(current.calls),receipts:copy(current.receipts),pcm:copy(current.pcm),checkpoints:copy(current.checkpoints),silenceEstablished:copy(current.silenceEstablished??null),pcmCoverage:'finite-checkpoint-windows',errors:copy(errors),overflow};current=null;return result;},restore(){active=false;current=null;
  const attempt=(label,operation)=>{try{if(operation()===false)throw Error('Original method not restored');}catch(value){cleanupErrors.push({label,message:String(value.message||value).slice(0,512)});}};
  attempt('animation',()=>root.cancelAnimationFrame(pending));attempt('input-down',()=>document.removeEventListener('keydown',input,true));attempt('input-up',()=>document.removeEventListener('keyup',input,true));
  attempt('pointerdown',()=>document.removeEventListener('pointerdown',action,true));attempt('click',()=>document.removeEventListener('click',action,true));
  for(const entry of entries){attempt('port',()=>entry.node.port.removeEventListener('message',entry.listener,true));attempt('processorerror',()=>entry.node.removeEventListener('processorerror',entry.processorError));if(entry.analyser){attempt('tap-input',()=>entry.owner.outputGate.disconnect(entry.analyser));attempt('tap-output',()=>entry.analyser.disconnect());}}
  for(const [object,key,wrapped,original]of [[Receiver.prototype,'request',requested,request],[Receiver,'create',created,create],[Receiver.prototype,'play',played,play],[audioProto,'connect',connected,connect],[audioProto,'disconnect',disconnected,disconnect]])attempt(key,()=>{if(object[key]===wrapped)object[key]=original;return object[key]===original;});
  return{restored:cleanupErrors.length===0,overflow,errors:copy(errors),cleanupErrors};
 }};
}
