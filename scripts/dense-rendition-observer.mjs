import {readPlaybackClock} from '../web/playback-clock-view.js';
import {readFileSync} from 'node:fs';
const nativeObserver=readFileSync(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8');
const observerStart=nativeObserver.indexOf('async function observeBasicKeyReceiver('),observerEnd=nativeObserver.indexOf('// End shared audio-thread observer.');
if(observerStart<0||observerEnd<=observerStart)throw Error('Shared audio-thread observer boundary is missing');
export const audioThreadObserverSource=nativeObserver.slice(observerStart,observerEnd);
// Acceptance-only observers. Every production call keeps its receiver, arguments,
// return value and errors. No clock, note, timer, lookahead or input is modified.
export function denseRenditionBootstrap(){
 // Playwright wraps init scripts in an IIFE. Explicitly export the shared
 // clock reader and observer namespace; page.evaluate cannot see local names.
 return `globalThis.__wmhReadPlaybackClock=(${readPlaybackClock.toString()});\nglobalThis.__wmhDenseObserverTools=Object.freeze({observeAudio:${observeDenseRenditionAudio.toString()},observeReceiver:${audioThreadObserverSource},install:${installDenseRenditionObserver.toString()}});\nlocalStorage.setItem('worldmusichub.locale.v1','zh-CN');`;
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
 return{snapshot:()=>({sourceStarts,oscillatorStarts,created,overflow,activeSources:[...live].filter(row=>row.start!==null&&row.start<=row.context.currentTime&&row.stop>row.context.currentTime).length,pendingSources:[...live].filter(row=>row.start!==null&&row.start>row.context.currentTime&&row.stop>row.start).length}),restore(){let restored=true;for(const row of live)try{row.restore();}catch{restored=false;}live.clear();for(const restore of restores)try{if(!restore())restored=false;}catch{restored=false;}return restored;}};
}
export async function installDenseRenditionObserver({library,audioProbe}={}){
 const {BasicKeyAudioReceiver,Renderer}=library||{...(await import('/basic-key-audio-receiver.js')),Renderer:globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay};
 if(!Renderer)throw Error('Load the first real staff page before installing the dense observer');
 const doc=globalThis.document,now=()=>performance.now(),get=id=>doc.getElementById(id),limits={pumps:4096,schedules:8192,renders:256,frames:4096,scope:128,states:128,errors:32,longTasks:256},data={version:2,pumps:[],schedules:[],renders:[],frames:[],scope:[],states:[],errors:[],longTasks:[],longTaskSupported:false,overflow:[],counts:{pumps:0,schedules:0,renders:0},listeningStarted:null,listeningEnded:null};
 let active=true,context=null;const contexts=new Map(),restores=[],painted=new Set();
 const push=(kind,row)=>{if(!active)return;if(data[kind].length<limits[kind])data[kind].push(row);else if(!data.overflow.includes(kind))data.overflow.push(kind);};
 const screen=()=>{const clock=globalThis.__wmhReadPlaybackClock(doc);return{wall:now(),clock,position:clock.positionMs,renderer:get('clean-song-stage').dataset.rendererState,scoreState:get('workspace').dataset.scoreState,range:get('engraving-range').textContent,captured:get('hud-captured').textContent,notice:get('notice').textContent,audioTime:context?.currentTime??null,audioState:context?.state??null};};
 const errorRow=error=>({code:String(error?.code||error?.name||'error').slice(0,96),message:String(error?.message||error).slice(0,512),eventId:String(error?.detail?.eventId||'').slice(0,160),lateSeconds:Number.isFinite(error?.detail?.lateSeconds)?error.detail.lateSeconds:null,...screen()});
 const attachContext=value=>{context=value;if(contexts.has(value))return;const observe=()=>push('states',{wall:now(),audioTime:value.currentTime,state:value.state});contexts.set(value,observe);observe();value.addEventListener?.('statechange',observe);};
 const observeReceiver=library?.observeReceiver||globalThis.__wmhDenseObserverTools?.observeReceiver;
 if(typeof observeReceiver!=='function')throw Error('Actual receiver observer unavailable');
 const receiver=await observeReceiver(doc,{Receiver:BasicKeyAudioReceiver,onContext:attachContext,onStart(owner){if(data.listeningStarted===null)data.listeningStarted=screen();}});
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
    if(active&&data.listeningStarted!==null&&data.listeningEnded===null)try{push('frames',{wall:begin,durationMs:now()-begin,callback:callback.name||'anonymous',position:globalThis.__wmhReadPlaybackClock(doc).positionMs,renderer:get('clean-song-stage')?.dataset?.rendererState,audioTime:context?.currentTime??null,audioState:context?.state??null});}
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
 const receiverState=()=>receiver.status();
 const snapshot=()=>({...structuredClone(data),current:screen(),audio:audioProbe?.snapshot(),audioThread:receiver.snapshot(),receiver:receiverState()});
 return{markEnded(){const end=screen();if(!end.clock.completed||end.clock.phase!=='ended'||end.position!==end.clock.durationMs||end.renderer!=='ended'||!receiverState().completed||!receiver.quiet())throw Error('Natural processor End and disposal are not observable yet');data.listeningEnded=end;return structuredClone(end);},status:()=>({errors:[...structuredClone(data.errors),...receiverState().errors],overflow:[...data.overflow,...(receiverState().overflow?['audioThread']:[])],schedules:receiver.count(),completed:receiverState().completed,quiet:receiver.quiet(),current:screen()}),snapshot,stop(){
  const cleanupErrors=[];let restored=true,final,receiverCleanup;
  const attempt=(name,run)=>{try{const result=run();if(result===false||result?.restored===false||result?.cleanupErrors?.length)throw Error(result?.cleanupErrors?.map(error=>error.message).join('; ')||'Observer restoration was incomplete');return result;}catch(error){restored=false;cleanupErrors.push({name,message:String(error?.message||error).slice(0,512)});}};
  final=attempt('snapshot',snapshot)||{...structuredClone(data)};active=false;
  attempt('long-task-observer',()=>longTaskObserver?.disconnect());attempt('notation-scope-listener',()=>get('workspace').removeEventListener('notationscopecontext',scope));
  for(const[index,restore]of restores.entries())attempt(`method-${index}`,restore);
  attempt('audio-receiver',()=>receiverCleanup=receiver.restore());for(const[value,observe]of contexts)attempt('context-state-listener',()=>value.removeEventListener?.('statechange',observe));attempt('legacy-audio-probe',()=>audioProbe?.restore()===true);
  return{...final,cleanup:{restored,contexts:contexts.size,players:final.receiver?.receivers??0,stopped:true,receiver:receiverCleanup,errors:cleanupErrors}};
 }};
}
