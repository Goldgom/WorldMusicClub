// Synthetic DOM metadata for verifier/observer tests only, never browser proof.
// Clock samples are explicit inputs; native range strings are independent.
import {createPlaybackClock} from '../web/playback-clock-view.js';
export function setEvidencePlaybackClock(node,positionMs,{durationMs=5000,rawValue=String(Math.min(durationMs,Math.max(0,positionMs))),...state}={}) {
 const clock=createPlaybackClock({positionMs,durationMs,...state});
 node.dataset??={};node.dataset.playbackClock=JSON.stringify(clock);if(typeof node.setAttribute==='function')node.setAttribute('data-playback-clock',node.dataset.playbackClock);else node['data-playback-clock']=node.dataset.playbackClock;
 node.value=rawValue;node.min=String(clock.rangeStartMs);node.max=String(clock.rangeEndMs);
 node.getAttribute??=function(name){return name==='data-playback-clock'?this.dataset.playbackClock:null;};
 return clock;
}
export function evidenceClockNode(positionMs=0,options={}){const node={};setEvidencePlaybackClock(node,positionMs,options);return node;}
