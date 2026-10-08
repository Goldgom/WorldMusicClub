/** Presentation windows only: source indices come from Rust or the admitted
 * engraving model. A staff inside a grand staff is never a separate row. */
export function notationMeasuresPerRow(width) {
  return width >= 1000 ? 4 : width >= 600 ? 2 : 1;
}
export function planNotationRows(systems, sourceMeasureIndex, {more=false,expectedRects=[]}={}) {
  if (!Array.isArray(systems) || !systems.length || !Number.isInteger(sourceMeasureIndex)) return null;
  if (systems.some(row => !Array.isArray(row.sourceMeasureIndices) || !row.sourceMeasureIndices.length
    || row.sourceMeasureIndices.some(index => !Number.isInteger(index) || index < 0))) return null;
  const candidates=systems.map((row,index)=>({row,index})).filter(({row})=>row.sourceMeasureIndices.includes(sourceMeasureIndex));
  const hit=candidates.find(({row})=>expectedRects.some(rect=>row.rect&&rect.top<row.rect.bottom&&rect.bottom>row.rect.top));
  const active=hit?.index??candidates[0]?.index??-1;
  if (active < 0) return null;
  const first = Math.min(active, Math.max(0, systems.length - 2));
  const rows = systems.slice(first, first + 2);
  const nextFrom = more && active === systems.length - 1 ? Math.min(...systems[active].sourceMeasureIndices) : null;
  return {active,first,rows,nextFrom};
}

/** Reveal whole adjacent systems, never individual heads. Height is allowed to
 * reflow the practice stage rather than clipping two systems to a 100px lane. */
export function revealNotationRows({systems,sourceMeasureIndex,viewport,stage,more=false,expectedRects=[],horizontalScroller=null}) {
  const plan=planNotationRows(systems,sourceMeasureIndex,{more,expectedRects});
  if(!plan||plan.rows.some(row=>!row.rect||!['top','bottom','left','right'].every(key=>Number.isFinite(row.rect[key]))))return null;
  const top=Math.min(...plan.rows.map(row=>row.rect.top)),bottom=Math.max(...plan.rows.map(row=>row.rect.bottom));
  const rect=viewport.getBoundingClientRect(),height=Math.ceil(bottom-top+24);
  if(height<=0)return null;
  // Keep paint at its readable size. The document can scroll on short screens;
  // controls are never covered by a fixed score panel.
  stage.style.setProperty('--notation-row-height',`${height}px`);
  viewport.dataset.notationRows=String(plan.rows.length);
  viewport.dataset.notationRow=String(plan.first);
  const scrollTop=Math.max(0,viewport.scrollTop+top-rect.top-12);
  if(Math.abs(viewport.scrollTop-scrollTop)>1)viewport.scrollTo?.({top:scrollTop,left:viewport.scrollLeft,behavior:'instant'});
  const stageRect=stage.getBoundingClientRect?.();
  let partial=plan.rows.some(row=>row.rect.right-row.rect.left>rect.width+1)||(stageRect&&height>stageRect.bottom-Math.max(stageRect.top,rect.top));
  if(horizontalScroller&&expectedRects.length){
    const target=expectedRects[0],left=rect.left+8,right=rect.right-8;
    const delta=target.left<left?target.left-left:target.right>right?target.right-right:0;
    if(delta)horizontalScroller.scrollTo?.({left:Math.max(0,horizontalScroller.scrollLeft+delta),top:horizontalScroller.scrollTop,behavior:'instant'});
  }
  viewport.dataset.notationRowOverflowX=String(partial);
  return {...plan,status:partial?'partial':'ready',height};
}
