import {CanonicalSha256,canonicalFingerprint,canonicalUtf8} from './canonical-audio-fingerprint.js';
import {inspectCleanRendition} from './clean-song-player.js';
import {hasBasicKeyRendition,isVsqSong} from './clean-song-package.js';
import {assertPracticeAssistanceCurrent,practiceAssistanceBinding} from './practice-assistance-receipt.js';

export const SONG_MOD_FORMAT='wmc-song-mod';
export const SONG_MOD_VERSION=2;
export const SONG_MOD_STORAGE_PREFIX='worldmusichub.song-mod.v2.';
export const SONG_MOD_LEGACY_STORAGE_PREFIX='worldmusichub.song-mod.v1.';
export const SONG_MOD_LIVE_INSTRUMENTS=Object.freeze(['follow','piano','guitar']);
const v1PartFields=['partId','performer','instrument','muted','visible'];
export const SONG_MOD_INSTRUMENTS=Object.freeze(['source','sine','triangle','reed']);
const fail=message=>{throw Object.assign(new TypeError(message),{code:'invalid_song_mod'});};
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameRevision=(a,b)=>a?.kind===b?.kind&&a?.value===b?.value;

/** A sidecar only: never edit score notes, raw sources, or renderer profiles. */
export function songModIdentity(context) {
  const {score,cleanSong=null}=context.pitchView?.sourceView||context;
  if(!score?.id||!Array.isArray(score.parts)||!score.parts.length)fail('A score with stable source part IDs is required.');
  return {songId:score.id,sourceRevision:cleanSong?{kind:'clean-package-sha256',value:cleanSong.identity}:{kind:'canonical-score-v1',value:canonicalFingerprint('wmh-canonical-score-v1',score)}};
}

/** Engine-neutral fingerprint: compact JSON tuple, UTF-8, SHA-256. */
export function songModConfigFingerprint(config,version=config.parts.some(part=>Object.hasOwn(part,'liveInstrument'))?2:1) {
  if(![1,2].includes(version))fail('Unsupported Mod fingerprint version.');
  const tuple=[config.layout,config.showOtherParts,config.parts.map(part=>[part.partId,part.performer,part.instrument,...(version===2?[part.liveInstrument]:[]),part.muted,part.visible])];
  return new CanonicalSha256().update(canonicalUtf8(`wmc-song-mod-config-v${version}\n`+JSON.stringify(tuple))).hex();
}
export function createSongMod(identity,config) {
  const copy=structuredClone(config);
  if(Array.isArray(copy?.parts)&&copy.parts.every(part=>keys(part,v1PartFields)))for(const part of copy.parts)part.liveInstrument='follow';
  return validateSongMod({format:SONG_MOD_FORMAT,version:SONG_MOD_VERSION,songId:identity.songId,sourceRevision:{...identity.sourceRevision},configFingerprint:songModConfigFingerprint(copy,SONG_MOD_VERSION),config:copy});
}
export function validateSongMod(mod,{identity,parts}={}) {
  if(!keys(mod,['format','version','songId','sourceRevision','configFingerprint','config'])||mod.format!==SONG_MOD_FORMAT||![1,2].includes(mod.version)||typeof mod.songId!=='string'||!mod.songId||mod.songId.length>512)fail('Unsupported song Mod envelope.');
  if(!keys(mod.sourceRevision,['kind','value'])||!['canonical-score-v1','clean-package-sha256','clean-score-sha256'].includes(mod.sourceRevision.kind)||!hash(mod.sourceRevision.value))fail('A typed source revision is required.');
  if(identity&&(mod.songId!==identity.songId||!sameRevision(mod.sourceRevision,identity.sourceRevision)))fail('This Mod belongs to a different song or source revision.');
  const config=mod.config;
  if(!keys(config,['layout','showOtherParts','parts'])||!['complete','solo'].includes(config.layout)||typeof config.showOtherParts!=='boolean'||!Array.isArray(config.parts)||!config.parts.length||config.parts.length>128)fail('Unsupported Mod configuration.');
  const ids=new Set();
  for(const part of config.parts){
    if(!keys(part,mod.version===1?v1PartFields:[...v1PartFields,'liveInstrument'])||typeof part.partId!=='string'||!part.partId||part.partId.length>512||ids.has(part.partId)||!['human','machine'].includes(part.performer)||!SONG_MOD_INSTRUMENTS.includes(part.instrument)||(mod.version===2&&!SONG_MOD_LIVE_INSTRUMENTS.includes(part.liveInstrument))||typeof part.muted!=='boolean'||typeof part.visible!=='boolean')fail('Invalid per-part Mod configuration.');
    ids.add(part.partId);
  }
  if(parts&&(parts.length!==config.parts.length||parts.some((part,index)=>(typeof part==='string'?part:part.id)!==config.parts[index].partId)))fail('Mod parts must match every source part in source order.');
  if(!hash(mod.configFingerprint)||mod.configFingerprint!==songModConfigFingerprint(config,mod.version))fail('The Mod configuration fingerprint does not match.');
  return mod;
}
/** Validate the old closed contract before migrating; callers never rewrite v1. */
export function normalizeSongMod(mod,binding) {
  validateSongMod(mod,binding);
  return mod.version===1?createSongMod(mod,mod.config):structuredClone(mod);
}
export function defaultSongMod(context,identity=songModIdentity(context)) {
  const {score}=context;
  const selection=context.practiceSelection||context.selection;
  const selected=new Set(context.mode==='listen'||context.defaultListen?[]:selection?.kind==='all'?score.parts.map(part=>part.id):selection?.part_ids||[context.part||score.parts[0].id]);
  return createSongMod(identity,{layout:context.practiceLayout||'complete',showOtherParts:context.showOthers!==false,parts:score.parts.map(part=>({partId:part.id,performer:selected.has(part.id)?'human':'machine',instrument:'source',muted:false,visible:true}))});
}
export function songModCapabilities({cleanSong=null,compiled}={}) {
  const performers=Boolean(compiled),audioThread=!cleanSong||hasBasicKeyRendition(cleanSong)||isVsqSong(cleanSong)&&Boolean(cleanSong.runtime),audio=audioThread||Boolean(cleanSong&&performers&&inspectCleanRendition(cleanSong).supported);
  return {performers,audio,audioThread,instruments:performers&&audioThread,instrumentReason:audioThread?'':'renderer_has_no_per_part_timbre',audioReason:audio?'':'renderer_has_no_supported_audio'};
}
export function songModOptions(mod,{assistance=null}={}) {
  const {config}=validateSongMod(mod),human=config.parts.filter(part=>part.performer==='human').map(part=>part.partId);
  let machineParts=null;
  if(assistance){
    assertPracticeAssistanceCurrent(assistance,practiceAssistanceBinding(assistance));
    const selected=assistance.plan.selection.selected_part_ids;
    if(selected.length!==human.length||selected.some(id=>!human.includes(id)))fail('The checked note assignment belongs to another Mod human selection.');
    machineParts=new Set(assistance.source_ownership.filter(unit=>unit.owner==='machine').map(unit=>unit.part_id));
  }
  // The legacy target planner needs a nonempty selection even in Listen mode.
  // Listen bypasses human recording/scoring; the Mod remains the role owner.
  return {mode:human.length?'practice':'listen',practiceSelection:human.length===config.parts.length||!human.length?{kind:'all',part_ids:config.parts.map(part=>part.partId)}:{kind:'parts',part_ids:human},part:human.length===1?human[0]:null,practiceLayout:config.layout,showOthers:config.showOtherParts,mutedPartIds:config.parts.filter(part=>part.muted).map(part=>part.partId),hiddenPartIds:config.parts.filter(part=>!part.visible).map(part=>part.partId),instrumentOverrides:Object.fromEntries(config.parts.filter(part=>(machineParts?machineParts.has(part.partId):part.performer==='machine')&&part.instrument!=='source').map(part=>[part.partId,part.instrument]))};
}
/** Only ownership or synthesis-policy changes invalidate the current take. */
export function songModChanges(before,after) {
  validateSongMod(before);validateSongMod(after);
  const previous=new Map(before.config.parts.map(part=>[part.partId,part]));
  const ownership=after.config.parts.some(part=>previous.get(part.partId)?.performer!==part.performer);
  const instruments=after.config.parts.some(part=>previous.get(part.partId)?.instrument!==part.instrument||(previous.get(part.partId)?.liveInstrument||'follow')!==(part.liveInstrument||'follow'));
  const mix=after.config.parts.some(part=>previous.get(part.partId)?.muted!==part.muted);
  const display=before.config.layout!==after.config.layout||before.config.showOtherParts!==after.config.showOtherParts||after.config.parts.some(part=>previous.get(part.partId)?.visible!==part.visible);
  return {ownership,instruments,mix,display,requiresReset:ownership||instruments};
}
export function assertSongModSupported(mod,capabilities,{assistance=null}={}) {
  validateSongMod(mod);
  const options=songModOptions(mod,{assistance});
  if(!capabilities.performers)fail('This source has no supported performance targets.');
  if(assistance&&!capabilities.audioThread)fail('This renderer cannot play the complete checked machine accompaniment.');
  if(!capabilities.instruments&&Object.keys(options.instrumentOverrides).length)fail('This renderer does not support the checked machine sound overrides.');
  if(!capabilities.instruments&&mod.config.parts.some(part=>part.performer==='machine'&&part.instrument!=='source'))fail('This renderer does not support per-part instrument overrides. Restore the source sound to continue.');
  if(!capabilities.audio&&mod.config.parts.some(part=>part.performer==='machine'&&!part.muted))fail('This renderer has no supported source accompaniment. Assign all sounding parts to a human or mute them.');
}

/** Storage errors keep the usable session Mod and never erase an older copy. */
export class SongModStore {
  constructor({storage}={}){this.storage=storage;this.entries=new Map();this.identities=new WeakMap();}
  identity(context){const score=context.pitchView?.sourceView.score||context.score;let identity=this.identities.get(score);if(!identity){identity=songModIdentity(context);this.identities.set(score,identity);}return identity;}
  commitSaved(context,mod){const identity=this.identity(context);validateSongMod(mod,{identity,parts:context.score.parts});const next={...this.read(context),mod:structuredClone(mod),status:'saved',explicit:true};this.entries.set(this.key(identity),next);return next;}
  key(identity,prefix=SONG_MOD_STORAGE_PREFIX){return prefix+encodeURIComponent(identity.songId)+'.'+identity.sourceRevision.kind+'.'+identity.sourceRevision.value;}
  target(){return this.storage===undefined?globalThis.localStorage:this.storage;}
  read(context){
    const identity=this.identity(context),key=this.key(identity);if(this.entries.has(key)){const entry=this.entries.get(key);if(!entry.explicit){entry.mod=defaultSongMod(context,identity);entry.original=entry.mod;}return entry;}
    const original=defaultSongMod(context,identity);let mod=original,status='default';
    try{const target=this.target();if(typeof target?.getItem!=='function')status='unavailable';else{const raw=target.getItem(key)??target.getItem(this.key(identity,SONG_MOD_LEGACY_STORAGE_PREFIX));if(raw!=null){if(typeof raw!=='string')fail('Saved Mod must be JSON text.');if(raw.length>256*1024)fail('Saved Mod exceeds its size budget.');mod=normalizeSongMod(JSON.parse(raw),{identity,parts:context.score.parts});status='saved';}}}catch{status='unavailable';}
    const entry={mod,original,status,explicit:status==='saved'};this.entries.set(key,entry);return entry;
  }
  save(context,mod){
    const identity=this.identity(context);mod=normalizeSongMod(mod,{identity,parts:context.score.parts});const entry=this.read(context);let status='unsaved';
    try{const target=this.target();if(typeof target?.setItem==='function'){target.setItem(this.key(identity),JSON.stringify(mod));status='saved';}}catch{/* Keep current choices without claiming persistence. */}
    const next={...entry,mod:structuredClone(mod),status,explicit:true};this.entries.set(this.key(identity),next);return next;
  }
}
