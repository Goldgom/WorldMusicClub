import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareCleanSong} from '../web/clean-song-package.js';
export const fixtureHash='c'.repeat(64);
export const fixtureKey=`native:song-${fixtureHash}`;
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
export function cleanDescriptor(change=()=>{}){
  const score=JSON.parse(read('./fixtures/clean-song-v2/score.json')),metadata=JSON.parse(read('./fixtures/clean-song-v2/metadata.json')),runtime=JSON.parse(read('./fixtures/clean-song-v2-runtime.json'));
  change({score,metadata,runtime});
  return{version:2,content_sha256:fixtureHash,metadata_json:JSON.stringify(metadata),score_json:JSON.stringify(score),media:metadata.media.map(({path,...item})=>({...item,handle:`asset-${item.sha256}`})),runtime};
}
export const cleanSong=(change)=>{const descriptor=cleanDescriptor(change);return prepareCleanSong(fixtureKey,descriptor,descriptor.runtime.compilation.score);};
export function mediaFixture({id='cover',role='cover',mime='image/png',content='authored-media',offset_ms}={}){const data=Buffer.from(content),sha256=createHash('sha256').update(data).digest('hex');return{data,descriptor:{id,role,mime,path:`media/${id}`,bytes:data.length,sha256,...(offset_ms===undefined?{}:{offset_ms})}};}
export function fakeAudio(){
  const nodes=[],parameter=()=>({value:0,events:[],setValueAtTime(value,at){this.value=value;this.events.push({value,at});},linearRampToValueAtTime(value,at){this.events.push({value,at});},exponentialRampToValueAtTime(value,at){this.events.push({value,at});},cancelScheduledValues(){}});
  const node=(type,extra={})=>{const item={kind:type,type,connections:[],disconnected:false,connect(to){this.connections.push(to);},disconnect(){this.disconnected=true;},...extra};nodes.push(item);return item;};
  const context={currentTime:0,state:'running',sampleRate:8000,destination:{},createGain:()=>node('gain',{gain:parameter()}),createStereoPanner:()=>node('pan',{pan:parameter()}),createConvolver:()=>node('convolver'),createBuffer:(channels,length)=>({length,getChannelData:()=>new Float32Array(length)}),createOscillator:()=>node('oscillator',{frequency:parameter(),starts:[],stops:[],start(at){this.starts.push(at);},stop(at){this.stops.push(at);}})};
  return{context,nodes,output:node('output')};
}

export function initialSensitivitySong(change=()=>{}) {
  const score=JSON.parse(read('./fixtures/clean-song-v2-rpn/score.json')),
    metadata=JSON.parse(read('./fixtures/clean-song-v2-rpn/metadata.json')),
    runtime=JSON.parse(read('./fixtures/clean-song-v2-rpn-runtime.json'));
  change({score,metadata,runtime});
  const descriptor={version:2,content_sha256:fixtureHash,metadata_json:JSON.stringify(metadata),score_json:JSON.stringify(score),media:[],runtime};
  return prepareCleanSong(fixtureKey,descriptor,runtime.compilation.score);
}

// Original synthetic adapter response, built from the repository's authored
// exercise. This is transport evidence, not a JavaScript MIDI compiler.
export function initialSensitivity12Song(change=()=>{}) {
  return initialSensitivitySong(({score,metadata,runtime})=>{
    const M='select_most_significant_zero',L='select_least_significant_zero',S='set_semitones12',C='set_cents_zero';
    const sequences=[[L,M,S,C],[L,M,L,M,S,S,C,C],[M,L,M,L,S,S,C,C]];
    const shift=origin=>({...origin,event:origin.event+(origin.track>0&&origin.event>=8?sequences[origin.track-1].length-6:0)});
    for(const events of [score.performance.events,runtime.events]){
      const replacements=[];
      for(const event of events){
        const channel=event.command.channel,steps=sequences[channel];
        if(event.command.kind==='initial_pitch_bend_sensitivity'){
          if(event.origin.event!==2)continue;
          steps.forEach((step,index)=>{
            const entry=structuredClone(event);entry.origin.event=2+index;
            entry.command={kind:'initial_pitch_bend_sensitivity12',channel,step};
            if(entry.at)entry.at={numerator:index+1,denominator:9600};
            else{entry.exact_microseconds={numerator:String((index+1)*625),denominator:12};entry.at_ms=(index+1)*625/12/1000;}
            replacements.push(entry);
          });
        }else{
          const entry=structuredClone(event),after=entry.origin.track>0&&entry.origin.event>=8;
          entry.origin=shift(entry.origin);
          if(after&&entry.at?.numerator===0)entry.at={numerator:8,denominator:9600};
          if(after&&entry.at_ms===0){entry.exact_microseconds={numerator:'5000',denominator:12};entry.at_ms=5000/12/1000;}
          replacements.push(entry);
        }
      }
      replacements.sort((a,b)=>{
        const left=a.at??a.exact_microseconds,right=b.at??b.exact_microseconds;
        return Number(left.numerator)/left.denominator-Number(right.numerator)/right.denominator||a.origin.track-b.origin.track||a.origin.event-b.origin.event;
      });
      events.splice(0,events.length,...replacements);
    }
    for(const note of [...score.performance.notes,...runtime.notes]){note.attack=shift(note.attack);note.release=shift(note.release);}
    score.performance.tracks.forEach(track=>{if(track.source_index)track.source_event_count+=sequences[track.source_index-1].length-6;});
    score.coverage.source_events+=2;score.coverage.represented_events+=2;
    for(const event of runtime.events)event.event_id=`midi:${score.source.sha256}:t${event.origin.track}:e${event.origin.event}`;
    for(const note of runtime.notes)note.event_id=`midi:${score.source.sha256}:t${note.attack.track}:e${note.attack.event}`;
    change({score,metadata,runtime});
  });
}
