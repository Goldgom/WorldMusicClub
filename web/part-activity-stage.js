import {canonicalActivityPlayback,retirePartActivityAdmission} from './part-activity-playback.js';
import {compilePartActivity,samplePartActivity} from './part-activity-model.js';
import {partActivityEligible} from './part-activity-view.js';

/** Display-only cache. Retired rows never authorize a new audible epoch. */
export function createPartActivityStage({canonicalSession,cleanPlayer}){
 let snapshot=null,model=null,epoch=null,retired=null;
 const clear=()=>{snapshot=null;model=null;epoch=null;retired=null;};
 const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>value===b[i]);
 return{clear,retire({cleanSong,lifecycle}){
  try{const admission=retirePartActivityAdmission(cleanSong?cleanPlayer:canonicalSession,{clean:Boolean(cleanSong)});
  if(admission)retired={admission,lifecycle:[...lifecycle],model:compilePartActivity(admission.snapshot,admission.binding)};
  else if(!same(retired?.lifecycle,lifecycle))clear();}catch{clear();}
 },sample({cleanSong,source,context,position,sourceClock,transport,countIn,soundEnabled,hiddenPartIds=[],lifecycle=[],otherRenderer=false}){
  if(otherRenderer||(cleanSong?cleanPlayer.song!==cleanSong:canonicalSession.compilation!==source)){clear();return null;}
  if(retired&&!same(retired.lifecycle,lifecycle))clear();
  if(!partActivityEligible(context)){if(context.screen!=='stage'||context.mode!=='practice')clear();return null;}
  const frame={positionMs:position,sourceClock,transport,countIn,soundEnabled,view:{layout:context.layout,hideOtherParts:!context.showOtherParts,hiddenPartIds}};
  const admitted=cleanSong?cleanPlayer.activityPlayback(frame):canonicalActivityPlayback(canonicalSession,frame);
  if(admitted.status!=='ready'){
   snapshot=null;model=null;epoch=null;
   if(!['paused','ended'].includes(transport)||!retired?.admission.current()){clear();return null;}
   const result=samplePartActivity(retired.model,{...frame,binding:retired.admission.binding,rendererState:'stopped',soundEnabled:false});
   return Object.freeze({...result,rows:Object.freeze(result.rows.map(row=>Object.freeze({...row,activeGateCount:0})))});
  }
  try{if(snapshot!==admitted.snapshot||epoch!==admitted.epoch){model=compilePartActivity(admitted.snapshot,admitted.binding);snapshot=admitted.snapshot;epoch=admitted.epoch;}return samplePartActivity(model,admitted.frame);}catch{clear();return null;}
 }};
}
