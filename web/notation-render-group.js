/** Stack real independently admitted renderers without synthesizing a combined
 * native score, note map, or tie authorization. Mutable members let cancellation
 * dispose already-mounted parts while a later part is still rendering. */
export function createNotationRenderGroup(members){
  const mapped=()=>members.filter(member=>['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes'].every(key=>typeof member.renderer[key]==='function'));
  return{
    dispose(){for(const member of members){member.renderer.dispose?.();member.mount.remove?.();}members.length=0;},
    renderGeneration:()=>members.map(member=>member.renderer.renderGeneration?.()||'0').join(':'),
    mappingStatus(){const statuses=mapped().map(member=>member.renderer.mappingStatus()),verifiedGlyphCount=statuses.reduce((sum,item)=>sum+(item.verifiedGlyphCount||0),0),displayedSegmentCount=statuses.reduce((sum,item)=>sum+(item.displayedSegmentCount||0),0);return{status:statuses.length===members.length&&statuses.every(item=>item.status==='ready')?'ready':verifiedGlyphCount?'partial':'unavailable',verifiedGlyphCount,displayedSegmentCount,diagnostics:statuses.flatMap(item=>item.diagnostics||[])};},
    setExpectedWrittenNotes(value){let accepted=false;for(const member of mapped())accepted=member.renderer.setExpectedWrittenNotes({...value,sourceNoteIds:value.sourceNoteIds.filter(id=>member.noteIds.has(id))})||accepted;return accepted;},
    clearExpectedWrittenNotes(){for(const member of mapped())member.renderer.clearExpectedWrittenNotes();return true;},
    refreshExpectedCueGeometry(){for(const member of mapped())member.renderer.refreshExpectedCueGeometry?.();},
    expectedNoteBounds(){const results=members.flatMap(member=>typeof member.renderer.expectedNoteBounds==='function'?[member.renderer.expectedNoteBounds()]:[]),rects=results.flatMap(result=>result.rects||[]);return{status:rects.length?(results.every(result=>result.status==='ready')?'ready':'partial'):'unavailable',rects};},
  };
}
