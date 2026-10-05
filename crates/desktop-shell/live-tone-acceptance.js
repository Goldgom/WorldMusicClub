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
  const analyser=owner.context.createAnalyser();analyser.fftSize=16384;owner.outputGate.connect(analyser);entry.analyser=analyser;entry.tapReady={...event(),source:source()};
 });},reason=>{if(active)error(reason);}]);else if(active)error('Live-tone create did not return its ready promise');return result;}
 Receiver.create=created;
 const source=()=>{const state=readSource();return{activeReceivers:state.activeReceivers,pendingReceivers:state.pendingReceivers,started:state.started,errors:copy(state.errors||[]),overflow:state.overflow};};
 const describe=entry=>{const owner=entry.owner,node=entry.node;return{receiverId:entry.id,nodeId:id(node),gateId:id(owner.outputGate),destinationId:id(owner.context.destination),generation:owner.generation,state:owner.state,disposed:owner.disposed,contextState:owner.context.state,sampleRate:owner.context.sampleRate,audioTime:owner.context.currentTime,nativeNode:node instanceof NativeNode,nativePort:node.port instanceof NativePort,contextMatches:node.context===owner.context&&owner.outputGate.context===owner.context,numberOfInputs:node.numberOfInputs,numberOfOutputs:node.numberOfOutputs,graphToDestination:path(node,owner.context.destination),tapConnected:edges.get(owner.outputGate)?.has(entry.analyser)===true};};
 const boundary=label=>({...event(),label,source:source(),nodes:entries.length,receiver:describe(current.entry)});
 function played(...args){const result=Reflect.apply(play,this,args);if(active&&current)safely(()=>{const entry=entries.find(value=>value.owner===this);if(!entry)throw Error('Live-tone play has no native receiver');push(current.calls,{...event(),receiverId:entry.id,generation:this.generation,token:result,id:args[0],midi:args[1],duration:args[2]??null,delay:args[3]??0,timbre:args[4]??'piano',velocity:args[5]??90,inputSequence:current.inputs.filter(row=>row.type==='keydown').at(-1)?.sequence??null,source:source()});});return result;}
 Receiver.prototype.play=played;
 function input(value){if(!active||!current||value.code!==keyCode)return;safely(()=>{push(current.inputs,{...event(),type:value.type,code:value.code,isTrusted:value.isTrusted===true,repeat:Boolean(value.repeat),surface:value.target?.closest?.('[data-keyboard-performance]')?.id||null,eventTime:value.timeStamp,source:source()},8);});}
 document.addEventListener('keydown',input,true);document.addEventListener('keyup',input,true);
 function sample(){if(!active||!current)return;safely(()=>{const entry=current.entry,owner=entry.owner;if(!current.calls.length||current.pcm.blocks.length>=64)return;const values=new Float32Array(entry.analyser.fftSize);entry.analyser.getFloatTimeDomainData(values);let peak=0,energy=0,nonzeroSamples=0;for(const value of values){if(!Number.isFinite(value))throw Error('Nonfinite live output PCM');peak=Math.max(peak,Math.abs(value));energy+=value*value;if(value!==0)nonzeroSamples++;}push(current.pcm.blocks,{...event(),audioTime:owner.context.currentTime,contextState:owner.context.state,peak,energy,nonzeroSamples,samples:values.length,graphToDestination:path(entry.node,owner.context.destination)},64);});if(current&&current.pcm.blocks.length<64)pending=root.requestAnimationFrame(sample);}
 const settled=()=>Boolean(current&&current.inputs.filter(row=>row.type==='keydown').length===1&&current.inputs.filter(row=>row.type==='keyup').length===1&&current.calls.length===1&&current.receipts.some(row=>row.record.type==='ended'&&row.record.token===current.calls[0].token&&row.record.generation===current.calls[0].generation&&row.record.id===current.calls[0].id)&&current.pcm.blocks.some(row=>row.nonzeroSamples>0&&row.peak>1e-6&&row.energy>1e-10));
 return{failureEvidence(){return{version:1,errors:copy(errors),overflow,receivers:entries.map(entry=>({created:copy(entry.created),ready:copy(entry.ready),tapReady:copy(entry.tapReady),receiver:entry.owner?describe(entry):null})),current:current?{ready:copy(current.ready),inputs:copy(current.inputs),calls:copy(current.calls),receipts:copy(current.receipts),pcm:copy(current.pcm),after:boundary('failure')}:null};},assertHealthy(){if(errors.length)throw Error(`Live-tone observation failed: ${errors.join("; ")}`);},begin(){if(current)throw Error('Live-tone key observation already active');const ready=entries.filter(entry=>entry.owner?.state==='ready'&&!entry.owner.disposed&&entry.analyser&&entry.ready);if(ready.length!==1)throw Error('Exactly one ready persistent live-tone receiver required');current={entry:ready[0],inputs:[],calls:[],receipts:[],pcm:{method:'passive-fixed-live-gate-analyser',fftSize:16384,blocks:[]}};current.ready=boundary('ready');sample();return copy(current.ready);},settled,finish(){if(!current)throw Error('Missing live-tone observation');root.cancelAnimationFrame(pending);const result={version:1,expected:{keyCode,midi},initialization:{created:copy(current.entry.created),ready:copy(current.entry.ready),tapReady:copy(current.entry.tapReady)},ready:copy(current.ready),after:boundary('after'),inputs:copy(current.inputs),calls:copy(current.calls),receipts:copy(current.receipts),pcm:copy(current.pcm),errors:copy(errors),overflow};current=null;return result;},restore(){active=false;current=null;
  const attempt=(label,operation)=>{try{if(operation()===false)throw Error('Original method not restored');}catch(value){cleanupErrors.push({label,message:String(value.message||value).slice(0,512)});}};
  attempt('animation',()=>root.cancelAnimationFrame(pending));attempt('input-down',()=>document.removeEventListener('keydown',input,true));attempt('input-up',()=>document.removeEventListener('keyup',input,true));
  for(const entry of entries){attempt('port',()=>entry.node.port.removeEventListener('message',entry.listener,true));attempt('processorerror',()=>entry.node.removeEventListener('processorerror',entry.processorError));if(entry.analyser){attempt('tap-input',()=>entry.owner.outputGate.disconnect(entry.analyser));attempt('tap-output',()=>entry.analyser.disconnect());}}
  for(const [object,key,wrapped,original]of [[Receiver.prototype,'request',requested,request],[Receiver,'create',created,create],[Receiver.prototype,'play',played,play],[audioProto,'connect',connected,connect],[audioProto,'disconnect',disconnected,disconnect]])attempt(key,()=>{if(object[key]===wrapped)object[key]=original;return object[key]===original;});
  return{restored:cleanupErrors.length===0,overflow,errors:copy(errors),cleanupErrors};
 }};
}
