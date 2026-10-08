import {beat,renderNotation} from './music.js';

/** Present the admitted bounded rendition page. Separate batches respect the
 * existing 1,000-glyph renderer limit without discarding a target or changing
 * its written/rendition identity. Unusual sparse pages use explicit markers. */
export function renderBasicKeyPage(page,mode,{width,numberedMode,i18n,measureFrom=0,measureTo=null}={}){
  if(!page?.score)return{html:'',fallback:[],renderedIds:[]};
  const part=page.score.parts[0],groups=new Map();
  if(measureTo!==null){
    const first=page.score.measures[measureFrom],last=page.score.measures[measureTo-1];
    if(!first||!last||measureTo<=measureFrom)throw new RangeError('Invalid admitted display row.');
    const start=beat(first.at),end=beat(last.at)+beat(last.length);
    const notes=part.notes.filter(note=>beat(note.at)>=start&&beat(note.at)<end);
    const slices=new Map();for(const note of notes){const at=start+Math.floor((beat(note.at)-start)/32)*32;if(!slices.has(at))slices.set(at,[]);slices.get(at).push(note);}
    if(!slices.size)slices.set(start,[]);
    const batches=[];for(const[at,items]of slices)for(let index=0;index<Math.max(1,items.length);index+=1000)batches.push({at,notes:items.slice(index,index+1000)});
    if(batches.length>64)return{html:'',fallback:(page.interpreted_notes||[]).filter(note=>notes.some(source=>source.id===note.note_id)),renderedIds:[]};
    return{html:batches.map(batch=>renderNotation({...page.score,measures:page.score.measures.filter(measure=>beat(measure.at)>=batch.at&&beat(measure.at)<Math.min(end,batch.at+32)),parts:[{...part,notes:batch.notes}]},mode,{startBeat:batch.at,spanBeats:Math.min(32,end-batch.at),width,partId:part.id,allParts:false,numberedMode,i18n})).join(''),fallback:[],renderedIds:batches.flatMap(batch=>batch.notes.map(note=>note.id))};
  }
  for(const note of part.notes){const start=Math.floor(beat(note.at)/32)*32;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(note);}
  const batches=[];for(const[start,notes]of groups)for(let index=0;index<notes.length;index+=1000)batches.push({start,notes:notes.slice(index,index+1000)});
  if(batches.length>64)return{html:'',fallback:page.interpreted_notes.filter(note=>note.display_kind==='interval'),renderedIds:[]};
  return{html:batches.map(({start,notes})=>renderNotation({...page.score,parts:[{...part,notes}]},mode,{startBeat:start,spanBeats:32,width,partId:part.id,allParts:false,numberedMode,i18n})).join(''),fallback:[],renderedIds:batches.flatMap(batch=>batch.notes.map(note=>note.id))};
}
