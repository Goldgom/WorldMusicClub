import {runtimeReceiptFields} from './source-practice-eligibility.js';
// A projection is admitted only after the Rust response and its complete source
// correspondence have been checked by preparePitchModView. Preferences cannot
// manufacture this runtime token by deserializing the same JSON.
const views=new WeakMap(),contexts=new WeakMap();
// This module is in the Worklet import closure. Keep it free of UI dependencies.
function equivalentJson(a,b){
  if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equivalentJson(a[key],b[key]));
}
const fail=()=>{throw Object.assign(new TypeError('The checked pitch view no longer matches its original source and effective runtime.'),{code:'pitch_mod_context_invalid'});};
const fields=(value,names)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const shift=value=>Number.isSafeInteger(value)&&value>=-12&&value<=12&&value!==0;
const profiles={
  'wmc-canonical-score-v1':['wmc-canonical-practice-v1','wmc-canonical-score-serde-json',null],
  'wmh-basic-keys-midi1-v1':['wmh-basic-key-rendition-fifo-v1','wmc-basic-complete-serde-json',null],
  'wmh-vsq-clean-v1':['wmh-vsq-base-note-practice-v1','wmc-vsq-complete-serde-json','base_notes_instrumental'],
  'wmh-semantic-midi1-v1':['wmh-semantic-midi1-v1','wmc-semantic-complete-serde-json',null],
};
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function pitchModOriginalSource(view){
  const song=view?.sourceView?.cleanSong;if(!song)return null;
  return{key:song.libraryKey.replace(/^native:/,''),content_sha256:song.identity,profile:song.profile,choice:song.runtime?.choice??null,runtime_policy:song.profile==='wmh-basic-keys-midi1-v1'?'wmh-basic-key-rendition-fifo-v1':song.runtime?.profile||song.profile};
}
function validOriginalReceipt(receipt,source){
  const profile=source?.profile||'wmc-canonical-score-v1',expected=profiles[profile];
  return expected&&runtimeReceiptFields(receipt,profile)&&fields(receipt.source_binding,['domain','serialization_revision','digest'])&&receipt.source_binding.domain===expected[1]&&receipt.source_binding.serialization_revision===1&&hash(receipt.source_binding.digest)&&receipt.saved_package_sha256===(source?.content_sha256??null)&&receipt.source_profile===profile&&receipt.runtime_policy===expected[0]&&receipt.choice===expected[2]&&hash(receipt.runtime_digest)&&(!source||source.runtime_policy===expected[0]&&source.choice===expected[2]&&hash(source.content_sha256)&&source.key===`song-${source.content_sha256}`);
}
function sourceResponse(source,receipt){return source||{kind:'canonical',source_binding:receipt.source_binding,profile:receipt.source_profile,choice:receipt.choice,runtime_policy:receipt.runtime_policy};}
export function admitPitchModView(view,responseSource){
  const config=view?.configuration,identity=view?.identity,receipt=view?.receipt,source=pitchModOriginalSource(view);
  if(!fields(config,['format','version','semitones'])||config.format!=='wmc-pitch-mod'||config.version!==1||!shift(config.semitones)||!fields(identity,['format','version','semitones','original_receipt','written_interval','digest'])||identity.format!==config.format||identity.version!==config.version||identity.semitones!==config.semitones||!hash(identity.digest)||!fields(identity.written_interval,['diatonic_steps','fifths_delta'])||!Object.values(identity.written_interval).every(Number.isSafeInteger)||!validOriginalReceipt(identity.original_receipt,source)||!equivalentJson(responseSource,sourceResponse(source,identity.original_receipt))||!receipt||!hash(receipt.runtime_digest)||receipt.runtime_digest===identity.original_receipt.runtime_digest||!equivalentJson(receipt,{...identity.original_receipt,runtime_policy:'wmc-pitch-mod-v1',runtime_digest:receipt.runtime_digest})||!view.sourceView?.score||!view.sourceView.compiled||view.compiled?.score!==view.score)fail();
  const context=freeze(structuredClone({configuration:config,identity,receipt}));
  const saved={view,context,source:structuredClone(source),score:view.sourceView.score,compiled:view.sourceView.compiled,song:view.sourceView.cleanSong,originalScore:structuredClone(view.sourceView.score),effectiveScore:view.score,effectiveCompiled:view.compiled,effectiveSong:view.cleanSong};
  views.set(view,saved);contexts.set(context,saved);return view;
}
export function assertPitchModContext(context,source,binding=null){
  const saved=contexts.get(context);if(!saved)fail();
  const {view}=saved;
  if(!equivalentJson(saved.source,source)||!equivalentJson(saved.source,pitchModOriginalSource(view))||view.sourceView.score!==saved.score||view.sourceView.compiled!==saved.compiled||view.sourceView.cleanSong!==saved.song||!equivalentJson(saved.originalScore,view.sourceView.score)||view.score!==saved.effectiveScore||view.compiled!==saved.effectiveCompiled||view.cleanSong!==saved.effectiveSong||!equivalentJson(context.configuration,view.configuration)||!equivalentJson(context.identity,view.identity)||!equivalentJson(context.receipt,view.receipt))fail();
  if(binding&&(binding.sourceToken!==(view.cleanSong||view.compiled)||binding.runtimeToken!==(view.cleanSong?view.cleanSong.runtime:view.compiled.timeline)))fail();
  return context;
}
export function pitchModContext(view){
  if(view==null||view.configuration?.semitones===0&&view.identity===null&&view.receipt===null)return null;
  const saved=views.get(view);if(!saved)fail();return assertPitchModContext(saved.context,saved.source);
}
export function pitchModPreferenceKey(base,context){
  if(!context)return base;
  const saved=contexts.get(context);if(!saved)fail();assertPitchModContext(context,saved.source);
  return JSON.stringify([base,'wmc-pitch-mod',1,context.identity.semitones,context.identity.digest]);
}
/** Storage scope only: this never admits a serialized projection for playback. */
export function isPitchModPreferenceKey(key,base){
  if(key===base)return true;
  try{const value=JSON.parse(key);return Array.isArray(value)&&value.length===5&&value[0]===base&&value[1]==='wmc-pitch-mod'&&value[2]===1&&shift(value[3])&&hash(value[4])&&JSON.stringify(value)===key;}catch{return false;}
}
