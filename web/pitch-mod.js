import {songModIdentity,validateSongMod} from './song-mod.js';
import {preparePitchModSong} from './clean-song-package.js';
import {admitPitchModView,isPitchModPreferenceKey} from './pitch-mod-context.js';

export const PITCH_MOD_FORMAT='wmc-pitch-mod';
export const PITCH_MOD_VERSION=1;
export const PITCH_MOD_STORAGE_PREFIX='worldmusichub.pitch-mod.v1.';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(message,code='pitch_mod_projection')=>{throw Object.assign(new Error(message),{code});};
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(a,b)=>stable(a)===stable(b);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export function pitchModConfiguration(semitones=0){
  if(!Number.isInteger(semitones)||semitones < -12||semitones > 12)fail('Choose a whole-song shift from −12 to +12 half steps.','pitch_mod_shift');
  return Object.freeze({format:PITCH_MOD_FORMAT,version:PITCH_MOD_VERSION,semitones});
}
export function validatePitchModConfiguration(value){
  if(!value||Object.keys(value).length!==3||value.format!==PITCH_MOD_FORMAT||value.version!==PITCH_MOD_VERSION)fail('Unsupported pitch Mod configuration.','pitch_mod_shift');
  pitchModConfiguration(value.semitones);return value;
}
export function originalPitchContext(value){return value?.pitchView?.sourceView||value;}
export function pitchModSemitones(value){return value?.pitchView?.configuration.semitones||0;}
export function pitchModSupported(value){const song=originalPitchContext(value)?.cleanSong;return !song||song.profile==='wmh-basic-keys-midi1-v1'&&Boolean(song.runtime?.rendition)||song.profile==='wmh-vsq-clean-v1'&&song.runtime?.choice==='base_notes_instrumental';}
export function pitchModSource(value){
  const song=originalPitchContext(value)?.cleanSong;if(!song)return null;
  return {key:song.libraryKey.replace(/^native:/,''),content_sha256:song.identity,profile:song.profile,choice:song.runtime?.choice??null,runtime_policy:song.profile==='wmh-basic-keys-midi1-v1'?'wmh-basic-key-rendition-fifo-v1':song.runtime?.profile||song.profile};
}
export function pitchModRange(compiled){
  const notes=compiled?.timeline?.notes||[];if(!notes.length)return null;
  return notes.reduce(([low,high],note)=>[Math.min(low,note.midi),Math.max(high,note.midi)],[127,0]);
}
export function pitchViewContext(context,view){
  const source=originalPitchContext(context),effective=view?.configuration.semitones?view:source;
  return {...context,score:effective.score,compiled:effective.compiled,cleanSong:effective.cleanSong||null,pitchView:view?.configuration.semitones?view:null};
}

/** Rust produces every pitch and native gate. This boundary only joins IDs,
 * checks unchanged timing/coverage and retains the original export objects. */
export async function preparePitchModView(context,semitones,{api,signal}={}){
  const configuration=pitchModConfiguration(semitones),original=originalPitchContext(context);
  if(!original?.compiled?.timeline||!original.score)fail('Choose a complete playable song before checking its pitch.');
  const sourceView=Object.freeze({score:original.score,compiled:original.compiled,cleanSong:original.cleanSong||null});
  if(semitones===0)return Object.freeze({...sourceView,sourceView,configuration,identity:null,receipt:null,source_pitches:[],range:pitchModRange(original.compiled),audioProfile:null});
  if(!pitchModSupported(original))fail('Whole-song pitch shifting is unavailable for this source renderer. Its original playback remains available.','pitch_mod_renderer');
  const source=pitchModSource(original),response=await api(source?'/api/library/pitch-mod/project':'/api/pitch-mod/project',source?{source,configuration}:{score:original.score,configuration},signal);
  if(signal?.aborted)throw Object.assign(new Error('Pitch check was cancelled.'),{name:'AbortError'});
  const {identity,receipt,compilation,source_pitches:pitches}=response||{};
  if(!same(response?.configuration,configuration)||identity?.format!==PITCH_MOD_FORMAT||identity?.version!==PITCH_MOD_VERSION||identity?.semitones!==semitones||!hash(identity.digest)||!receipt||!Array.isArray(pitches)||!compilation?.score||!Array.isArray(compilation.timeline?.notes)||compilation.score.id!==original.score.id||compilation.score.parts.length!==original.score.parts.length)fail('The checked pitch view does not match this song and shift.');
  if(source&&!same(response.source,source))fail('The checked pitch view belongs to another saved source.');
  const bySource=new Map();
  for(const item of pitches){
    if(!item||typeof item.source_id!=='string'||typeof item.part_id!=='string'||bySource.has(item.source_id)||typeof item.percussion!=='boolean'||![item.original_midi,item.effective_midi].every(key=>Number.isInteger(key)&&key>=0&&key<=127)||item.percussion&&item.original_midi!==item.effective_midi)fail('The pitch view contains an invalid or changed percussion source identity.');
    bySource.set(item.source_id,item);
  }
  const before=original.compiled.timeline,after=compilation.timeline;
  if(before.duration_ms!==after.duration_ms||before.notes.length!==after.notes.length)fail('A pitch shift cannot change source duration or note coverage.');
  for(let index=0;index<before.notes.length;index++){
    const a=before.notes[index],b=after.notes[index],sourceIds=a.source_note_ids||[a.source_note_id||a.id];
    if(!same({...a,midi:b.midi},b)||!sourceIds.every(id=>{const p=bySource.get(id);return p&&p.part_id===a.part_id&&p.original_midi===a.midi&&p.effective_midi===b.midi;}))fail('A pitch view changed a note identity, gate or authoritative pitch.');
  }
  const compiled=freeze(structuredClone(compilation)),audioProfile=response.audio_profile?freeze(structuredClone(response.audio_profile)):null;
  if(!source&&!audioProfile)fail('The checked canonical pitch view has no matching audio profile.');
  const cleanSong=source?preparePitchModSong(original.cleanSong,{...response,compilation:compiled}):null;
  return admitPitchModView(Object.freeze({configuration,identity:freeze(structuredClone(identity)),receipt:freeze(structuredClone(receipt)),source_pitches:freeze(structuredClone(pitches)),sourceView,score:compiled.score,compiled,cleanSong,audioProfile,range:Object.freeze(pitchModRange(compiled))}),response.source);
}

/** One reversible sidecar write publishes both pitch and ordinary Mod choices.
 * Original Mod v1/v2 bytes and saved song bytes are never rewritten here. */
export class PitchModStore{
  constructor({storage}={}){
    this.storage=storage;this.bundles=new Map();this.owners=new Map();this.contexts=new Map();this.raws=new Map();this.known=new Set();
    this.preferences={getItem:key=>this.readPreference(key),setItem:(key,raw)=>this.writePreference(key,raw)};
  }
  target(){return this.storage===undefined?globalThis.localStorage:this.storage;}
  key(context){const id=songModIdentity(originalPitchContext(context));return PITCH_MOD_STORAGE_PREFIX+encodeURIComponent(id.songId)+'.'+id.sourceRevision.kind+'.'+id.sourceRevision.value;}
  base(context){const source=pitchModSource(context),id=songModIdentity(originalPitchContext(context));return source?JSON.stringify([source.key,source.content_sha256,source.profile,source.choice,source.runtime_policy]):JSON.stringify([id.songId,id.sourceRevision.kind,id.sourceRevision.value]);}
  validRecord(key,raw,context){
    const match=/^worldmusichub\.practice-(assistance|progression)\.v1\.(.+)$/.exec(key);if(!match||typeof raw!=='string'||raw.length>128*1024)return false;
    let decoded,record;try{decoded=decodeURIComponent(match[2]);record=JSON.parse(raw);}catch{return false;}
    const bound=isPitchModPreferenceKey(decoded,this.base(context));
    return bound&&record?.preference_key===decoded&&same(record.source,pitchModSource(context));
  }
  validate(value,context){
    const fields=Object.keys(value||{});if(!value||![4,5].includes(fields.length)||fields.some(key=>!['format','version','configuration','song_mod','records'].includes(key))||value.format!=='wmc-pitch-mod-preference'||value.version!==1)fail('Unsupported saved pitch Mod.');
    validatePitchModConfiguration(value.configuration);validateSongMod(value.song_mod,{identity:songModIdentity(originalPitchContext(context)),parts:originalPitchContext(context).score.parts});
    if(Object.hasOwn(value,'records')&&(!value.records||typeof value.records!=='object'||Array.isArray(value.records)||Object.entries(value.records).some(([key,raw])=>!this.validRecord(key,raw,context))))fail('A saved pitch assignment belongs to another song, pitch scope or preference format.');
    return value;
  }
  read(context){
    const key=this.key(context);this.contexts.set(key,originalPitchContext(context));let raw=null;
    try{
      const target=this.target();if(typeof target?.getItem!=='function')throw Error('Storage is unavailable.');raw=target.getItem(key);
      if(raw===null){if(this.known.has(key))fail('The previously saved pitch Mod is missing. Reopen the saved song after restoring its settings.','pitch_mod_storage');this.raws.set(key,null);return null;}
      this.known.add(key);if(typeof raw!=='string'||raw.length>512*1024)fail('Saved pitch Mod exceeds its size budget.');
      const value=this.validate(JSON.parse(raw),context);this.install(key,value,raw);return {...value,raw};
    }catch(error){return raw===null&&!this.known.has(key)?null:{error:Object.assign(new Error(`Saved pitch Mod is unavailable: ${error.message}`,{cause:error}),{code:'pitch_mod_storage'})};}
  }
  install(key,value,raw){
    // Keep ownership tombstones: removing a known recipe must never resurrect
    // a standalone legacy record or silently restore first-use defaults.
    this.bundles.set(key,value);this.raws.set(key,raw);this.known.add(key);for(const record of Object.keys(value.records||{}))this.owners.set(record,key);
  }
  readPreference(key){
    const owner=this.owners.get(key);if(!owner)return this.target()?.getItem(key)??null;
    const value=this.read(this.contexts.get(owner));if(value?.error)throw value.error;
    if(!Object.hasOwn(value?.records||{},key))fail('The checked assignment disappeared from its saved pitch Mod. Reopen Mod before replacing it.','pitch_mod_storage');
    return value.records[key];
  }
  writePreference(key,raw){
    const owner=this.owners.get(key);if(!owner)return this.target().setItem(key,raw);
    const context=this.contexts.get(owner),expectedRaw=this.raws.get(owner),value=this.read(context);if(value?.error)throw value.error;
    this.save(context,value.configuration,value.song_mod,{records:{[key]:raw},expectedRaw});
  }
  save(context,configuration,mod,{records,expectedRaw=this.raws.get(this.key(context))??null}={}){
    const key=this.key(context),target=this.target();this.contexts.set(key,originalPitchContext(context));
    if(typeof target?.setItem!=='function'||typeof target?.getItem!=='function')fail('Pitch Mod could not be saved. Your previous settings and targets are unchanged.','pitch_mod_storage');
    let raw;try{raw=target.getItem(key);}catch{fail('Pitch Mod could not be read before saving. Your previous settings and targets are unchanged.','pitch_mod_storage');}
    if(raw!==expectedRaw)fail('Pitch Mod changed in another window. Reopen Mod before applying.','pitch_mod_preference_changed');
    let previous=null;if(raw!==null){try{previous=this.validate(JSON.parse(raw),context);}catch{fail('Saved pitch Mod is invalid. Your previous settings and targets are unchanged.','pitch_mod_storage');}}
    else if(this.known.has(key))fail('The previously saved pitch Mod is missing. Your previous settings and targets are unchanged.','pitch_mod_storage');
    const value=this.validate({format:'wmc-pitch-mod-preference',version:1,configuration,song_mod:mod,...((records||previous?.records)?{records:{...previous?.records,...records}}:{})},context),serialized=JSON.stringify(value);
    if(serialized.length>512*1024)fail('Saved pitch Mod exceeds its size budget.','pitch_mod_storage');
    try{target.setItem(key,serialized);}catch(error){throw Object.assign(new Error('Pitch Mod could not be saved. Your previous settings and targets are unchanged.',{cause:error}),{code:'pitch_mod_storage'});}
    this.install(key,value,serialized);return {...value,raw:serialized};
  }
}
