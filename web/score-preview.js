/** A browsing candidate never owns, pauses, or replaces the active performance. */
export class ScorePreview {
  constructor({compile,check,onChange=()=>{}}) { this.compile=compile;this.check=check;this.onChange=onChange;this.version=0;this.controller=null;this.value={status:'empty',score:null,compiled:null,identity:null,part:null,compatibility:{status:'pending',reason:'Choose a score.'}}; }
  publish(value) { this.value=value;this.onChange(value); }
  cancel() { this.version++;this.controller?.abort();this.controller=null; }
  async select(identity,load,{part=null}={}) {
    this.cancel();const version=this.version,controller=new AbortController();this.controller=controller;
    const valid=()=>version===this.version&&!controller.signal.aborted;
    this.publish({status:'loading',identity,part,score:null,compiled:null,compatibility:{status:'pending',reason:'Preparing this preview…'}});
    try {
      const score=await load(controller.signal);if(!valid())return false;
      const compiled=await this.compile(score,controller.signal);if(!valid())return false;
      const candidate={status:'ready',identity,part,score:compiled.score,compiled,compatibility:{status:'pending',reason:'Checking selected pitches with your instrument…'}};
      this.publish(candidate);
      try {const compatibility=await this.check(compiled,part,controller.signal);if(valid())this.publish({...candidate,compatibility});}
      catch(error){if(valid())this.publish({...candidate,compatibility:{status:'error',reason:`Practice compatibility could not be verified: ${error.message}`}});}
      return valid();
    } catch(error) {
      if(valid())this.publish({status:'error',identity,part,score:null,compiled:null,message:error.message,compatibility:{status:'error',reason:'Preview unavailable. Try this selection again.'}});
      return false;
    } finally {if(this.controller===controller)this.controller=null;}
  }
  adopt(compiled,compatibility,part=null) {
    this.cancel();this.publish({status:'ready',identity:compiled.score.id,part,score:compiled.score,compiled,compatibility});
  }
  canStart(mode) {return this.value.status==='ready'&&(mode==='listen'||this.value.compatibility.status==='ready');}
}

export function filterCatalog(items,query='',origin='all') {
  const terms=String(query).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item=>(origin==='all'||(origin==='original'?item.provenance.kind==='original_exercise':item.provenance.kind!=='original_exercise'))&&terms.every(term=>`${item.title} ${item.composer||''}`.normalize('NFKC').toLocaleLowerCase().includes(term)));
}

export function stageShortcutAllowed({screen,target,defaultPrevented=false,repeat=false,ctrlKey=false,metaKey=false,altKey=false,dialogOpen=false}) {
  return screen==='stage'&&!dialogOpen&&!defaultPrevented&&!repeat&&!ctrlKey&&!metaKey&&!altKey&&!/^(INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(target?.tagName||'')&&!target?.isContentEditable;
}
