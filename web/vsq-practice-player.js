import {PROGRAM_FAMILIES} from './midi-reference-synth.js';
import {CleanSongError} from './clean-song-package.js';
import {BasicKeyPlayer} from './basic-key-player.js';
import {buildVsqAudioPlan} from './vsq-audio-plan.js';

// Existing instrumental recipes, independent of VSQ singer/voice fields.
export const VSQ_REFERENCE_ROUTES=Object.freeze({piano:PROGRAM_FAMILIES[0],guitar:PROGRAM_FAMILIES[3]});
/** Shares preparation, cancellation and the sole audio-thread gate scheduler. */
export class VsqPracticePlayer extends BasicKeyPlayer {
  buildPlan({context,mode='listen',targetPart=null,mutedParts=null,soloParts=null,instrument='piano'}={}) {
    if(this.lookAheadMs!==100)throw new CleanSongError('reference_policy_required','The VSQ reference retains the declared 100 ms maximum start lead.');
    return buildVsqAudioPlan(this.song,{sampleRate:context.sampleRate,mode,targetPart,mutedParts:mutedParts||[],soloParts:soloParts||[],instrument});
  }
}
