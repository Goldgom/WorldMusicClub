/* Bounded passive receipt for the original seed/bulk file action. This observer
 * never stops propagation, prevents default, moves/focuses a control, sends
 * input, waits for a response, or treats missing/delayed receipts as failure. */
function createNativePickerObservation({document,fetcher,sequence,node,now=()=>performance.now(),utcNow=()=>Date.now()}) {
 const allowed=['import-button','free-import-file'];
 if(!allowed.includes(node?.id))return{stop(){}};
 const id=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value)?value:null;
 const tag=value=>typeof value==='string'&&/^[A-Z][A-Z0-9]{0,15}$/.test(value)?value:null;
 let sent=0,active=true;
 const observe=event=>{
  if(!active||sent>=6)return;
  try {
   const bounds=node.getBoundingClientRect(),hit=document.elementFromPoint(event.clientX,event.clientY),target=event.target;
   const receipt={version:1,sequence,event:event.type,expected_id:node.id,trusted:event.isTrusted===true,target_id:id(target?.id),target_tag:tag(target?.tagName),expected_connected:node.isConnected===true,expected_disabled:node.disabled===true,expected_hit:hit===node||Boolean(hit&&node.contains(hit)),target_matches:target===node||Boolean(target&&node.contains(target)),x:event.clientX,y:event.clientY,bounds:[bounds.x,bounds.y,bounds.width,bounds.height],viewport:[document.defaultView.innerWidth,document.defaultView.innerHeight],renderer_time_ms:now(),utc_ms:utcNow()};
   sent++;
   // The host binds this metadata to its already-persisted picker action.
   // Its receipt time can be later than this event when a native modal blocks
   // delivery; neither timestamp is a substitute for the trusted flag.
   void fetcher('/__desktop_smoke/picker-observation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(receipt)}).catch(()=>{});
  } catch {/* Observation must not interfere with the original event dispatch. */}
 };
 for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,observe,{capture:true,passive:true});
 return{stop(){if(!active)return;active=false;for(const type of ['pointerdown','pointerup','click'])document.removeEventListener(type,observe,true);}};
}
