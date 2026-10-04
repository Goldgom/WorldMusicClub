export const NOTATION_READABILITY=Object.freeze({jianpu:18,staff:7,minScale:.75});
const positive=value=>Number.isFinite(value)&&value>0;

/** Fit actual paint, never the full source. Once readable glyph size is reached,
 * retain scrollable music instead of squeezing an orchestra into a thumbnail. */
export function planNotationFit({width,height,contentWidth,contentHeight,glyphSize,mode='staff'}={}) {
  if(![width,height,contentWidth,contentHeight,glyphSize].every(positive)||!['staff','jianpu'].includes(mode))return {status:'unavailable',scale:1};
  const minimumGlyph=NOTATION_READABILITY[mode],minimumScale=Math.max(NOTATION_READABILITY.minScale,minimumGlyph/glyphSize);
  const idealScale=Math.min(1,width/contentWidth,height/contentHeight),scale=Math.max(minimumScale,idealScale);
  const paintedWidth=contentWidth*scale,paintedHeight=contentHeight*scale;
  return {status:paintedWidth>width+1||paintedHeight>height+1?'scroll':'fit',scale,minimumGlyph,glyphSize:glyphSize*scale,
    width:paintedWidth,height:paintedHeight,overflowX:paintedWidth>width+1,overflowY:paintedHeight>height+1,
    horizontalPages:Math.max(1,Math.ceil(paintedWidth/width)),verticalPages:Math.max(1,Math.ceil(paintedHeight/height))};
}

/** CSS zoom is confined to actual SVG paint, including nested part renderers. The unscaled surface
 * width stays stable for responsive engraving, exact SVG identities stay in
 * place, and native scrolling/reveal geometry uses the scaled painted bounds. */
export function setupNotationFit({viewport,getSurface,getReservedHeight=()=>0,onChange=()=>{},window=viewport.ownerDocument.defaultView}) {
  let frame=null,disposed=false,last='',surface=null,owned=new Map();
  const restoreNode=(node,style)=>{node.style.zoom=style.zoom;node.style.maxWidth=style.maxWidth;delete node.dataset.notationFitPaint;};
  const restore=()=>{for(const [node,style]of owned)restoreNode(node,style);owned.clear();};
  const schedule=()=>{if(disposed||frame!==null)return;frame=window.requestAnimationFrame?window.requestAnimationFrame(()=>{frame=null;refresh();}):setTimeout(()=>{frame=null;refresh();},0);};
  function refresh() {
    if(disposed)return;
    const next=viewport.hidden?null:getSurface();
    if(next!==surface){restore();surface=next;last='';}
    if(!surface)return;
    const paint=[...surface.querySelectorAll('svg')].filter(node=>!node.closest('[hidden]')&&!node.parentElement?.closest('svg'));
    let paintChanged=false;
    const activePaint=new Set(paint);for(const [node,style]of owned)if(!activePaint.has(node)){restoreNode(node,style);owned.delete(node);paintChanged=true;}
    for(const node of paint)if(!owned.has(node)){owned.set(node,{zoom:node.style.zoom||'',maxWidth:node.style.maxWidth||''});node.dataset.notationFitPaint='';node.style.maxWidth='none';paintChanged=true;}
    if(!paint.length){const plan={status:'unavailable',scale:1},signature=JSON.stringify(plan);viewport.dataset.notationFit=plan.status;viewport.dataset.notationScale='1';if(signature!==last){last=signature;onChange(plan);}return plan;}
    const rect=viewport.getBoundingClientRect(),surfaceRect=surface.getBoundingClientRect(),style=window.getComputedStyle?.(surface);
    const paddingX=(parseFloat(style?.paddingLeft)||0)+(parseFloat(style?.paddingRight)||0),paddingY=(parseFloat(style?.paddingTop)||0)+(parseFloat(style?.paddingBottom)||0);
    const widths=[],heights=[],glyphs=[];let mode='staff',paintedHeight=0;
    for(const node of paint){
      const zoom=Number(node.style.zoom)||1,bounds=node.getBoundingClientRect();
      widths.push(bounds.width/zoom);heights.push(bounds.height/zoom);paintedHeight+=bounds.height;
      const numbered=node.querySelector('.jianpu-note');if(numbered)mode='jianpu';
      const marks=numbered?[...node.querySelectorAll('.jianpu-note')]:[...node.querySelectorAll('.vf-notehead,.note-head')];
      for(const mark of marks){const box=mark.getBoundingClientRect();const size=numbered?parseFloat(window.getComputedStyle?.(mark)?.fontSize)||25:box.height/zoom;if(positive(size))glyphs.push(size);}
    }
    // Part headings, wrapper margins and quiet-part text stay at normal size.
    // Deduct their measured height instead of pretending it scales with SVGs.
    const unscaledHeight=Math.max(0,surfaceRect.height-paddingY-paintedHeight),reservedHeight=Math.max(0,getReservedHeight())+unscaledHeight;
    const plan=planNotationFit({width:Math.max(0,Math.min(rect.width,surfaceRect.width)-paddingX),height:Math.max(1,rect.height-paddingY-reservedHeight),
      contentWidth:Math.max(...widths),contentHeight:heights.reduce((sum,height)=>sum+height,0),glyphSize:glyphs.length?Math.min(...glyphs):mode==='jianpu'?25:10,mode});
    for(const node of paint){const scale=String(plan.scale);if(node.style.zoom!==scale){node.style.zoom=scale;paintChanged=true;}}
    viewport.dataset.notationFit=plan.status;viewport.dataset.notationScale=String(plan.scale);
    // A new page can have the same dimensions as its predecessor. Its separate
    // cue layer still needs the newly fitted paint coordinates exactly once.
    const signature=JSON.stringify(plan);if(signature!==last||paintChanged){last=signature;onChange(plan);}
    return plan;
  }
  const mutation=window.MutationObserver?new window.MutationObserver(schedule):null;
  mutation?.observe(viewport,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','width','height','viewBox']});
  const resize=window.ResizeObserver?new window.ResizeObserver(schedule):null;resize?.observe(viewport);
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  schedule();
  return {refresh:schedule,measure:refresh,destroy(){disposed=true;mutation?.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);if(frame!==null){if(window.cancelAnimationFrame)window.cancelAnimationFrame(frame);else clearTimeout(frame);}restore();delete viewport.dataset.notationFit;delete viewport.dataset.notationScale;}};
}
