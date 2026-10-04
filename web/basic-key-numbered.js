import {beat,renderNotation} from './music.js';

/** Present the admitted bounded rendition page. Separate batches respect the
 * existing 1,000-glyph renderer limit without discarding a target or changing
 * its written/rendition identity. Unusual sparse pages use explicit markers. */
export function renderBasicKeyPage(page,mode,{width,numberedMode,i18n}={}){
  if(!page?.score)return{html:'',fallback:[],renderedIds:[]};
  const part=page.score.parts[0],groups=new Map();
  for(const note of part.notes){const start=Math.floor(beat(note.at)/32)*32;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(note);}
  const batches=[];for(const[start,notes]of groups)for(let index=0;index<notes.length;index+=1000)batches.push({start,notes:notes.slice(index,index+1000)});
  if(batches.length>64)return{html:'',fallback:page.interpreted_notes.filter(note=>note.display_kind==='interval'),renderedIds:[]};
  return{html:batches.map(({start,notes})=>renderNotation({...page.score,parts:[{...part,notes}]},mode,{startBeat:start,spanBeats:32,width,partId:part.id,allParts:false,numberedMode,i18n})).join(''),fallback:[],renderedIds:batches.flatMap(batch=>batch.notes.map(note=>note.id))};
}
