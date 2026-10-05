import {createNotationRenderGroup} from './notation-render-group.js';

export const NOTATION_PREPARATION_LIMITS = Object.freeze({parts:4,targets:2048,segments:4096,xmlBytes:2*1024*1024,mapBytes:2*1024*1024});
/** Speculation has a tighter aggregate budget than foreground admission. A
 * refusal changes scheduling only; the complete page still uses ordinary OSMD.
 * Existing adapter limits separately count generated rests and full tie context.
 */
export function notationPreparationWithinBudget(exported) {
  const batch=exported?.basicBatch,pages=exported?.basicPages,limits=NOTATION_PREPARATION_LIMITS;
  if(!batch||!['ready','partial'].includes(batch.status)||!Array.isArray(pages)||!pages.length||pages.length>limits.parts||!Number.isInteger(batch.targetCount)||batch.targetCount<0||batch.targetCount>limits.targets)return false;
  let xmlBytes=0,mapBytes=0,segments=0;
  for(const page of pages){
    if(page.view_version!==2)return false;
    if(!page.musicxml)continue;
    const xml=page.musicxml.xml,map=page.musicxml.note_id_map;
    if(typeof xml!=='string'||!Array.isArray(map?.segments))return false;
    segments+=map.segments.length;if(segments>limits.segments||xml.length>limits.xmlBytes-xmlBytes)return false;
    xmlBytes+=new TextEncoder().encode(xml).byteLength;
    const serialized=JSON.stringify(map);if(serialized.length>limits.mapBytes-mapBytes)return false;
    mapBytes+=new TextEncoder().encode(serialized).byteLength;
    if(xmlBytes>limits.xmlBytes||mapBytes>limits.mapBytes)return false;
  }
  return true;
}

/** Own exactly one already-admitted native batch, including partial construction.
 * These are the same renderer-owned nodes later moved into the live surface.
 * Keep layout measurable for OSMD/binding, but outside the current surface and
 * its fit observer, clipped offscreen, inert and absent from accessibility.
 * No expected-note update or geometry publication is allowed before adoption.
 */
export async function prepareNotationBatch({document, width, pages, signal, isCurrent, needsEngraving, renderPage, quietPart}) {
  if (!Number.isFinite(width) || width < 320 || width > 4096 || !pages.length || pages.length > 4) throw new TypeError('Invalid prepared notation batch bounds.');
  signal.throwIfAborted();
  const root = document.createElement('div'), members = [], mounts = [];
  root.dataset.notationPreparation = '';
  root.setAttribute('aria-hidden', 'true'); root.inert = true;
  root.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:1px;overflow:hidden;pointer-events:none;contain:layout style paint`;
  const group = createNotationRenderGroup(members);
  let disposed = false, active = false;
  const current = () => !disposed && !signal.aborted && isCurrent();
  function dispose() {
    if (disposed) return;
    disposed = true; active = false;
    signal.removeEventListener('abort', dispose);
    try { group.dispose(); } finally { root.remove(); }
  }
  const renderer = {...group, dispose,
    setExpectedWrittenNotes: value => active && group.setExpectedWrittenNotes(value),
    refreshExpectedCueGeometry: () => active && group.refreshExpectedCueGeometry(),
    expectedNoteBounds: () => active ? group.expectedNoteBounds() : {status:'unavailable',rects:[]},
  };
  signal.addEventListener('abort', dispose, {once:true});
  document.body.append(root);
  try {
    for (const page of pages) {
      if (!current()) { dispose(); return null; }
      const mount = document.createElement('div');
      mount.className = 'notation-part-render'; mount.dataset.notationPartId = page.part_id;
      root.append(mount); mounts.push(mount);
      if (!needsEngraving(page)) {
        quietPart(mount, page);
        members.push({mount,noteIds:new Set(),renderer:{dispose(){mount.remove();},mappingStatus:()=>({status:'ready',verifiedGlyphCount:0,displayedSegmentCount:0,diagnostics:[]}),setExpectedWrittenNotes:()=>true,clearExpectedWrittenNotes:()=>true}});
        continue;
      }
      const result = await renderPage(mount, page, signal);
      if (!current()) { result.dispose?.(); dispose(); return null; }
      if (!result.ok) { result.dispose?.(); throw result; }
      members.push({mount,renderer:result,noteIds:new Set(page.score.parts[0].notes.map(note=>note.id))});
    }
    if (!current()) { dispose(); return null; }
    return {renderer,dispose,get active(){return active;},
      activate(container) {
        if (active || !current()) { dispose(); return false; }
        try {
          container.replaceChildren(...mounts); root.remove();
          group.refreshExpectedCueGeometry();
          active = true;
          return true;
        } catch (error) { dispose(); throw error; }
      },
    };
  } catch (error) { dispose(); throw error; }
}
