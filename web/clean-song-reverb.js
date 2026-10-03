/** Authored deterministic room reference, not an original plugin rendition. */
export const REFERENCE_ROOM = Object.freeze({id:'wmh-reference-room-v1',seconds:1.2,maxWetGain:0.22,maxSampleRate:96000});
const impulses=new WeakMap();
function impulse(context){
  if(impulses.has(context))return impulses.get(context);
  const buffer=context.createBuffer(2,Math.ceil(context.sampleRate*REFERENCE_ROOM.seconds),context.sampleRate);let seed=0x574d4801;
  for(let channel=0;channel<2;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=((seed>>>0)/2147483648-1)*Math.pow(1-i/data.length,3)*0.2;}}
  impulses.set(context,buffer);return buffer;
}
export function createReferenceRoom(context, output) {
  if(!context.createConvolver||!context.createBuffer||!Number.isFinite(context.sampleRate)||context.sampleRate<=0||context.sampleRate>REFERENCE_ROOM.maxSampleRate)throw new Error('Bounded procedural room audio is unavailable.');
  const nodes=[];let closed=false,convolver;
  const close=()=>{if(closed)return;closed=true;for(const node of nodes)node.disconnect();if(convolver)convolver.buffer=null;};
  try{
    const add=node=>{nodes.push(node);return node;},input=add(context.createGain()),send=add(context.createGain()),wet=add(context.createGain());convolver=add(context.createConvolver());
    convolver.normalize=false;convolver.buffer=impulse(context);send.gain.value=0;wet.gain.value=0;
    input.connect(output);input.connect(send);send.connect(convolver);convolver.connect(wet);wet.connect(output);
    return{input,set(value,at=context.currentTime){if(closed)return;send.gain.setValueAtTime(value/127,at);wet.gain.setValueAtTime(value===0?0:REFERENCE_ROOM.maxWetGain,at);},close};
  }catch(error){close();throw error;}
}
