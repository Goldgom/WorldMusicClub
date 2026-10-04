// Synthetic verifier fragments only. Never claim these rows establish a real
// browser, MessagePort, AudioWorklet, audible graph or native acceptance.
import {syntheticAudioThreadStatus} from './audio-thread-proof-fixtures.js';
import {syntheticVsqAudioThreadRun} from './vsq-audio-thread-proof-fixtures.js';
export function syntheticVsqAuthoringQuietAudio(){
 return {sourceStarts:0,oscillatorStarts:0,activeSources:0,pendingSources:0,worklet:{...syntheticAudioThreadStatus({started:0,completed:0}),contexts:0,states:[],initializations:[]}};
}
export function syntheticVsqAuthoringAudio(response,{phase='vsq-authoring-seed',sampleRate=48000}={}){
 const stopped=()=>({...syntheticVsqAuthoringQuietAudio(),worklet:syntheticAudioThreadStatus()}),cleanup=()=>({restored:true,overflow:false,errors:[],cleanupErrors:[]});
 return {phase,audioBeforePlay:syntheticVsqAuthoringQuietAudio(),beforeChoice:{audio:syntheticVsqAuthoringQuietAudio()},afterChoice:{audio:syntheticVsqAuthoringQuietAudio()},listenAudio:{...stopped(),worklet:syntheticAudioThreadStatus({activeReceivers:1,completed:0})},listenThread:[syntheticVsqAudioThreadRun(response,{sampleRate,mode:'listen',instrument:'piano'})],listenStopped:stopped(),reloadChoice:{audio:stopped()},finalAudio:stopped(),receiverCleanup:cleanup(),...(phase==='vsq-authoring-seed'?{reviewAudio:syntheticVsqAuthoringQuietAudio(),reviewReceiverCleanup:cleanup()}:{})};
}
