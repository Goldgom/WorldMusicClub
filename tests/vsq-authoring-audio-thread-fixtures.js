// Synthetic verifier fragments only. Never claim these rows establish a real
// browser, MessagePort, AudioWorklet, audible graph or native acceptance.
import {syntheticAudioThreadStatus} from './audio-thread-proof-fixtures.js';
import {syntheticVsqAudioThreadRun} from './vsq-audio-thread-proof-fixtures.js';
export function syntheticVsqAuthoringQuietAudio(){
 return {sourceStarts:0,oscillatorStarts:0,activeSources:0,pendingSources:0,worklet:{...syntheticAudioThreadStatus({started:0,completed:0}),contexts:0,states:[],initializations:[]}};
}
export function syntheticVsqAuthoringAudio(response,{phase='vsq-authoring-seed',sampleRate=48000}={}){
 const observed=(started,activeReceivers=0)=>{const worklet=syntheticAudioThreadStatus({started,completed:started-activeReceivers});worklet.initializations=Array.from({length:started},(_,index)=>({index:index+1,settled:true,ok:true}));if(activeReceivers){worklet.activeReceivers=activeReceivers;Object.assign(worklet.ownedNodes.at(-1),{state:'running',connected:true,nodeConnections:1,gateConnections:1,disposed:false});}return {...syntheticVsqAuthoringQuietAudio(),worklet};},cleanup=()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]});
 const listenAction=31,resetAction=32,playAction=34;
 return {phase,listenAction,playAction,listenSetupEvents:[{sequence:listenAction,type:'click',id:'start-performance',trusted:true},{sequence:resetAction,type:'click',id:'reset-button',trusted:true}],audioBeforeListen:syntheticVsqAuthoringQuietAudio(),audioBeforePlay:observed(1),beforeChoice:{audio:syntheticVsqAuthoringQuietAudio()},afterChoice:{audio:syntheticVsqAuthoringQuietAudio()},listenSetup:{listenAction,resetAction,admission:{screen:'stage',mode:'listen',renderer:'playing',positionMs:100,audio:observed(1,1)},afterResetAudio:observed(1),thread:[syntheticVsqAudioThreadRun(response,{sampleRate,mode:'listen',instrument:'piano',receiverId:1})]},listenAudio:observed(2,1),listenThread:[syntheticVsqAudioThreadRun(response,{sampleRate,mode:'listen',instrument:'piano',receiverId:2})],listenStopped:observed(2),reloadChoice:{audio:observed(2)},finalAudio:observed(2),receiverCleanup:cleanup(),...(phase==='vsq-authoring-seed'?{reviewAudio:syntheticVsqAuthoringQuietAudio(),reviewReceiverCleanup:cleanup()}:{})};
}
