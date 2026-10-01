import {parseBeatInput} from './practice-settings.js';
import {equivalentJson} from './adaptation-view.js';
export const EXTERNAL_OMR_LIMITS=Object.freeze({bytes:8*1024*1024,notes:100000,parts:128,page:20});
export const OMR_REVIEW_CATEGORIES=Object.freeze([
  ['notes_and_rests','Every note, rest, pitch and accidental · 音符与休止'],
  ['rhythm_and_voices','Exact onsets/durations, voices and staves · 节奏与声部'],
  ['ties_and_navigation','Ties, repeats and navigation · 延音与反复'],
  ['key_and_meter','Key, meter and measure boundaries · 调号与拍号'],
  ['tempo','Tempo map, including inferred defaults · 速度'],
  ['source_rights','Source credits and permission for this use · 来源与权利']
]);
export function boundedJson(value,label='Review package'){
  const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>EXTERNAL_OMR_LIMITS.bytes)throw Error(`${label} exceeds 8 MiB. Use a smaller original fragment; sources are never stripped to fit.`);return text;
}
export function bytesBase64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(binary)}
export function outputPayload(bytes,filename){
  if(bytes.byteLength>EXTERNAL_OMR_LIMITS.bytes)throw Error('Engine output exceeds 8 MiB. Export a smaller fragment.');
  if(/\.mxl$/i.test(filename))return{output_format:'mxl',output_content:bytesBase64(bytes)};
  if(!/\.(musicxml|xml)$/i.test(filename))throw Error('Choose separately generated Audiveris MusicXML (.musicxml/.xml) or compressed .mxl output.');
  try{return{output_format:'musicxml',output_content:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}}catch{throw Error('This XML is not valid UTF-8. Re-export it as UTF-8; no replacement characters were inserted.');}
}
export function exactBeatText(value){return value.denominator===1?String(value.numerator):`${value.numerator}/${value.denominator}`}
export function editedBeat(text,{duration=false}={}){const value=parseBeatInput(text);if(duration&&value.numerator===0)throw Error('A note/rest duration must be positive.');return value}
export function reviewPage(items,page=1){const total=Math.max(1,Math.ceil(items.length/EXTERNAL_OMR_LIMITS.page));const current=Math.max(1,Math.min(total,Math.trunc(Number(page))||1));const start=(current-1)*EXTERNAL_OMR_LIMITS.page;return{page:current,total,start,items:items.slice(start,start+EXTERNAL_OMR_LIMITS.page)}}
function editableShape(score){
  if(!score||score.version!==1||typeof score.id!=='string'||typeof score.title!=='string'||!Array.isArray(score.parts)||!score.parts.length||score.parts.length>EXTERNAL_OMR_LIMITS.parts)throw Error('The editor needs a canonical version-1 score with 1–128 parts.');
  let count=0;for(const part of score.parts){if(!part||typeof part.id!=='string'||!Array.isArray(part.notes))throw Error('Every part needs an ID and a notes array.');count+=part.notes.length;for(const note of part.notes){if(!note||typeof note.id!=='string')throw Error('Every note/rest needs a stable ID.');for(const field of ['at','duration'])if(!note[field]||!Number.isSafeInteger(note[field].numerator)||!Number.isSafeInteger(note[field].denominator)||note[field].denominator<=0)throw Error('Note onsets and durations need exact integer numerator/denominator objects.');if(note.pitch!=null){const pitch=note.pitch;if(!pitch||!['C','D','E','F','G','A','B'].includes(pitch.step)||!Number.isInteger(pitch.alter)||Math.abs(pitch.alter)>2||!Number.isInteger(pitch.octave)||pitch.octave < -2||pitch.octave>9)throw Error('A pitch needs step A–G, alter −2…2 and a supported octave, or null for a rest.');const midi=(pitch.octave+1)*12+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[pitch.step]+pitch.alter;if(midi<0||midi>127)throw Error('A corrected pitch is outside MIDI 0–127.');}}}
  if(count>EXTERNAL_OMR_LIMITS.notes)throw Error('A review draft is limited to 100,000 written notes/rests. Split the source; no rows were dropped.');
  for(const kind of ['tempo','keys','meters','measures','repeats']){const list=score[kind]??(kind==='repeats'?[]:null);const maximum=kind==='repeats'?10000:100000;if(!Array.isArray(list)||list.length>maximum)throw Error(`The ${kind} map must be an array with at most ${maximum} entries.`);if(kind==='tempo'||kind==='keys')for(const item of list)if(!item||!item.at||!Number.isSafeInteger(item.at.numerator)||!Number.isSafeInteger(item.at.denominator)||item.at.denominator<=0)throw Error(`${kind} entries need exact rational at positions.`);}
  return score;
}
// Match only documented Serde defaults; do not normalize musical values or discard fields.
function reviewedEditable(score,{expected=false}={}){
  const copy=structuredClone(score);delete copy.source;
  if(!Object.hasOwn(copy,'repeats'))copy.repeats=[];
  if(copy.provenance){if(expected)copy.provenance.kind='user_reviewed_external_omr';for(const key of ['source_url','license'])if(!Object.hasOwn(copy.provenance,key))copy.provenance[key]=null;}
  for(const part of copy.parts??[])for(const note of part.notes??[]){if(!Object.hasOwn(note,'pitch'))note.pitch=null;for(const key of ['tie_start','tie_stop'])if(!Object.hasOwn(note,key))note[key]=false;}
  return copy;
}
function immutableJson(value){if(value&&typeof value==='object'){for(const child of Object.values(value))immutableJson(child);Object.freeze(value)}return value}
export class ExternalOmrReview {
  constructor(response){
    if(response?.requires_review!==true||response.confidence!==null||Object.hasOwn(response,'timeline')||response.score?.source?.format!=='external-omr-draft'||!Array.isArray(response.diagnostics)||!Array.isArray(response.normalizations))throw Error('The server did not return a gated unreviewed OMR draft with unknown confidence.');
    boundedJson(response.score);let record;try{record=JSON.parse(response.score.source.content)}catch{throw Error('The original retention record is unreadable.');}if(record.version!==1||record.confirmation!==null||record.input?.engine_version!=='5.11.0'||!['musicxml','mxl'].includes(record.input.output_format)||typeof record.input.output_content!=='string'||!Array.isArray(record.normalizations))throw Error('The original unreviewed retention record is incomplete.');Object.defineProperty(this,'source',{value:immutableJson(structuredClone(response.score.source)),writable:false});this.editable=structuredClone(response.score);delete this.editable.source;editableShape(this.editable);
    this.warnings=[...response.normalizations.map(message=>({code:'normalization',message})),...response.diagnostics];this.revision=0;this.confirmation={};this.invalidate();
  }
  invalidate(){this.revision++;for(const[category]of OMR_REVIEW_CATEGORIES)this.confirmation[category]=false}
  confirm(category,value){if(!OMR_REVIEW_CATEGORIES.some(([key])=>key===category))throw Error('Unknown review category.');this.confirmation[category]=value===true}
  get complete(){return OMR_REVIEW_CATEGORIES.every(([key])=>this.confirmation[key]===true)}
  editorText(){const compact=boundedJson(this.editable,'Editable score');return compact.length<256000?JSON.stringify(this.editable,null,2):compact}
  replaceJson(text){
    this.invalidate();
    if(new TextEncoder().encode(text).byteLength>EXTERNAL_OMR_LIMITS.bytes)throw Error('Editable JSON exceeds 8 MiB.');
    let score;try{score=JSON.parse(text)}catch{throw Error('The advanced editor is not valid JSON. Correct it before applying.');}
    if(!score||typeof score!=='object'||Array.isArray(score))throw Error('The editor must contain a canonical score object.');
    if(Object.hasOwn(score,'source'))throw Error('The source retention record is managed separately. Remove the source field from editor JSON; the original record will be reattached unchanged.');
    editableShape(score);boundedJson({...score,source:this.source});this.editable=score;
  }
  addMapEvent(kind){
    if(!['tempo','keys'].includes(kind))throw Error('Only tempo and key events have structured manual controls.');
    const list=this.editable[kind];if(list.length>=100000)throw Error('This map already has 100,000 events. Split the source; no existing events were dropped.');
    this.invalidate();const event={at:{numerator:0,denominator:1},...(kind==='tempo'?{bpm:120}:{fifths:0,mode:'major'})};list.push(event);return{index:list.length-1,event};
  }
  removeMapEvent(kind,index){
    if(!['tempo','keys'].includes(kind)||!Number.isInteger(index)||index<0||index>=this.editable[kind].length)throw Error('Choose an existing tempo or key event to remove.');
    this.invalidate();this.editable[kind].splice(index,1);
  }
  score(){return structuredClone({...this.editable,source:this.source})}
  payload(){if(!this.complete)throw Error('Confirm every review category freshly after comparing with the original.');const payload={score:this.score(),confirmation:{...this.confirmation}};boundedJson(payload);return payload}
  verifyReviewed(compilation){
    if(compilation?.score?.source?.format!=='external-omr-reviewed'||!Array.isArray(compilation.timeline?.notes))throw Error('The server did not return a reviewed compilation.');
    let before,after;try{before=JSON.parse(this.source.content);after=JSON.parse(compilation.score.source.content)}catch{throw Error('The retained review record is unreadable.');}
    if(after.version!==before.version||!equivalentJson(before.input,after.input)||!equivalentJson(before.normalizations,after.normalizations)||!equivalentJson(after.confirmation,this.confirmation))throw Error('Original engine/image data or confirmation changed unexpectedly. Keep the original and retry.');
    if(!equivalentJson(reviewedEditable(this.editable,{expected:true}),reviewedEditable(compilation.score)))throw Error('The reviewed response changed the confirmed musical draft. Keep your corrections and retry; no score was activated.');
    return compilation;
  }
}
