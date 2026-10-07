/** Runs in the browser through Locator.evaluateAll. Only generated boxes can
 * clip descendants; display:contents keeps inherited paint rules but has no
 * principal box, even when an earlier layout leaves overflow:auto computed. */
export function browserMarkerVisibility(nodes) {
  return nodes.map(node=>{
    const r=node.getBoundingClientRect(),clip={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};
    const clippingAncestors=[],boxlessAncestors=[];
    const identity=element=>element.id?`#${element.id}`:element.tagName.toLowerCase();
    let painted=true;
    for(let parent=node;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)painted=false;
      if(style.display==='contents'){
        boxlessAncestors.push({element:identity(parent),display:style.display,overflowX:style.overflowX,overflowY:style.overflowY});
        continue;
      }
      if(parent instanceof SVGElement&&!(parent instanceof SVGSVGElement))continue;
      const box=parent.getBoundingClientRect(),html=parent instanceof HTMLElement;
      const left=box.left+(html?parent.clientLeft:0),top=box.top+(html?parent.clientTop:0);
      const right=html?left+parent.clientWidth:box.right,bottom=html?top+parent.clientHeight:box.bottom;
      const clipsX=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX),clipsY=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
      if(clipsX){clip.left=Math.max(clip.left,left);clip.right=Math.min(clip.right,right)}
      if(clipsY){clip.top=Math.max(clip.top,top);clip.bottom=Math.min(clip.bottom,bottom)}
      if(clipsX||clipsY)clippingAncestors.push({element:identity(parent),display:style.display,overflowX:style.overflowX,overflowY:style.overflowY,rect:{left,top,right,bottom}});
    }
    const fraction=r.width*r.height>0?Math.max(0,clip.right-clip.left)*Math.max(0,clip.bottom-clip.top)/(r.width*r.height):0;
    return{id:node.dataset.noteId,occurrences:node.dataset.occurrenceIds?JSON.parse(node.dataset.occurrenceIds):[],string:node.dataset.string,text:node.textContent,painted,fraction,width:r.width,height:r.height,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},visibleRect:clip,clippingAncestors,boxlessAncestors};
  });
}
