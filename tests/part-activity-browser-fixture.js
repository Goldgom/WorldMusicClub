import {createHash} from 'node:crypto';
// Original CC0 mechanical gates. Exact source bytes are retained in evidence.
export function partActivityMidi({suffix=''}={}) {
 const vlq=n=>{const a=[n&127];while(n>>=7)a.unshift((n&127)|128);return a;};
 const track=(name,channel,notes)=>{const label=Buffer.from(name),events=[[0,[255,3,...vlq(label.length),...label]],[0,[255,81,3,15,66,64]]];for(const [start,end,key]of notes)events.push([start*96,[144|channel,key,80]],[end*96,[128|channel,key,0]]);events.sort((a,b)=>a[0]-b[0]);let previous=0;const bytes=Buffer.from(events.flatMap(([at,value])=>{const delta=at-previous;previous=at;return[...vlq(delta),...value];}).concat([0,255,47,0]));const header=Buffer.alloc(8);header.write('MTrk');header.writeUInt32BE(bytes.length,4);return Buffer.concat([header,bytes]);};
 const names=['Human original','Machine gap 原创伴奏 '.repeat(6).trim(),'Machine high original'].map(n=>n+suffix);
 const bytes=Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,1,0,3,0,96]),track(names[0],0,[[0,1,60],[19,20,64]]),track(names[1],1,[[0,4,55],[8,12,55]]),track(names[2],2,[[0,20,115]])]);
 return{bytes,names:names.map((name,index)=>`${name} · channel ${index+1}`),sha256:createHash('sha256').update(bytes).digest('hex'),rights:{license:'CC0-1.0',attribution:'Original machine activity mechanical gates authored for acceptance'},gateWindows:{playing:[1000,3000],silent:[5000,7000]},durationMs:20000};
}
