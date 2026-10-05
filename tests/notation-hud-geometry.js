import assert from 'node:assert/strict';

// Clipping visibility alone misses a sibling HUD painted over an exact cue.
// These are actual UI panels, including pointer-inert ones; the intentional
// falling-note canvas and the notation ink are not HUD occluders.
export async function readNotationHudGeometry(page,selector){
  return page.evaluate(selector=>{
    const rect=node=>{
      const box=node.getBoundingClientRect(),clip={left:Math.max(0,box.left),top:Math.max(0,box.top),right:Math.min(innerWidth,box.right),bottom:Math.min(innerHeight,box.bottom)};
      let painted=box.width>0&&box.height>0;
      for(let parent=node;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)painted=false;
        if(parent instanceof SVGElement&&!(parent instanceof SVGSVGElement))continue;
        const bounds=parent.getBoundingClientRect(),html=parent instanceof HTMLElement,left=bounds.left+(html?parent.clientLeft:0),top=bounds.top+(html?parent.clientTop:0);
        if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)){clip.left=Math.max(clip.left,left);clip.right=Math.min(clip.right,html?left+parent.clientWidth:bounds.right);}
        if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)){clip.top=Math.max(clip.top,top);clip.bottom=Math.min(clip.bottom,html?top+parent.clientHeight:bounds.bottom);}
      }
      return{painted,rect:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},visible:clip};
    };
    const panels=[...document.querySelectorAll('.performance-status-copy,.onset-counter,#hud-result,.performance-hint,#stage-cue')].map(node=>({id:node.id||node.className,text:node.textContent.trim(),...rect(node)}));
    const targets=[...document.querySelectorAll(selector)].map(node=>({id:node.dataset.sourceNoteId||node.dataset.noteId,...rect(node)}));
    const status=document.querySelector('.performance-status'),cue=document.querySelector('#stage-cue');
    return{viewport:{width:innerWidth,height:innerHeight},locale:document.documentElement.lang,phase:status.dataset.phase,cueState:cue.dataset.cueState||null,status:rect(status),targets,panels};
  },selector);
}

export function assertNotationHudClear(proof){
  assert.ok(proof.targets.length,'Current notation must exist before testing HUD occlusion');
  assert.ok(proof.status?.painted,'The original performance status remains visible');
  for(const item of [proof.status,...proof.panels.filter(panel=>panel.painted)]){
    const a=item.rect,b=item.visible;
    assert.ok(b.left<=a.left+1&&b.top<=a.top+1&&b.right>=a.right-1&&b.bottom>=a.bottom-1,`HUD ${item.id||'status row'} stays fully readable: ${JSON.stringify(item)}`);
  }
  for(const target of proof.targets.filter(item=>item.painted))for(const panel of proof.panels.filter(item=>item.painted)){
    const a=target.visible,b=panel.visible,width=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),height=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    assert.ok(width*height<.5,`HUD ${panel.id} overlaps current notation ${target.id}: ${JSON.stringify({target,panel,overlap:{width,height},viewport:proof.viewport,locale:proof.locale,phase:proof.phase,cueState:proof.cueState})}`);
  }
}
