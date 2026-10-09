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

/** Explicit SVG sizes scale actual paint, including nested part renderers. The unscaled surface
 * width stays stable for responsive engraving, exact SVG identities stay in
 * place, and native scrolling/reveal geometry uses the scaled painted bounds. */
export function setupNotationFit({viewport,getSurface,getReservedHeight=()=>0,onChange=()=>{},window=viewport.ownerDocument.defaultView}) {
  let frame=null,disposed=false,last='',surface=null,owned=new Map();
  const restoreNode=(node,style)=>{node.style.width=style.width;node.style.height=style.height;node.style.maxWidth=style.maxWidth;delete node.dataset.notationFitPaint;};
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
    for(const node of paint)if(!owned.has(node)){owned.set(node,{width:node.style.width||'',height:node.style.height||'',maxWidth:node.style.maxWidth||'',scale:1});node.dataset.notationFitPaint='';node.style.maxWidth='none';paintChanged=true;}
    if(!paint.length){const plan={status:'unavailable',scale:1},signature=JSON.stringify(plan);viewport.dataset.notationFit=plan.status;viewport.dataset.notationScale='1';if(signature!==last){last=signature;onChange(plan);}return plan;}
    const rect=viewport.getBoundingClientRect(),surfaceRect=surface.getBoundingClientRect(),style=window.getComputedStyle?.(surface);
    const paddingX=(parseFloat(style?.paddingLeft)||0)+(parseFloat(style?.paddingRight)||0),paddingY=(parseFloat(style?.paddingTop)||0)+(parseFloat(style?.paddingBottom)||0);
    const widths=[],heights=[],glyphs=[];let mode='staff',paintedHeight=0;
    for(const node of paint){
      const scale=owned.get(node).scale,bounds=node.getBoundingClientRect();
      widths.push(bounds.width/scale);heights.push(bounds.height/scale);paintedHeight+=bounds.height;
      const numbered=node.querySelector('.jianpu-note');if(numbered)mode='jianpu';
      const marks=numbered?[...node.querySelectorAll('.jianpu-note')]:[...node.querySelectorAll('.vf-notehead,.note-head')];
      for(const mark of marks){const box=mark.getBoundingClientRect();const size=numbered?parseFloat(window.getComputedStyle?.(mark)?.fontSize)||25:box.height/scale;if(positive(size))glyphs.push(size);}
    }
    // Part headings, wrapper margins and quiet-part text stay at normal size.
    // Deduct their measured height instead of pretending it scales with SVGs.
    const unscaledHeight=Math.max(0,surfaceRect.height-paddingY-paintedHeight),reservedHeight=Math.max(0,getReservedHeight())+unscaledHeight;
    let plan=planNotationFit({width:Math.max(0,Math.min(rect.width,surfaceRect.width)-paddingX),height:Math.max(1,rect.height-paddingY-reservedHeight),
      contentWidth:Math.max(...widths),contentHeight:heights.reduce((sum,height)=>sum+height,0),glyphSize:glyphs.length?Math.min(...glyphs):mode==='jianpu'?25:10,mode});
    if(viewport.dataset.notationRows)plan={...plan,scale:1,status:'rows',glyphSize:glyphs.length?Math.min(...glyphs):mode==='jianpu'?25:10};
    // Old Android WebView reports pre-zoom SVG rectangles while painting zoomed
    // glyphs. Resizing the SVG viewport keeps fitting and note reveal in the same
    // coordinate system on both old and current engines.
    for(const [index,node]of paint.entries()){
      const width=`${widths[index]*plan.scale}px`,height=`${heights[index]*plan.scale}px`;
      if(node.style.width!==width||node.style.height!==height){node.style.width=width;node.style.height=height;paintChanged=true;}
      owned.get(node).scale=plan.scale;
    }
    viewport.dataset.notationFit=plan.status;viewport.dataset.notationScale=String(plan.scale);
    // A new page can have the same dimensions as its predecessor. Its separate
    // cue layer still needs the newly fitted paint coordinates exactly once.
    // At the readable scale floor, a smaller lane can have the exact same fit
    // result and page counts. Its clipping edges still invalidate a cached
    // current-note reveal, including while paused between playback frames.
    const signature=JSON.stringify([plan,rect.left,rect.top,rect.width,rect.height,viewport.clientWidth,viewport.clientHeight]);
    if(signature!==last||paintChanged){last=signature;onChange(plan);}
    return plan;
  }
  // Current-note outlines are an absolute, pointer-inert layer outside SVG.
  // Their visibility never changes music dimensions and must not refit every
  // notehead on each attack. Structural paint and real surface changes still fit.
  const onlyCueVisibility=record=>record.type==='attributes'&&record.attributeName==='hidden'
    &&record.target?.classList?.contains('engraving-expected-cue')
    &&record.target.parentElement?.classList?.contains('engraving-expected-cues');
  const mutation=window.MutationObserver?new window.MutationObserver(records=>{if(records.some(record=>!onlyCueVisibility(record)))schedule();}):null;
  mutation?.observe(viewport,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','width','height','viewBox']});
  const resize=window.ResizeObserver?new window.ResizeObserver(schedule):null;resize?.observe(viewport);
  window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  schedule();
  return {refresh:schedule,measure:refresh,destroy(){disposed=true;mutation?.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);if(frame!==null){if(window.cancelAnimationFrame)window.cancelAnimationFrame(frame);else clearTimeout(frame);}restore();delete viewport.dataset.notationFit;delete viewport.dataset.notationScale;}};
}
