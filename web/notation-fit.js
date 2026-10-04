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

/** CSS zoom is confined to renderer-owned paint children. The unscaled surface
 * width stays stable for responsive engraving, exact SVG identities stay in
 * place, and native scrolling/reveal geometry uses the scaled painted bounds. */
export function setupNotationFit({viewport,getSurface,getReservedHeight=()=>0,onChange=()=>{},window=viewport.ownerDocument.defaultView}) {
  let frame=null,disposed=false,last='',surface=null,owned=new Map();
  const restore=()=>{for(const [node,style]of owned){node.style.zoom=style.zoom;node.style.maxWidth=style.maxWidth;delete node.dataset.notationFitPaint;}owned.clear();};
  const schedule=()=>{if(disposed||frame!==null)return;frame=window.requestAnimationFrame?window.requestAnimationFrame(()=>{frame=null;refresh();}):setTimeout(()=>{frame=null;refresh();},0);};
  function refresh() {
    if(disposed)return;
    const next=viewport.hidden?null:getSurface();
    if(next!==surface){restore();surface=next;last='';}
    if(!surface)return;
    const paint=[...surface.children].filter(node=>!node.hidden&&(node.tagName?.toLowerCase()==='svg'||node.querySelector('svg')));
    for(const node of paint)if(!owned.has(node)){owned.set(node,{zoom:node.style.zoom||'',maxWidth:node.style.maxWidth||''});node.dataset.notationFitPaint='';node.style.maxWidth='none';}
    if(!paint.length)return;
    const rect=viewport.getBoundingClientRect(),surfaceRect=surface.getBoundingClientRect(),style=window.getComputedStyle?.(surface);
    const paddingX=(parseFloat(style?.paddingLeft)||0)+(parseFloat(style?.paddingRight)||0),paddingY=(parseFloat(style?.paddingTop)||0)+(parseFloat(style?.paddingBottom)||0);
    const widths=[],heights=[],glyphs=[];let mode='staff';
    for(const node of paint){
      const zoom=Number(node.style.zoom)||1,bounds=node.getBoundingClientRect();
      widths.push(bounds.width/zoom);heights.push(bounds.height/zoom);
      const numbered=node.querySelector('.jianpu-note');if(numbered)mode='jianpu';
      const marks=numbered?[...node.querySelectorAll('.jianpu-note')]:[...node.querySelectorAll('.vf-notehead,.note-head')];
      for(const mark of marks){const box=mark.getBoundingClientRect();const size=numbered?parseFloat(window.getComputedStyle?.(mark)?.fontSize)||25:box.height/zoom;if(positive(size))glyphs.push(size);}
    }
    const reservedHeight=Math.max(0,getReservedHeight());
    const plan=planNotationFit({width:Math.max(0,Math.min(rect.width,surfaceRect.width)-paddingX),height:Math.max(1,rect.height-paddingY-reservedHeight),
      contentWidth:Math.max(...widths),contentHeight:heights.reduce((sum,height)=>sum+height,0),glyphSize:glyphs.length?Math.min(...glyphs):mode==='jianpu'?25:10,mode});
    for(const node of paint){const scale=String(plan.scale);if(node.style.zoom!==scale)node.style.zoom=scale;}
    viewport.dataset.notationFit=plan.status;viewport.dataset.notationScale=String(plan.scale);
    const signature=JSON.stringify(plan);if(signature!==last){last=signature;onChange(plan);}
    return plan;
  }
  const mutation=window.MutationObserver?new window.MutationObserver(schedule):null;
  mutation?.observe(viewport,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','width','height','viewBox']});
  const resize=window.ResizeObserver?new window.ResizeObserver(schedule):null;resize?.observe(viewport);
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  schedule();
  return {refresh:schedule,measure:refresh,destroy(){disposed=true;mutation?.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);if(frame!==null){if(window.cancelAnimationFrame)window.cancelAnimationFrame(frame);else clearTimeout(frame);}restore();delete viewport.dataset.notationFit;delete viewport.dataset.notationScale;}};
}
