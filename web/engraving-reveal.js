/** Presentation geometry only. Rust supplies identities and all musical time. */
export function planEngravingReveal(rects,viewport){
  const fields=['left','right','top','bottom','scrollTop','scrollLeft','maxTop','maxLeft'];
  if(!Array.isArray(rects)||!rects.length||!fields.every(key=>Number.isFinite(viewport?.[key]))||viewport.right<=viewport.left||viewport.bottom<=viewport.top)return null;
  if(rects.some(rect=>!['left','right','top','bottom'].every(key=>Number.isFinite(rect?.[key]))||rect.right<=rect.left||rect.bottom<=rect.top))return null;
  const ordered=[...rects].sort((a,b)=>a.top-b.top||a.left-b.left||(a.xmlNoteId<b.xmlNoteId?-1:a.xmlNoteId>b.xmlNoteId?1:0));
  const width=viewport.right-viewport.left,height=viewport.bottom-viewport.top;
  const union={left:Math.min(...rects.map(rect=>rect.left)),right:Math.max(...rects.map(rect=>rect.right)),top:Math.min(...rects.map(rect=>rect.top)),bottom:Math.max(...rects.map(rect=>rect.bottom))};
  const partial=union.right-union.left>width||union.bottom-union.top>height;
  // An oversized simultaneous group has no single fully visible position. Reveal
  // its topmost verified head deterministically and report the limited view.
  const target=partial?ordered[0]:union;
  // Keep context around a head when space permits, but never exclude another
  // verified head merely to retain decorative padding around the group.
  const delta=(start,end,low,high)=>{const margin=Math.max(0,Math.min(12,(high-low)/4,(high-low-(end-start))/2));return start<low+margin?start-low-margin:end>high-margin?end-high+margin:0};
  const clamp=(value,max)=>Math.max(0,Math.min(Math.max(0,max),value));
  const scrollTop=clamp(viewport.scrollTop+delta(target.top,target.bottom,viewport.top,viewport.bottom),viewport.maxTop),scrollLeft=clamp(viewport.scrollLeft+delta(target.left,target.right,viewport.left,viewport.right),viewport.maxLeft);
  const dx=scrollLeft-viewport.scrollLeft,dy=scrollTop-viewport.scrollTop;
  return {scrollTop,scrollLeft,partial:partial||target.left-dx<viewport.left||target.right-dx>viewport.right||target.top-dy<viewport.top||target.bottom-dy>viewport.bottom};
}
