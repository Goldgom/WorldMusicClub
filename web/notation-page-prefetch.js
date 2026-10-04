/** One next-page batch beside the renderer's current batch. Replacements abort
 * old work; a late old response can never become the next page of a new scope. */
export class NotationPagePrefetch {
  constructor(){this.slot=null;this.version=0;}
  clear(){this.version++;this.slot?.controller.abort();this.slot=null;}
  prime(key,metadata,load){
    if(this.slot?.key===key)return this.slot.promise;
    this.clear();const version=this.version,controller=new AbortController(),slot={key,metadata,controller,value:null,error:null,promise:null};this.slot=slot;
    slot.promise=Promise.resolve().then(()=>load(controller.signal)).then(value=>{if(version!==this.version||controller.signal.aborted)return null;slot.value=value;return value;},error=>{if(version===this.version&&!controller.signal.aborted)slot.error=error;return null;});return slot.promise;
  }
  async take(key){const slot=this.slot;if(slot?.key!==key)return null;const value=slot.value||await slot.promise;if(this.slot!==slot||slot.controller.signal.aborted)return null;this.slot=null;return value;}
  peek(){return this.slot;}
}
