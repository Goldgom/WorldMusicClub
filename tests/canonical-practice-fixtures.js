import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';

/** Original Rust-compiled tie/repeat evidence, rendered through the production
 * canonical DSP core in the Node port harness. This is not a browser/device. */
export async function canonicalPracticeApp(options={}){
  const evidence=JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url))),score=evidence.compilation.score;
  const server=await nativeScoreServer({scores:[score]});let extra=null,clock=1000;
  server.setRoute(async request=>{
    const value=await extra?.(request);if(value!==undefined)return value;
    const {path,body}=request;
    if(path==='/api/compile'&&body.id===score.id)return nativeResponse(evidence.compilation);
    if(path==='/api/canonical-audio-profile'&&body.id===score.id)return nativeResponse(evidence.profile);
    if(path==='/api/practice-window'){
      const start_ms=body.from.numerator/body.from.denominator*500,end_ms=body.to.numerator/body.to.denominator*500;
      return nativeResponse({start_ms,end_ms,from:body.from,to:body.to,target_note_ids:evidence.compilation.timeline.notes.filter(note=>note.start_ms>=start_ms&&note.start_ms<end_ms).map(note=>note.id),crossing_notes:evidence.compilation.timeline.notes.filter(note=>note.start_ms<start_ms&&note.start_ms+note.duration_ms>start_ms).length,diagnostics:[]});
    }
    if(path==='/api/practice-targets'){
      // Model the existing Rust physical-input result. Keep source audio raw.
      const grouped=new Map();for(const note of body.timeline.notes){const key=`${note.start_ms}:${note.midi}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(note);}
      const groups=[],notes=[];for(const entries of grouped.values()){
        entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const source_note_ids=[...new Set(entries.flatMap(note=>note.source_note_ids))],part_ids=[...new Set(entries.map(note=>note.part_id))],note={...entries[0],source_note_ids,duration_ms:Math.max(...entries.map(note=>note.duration_ms)),velocity:Math.max(...entries.map(note=>note.velocity))};notes.push(note);groups.push({target_id:note.id,source_occurrence_ids:entries.map(note=>note.id),source_note_ids,part_ids});
      }
      return nativeResponse({timeline:{...body.timeline,notes},groups,diagnostics:[],source_note_count:body.timeline.notes.length,target_count:notes.length,playable:notes.length>0});
    }
    if(path==='/api/assess')return nativeResponse({hits:[],misses:body.timeline.notes.map(note=>note.id),extras:[],accuracy_percent:0,mean_abs_error_ms:null,summary:{expected_notes:body.timeline.notes.length,coverage_percent:0,timing_bias_ms:null,timing_stddev_ms:null,advice:[]},pitch_breakdown:[],grade_counts:{perfect:0,good:0,early:0,late:0,missed:body.timeline.notes.length,extra:0},onset_completion:{total:body.timeline.notes.length,complete:0,longest_complete_sequence:0}});
  });
  const app=await nativeStorageApp(server,{now:()=>clock,...options});const key=[...server.records.keys()][0];
  await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-complete-practice').disabled);
  return {app,server,evidence,score,time(value){clock=value;app.renderAudioTo((value-1000)/1000);},setRoute(handler){extra=handler;},receiver(){return app.audioNodes.findLast(node=>node.core?.plan?.protocol==='wmh-canonical-audio-v1'&&node.connected);}};
}
