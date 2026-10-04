import {equivalentJson} from './adaptation-view.js';
import {isCleanSong,isBasicKeysSong,VSQ_PROFILE,VSQ_PRACTICE_PROFILE} from './clean-song-package.js';

const fail=()=>{throw Object.assign(Error('The complete-song recommendation is not bound to the current native score, performance clock and explicit practice choice. Reload the saved song and request fresh guidance.'),{code:'clean_fingering_source_invalid'});};

export const BASIC_KEY_FINGERING_REASON='Hand/finger guidance is unavailable for nominal MIDI key projections. Key practice and complete source export remain available.';
export function fingeringUnavailable(context){return isBasicKeysSong(context?.cleanSong);}

/** Bind requests to admitted saved bytes. Never reconstruct native musical time in JS. */
export function fingeringSource(context){
  const song=context?.cleanSong;
  if(fingeringUnavailable(context))throw Object.assign(Error(BASIC_KEY_FINGERING_REASON),{code:'basic_keys_fingering_unavailable'});
  if(song==null)return null;
  if(!isCleanSong(song)||!song.notation||!song.compilation||song.compilation.score!==context.score||song.compilation.timeline!==context.timeline
    ||!song.runtime||!/^[0-9a-f]{64}$/.test(song.identity)||song.libraryKey!==`native:song-${song.identity}`)fail();
  let choice=null;
  if(song.profile===VSQ_PROFILE){
    if(song.runtime.profile!==VSQ_PRACTICE_PROFILE||song.runtime.choice!=='base_notes_instrumental')fail();
    choice=song.runtime.choice;
  }else if(song.profile!=='wmh-semantic-midi1-v1'||song.runtime.compilation!==song.compilation)fail();
  return{key:song.libraryKey.slice('native:'.length),content_sha256:song.identity,profile:song.profile,choice};
}

export function currentFingeringSource(context,song,source){
  if((context?.cleanSong??null)!==song)return false;
  try{return equivalentJson(fingeringSource(context),source);}catch{return false;}
}

export function fingeringRequest(instrument,context,settings,source){
  const body={part_id:context.part_id,profile:context.profile,...settings};
  return source?{path:`/api/library/fingering/${instrument}`,body:{source,settings:body}}
    :{path:`/api/fingering/${instrument}`,body:{score:context.score,...body}};
}

/** Keep the existing complete plan validators authoritative inside this envelope. */
export function fingeringResponse(response,source){
  if(!source)return response;
  if(!response||!equivalentJson(response.source,source)||!response.plan)fail();
  return response.plan;
}
