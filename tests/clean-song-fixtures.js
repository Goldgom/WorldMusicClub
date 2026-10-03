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
