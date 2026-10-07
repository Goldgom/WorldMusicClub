import {originalPitchContext,pitchModSource} from './pitch-mod.js';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unsupported=new Set(['unsupported_source_profile','unsupported_canonical_midi','unsupported_disclosure_profile']);
const sameSource=(a,b)=>a&&b&&['key','content_sha256','profile','choice','runtime_policy'].every(key=>a[key]===b[key]);
const failure=()=>Object.assign(new Error('Source instrument details do not match the original source.'),{code:'source_instrument_binding'});
const fields=(token,status,details=null,error=null)=>({sourceInstrumentDetailsToken:token,sourceInstrumentDetailsStatus:status,sourceInstrumentDetails:details,sourceInstrumentDetailsError:error});

/** Read-only, source-scoped cache. A late response updates only its own entry;
 * callers always read the current source rather than installing an async result.
 * Pitch/progression targets and renderer overrides are never metadata inputs. */
export class SourceInstrumentDetailsLoader {
  constructor({api,onChange=()=>{}}){this.api=api;this.onChange=onChange;this.entries=new WeakMap();}
  read(context){
    const original=originalPitchContext(context),score=original?.score,song=original?.cleanSong,token=song||score;
    if(!score||!token)return fields(null,'absent');
    const cached=this.entries.get(token);if(cached)return cached.value;
    const source=song?pitchModSource(original):null;
    let path,body;
    if(song){path='/api/library/source-instrument-details';body={source};}
    else if(!score.source){const value=fields(token,'absent');this.entries.set(token,{value});return value;}
    else if(score.source.format!=='midi-base64'){const value=fields(token,'unsupported');this.entries.set(token,{value});return value;}
    else{path='/api/source-instrument-details/canonical';body=score;}
    const entry={value:fields(token,'loading')};this.entries.set(token,entry);
    // Schedule after read returns: even a synchronous transport cannot reenter
    // view rendering before the cache entry and loading state exist.
    entry.pending=Promise.resolve().then(()=>this.api(path,body)).then(response=>{
      const details=response?.details,binding=details?.source_binding;
      const expected=score.parts.map(part=>part.id),received=details?.parts?.map(part=>part.part_id);
      const basic=Boolean(song?.profile==='wmh-basic-keys-midi1-v1');
      if(source&&!sameSource(response?.source,source)||details?.revision!==1||binding?.serialization_revision!==1||!hash(binding?.digest)||binding.domain!==(basic?'wmc-basic-complete-wire-json':'wmc-canonical-score-serde-json')||!hash(details?.original_midi_sha256)||!Array.isArray(received)||received.length!==expected.length||new Set(received).size!==received.length||expected.some(id=>!received.includes(id)))throw failure();
      entry.value=fields(token,'ready',details);
    }).catch(error=>{entry.value=fields(token,unsupported.has(error?.code)?'unsupported':'error',null,error);}).then(()=>this.onChange());
    return entry.value;
  }
}
