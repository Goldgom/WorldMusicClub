import {createBulkImportTransport} from './bulk-import.js';
import {isBasicKeysSummary} from './clean-song-package.js';

const issue=(code,message)=>Object.assign(new Error(message),{code});
function basicItem(report){
  const item=report.items.length===1?report.items[0]:null;
  if(!item)throw issue('midi_import_result','The direct MIDI import did not return one complete source.');
  if(!['ready','saved','duplicate'].includes(item.status))throw issue(item.code,item.message);
  const summary=item.clean_package??item.entry?.clean_package,entrySummary=item.entry?.clean_package;
  if(!isBasicKeysSummary(summary))throw issue('midi_import_result','The importer did not validate a complete MIDI-key package.');
  if(entrySummary!=null&&(!isBasicKeysSummary(entrySummary)||entrySummary.content_sha256!==summary.content_sha256))throw issue('midi_import_result','The saved MIDI summary does not match the complete source.');
  if(item.entry&&item.entry.key!==`song-${summary.content_sha256}`)throw issue('midi_import_result','The saved MIDI identity does not match the complete source.');
  return{item,contentSha256:summary.content_sha256};
}

/** A fallback writes the original File, never its inferred notation projection.
 * A submitted native commit may finish after navigation; only inventory refresh
 * survives that boundary. The caller owns preview and playback admission.
 */
export async function importDirectMidiFallback(file,{getStorage,transport=createBulkImportTransport(),current=()=>true,onCommitted=async()=>{}}={}){
  const storage=await getStorage();if(!current())return null;
  if(storage.info.kind!=='native')throw issue('midi_native_import_required','This MIDI needs the native app’s complete MIDI-key import. The strict notation importer could not interpret it.');
  const reviewed=await transport.preview(file);if(!current())return null;
  // The raw-file digest alone cannot bind a commit to its reviewed package.
  const {contentSha256:reviewedContentSha256}=basicItem(reviewed);
  let committed,commitError;
  try{committed=await transport.commit(file,{sha256:reviewed.source.sha256});}
  catch(error){commitError=error;}
  // A refresh failure must not replace an uncertain filesystem-commit result.
  try{await onCommitted();}catch(error){if(!commitError)throw error;}
  if(commitError)throw commitError;
  if(!current())return null;
  const {item,contentSha256}=basicItem(committed);
  if(contentSha256!==reviewedContentSha256)throw issue('midi_import_result','The saved MIDI identity does not match the reviewed complete source.');
  if(!['saved','duplicate'].includes(item.status)||!item.entry)throw issue('midi_import_not_saved','The complete MIDI source was not confirmed saved. Refresh the library before retrying.');
  return{libraryKey:`native:${item.entry.key}`,warnings:committed.warnings,status:item.status};
}

export function directMidiImportText(locale,{reason,warnings=[],inspection=false}={}){
  const message=locale==='en'
    ?inspection?'Complete MIDI source saved. Playback and scored practice are unavailable because no supported practice clock was admitted.':'Complete MIDI source saved. The Start area shows whether practice is ready and any device-range changes needed. Listen and practice use the disclosed FIFO basic-key interpretation. Original instrument sounds are not reproduced.'
    :inspection?'完整 MIDI 源文件已保存。未能建立受支持的练习时钟，暂不可播放或评分练习。':'完整 MIDI 源文件已保存。开始演奏区域会显示练习是否就绪及所需的设备音域设置。聆听与练习采用已说明的 FIFO 基础按键解释方式，不复现原始乐器声音。';
  return [message,locale==='en'?`Strict notation import: ${reason}`:`严格记谱导入：${reason}`,...warnings].filter(Boolean).join(' ');
}
