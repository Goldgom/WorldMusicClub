const batches=new WeakMap();

/** Dimension observers only enqueue work. Every document reads its pending
 * piano budgets together in the next frame, then writes changed properties.
 * Owners prevent a disposed or replaced view from publishing stale geometry. */
export function createPianoBudgetUpdate({document,window=document.defaultView,property,measure}){
  const body=document.body;
  let batch=batches.get(body);
  if(!batch){
    const useFrames=typeof window.requestAnimationFrame==='function';
    batch={owners:new Map(),pending:new Set(),frame:null,
      request:callback=>useFrames?window.requestAnimationFrame(callback):setTimeout(callback,0),
      cancel:id=>useFrames?window.cancelAnimationFrame?.(id):clearTimeout(id)};
    batches.set(body,batch);
  }
  const owner={active:true,property,measure},previous=batch.owners.get(property);
  if(previous){previous.active=false;batch.pending.delete(previous);}
  batch.owners.set(property,owner);
  const current=item=>item.active&&document.body===body&&batch.owners.get(item.property)===item;
  function schedule(){
    if(!current(owner))return;
    batch.pending.add(owner);
    if(batch.frame!==null)return;
    const frame={id:null};batch.frame=frame;
    frame.id=batch.request(()=>{
      if(batch.frame!==frame)return;
      batch.frame=null;
      const pending=[...batch.pending];batch.pending.clear();
      const measured=pending.filter(current).map(item=>({item,value:item.measure()}));
      for(const {item,value}of measured){
        if(!current(item)||value===null||value===undefined)continue;
        if(body.style.getPropertyValue(item.property)!==value)body.style.setProperty(item.property,value);
      }
    });
  }
  function dispose(){
    if(!owner.active)return;owner.active=false;batch.pending.delete(owner);
    if(batch.owners.get(property)===owner){batch.owners.delete(property);if(document.body===body)body.style.removeProperty(property);}
    if(!batch.pending.size&&batch.frame!==null){batch.cancel(batch.frame.id);batch.frame=null;}
    if(!batch.owners.size)batches.delete(body);
  }
  return{schedule,dispose};
}
