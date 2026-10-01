/** Read retained score sources as inert download data; never render or execute them. */
export const SOURCE_ARCHIVE_LIMITS=Object.freeze({sourceBytes:8*1024*1024,files:16});
const encoder=new TextEncoder();
const shaPattern=/^[a-fA-F0-9]{64}$/;
function utf8(text){
 if(typeof text!=='string'||(text.isWellFormed&&!text.isWellFormed()))throw Error('Retained source is not valid Unicode text. Keep the original canonical JSON.');
 const bytes=encoder.encode(text);if(bytes.length>SOURCE_ARCHIVE_LIMITS.sourceBytes)throw Error('Retained source exceeds the 8 MiB download-view limit. Export the complete score JSON instead.');return bytes;
}
function filename(value,fallback='retained-source.txt'){
 let name=String(value||fallback).split(/[\\/]/).at(-1).replace(/[<>:"|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||fallback;
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name=`source-${name}`;
 return name;
}
function safeTextFilename(value,fallback){
 const name=filename(value,fallback);return /\.(xml|musicxml|mscx|json|jianpu|txt)$/i.test(name)?name:`${name}.txt`;
}
function safeBinaryFilename(value,fallback='source.bin'){
 const name=filename(value,fallback);return /\.(mid|midi|mxl|png|jpe?g|bin)$/i.test(name)?name:`${name}.bin`;
}
function file(id,name,content,encoding,role,{sha256=null,bytes=null,note=''}={}){
 return Object.freeze({id,filename:name,content,encoding,role,declaredSha256:typeof sha256==='string'&&shaPattern.test(sha256)?sha256.toLowerCase():null,declaredBytes:Number.isSafeInteger(bytes)&&bytes>=0?bytes:null,note});
}
export function retainedSourceArchive(score){
 const source=score?.source;if(!source)return {files:[],warnings:['This score has no retained original-source payload. Export its canonical JSON to preserve the written score.']};
 utf8(source.content);
 const files=[file('complete-retained-source',safeTextFilename(source.filename,'retained-source.txt'),source.content,'utf-8','Complete retained source')],warnings=[];
 if(source.format==='midi-base64'){
  files.push(file('original-midi',safeBinaryFilename(source.filename?.replace(/\.json$/i,'.mid')||'original.mid'),source.content,'base64','Original MIDI bytes'));
 }else if(source.format==='worldmusichub-mxl-archive-v1'){
  try{
   const envelope=JSON.parse(source.content);
   if(envelope.version!==1)throw Error('Unknown MXL retention version');
   if(typeof envelope.selected_score_path!=='string'||!envelope.selected_score_path.length||!envelope.files||Array.isArray(envelope.files)||Object.keys(envelope.files).length!==2)throw Error('Incomplete MXL retention record');
   for(const[name,encoding]of [['original.mxl','base64'],['selected.musicxml','utf-8']]){const value=envelope.files[name];if(!value||value.encoding!==encoding||typeof value.content!=='string'||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>SOURCE_ARCHIVE_LIMITS.sourceBytes)throw Error('Incomplete retained MXL file metadata')}
   const path=envelope.selected_score_path.length>500?`${envelope.selected_score_path.slice(0,500)}… (full path retained in the complete envelope)`:envelope.selected_score_path;
   const original=envelope.files['original.mxl'],selected=envelope.files['selected.musicxml'];
   files.push(file('mxl:original.mxl','original.mxl',original.content,'base64','Original MXL archive',{bytes:original.bytes,note:'Complete imported archive, including its container and ancillary entries. Saved as inert bytes; this view does not extract or open it.'}));
   files.push(file('mxl:selected.musicxml','selected.musicxml',selected.content,'utf-8','Selected MusicXML entry',{bytes:selected.bytes,note:`Exact XML entry selected by the manifest: ${path}. Keep the original MXL or full score JSON for the other archive contents.`}));
  }catch(error){files.splice(1);warnings.push(`Individual MXL files are unavailable: ${error.message}. The complete retained envelope is still downloadable unchanged.`)}
 }else if(source.format==='worldmusichub-curated-edition-v1'){
  let envelope;
  try{envelope=JSON.parse(source.content);if(envelope.version!==1||!envelope.files||Array.isArray(envelope.files)||typeof envelope.files!=='object')throw Error('Unknown archive version');
   const entries=Object.entries(envelope.files);if(entries.length>SOURCE_ARCHIVE_LIMITS.files)throw Error('Too many retained files');
   for(const[name,value]of entries){
    if(!value||typeof value.content!=='string'||!['utf-8','base64'].includes(value.encoding))throw Error('Unsupported retained-file encoding');
    const note=name==='import.musicxml'?'Explicitly normalized compatible copy; consult the retained conversion record.':name==='converter.musicxml'?'Exact converter output, including its original DTD header; generic import may reject it.':name==='reference.mid'?'Reference key/controller data. This app may refuse unsupported controllers; it is not equivalent expressive playback.':'';
    files.push(file(`edition:${name}`,value.encoding==='utf-8'?safeTextFilename(name,'source.txt'):safeBinaryFilename(name),value.content,value.encoding,name==='original.mscx'?'Original edition source':name==='import.musicxml'?'Compatible import copy':name==='reference.mid'?'Reference MIDI':'Retained conversion file',{sha256:value.sha256,bytes:value.bytes,note}));
   }
   if(typeof envelope.license_text==='string')files.push(file('edition-license','LICENSE-CC0.txt',envelope.license_text,'utf-8','Edition license',{sha256:envelope.provenance?.license_text_sha256}));
  }catch(error){files.splice(1);warnings.push(`Individual files are unavailable: ${error.message}. The complete retained envelope is still downloadable unchanged.`)}
 }else if(source.format.includes('omr')||['octave-adaptation','semitone-transposition'].includes(source.format)){
  warnings.push('This retained envelope can include images, review history or an original score. Export the complete score JSON as well; this view does not flatten those records.');
 }
 warnings.push('Downloads stay local. Sources may contain private information or separately licensed music. Declared checksums are file claims, not proof of rights or authenticity.');
 return {files,warnings};
}
export async function inspectRetainedSourceFile(descriptor,{crypto=globalThis.crypto}={}){
 let bytes;
 if(descriptor.encoding==='utf-8')bytes=utf8(descriptor.content);
 else if(descriptor.encoding==='base64'){
  if(typeof descriptor.content!=='string'||descriptor.content.length>Math.ceil(SOURCE_ARCHIVE_LIMITS.sourceBytes/3)*4)throw Error('Encoded source exceeds the download-view limit.');
  let decoded;try{decoded=atob(descriptor.content)}catch{throw Error('Retained base64 bytes are invalid; export the complete original envelope instead.')}
  // A strict canonical encoding avoids accepting whitespace or malformed pad bits silently.
  if(btoa(decoded)!==descriptor.content)throw Error('Retained base64 is not canonical; no bytes were silently normalized.');
  bytes=Uint8Array.from(decoded,character=>character.charCodeAt(0));
 }else throw Error('Unsupported retained source encoding.');
 if(bytes.length>SOURCE_ARCHIVE_LIMITS.sourceBytes)throw Error('Decoded source exceeds the download-view limit.');
 const sha256=crypto?.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''):null;
 return {bytes,filename:descriptor.filename,mime:'application/octet-stream',sha256,
  checksumMatches:descriptor.declaredSha256&&sha256?descriptor.declaredSha256===sha256:null,
  sizeMatches:descriptor.declaredBytes===null?null:descriptor.declaredBytes===bytes.length};
}
