import {isCleanSong,isPerformanceSong,isBasicKeysSong,isVsqSong,basicKeysParts,hasBasicKeyRendition} from './clean-song-package.js';
import {resolvePracticeSelection,humanPracticePartIds} from './practice-selection.js';
import {referencePreviewBudget,BASIC_KEY_MAX_VOICES} from './basic-key-rendition.js';
import {assistancePracticeGate} from './app-assistance.js';
/** A browsing candidate never owns, pauses, or replaces the active performance. */
export class ScorePreview {
  constructor({compile,check,resolveOptions=()=>null,prepareView=async value=>value,onChange=()=>{},assistanceController=null,assistanceContext=null}) { this.prepareView=prepareView;this.assistanceController=assistanceController;this.assistanceContext=assistanceContext;this.resolveOptions=resolveOptions;this.compile=compile;this.check=check;this.onChange=onChange;this.version=0;this.controller=null;this.value={status:'empty',score:null,compiled:null,identity:null,part:null,compatibility:{status:'pending',reason:'Choose a score.'}}; }
  publish(value) { this.value=value;this.onChange(value); }
  cancel({preserveAssistance=false}={}) { this.version++;this.controller?.abort();this.controller=null;if(!preserveAssistance)this.assistanceController?.reset(); }
  async select(identity,load,{part=null,practiceSelection,practiceLayout='solo',showOthers=true}={}) {
    this.cancel();const version=this.version,controller=new AbortController();this.controller=controller;
    const valid=()=>version===this.version&&!controller.signal.aborted;
    this.publish({status:'loading',identity,part,score:null,compiled:null,compatibility:{status:'pending',reason:'Preparing this preview…'}});
    try {
      const loaded=await load(controller.signal);if(!valid())return false;
      let cleanSong=isCleanSong(loaded?.cleanSong)?loaded.cleanSong:null;const score=cleanSong?loaded.score:loaded;
      if(isPerformanceSong(cleanSong)){
        this.publish({status:'performance',identity,part:null,cleanSong,score:null,compiled:null,compatibility:{status:'blocked',reason:'Notation and practice targets are unavailable for independent performance events.'}});
        return valid();
      }
      if(cleanSong&&part===null)part=(isBasicKeysSong(cleanSong)?basicKeysParts(cleanSong).find(part=>part.practice_available&&!part.percussion)?.id:cleanSong.notation.parts[0]?.id)||cleanSong.notation.parts[0]?.id||null;
      if(isBasicKeysSong(cleanSong)&&!cleanSong.compilation){this.publish({status:'inspection',identity,part,cleanSong,score,compiled:null,compatibility:{status:'blocked',reason:'The complete source is retained, but an unambiguous practice clock is unavailable.'}});return valid();}
      if(cleanSong&&!cleanSong.compilation){this.publish({status:'choice',identity,part,cleanSong,score,compiled:null,compatibility:{status:'pending',reason:'Choose base-note instrumental practice.'}});return valid();}
      let compiled=cleanSong?cleanSong.compilation:await this.compile(score,controller.signal);if(!valid())return false;
      const prepared=await this.prepareView({score:compiled.score,compiled,cleanSong,identity,part,practiceSelection,practiceLayout,showOthers},controller.signal);if(!valid())return false;
      compiled=prepared.compiled;cleanSong=prepared.cleanSong;
      practiceSelection=resolvePracticeSelection(compiled.score.parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]}));
      const overrides=this.resolveOptions({...prepared,score:compiled.score,compiled,cleanSong,identity,part,practiceSelection,practiceLayout,showOthers});
      if(overrides){part=overrides.part;practiceSelection=resolvePracticeSelection(compiled.score.parts,overrides.practiceSelection);practiceLayout=overrides.practiceLayout;showOthers=overrides.showOthers;}
      const candidate={status:'ready',identity,part,practiceSelection,practiceLayout,showOthers,...(prepared.pitchView?{pitchView:prepared.pitchView}:{}),...(overrides?.songMod?{songMod:overrides.songMod}:{}),cleanSong,score:compiled.score,compiled,compatibility:{status:'pending',reason:'Checking selected pitches with your instrument…'}};
      if(isBasicKeysSong(cleanSong)&&!hasBasicKeyRendition(cleanSong)&&practiceSelection.part_ids.some(id=>!basicKeysParts(cleanSong).some(item=>item.id===id&&item.practice_available))){this.publish({...candidate,compatibility:{status:'blocked',reason:'This retained part has no supported positive-duration melodic MIDI-key targets.'}});return valid();}
      this.publish(candidate);
      // Same-version view and playback-mix edits may update the candidate while
      // its target check runs. Ownership changes cancel this version instead.
      try {const assistance=await this.assistanceController?.restore();if(!valid())return false;const gate=this.assistanceController?assistancePracticeGate(this.assistanceController):null;this.value={...this.value,assistance:assistance||null};const compatibility=gate||await this.check(compiled,practiceSelection,controller.signal,{assistance});if(valid())this.publish({...this.value,compatibility});}
      catch(error){if(valid())this.publish({...this.value,compatibility:{status:'error',reason:`Practice compatibility could not be verified: ${error.message}`}});}
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
  adopt(compiled,compatibility,part=null,identity=compiled.score.id,cleanSong=null,{practiceSelection,practiceLayout='solo',showOthers=true,songMod=null,pitchView=null}={}) {
    this.cancel();const version=this.version;
    this.publish({status:'ready',identity,part,practiceSelection:resolvePracticeSelection(compiled.score.parts,practiceSelection??(part===null?{kind:'all'}:{kind:'parts',part_ids:[part]})),practiceLayout,showOthers,songMod,pitchView,score:compiled.score,compiled,compatibility:this.assistanceController?{status:'pending',reason:'Validating the saved note assignment…'}:compatibility,cleanSong});
    if(this.assistanceController)void this.assistanceController.restore().then(assistance=>{if(version===this.version)this.publish({...this.value,assistance,compatibility:assistancePracticeGate(this.assistanceController)||compatibility});});
  }
  canStart(mode) {
    const value=this.value;let assistance=null;
    try{
      if(this.assistanceController){const gate=assistancePracticeGate(this.assistanceController);if(mode==='practice'&&gate)return false;assistance=this.assistanceController.current();}
      const muted=value.songMod?.config.parts.filter(part=>part.muted).map(part=>part.partId)||[],human=mode==='practice'?(value.practiceSelection?.part_ids||(value.part?[value.part]:[])):[],excluded=[...new Set([...human,...muted])];
      const selection=assistance?{kind:'parts',part_ids:assistance.plan.selection.selected_part_ids}:muted.length?(excluded.length?{kind:'parts',part_ids:excluded}:null):mode==='practice'?(value.practiceSelection??value.part):null;
      if(value.compiled&&(hasBasicKeyRendition(value.cleanSong)||isVsqSong(value.cleanSong))&&referencePreviewBudget(value.compiled.timeline.notes,selection,value.cleanSong.runtime.rendition,assistance?{assistance,assistanceContext:this.assistanceContext,sourceToken:value.cleanSong,mutedParts:muted}:undefined)>BASIC_KEY_MAX_VOICES)return false;
      if(mode==='practice'&&assistance&&!assistance.scored_mode_allowed)return false;
      return value.status==='ready'&&(!isBasicKeysSong(value.cleanSong)||mode==='listen'&&hasBasicKeyRendition(value.cleanSong)||mode==='practice'&&[...humanPracticePartIds(value.score.parts,{practiceSelection:value.practiceSelection,targetPart:value.part})].some(id=>basicKeysParts(value.cleanSong).some(part=>part.id===id&&part.practice_available)))&&(mode==='listen'||value.compatibility.status==='ready');
    }catch{return false;}
  }
}

export function filterCatalog(items,query='',origin='all') {
  const terms=String(query).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item=>(origin==='all'||(origin==='original'?item.provenance.kind==='original_exercise':item.provenance.kind!=='original_exercise'))&&terms.every(term=>`${item.title} ${item.composer||''}`.normalize('NFKC').toLocaleLowerCase().includes(term)));
}

export function stageShortcutAllowed({screen,target,defaultPrevented=false,repeat=false,ctrlKey=false,metaKey=false,altKey=false,dialogOpen=false}) {
  return screen==='stage'&&!dialogOpen&&!defaultPrevented&&!repeat&&!ctrlKey&&!metaKey&&!altKey&&!/^(INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(target?.tagName||'')&&!target?.isContentEditable;
}
