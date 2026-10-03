import {createHash} from 'node:crypto';
import {preparePerformanceSong,PERFORMANCE_PROFILE} from '../web/clean-song-package.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
/** Entirely authored, three-track UI protocol fixture. This is not a MIDI
 * decoder or a timing compiler: Rust compilation is verified in its own suite. */
export function completePerformanceDescriptor({shared=false,blocked=false,controls=false,deviceName=null,title='Authored complete performance'}={}){
  const source={format:'midi',sha256:hash('original complete event UI fixture'),bytes:1};
  const channel=shared?0:1;
  const keyCommand=(kind,key,velocity,channel=0)=>({kind,key,velocity,channel});
  const rows=[
    [[0,{kind:'tempo',microseconds_per_quarter:500000}],[600000,{kind:'track_end'}]],
    [[0,{kind:'instrument_program',channel:0,program:80}],...(blocked?[[0,{kind:'channel_pressure',channel:0,pressure:100}]]:[]),...(controls?[[0,{kind:'volume',channel:0,value:100}],[0,{kind:'sustain',channel:0,value:127}]]:[]),[0,keyCommand('key_attack',60,90)],[100000,keyCommand('key_attack',60,70)],[200000,keyCommand('key_release',60,20)],[400000,keyCommand('key_release',60,45)],...(controls?[[500000,{kind:'sustain',channel:0,value:0}]]:[]),[600000,{kind:'track_end'}]],
    [[0,keyCommand('key_attack',65,85,channel)],[300000,keyCommand('key_release',65,31,channel)],[600000,{kind:'track_end'}]],
  ];
  if(deviceName!==null)for(const row of rows.slice(1))row.unshift([0,{kind:'text',role:'device_name',text:deviceName}]);
  const tracks=rows.map((events,index)=>({id:`track-${index+1}`,source_index:index,name:['Authored conductor','Authored repeated attacks','Authored lower line'][index],source_event_count:events.length,end:{numerator:6,denominator:5}}));
  const parts=[{id:'midi-t2-c1',track_id:'track-2',channel:0,sound_identity:'unspecified_midi_route'},{id:`midi-t3-c${channel+1}`,track_id:'track-3',channel,sound_identity:'unspecified_midi_route'}];
  const events=rows.flatMap((row,track)=>row.map(([micros,command],event)=>({event_id:`midi:${source.sha256}:t${track}:e${event}`,exact_microseconds:{numerator:String(micros),denominator:1},origin:{track,event},command:{...command,...(['key_attack','key_release'].includes(command.kind)?{part_id:`midi-t${track+1}-c${command.channel+1}`}:{})}})))
    .sort((a,b)=>Number(a.exact_microseconds.numerator)-Number(b.exact_microseconds.numerator)||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
  const unavailable={status:'unavailable',represented_attacks:0,reason:'not_derived_from_independent_events'};
  const coverage={performance:{status:'complete',source_tracks:3,source_events:events.length,represented_events:events.length,key_attacks:3,key_releases:3},notation:unavailable,targets:unavailable};
  const score={format:'worldmusichub-complete-score',version:2,id:'authored-complete-event-ui',title,source,notation:null,performance:{profile:PERFORMANCE_PROFILE,end:{numerator:6,denominator:5},tracks,parts,events:events.map(({exact_microseconds,...event})=>({...event,at:{numerator:Number(exact_microseconds.numerator),denominator:500000}}))},coverage};
  const score_json=JSON.stringify(score),scoreHash=hash(score_json);
  const metadata={format:'worldmusichub-song',version:2,id:score.id,title,sources:[source],score:{path:'score.json',bytes:Buffer.byteLength(score_json),sha256:scoreHash},media:[]};
  const runtime={profile:PERFORMANCE_PROFILE,score_id:score.id,score_sha256:scoreHash,source_sha256:source.sha256,tracks,parts,events,coverage,duration_microseconds:{numerator:'600000',denominator:1}};
  const content_sha256=hash(`original test package:${scoreHash}`),key=`song-${content_sha256}`;
  const summary={version:2,content_sha256,profile:PERFORMANCE_PROFILE,notation_available:false,coverage,media:[]};
  const descriptor={...summary,metadata_json:JSON.stringify(metadata),score_json,runtime};
  const entry={key,revision:1,title,composer:'',score_id:score.id,label:title,score_bytes:Buffer.byteLength(score_json),saved_at_unix_ms:1700000000000,clean_package:summary};
  return{descriptor,entry,score,key,libraryKey:`native:${key}`};
}
export async function completePerformanceSong(options){const fixture=completePerformanceDescriptor(options);return preparePerformanceSong(fixture.libraryKey,fixture.descriptor,null);}

class Parameter{constructor(){this.events=[];}setValueAtTime(value,at){this.value=value;this.events.push(['set',value,at]);}linearRampToValueAtTime(value,at){this.events.push(['ramp',value,at]);}setTargetAtTime(){}exponentialRampToValueAtTime(){}cancelScheduledValues(){}}
export class PerformanceAudio{
  constructor(){this.currentTime=0;this.state='running';this.sampleRate=8000;this.nodes=[];this.destination={context:this};}
  create(kind){const node={context:this,kind,gain:new Parameter(),pan:new Parameter(),frequency:new Parameter(),Q:new Parameter(),connections:[],starts:[],stops:[],disconnected:false,connect(target){this.connections.push(target);},disconnect(){this.disconnected=true;},start(at){this.starts.push(at);},stop(at){this.stops.push(at);}};this.nodes.push(node);return node;}
  createStereoPanner(){return this.create('panner');}createConvolver(){return this.create('convolver');}
  createGain(){return this.create('gain');}createOscillator(){return this.create('oscillator');}createBufferSource(){return this.create('noise');}createBiquadFilter(){return this.create('filter');}
  createBuffer(channels,length){return{getChannelData:()=>new Float32Array(length)};}
  async resume(){this.state='running';}
}
export class PerformanceTimers{
  constructor(){this.now=0;this.serial=0;this.pending=new Map();}
  setTimeout=(fn,ms)=>{const id=++this.serial;this.pending.set(id,{fn,at:this.now+ms});return id;};
  clearTimeout=id=>this.pending.delete(id);
  advance(ms,audio){const end=this.now+ms;while(this.now<end){this.now=Math.min(end,this.now+10);audio.currentTime=this.now/1000;for(const[id,item]of [...this.pending])if(item.at<=this.now){this.pending.delete(id);item.fn();}}}
}
