/** Stack real independently admitted renderers without synthesizing a combined
 * native score, note map, or tie authorization. Mutable members let cancellation
 * dispose already-mounted parts while a later part is still rendering. */
export function createNotationRenderGroup(members){
  const mapped=()=>members.filter(member=>['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes'].every(key=>typeof member.renderer[key]==='function'));
  return{
    dispose(){for(const member of members){member.renderer.dispose?.();member.mount.remove?.();member.rowMount?.remove?.();}members.length=0;},
    systemLayout(){
      const rows=new Map();
      for(const member of members){
        if(member.rowMount){
          const box=member.rowMount.getBoundingClientRect(),rects=[box,...(member.renderer.systemLayout?.()?.systems||[]).map(row=>row.rect)].filter(Boolean),previous=rows.get(member.rowIndex);if(previous)rects.push(previous.rect);
          const rect={left:Math.min(...rects.map(rect=>rect.left)),right:Math.max(...rects.map(rect=>rect.right)),top:Math.min(...rects.map(rect=>rect.top)),bottom:Math.max(...rects.map(rect=>rect.bottom))};
          rows.set(member.rowIndex,{index:member.rowIndex,sourceMeasureIndices:member.sourceMeasureIndices,rect});
        }
        else {for(const row of member.renderer.systemLayout?.()?.systems||[])rows.set(rows.size,{...row,index:rows.size});}
      }
      return {status:rows.size?'ready':'unavailable',systems:[...rows.values()]};
    },
    renderGeneration:()=>members.map(member=>member.renderer.renderGeneration?.()||'0').join(':'),
    mappingStatus(){const statuses=mapped().map(member=>member.renderer.mappingStatus()),verifiedGlyphCount=statuses.reduce((sum,item)=>sum+(item.verifiedGlyphCount||0),0),displayedSegmentCount=statuses.reduce((sum,item)=>sum+(item.displayedSegmentCount||0),0);return{status:statuses.length===members.length&&statuses.every(item=>item.status==='ready')?'ready':verifiedGlyphCount?'partial':'unavailable',verifiedGlyphCount,displayedSegmentCount,diagnostics:statuses.flatMap(item=>item.diagnostics||[])};},
    setExpectedWrittenNotes(value){let accepted=false;for(const member of mapped()){
      if(member.sourceMeasureIndices&&!member.sourceMeasureIndices.includes(value.sourceMeasureIndex)){member.renderer.clearExpectedWrittenNotes();continue;}
      accepted=member.renderer.setExpectedWrittenNotes({...value,sourceMeasureIndex:value.sourceMeasureIndex-(member.sourceMeasureOffset||0),sourceNoteIds:value.sourceNoteIds.filter(id=>member.noteIds.has(id))})||accepted;
    }return accepted;},
    clearExpectedWrittenNotes(){for(const member of mapped())member.renderer.clearExpectedWrittenNotes();return true;},
    refreshExpectedCueGeometry(){for(const member of mapped())member.renderer.refreshExpectedCueGeometry?.();},
    expectedNoteBounds(){const results=members.flatMap(member=>typeof member.renderer.expectedNoteBounds==='function'?[member.renderer.expectedNoteBounds()]:[]),rects=results.flatMap(result=>result.rects||[]);return{status:rects.length?(results.every(result=>result.status==='ready')?'ready':'partial'):'unavailable',rects};},
  };
}
