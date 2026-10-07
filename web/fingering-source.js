import {equivalentJson} from './adaptation-view.js';
import {practiceAssistanceBinding} from './practice-assistance-receipt.js';
import {isCleanSong,isBasicKeysSong,VSQ_PROFILE,VSQ_PRACTICE_PROFILE} from './clean-song-package.js';

const fail=()=>{throw Object.assign(Error('The complete-song recommendation is not bound to the current native score, performance clock and explicit practice choice. Reload the saved song and request fresh guidance.'),{code:'clean_fingering_source_invalid'});};

export const BASIC_KEY_FINGERING_REASON='Hand/finger guidance is unavailable for nominal MIDI key projections. Key practice and complete source export remain available.';
export const PARTIAL_ASSISTANCE_FINGERING_REASON='Hand/finger guidance is unavailable for this assisted selection: the current planners cover whole selected parts and cannot plan only the human-owned notes. Restore Original to request guidance.';
export const PENDING_ASSISTANCE_FINGERING_REASON='Hand/finger guidance is unavailable until assistance ownership is checked for the current selection. Restore or validate Original to request guidance.';

/** The app supplies its current admitted receipt; missing flags preserve legacy
 * Original behavior. Never derive a note-filtered source for a whole-part planner. */
export function fingeringUnavailableReason(context){
  if(isBasicKeysSong(context?.cleanSong))return{code:'basic_keys',message:BASIC_KEY_FINGERING_REASON};
  if(context?.assistance!=null){
    try{practiceAssistanceBinding(context.assistance);}catch{return{code:'assistance_pending',message:PENDING_ASSISTANCE_FINGERING_REASON};}
    if(!context.assistance.all_selected_human)return{code:'assistance_partial',message:PARTIAL_ASSISTANCE_FINGERING_REASON};
  }
  return context?.assistanceUnavailable?{code:'assistance_pending',message:PENDING_ASSISTANCE_FINGERING_REASON}:null;
}
export function fingeringUnavailable(context){return fingeringUnavailableReason(context)!==null;}

/** Bind requests to admitted saved bytes. Never reconstruct native musical time in JS. */
export function fingeringSource(context){
  const song=context?.cleanSong;
  const unavailable=fingeringUnavailableReason(context);
  if(unavailable)throw Object.assign(Error(unavailable.message),{code:`${unavailable.code}_fingering_unavailable`});
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

export function currentFingeringSource(context,song,source,assistance=null){
  if((context?.cleanSong??null)!==song||(context?.assistance??null)!==assistance)return false;
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
