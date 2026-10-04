// Acceptance-only observers. Every production call keeps its receiver, arguments,
// return value and errors. No clock, note, timer, lookahead or input is modified.
export function denseRenditionBootstrap(){
 // Playwright wraps init scripts in an IIFE. Explicitly export only this
 // acceptance namespace; page.evaluate cannot see local function declarations.
 return `globalThis.__wmhDenseObserverTools=Object.freeze({observeAudio:${observeDenseRenditionAudio.toString()},install:${installDenseRenditionObserver.toString()}});\nlocalStorage.setItem('worldmusichub.locale.v1','zh-CN');`;
}
export function observeDenseRenditionAudio(root=globalThis){
 const prototypes=new Set([root.AudioContext?.prototype,root.webkitAudioContext?.prototype].filter(Boolean));if(!prototypes.size)throw Error('Real Web Audio is required');const live=new Set(),restores=[];let sourceStarts=0,oscillatorStarts=0,created=0,overflow=false;
 for(const prototype of prototypes)for(const method of ['createOscillator','createBufferSource']){const original=prototype[method];if(typeof original!=='function')throw Error(`Missing real ${method}`);
  function observe(...args){const node=Reflect.apply(original,this,args),row={context:this,node,start:null,stop:Infinity,disconnected:false},start=node.start,stop=node.stop,disconnect=node.disconnect;created++;if(created>8192)overflow=true;live.add(row);
   const restore=()=>{if(node.start===started)node.start=start;if(node.stop===stopped)node.stop=stop;if(node.disconnect===disconnected)node.disconnect=disconnect;};row.restore=restore;
   function started(...values){const result=Reflect.apply(start,this,values);row.start=values.length?Number(values[0]):row.context.currentTime;sourceStarts++;if(method==='createOscillator')oscillatorStarts++;return result;}
   function stopped(...values){const result=Reflect.apply(stop,this,values);row.stop=values.length?Number(values[0]):row.context.currentTime;return result;}
   function disconnected(...values){const result=Reflect.apply(disconnect,this,values);if(!values.length){row.disconnected=true;live.delete(row);restore();}return result;}
   node.start=started;node.stop=stopped;node.disconnect=disconnected;return node;
  }
  prototype[method]=observe;restores.push(()=>{if(prototype[method]===observe)prototype[method]=original;return prototype[method]===original;});
 }
 return{snapshot:()=>({sourceStarts,oscillatorStarts,created,overflow,activeSources:[...live].filter(row=>row.start!==null&&row.start<=row.context.currentTime&&row.stop>row.context.currentTime).length,pendingSources:[...live].filter(row=>row.start!==null&&row.start>row.context.currentTime&&row.stop>row.start).length}),restore(){for(const row of live)row.restore();live.clear();return restores.map(restore=>restore()).every(Boolean);}};
}
export async function installDenseRenditionObserver({library,audioProbe}={}){
 const {BasicKeyPlayer,ReferenceAudioReceiver,Renderer}=library||{...(await import('/basic-key-player.js')),...(await import('/midi-reference-synth.js')),Renderer:globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay};
 if(!Renderer)throw Error('Load the first real staff page before installing the dense observer');
 const doc=globalThis.document,now=()=>performance.now(),get=id=>doc.getElementById(id),limits={pumps:4096,schedules:8192,renders:256,frames:4096,scope:128,states:128,errors:32,longTasks:256},data={version:1,pumps:[],schedules:[],renders:[],frames:[],scope:[],states:[],errors:[],longTasks:[],longTaskSupported:false,overflow:[],counts:{pumps:0,schedules:0,renders:0},listeningStarted:null,listeningEnded:null};
 let active=true,context=null;const players=new Map(),contexts=new Map(),restores=[],painted=new Set();
 const push=(kind,row)=>{if(!active)return;if(data[kind].length<limits[kind])data[kind].push(row);else if(!data.overflow.includes(kind))data.overflow.push(kind);};
 const screen=()=>({wall:now(),position:Number(get('progress').value),renderer:get('clean-song-stage').dataset.rendererState,scoreState:get('workspace').dataset.scoreState,range:get('engraving-range').textContent,captured:get('hud-captured').textContent,notice:get('notice').textContent,audioTime:context?.currentTime??null,audioState:context?.state??null});
 const errorRow=error=>({code:String(error?.code||error?.name||'error').slice(0,96),message:String(error?.message||error).slice(0,512),eventId:String(error?.detail?.eventId||'').slice(0,160),lateSeconds:Number.isFinite(error?.detail?.lateSeconds)?error.detail.lateSeconds:null,...screen()});
 const attachContext=value=>{context=value;if(contexts.has(value))return;const observe=()=>push('states',{wall:now(),audioTime:value.currentTime,state:value.state});contexts.set(value,observe);observe();value.addEventListener?.('statechange',observe);};
 const pump=BasicKeyPlayer.prototype.pump;
 function observedPump(...args){
  if(!active)return Reflect.apply(pump,this,args);
  if(!players.has(this)){const original=this.onError,wrapped=error=>{push('errors',errorRow(error));return Reflect.apply(original,this,[error]);};players.set(this,{original,wrapped,last:null});this.onError=wrapped;}
  const owner=players.get(this);if(this.context)attachContext(this.context);const begin=now(),running=this.running,before=screen(),cursor=this.noteCursor;if(running&&data.listeningStarted===null)data.listeningStarted=before;
  const row={wall:begin,gapMs:running&&owner.last!==null?begin-owner.last:null,position:before.position,transportPosition:typeof this.getPositionMs==='function'?this.getPositionMs():null,audioTime:context?.currentTime??null,audioState:context?.state??null,cursor,runningBefore:running};if(running)owner.last=begin;
  try{return Reflect.apply(pump,this,args);}finally{if(running){data.counts.pumps++;Object.assign(row,{durationMs:now()-begin,afterAudioTime:context?.currentTime??null,afterPosition:Number(get('progress').value),afterCursor:this.noteCursor,runningAfter:this.running});push('pumps',row);}}
 }
 BasicKeyPlayer.prototype.pump=observedPump;restores.push(()=>{if(BasicKeyPlayer.prototype.pump===observedPump)BasicKeyPlayer.prototype.pump=pump;return BasicKeyPlayer.prototype.pump===pump;});
 const schedule=ReferenceAudioReceiver.prototype.schedule;
 function observedSchedule(note,start,end,...rest){
  const before=now(),audioNow=this.context.currentTime,row={eventId:note.eventId,key:note.key,velocity:note.velocity,start,end,audioNow,wall:before,position:Number(get('progress').value)};data.counts.schedules++;
  try{const voice=Reflect.apply(schedule,this,[note,start,end,...rest]);Object.assign(row,{returnedVoice:Boolean(voice),voiceStart:voice?.start,voiceEnd:voice?.end});return voice;}catch(error){row.error=errorRow(error);throw error;}finally{row.durationMs=now()-before;row.afterAudioTime=this.context.currentTime;push('schedules',row);}
 }
 ReferenceAudioReceiver.prototype.schedule=observedSchedule;restores.push(()=>{if(ReferenceAudioReceiver.prototype.schedule===observedSchedule)ReferenceAudioReceiver.prototype.schedule=schedule;return ReferenceAudioReceiver.prototype.schedule===schedule;});
 for(const method of ['load','updateGraphic','render']){
  const original=Renderer.prototype[method];if(typeof original!=='function')throw Error(`Actual renderer method missing: ${method}`);
  function observed(...args){const begin=now(),row={method,...screen()};data.counts.renders++;try{const result=Reflect.apply(original,this,args);if(result?.then)result.then(()=>{row.settledMs=now()-begin;},error=>{row.settledMs=now()-begin;row.error=String(error?.message||error).slice(0,512);});return result;}catch(error){row.error=String(error?.message||error).slice(0,512);throw error;}finally{row.durationMs=now()-begin;row.afterAudioTime=context?.currentTime??null;push('renders',row);}}
  Renderer.prototype[method]=observed;restores.push(()=>{if(Renderer.prototype[method]===observed)Renderer.prototype[method]=original;return Renderer.prototype[method]===original;});
 }
 const requestFrame=globalThis.requestAnimationFrame;
 if(typeof requestFrame==='function'){
  function observedFrame(...requestArgs){
   const callback=requestArgs[0];if(typeof callback!=='function')return Reflect.apply(requestFrame,this,requestArgs);
   requestArgs[0]=function(...args){const begin=now();try{return Reflect.apply(callback,this,args);}finally{
    if(active&&data.listeningStarted!==null&&data.listeningEnded===null)try{push('frames',{wall:begin,durationMs:now()-begin,callback:callback.name||'anonymous',position:Number(get('progress')?.value),renderer:get('clean-song-stage')?.dataset?.rendererState});}
    catch(error){push('errors',{code:'dense_frame_observer',message:String(error?.message||error).slice(0,512)});}
   }};
   return Reflect.apply(requestFrame,this,requestArgs);
  }
  globalThis.requestAnimationFrame=observedFrame;restores.push(()=>{if(globalThis.requestAnimationFrame===observedFrame)globalThis.requestAnimationFrame=requestFrame;return globalThis.requestAnimationFrame===requestFrame;});
 }
 let longTaskObserver;if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){data.longTaskSupported=true;longTaskObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())push('longTasks',{startTime:entry.startTime,duration:entry.duration});});longTaskObserver.observe({type:'longtask',buffered:false});}
 const scope=event=>{const detail=event.detail,stage=get('workspace'),row={...screen(),scope:detail.scope,status:detail.status,page:detail.page,parts:[...(detail.renderedPartIds||[])],loadMs:Number(stage.dataset.notationLoadMs),prefetch:stage.dataset.notationPrefetch};
  const identity=JSON.stringify([row.range,row.parts]);if(detail.status==='ready'&&row.parts.length===4&&!painted.has(identity)){painted.add(identity);row.sourceIds=[...get('engraved-staff').querySelectorAll('[data-source-note-id]')].map(node=>node.dataset.sourceNoteId);row.heads=get('engraved-staff').querySelectorAll('.vf-notehead').length;row.svg=get('engraved-staff').querySelectorAll('svg').length;}push('scope',row);};
 get('workspace').addEventListener('notationscopecontext',scope);
 return{markEnded(){const end=screen();if(end.renderer!=='ended')throw Error('Natural End is not observable yet');data.listeningEnded=end;return structuredClone(end);},status:()=>({errors:structuredClone(data.errors),overflow:[...data.overflow],schedules:data.counts.schedules,current:screen()}),snapshot:()=>({...structuredClone(data),current:screen(),audio:audioProbe?.snapshot()}),stop(){const final={...structuredClone(data),current:screen(),audio:audioProbe?.snapshot()};active=false;longTaskObserver?.disconnect();get('workspace').removeEventListener('notationscopecontext',scope);const restored=restores.map(restore=>restore());for(const[player,owner]of players){if(player.onError===owner.wrapped)player.onError=owner.original;restored.push(player.onError===owner.original);}for(const[value,observe]of contexts)value.removeEventListener?.('statechange',observe);const audioRestored=audioProbe?.restore()===true;return{...final,cleanup:{restored:restored.every(Boolean)&&audioRestored,contexts:contexts.size,players:players.size,stopped:true}};}};
}
