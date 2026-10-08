/** Presentation only. Never infer source names from array order or instruments. */
export function partActivitySourceLabels(parts) {
 const labels=new Map(),seen=new Set();
 if(!Array.isArray(parts)||parts.length>128)return labels;
 for(const part of parts){
  const id=part?.id;if(typeof id!=='string'||!id)continue;
  if(seen.has(id)){labels.delete(id);continue;}seen.add(id);
  const label=[part.name,part.label].find(value=>typeof value==='string'&&value.trim());
  if(label!==undefined)labels.set(id,label);
 }
 return labels;
}
