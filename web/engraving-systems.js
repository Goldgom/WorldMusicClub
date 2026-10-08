/** OSMD presentation only. A system contains every simultaneous staff, including
 * both halves of a grand staff. Neither staff lines nor notehead y positions
 * define a musical row. All measure identities arrive from the admitted model. */
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>Number.isFinite(value);
const unavailable=()=>({status:'unavailable',systems:[]});

function modelCoordinates(renderer,coordinates){
  const measures=renderer?.Sheet?.SourceMeasures;
  if(!Array.isArray(measures)||!Array.isArray(coordinates)||!measures.length||measures.length!==coordinates.length||new Set(measures).size!==measures.length)return null;
  if(coordinates.some(value=>!integer(value?.sourceMeasureIndex)))return null;
  return new Map(measures.map((measure,index)=>[measure,{...coordinates[index],modelMeasureIndex:index}]));
}

/** Add line breaks to the disposable OSMD model, never the source XML or score.
 * Fragment models can contain many pieces of one source bar: only its first
 * fragment may acquire a requested source-measure boundary. Natural dense-music
 * line breaks remain OSMD's responsibility and are reported by systemLayout. */
export function applyEngravingSystemBreaks(renderer,coordinates,{fromMeasure=1,toMeasure,measuresPerRow}={}){
  if(!Number.isInteger(measuresPerRow)||measuresPerRow<1||measuresPerRow>64||!Number.isInteger(fromMeasure)||fromMeasure<1||!Number.isInteger(toMeasure)||toMeasure<fromMeasure)return false;
  const mapped=modelCoordinates(renderer,coordinates);
  if(!mapped||!renderer.EngravingRules)return false;
  let previous=null;
  for(const [measure,coordinate]of mapped){
    const index=coordinate.sourceMeasureIndex;
    if(index!==previous&&index>=fromMeasure&&index<toMeasure&&(index-(fromMeasure-1))%measuresPerRow===0)measure.printNewSystemXml=true;
    previous=index;
  }
  renderer.EngravingRules.NewSystemAtXMLNewSystemAttribute=true;
  return true;
}

function systemRect(system,svg,unit){
  const box=system?.PositionAndShape,position=box?.AbsolutePosition,matrix=svg.getScreenCTM?.(),paint=svg.getBoundingClientRect?.();
  const style=svg.ownerDocument?.defaultView?.getComputedStyle?.(svg);
  if(style&&(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0'))return null;
  if(!matrix||![matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(finite)||Math.abs(matrix.a*matrix.d-matrix.b*matrix.c)<1e-12||!paint||paint.width<=0||paint.height<=0)return null;
  if(![position?.x,position?.y,box.BorderLeft,box.BorderRight,box.BorderTop,box.BorderBottom,unit].every(finite)||unit<=0||box.BorderRight<=box.BorderLeft||box.BorderBottom<=box.BorderTop)return null;
  // OSMD draws in staff units multiplied by calculatePixelDistance(1). Its SVG
  // viewBox already includes renderer.Zoom; getScreenCTM also includes CSS fit,
  // parent transforms and scroll. Multiplying Zoom here would apply it twice.
  // MusicSystem's pinned BorderTop/Bottom are the complete skyline/bottomline,
  // including ledger lines, articulations and lyrics, not just five staff lines.
  const left=(position.x+box.BorderLeft-1)*unit,right=(position.x+box.BorderRight+1)*unit;
  const top=(position.y+box.BorderTop-1)*unit,bottom=(position.y+box.BorderBottom+1)*unit;
  const points=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
  const rect={left:Math.min(...points.map(point=>point.x)),right:Math.max(...points.map(point=>point.x)),top:Math.min(...points.map(point=>point.y)),bottom:Math.max(...points.map(point=>point.y))};
  if(!Object.values(rect).every(finite))return null;
  return {...rect,width:rect.right-rect.left,height:rect.bottom-rect.top};
}

/** Read fresh screen geometry after every fit, adoption or responsive reflow.
 * Backend/page identity ties each MusicSystem to its own real SVG. Failure does
 * not substitute guessed rectangles, staff counts or printed measure numbers. */
export function readEngravingSystems(renderer,mount,coordinates,{fromMeasure=1,toMeasure}={}){
  try{
    const mapped=modelCoordinates(renderer,coordinates),pages=renderer?.GraphicSheet?.MusicPages,drawer=renderer?.Drawer,backends=drawer?.Backends;
    if(!mapped||!Array.isArray(pages)||!Array.isArray(backends)||!mount?.contains)return unavailable();
    const unit=drawer.calculatePixelDistance?.(1),systems=[];
    for(const [pageIndex,page]of pages.entries()){
      const backend=backends.find(value=>value.graphicalMusicPage===page),svg=backend?.getSvgElement?.();
      if(!svg||!svg.isConnected||!mount.contains(svg)||!Array.isArray(page.MusicSystems))return unavailable();
      for(const system of page.MusicSystems){
        if(!Array.isArray(system.GraphicalMeasures)||!Array.isArray(system.StaffLines)||!system.StaffLines.length)return unavailable();
        const found=new Map();
        for(const measure of system.GraphicalMeasures.flat()){
          if(!measure||measure.IsExtraGraphicalMeasure)continue;
          const coordinate=mapped.get(measure.parentSourceMeasure);
          if(!coordinate||measure.ParentMusicSystem!==system)return unavailable();
          if(coordinate.sourceMeasureIndex>=fromMeasure-1&&(toMeasure===undefined||coordinate.sourceMeasureIndex<toMeasure))found.set(coordinate.modelMeasureIndex,coordinate);
        }
        if(!found.size)continue;
        const measures=[...found.values()].sort((a,b)=>a.modelMeasureIndex-b.modelMeasureIndex),rect=systemRect(system,svg,unit);
        if(!rect)return unavailable();
        systems.push({index:systems.length,pageIndex,sourceMeasureIndices:[...new Set(measures.map(value=>value.sourceMeasureIndex))],measures,staffCount:system.StaffLines.length,rect,...rect});
      }
    }
    return systems.length?{status:'ready',systems}:unavailable();
  }catch{return unavailable();}
}
