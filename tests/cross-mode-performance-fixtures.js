import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';

const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));

// Existing original fixtures, actual app/Mod/player/core code, in-memory native
// protocol and DOM. This does not claim browser, device, or fresh Rust evidence.
export async function crossModePerformanceApp(){
  const canonical=read('canonical-audio-evidence'),server=await nativeScoreServer({scores:[canonical.compilation.score]}),keys={canonical:[...server.records.keys()][0]};
  const sources={canonical:{score:canonical.compilation.score,evidence:canonical}};
  for(const [name,opened] of [['basic',basicKeyRenditionFixture()],['vsq',read('vsq-clean-v1-native-open')]]){
    const descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,key=`song-${descriptor.content_sha256}`;
    const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,media:[]};
    for(const field of ['coverage','notation_available','interpretation_limits'])if(descriptor[field]!==undefined)summary[field]=descriptor[field];
    server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(descriptor.score_json),saved_at_unix_ms:1700000000000,clean_package:summary}});
    keys[name]=key;sources[name]={score,descriptor};
  }
  const pages=read('basic-key-rendition-notation-page'),third=read('basic-key-rendition-third-part'),vsqRuntime=read('vsq-clean-v1-runtime');
  let additionalRoute=null;
  server.setRoute(async request=>{
    const supplied=await additionalRoute?.(request);if(supplied!==undefined)return supplied;
    const {path,body}=request;
    if(path==='/api/compile'&&body.id===sources.canonical.score.id)return nativeResponse(canonical.compilation);
    if(path==='/api/canonical-audio-profile'&&body.id===sources.canonical.score.id)return nativeResponse(canonical.profile);
    if(path==='/api/library/runtime')return nativeResponse(vsqRuntime);
    if(path==='/api/library/basic-keys/notation')return nativeResponse(body.settings.part_id===sources.basic.score.parts[1].id?pages.percussion.response:body.settings.part_id===sources.basic.score.parts[2].id?third.response:pages.melodic.response);
    if(path==='/api/practice-targets'){
      const grouped=new Map();
      for(const note of body.timeline.notes){const key=`${note.start_ms}:${note.midi}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(note);}
      const notes=[],groups=[];
      for(const entries of grouped.values()){
        entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
        const source_note_ids=[...new Set(entries.flatMap(note=>note.source_note_ids||[note.id]))],part_ids=[...new Set(entries.map(note=>note.part_id))];
        const note={...entries[0],source_note_ids,duration_ms:Math.max(...entries.map(note=>note.duration_ms)),velocity:Math.max(...entries.map(note=>note.velocity))};
        notes.push(note);groups.push({target_id:note.id,source_occurrence_ids:entries.map(note=>note.id),source_note_ids,part_ids});
      }
      return nativeResponse({timeline:{...body.timeline,notes},groups,diagnostics:[],source_note_count:body.timeline.notes.length,target_count:notes.length,playable:notes.length>0});
    }
    if(path==='/api/practice-window'){
      const start_ms=body.from.numerator/body.from.denominator*500,end_ms=body.to.numerator/body.to.denominator*500;
      return nativeResponse({start_ms,end_ms,from:body.from,to:body.to,target_note_ids:canonical.compilation.timeline.notes.filter(note=>note.start_ms>=start_ms&&note.start_ms<end_ms).map(note=>note.id),crossing_notes:0,diagnostics:[]});
    }
    if(path==='/api/assess')return nativeResponse({hits:[],misses:body.timeline.notes.map(note=>note.id),extras:[],accuracy_percent:0,mean_abs_error_ms:null,summary:{expected_notes:body.timeline.notes.length,coverage_percent:0,timing_bias_ms:null,timing_stddev_ms:null,advice:[]},pitch_breakdown:[],grade_counts:{perfect:0,good:0,early:0,late:0,missed:body.timeline.notes.length,extra:0},onset_completion:{total:body.timeline.notes.length,complete:0,longest_complete_sequence:0}});
  });
  let clock=1000;const storageValues=new Map(),app=await nativeStorageApp(server,{now:()=>clock,storageValues});
  await app.until(()=>Object.values(keys).every(key=>app.savedButton(key))&&!app.$('start-performance').disabled);
  await app.click('home-single-player');
  const select=async name=>{
    if(app.document.body.dataset.screen==='stage')await app.click('back-to-library');
    app.savedButton(keys[name]).click();
    await app.until(()=>app.$('preview-title').textContent===sources[name].score.title&&app.$('song-lobby').dataset.previewStatus===(name==='vsq'?'choice':'ready'));
    if(name==='vsq'){
      await app.click('vsq-choose-base-notes');
      await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready');
    }
    await app.until(()=>!app.$('configure-song-mod').disabled);
  };
  return{app,server,keys,sources,storageValues,select,setRoute:route=>{additionalRoute=route;},time(ms){clock+=ms;app.renderAudioTo((clock-1000)/1000);app.frame();},receiver(){return app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected);}};
}

export const modControl=(app,kind,id)=>app.$('song-mod-parts').querySelector(`[data-mod-${kind}="${id}"]`);
export function setMod(app,kind,id,value){const node=modControl(app,kind,id);if(typeof value==='boolean')node.checked=value;else node.value=value;app.emit(node,'change');}
export async function applyMod(app){await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open&&(app.document.body.dataset.screen!=='stage'||!app.$('play-button').disabled),'Mod Apply must settle');}
export const renderer=(app,name)=>app.$(name==='canonical'?'canonical-audio-policy':'clean-song-stage');
export async function startPerformance(app,name){await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage'&&renderer(app,name).dataset.rendererState==='playing');}
