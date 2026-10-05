/** One next-page batch beside the renderer's current batch. Replacements abort
 * old work; a late old response can never become the next page of a new scope. */
export class NotationPagePrefetch {
  constructor({dispose=()=>{}}={}){this.slot=null;this.version=0;this.dispose=dispose;}
  clear(){this.version++;const slot=this.slot;this.slot=null;slot?.controller.abort();if(slot?.value)this.dispose(slot.value);}
  prime(key,metadata,load){
    if(this.slot?.key===key)return this.slot.promise;
    this.clear();const version=this.version,controller=new AbortController(),slot={key,metadata,controller,value:null,error:null,promise:null};this.slot=slot;
    slot.promise=Promise.resolve().then(()=>controller.signal.aborted?null:load(controller.signal)).then(value=>{if(version!==this.version||controller.signal.aborted){if(value)this.dispose(value);return null;}slot.value=value;return value;},error=>{if(version===this.version&&!controller.signal.aborted)slot.error=error;return null;});return slot.promise;
  }
  async take(key){const slot=this.slot;if(slot?.key!==key)return null;const value=slot.value||await slot.promise;if(this.slot!==slot||slot.controller.signal.aborted)return null;this.slot=null;return value;}
  peek(){return this.slot;}
}
