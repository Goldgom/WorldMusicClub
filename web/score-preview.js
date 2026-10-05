import {isCleanSong,isPerformanceSong,isBasicKeysSong,isVsqSong,basicKeysParts,hasBasicKeyRendition} from './clean-song-package.js';
import {resolvePracticeSelection,humanPracticePartIds} from './practice-selection.js';
import {referencePreviewBudget,BASIC_KEY_MAX_VOICES} from './basic-key-rendition.js';
/** A browsing candidate never owns, pauses, or replaces the active performance. */
export class ScorePreview {
  constructor({compile,check,onChange=()=>{}}) { this.compile=compile;this.check=check;this.onChange=onChange;this.version=0;this.controller=null;this.value={status:'empty',score:null,compiled:null,identity:null,part:null,compatibility:{status:'pending',reason:'Choose a score.'}}; }
  publish(value) { this.value=value;this.onChange(value); }
  cancel() { this.version++;this.controller?.abort();this.controller=null; }
  async select(identity,load,{part=null,practiceSelection,practiceLayout='solo',showOthers=true}={}) {
    this.cancel();const version=this.version,controller=new AbortController();this.controller=controller;
    const valid=()=>version===this.version&&!controller.signal.aborted;
    this.publish({status:'loading',identity,part,score:null,compiled:null,compatibility:{status:'pending',reason:'Preparing this preview…'}});
    try {
      const loaded=await load(controller.signal);if(!valid())return false;
      const cleanSong=isCleanSong(loaded?.cleanSong)?loaded.cleanSong:null,score=cleanSong?loaded.score:loaded;
      if(isPerformanceSong(cleanSong)){
        this.publish({status:'performance',identity,part:null,cleanSong,score:null,compiled:null,compatibility:{status:'blocked',reason:'Notation and practice targets are unavailable for independent performance events.'}});
        return valid();
      }
      if(cleanSong&&part===null)part=(isBasicKeysSong(cleanSong)?basicKeysParts(cleanSong).find(part=>part.practice_available&&!part.percussion)?.id:cleanSong.notation.parts[0]?.id)||cleanSong.notation.parts[0]?.id||null;
      if(isBasicKeysSong(cleanSong)&&!cleanSong.compilation){this.publish({status:'inspection',identity,part,cleanSong,score,compiled:null,compatibility:{status:'blocked',reason:'The complete source is retained, but an unambiguous practice clock is unavailable.'}});return valid();}
      if(cleanSong&&!cleanSong.compilation){this.publish({status:'choice',identity,part,cleanSong,score,compiled:null,compatibility:{status:'pending',reason:'Choose base-note instrumental practice.'}});return valid();}
      const compiled=cleanSong?cleanSong.compilation:await this.compile(score,controller.signal);if(!valid())return false;
      practiceSelection=resolvePracticeSelection(compiled.score.parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]}));
      const candidate={status:'ready',identity,part,practiceSelection,practiceLayout,showOthers,cleanSong,score:compiled.score,compiled,compatibility:{status:'pending',reason:'Checking selected pitches with your instrument…'}};
      if(isBasicKeysSong(cleanSong)&&!hasBasicKeyRendition(cleanSong)&&practiceSelection.part_ids.some(id=>!basicKeysParts(cleanSong).some(item=>item.id===id&&item.practice_available))){this.publish({...candidate,compatibility:{status:'blocked',reason:'This retained part has no supported positive-duration melodic MIDI-key targets.'}});return valid();}
      this.publish(candidate);
      try {const compatibility=await this.check(compiled,practiceSelection,controller.signal);if(valid())this.publish({...candidate,compatibility});}
      catch(error){if(valid())this.publish({...candidate,compatibility:{status:'error',reason:`Practice compatibility could not be verified: ${error.message}`}});}
      return valid();
    } catch(error) {
      if(valid())this.publish({status:'error',identity,part,score:null,compiled:null,message:error.message,errorCode:error.code,compatibility:{status:'error',reason:'Preview unavailable. Try this selection again.'}});
      return false;
    } finally {if(this.controller===controller)this.controller=null;}
  }
  async chooseVsqPractice(derive) {
    const previous=this.value;if(previous.status!=='choice'||!previous.cleanSong)return false;
    this.cancel();const version=this.version,controller=new AbortController();this.controller=controller;
    this.publish({...previous,status:'choosing',message:null,errorCode:null});
    try {
      const cleanSong=await derive(previous.cleanSong,controller.signal);
      if(version!==this.version||controller.signal.aborted)return false;
      return await this.select(previous.identity,async()=>({score:previous.score,cleanSong}),{part:previous.part,practiceSelection:previous.practiceSelection,practiceLayout:previous.practiceLayout,showOthers:previous.showOthers});
    } catch(error) {
      if(version===this.version&&!controller.signal.aborted)this.publish({...previous,message:error.message,errorCode:error.code});
      return false;
    } finally {if(this.controller===controller)this.controller=null;}
  }
  adopt(compiled,compatibility,part=null,identity=compiled.score.id,cleanSong=null,{practiceSelection,practiceLayout='solo',showOthers=true}={}) {
    this.cancel();this.publish({status:'ready',identity,part,practiceSelection:resolvePracticeSelection(compiled.score.parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]})),practiceLayout,showOthers,score:compiled.score,compiled,compatibility,cleanSong});
  }
  canStart(mode) {const value=this.value;if(value.compiled&&(hasBasicKeyRendition(value.cleanSong)||isVsqSong(value.cleanSong))&&referencePreviewBudget(value.compiled.timeline.notes,mode==='practice'?(value.practiceSelection??value.part):null,value.cleanSong.runtime.rendition)>BASIC_KEY_MAX_VOICES)return false;return value.status==='ready'&&(!isBasicKeysSong(value.cleanSong)||mode==='listen'&&hasBasicKeyRendition(value.cleanSong)||mode==='practice'&&[...humanPracticePartIds(value.score.parts,{practiceSelection:value.practiceSelection,targetPart:value.part})].some(id=>basicKeysParts(value.cleanSong).some(part=>part.id===id&&part.practice_available)))&&(mode==='listen'||value.compatibility.status==='ready');}
}

export function filterCatalog(items,query='',origin='all') {
  const terms=String(query).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item=>(origin==='all'||(origin==='original'?item.provenance.kind==='original_exercise':item.provenance.kind!=='original_exercise'))&&terms.every(term=>`${item.title} ${item.composer||''}`.normalize('NFKC').toLocaleLowerCase().includes(term)));
}

export function stageShortcutAllowed({screen,target,defaultPrevented=false,repeat=false,ctrlKey=false,metaKey=false,altKey=false,dialogOpen=false}) {
  return screen==='stage'&&!dialogOpen&&!defaultPrevented&&!repeat&&!ctrlKey&&!metaKey&&!altKey&&!/^(INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(target?.tagName||'')&&!target?.isContentEditable;
}
