/** Metadata and immutable bounded score snapshots for the local, fixed bundled catalog. */
export const CATALOG_LIMITS=Object.freeze({items:1000,indexBytes:2*1024*1024,scoreBytes:8*1024*1024,cacheBytes:16*1024*1024,cacheEntries:3});
const encodedBytes=text=>new TextEncoder().encode(text).byteLength;
const boundedString=(value,max,empty=true)=>typeof value==='string'&&Array.from(value).length<=max&&(empty||Boolean(value.trim()));
export function validateCatalogIndex(response){
 const fail=()=>{throw Error('The local catalog index is incomplete or exceeds supported metadata limits. Restart with a matching server build; local imports remain available.');};
 if(response?.version!==1||!Array.isArray(response.items)||response.items.length>CATALOG_LIMITS.items||encodedBytes(JSON.stringify(response))>CATALOG_LIMITS.indexBytes)fail();
 const ids=new Set();for(const item of response.items){if(!item||!boundedString(item.id,128,false)||ids.has(item.id)||!boundedString(item.title,1000,false)||!boundedString(item.composer,1024)||!item.provenance||!boundedString(item.provenance.kind,64,false)||!boundedString(item.provenance.attribution,8192)||Object.hasOwn(item,'parts')||Object.hasOwn(item,'source')||item.provenance.source_url!=null&&!boundedString(item.provenance.source_url,4096)||item.provenance.license!=null&&!boundedString(item.provenance.license,256))fail();ids.add(item.id);if(!['written_event_count','pitched_note_count','rest_count','part_count'].every(key=>Number.isInteger(item[key])&&item[key]>=0)||item.written_event_count!==item.pitched_note_count+item.rest_count||item.written_event_count>100000||item.part_count<1||item.part_count>128||!Number.isFinite(item.opening_bpm)||item.opening_bpm<10||item.opening_bpm>600)fail();}
 return structuredClone(response.items);
}
export function validateCatalogScore(score,item){
 const fail=()=>{throw Error('The fetched score does not match the requested catalog entry. The previous score is unchanged; refresh the library and retry.');};
 if(!score||score.version!==1||score.id!==item.id||score.title!==item.title||score.composer!==item.composer||!Array.isArray(score.parts)||score.parts.length!==item.part_count||score.tempo?.[0]?.bpm!==item.opening_bpm)fail();
 for(const key of ['kind','attribution','source_url','license'])if((score.provenance?.[key]??null)!==(item.provenance[key]??null))fail();
 let notes=0,rests=0;for(const part of score.parts){if(!Array.isArray(part.notes))fail();for(const note of part.notes){if(note?.pitch)notes++;else rests++;}}
 if(notes!==item.pitched_note_count||rests!==item.rest_count||notes+rests!==item.written_event_count)fail();
 const text=JSON.stringify(score),bytes=encodedBytes(text);if(bytes>CATALOG_LIMITS.scoreBytes)throw Error('The bundled score exceeds the 8 MiB local-score limit. The previous score is unchanged.');
 return{text,bytes};
}
export class CatalogScoreCache {
 constructor({maxEntries=CATALOG_LIMITS.cacheEntries,maxBytes=CATALOG_LIMITS.cacheBytes}={}){if(!Number.isInteger(maxEntries)||maxEntries<1||!Number.isInteger(maxBytes)||maxBytes<1)throw Error('Invalid catalog cache limits.');this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.entries=new Map();this.bytes=0;}
 clear(){this.entries.clear();this.bytes=0}
 get(id){const entry=this.entries.get(id);if(!entry)return null;this.entries.delete(id);this.entries.set(id,entry);return JSON.parse(entry.text)}
 put(item,score){const entry=validateCatalogScore(score,item);if(entry.bytes>this.maxBytes)return false;const previous=this.entries.get(item.id);if(previous){this.bytes-=previous.bytes;this.entries.delete(item.id)}while(this.entries.size>=this.maxEntries||this.bytes+entry.bytes>this.maxBytes){const oldest=this.entries.keys().next().value;this.bytes-=this.entries.get(oldest).bytes;this.entries.delete(oldest)}this.entries.set(item.id,entry);this.bytes+=entry.bytes;return true;}
}
export async function fetchCatalogScore(item,api,cache,signal){
 const cancelled=()=>{if(signal?.aborted)throw new DOMException('Catalog selection was cancelled.','AbortError')};cancelled();const cached=cache.get(item.id);if(cached){validateCatalogScore(cached,item);return cached}
 const score=await api(`/api/catalog/score/${encodeURIComponent(item.id)}`,undefined,signal);cancelled();cache.put(item,score);return structuredClone(score);
}
