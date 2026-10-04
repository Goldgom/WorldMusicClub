/** Notation scope never changes practice targets, routing, mute or solo. A
 * missing current part is a choice to make, not permission to pick the first. */
export function resolveNotationScope({parts=[],scope='current',practicePartId=null,selectedPartId=null}={}) {
  const ids=parts.map(part=>part.id);
  if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw new TypeError('Notation parts must have unique source IDs.');
  if(!['current','all','part'].includes(scope))throw new TypeError('Unknown notation scope.');
  const partId=scope==='current'?practicePartId:scope==='part'?selectedPartId:null;
  const partIds=scope==='all'?ids:ids.includes(partId)?[partId]:[];
  return {scope,partId,partIds,totalParts:ids.length,status:!ids.length?'empty':partIds.length?'ready':scope==='current'?'choose_current_part':'choose_part'};
}

/** Bound the amount of notation in memory without mislabelling a subset All.
 * Every source part is reachable through the returned part-page inventory. */
export function planNotationPartBatch(partIds,{firstPart=0,maxParts=4}={}) {
  if(!Array.isArray(partIds)||partIds.some(id=>typeof id!=='string'||!id)||new Set(partIds).size!==partIds.length
    ||!Number.isInteger(maxParts)||maxParts<1||maxParts>16||!Number.isInteger(firstPart)||firstPart<0)throw new TypeError('Invalid notation part page.');
  const totalParts=partIds.length,partPages=Math.ceil(totalParts/maxParts);
  firstPart=totalParts?Math.min(Math.floor(firstPart/maxParts),partPages-1)*maxParts:0;
  const selected=partIds.slice(firstPart,firstPart+maxParts);
  return {partIds:selected,totalParts,firstPart,lastPart:firstPart+selected.length,partPage:totalParts?Math.floor(firstPart/maxParts)+1:0,partPages,
    previousPart:firstPart?Math.max(0,firstPart-maxParts):null,nextPart:firstPart+maxParts<totalParts?firstPart+maxParts:null};
}

function pageTargets(page) {
  // Native v2 pages retain every interpreted target, including instantaneous
  // and unresolved events; v1 uses the three disjoint source-attack classes.
  if(Array.isArray(page.interpreted_notes))return page.interpreted_notes.length;
  return (page.score?.parts||[]).reduce((sum,part)=>sum+(part.notes?.length||0),0)+(page.unresolved?.length||0)+(page.instantaneous?.length||0);
}

/** requestPage must return a page already checked against its own native
 * source, policy and part. Never merge pages into a synthetic score identity.
 * Callers retain source measure/position anchors when retrying a smaller view. */
export async function loadNotationPartBatch({partIds,firstPart=0,maxParts=4,measureCount=8,maxTargets=2048,requestPage,signal}={}) {
  if(!Number.isInteger(measureCount)||measureCount<1||measureCount>32||!Number.isInteger(maxTargets)||maxTargets<1||maxTargets>2048||typeof requestPage!=='function')throw new TypeError('Invalid notation batch bounds.');
  const batch=planNotationPartBatch(partIds,{firstPart,maxParts}),requestedMeasureCount=measureCount;
  if(!batch.partIds.length)return {...batch,pages:[],measureCount,requestedMeasureCount,targetCount:0,status:'empty'};
  for(;;) {
    signal?.throwIfAborted();
    // At most four default native requests are outstanding; all settle before
    // another window is requested, and rejection cannot leak partial pages.
    const responses=await Promise.allSettled(batch.partIds.map(partId=>requestPage(partId,{measureCount,signal})));
    signal?.throwIfAborted();
    const failed=responses.find(response=>response.status==='rejected');if(failed)throw failed.reason;
    const pages=responses.map(response=>response.value);
    if(pages.some((page,index)=>page?.part_id!==batch.partIds[index]))throw new TypeError('Notation batch contains the wrong source part.');
    const targetCount=pages.reduce((sum,page)=>sum+pageTargets(page),0);
    if(pages.some(page=>page.status==='page_limit')||targetCount>maxTargets) {
      if(measureCount>1){measureCount=Math.max(1,Math.floor(measureCount/2));continue;}
      return {...batch,pages:[],measureCount,requestedMeasureCount,targetCount,status:'page_limit'};
    }
    const quietClock=page=>page.status==='empty_page'&&Array.isArray(page.measures)&&page.measures.length>0&&Number.isFinite(page.source_start_ms)&&Number.isFinite(page.follow_end_ms)&&page.follow_end_ms>page.source_start_ms;
    const ready=pages.filter(page=>['ready','percussion_selectors','onset_page'].includes(page.status)||quietClock(page));
    const paintable=pages.filter(page=>['ready','percussion_selectors','onset_page','rendering_unavailable'].includes(page.status)||quietClock(page));
    return {...batch,pages,measureCount,requestedMeasureCount,targetCount,status:ready.length===pages.length?'ready':paintable.length?'partial':'unavailable'};
  }
}
