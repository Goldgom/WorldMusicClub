// Portable incremental SHA-256. Shared by host preparation and the actual
// processor: constant scratch storage, no WebCrypto/DOM/timers in the worklet.
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotate = (n,s) => n >>> s | n << (32-s);
export class CanonicalSha256 {
  constructor() { this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.block=new Uint8Array(64);this.words=new Uint32Array(64);this.used=0;this.bytes=0; }
  compress() {
    const w=this.words,b=this.block;
    for(let i=0;i<16;i++)w[i]=(b[i*4]<<24|b[i*4+1]<<16|b[i*4+2]<<8|b[i*4+3])>>>0;
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^a>>>3)+w[i-7]+(rotate(b,17)^rotate(b,19)^b>>>10))>>>0;}
    let a=this.h[0],b0=this.h[1],c=this.h[2],d=this.h[3],e=this.h[4],f=this.h[5],g=this.h[6],h=this.h[7];
    for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b0)^(a&c)^(b0&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b0;b0=a;a=(t1+t2)>>>0;}
    this.h[0]=(this.h[0]+a)>>>0;this.h[1]=(this.h[1]+b0)>>>0;this.h[2]=(this.h[2]+c)>>>0;this.h[3]=(this.h[3]+d)>>>0;this.h[4]=(this.h[4]+e)>>>0;this.h[5]=(this.h[5]+f)>>>0;this.h[6]=(this.h[6]+g)>>>0;this.h[7]=(this.h[7]+h)>>>0;
  }
  update(bytes) { if(this.finished)throw new Error('Fingerprint already finalized');this.bytes+=bytes.length;for(let i=0;i<bytes.length;i++){this.block[this.used++]=bytes[i];if(this.used===64){this.compress();this.used=0;}}return this; }
  hex() { if(this.finished)return this.finished;const length=this.bytes;this.block[this.used++]=128;if(this.used>56){this.block.fill(0,this.used);this.compress();this.used=0;}this.block.fill(0,this.used,56);const view=new DataView(this.block.buffer);view.setUint32(56,Math.floor(length/0x20000000));view.setUint32(60,(length*8)>>>0);this.compress();this.finished=Array.from(this.h,n=>n.toString(16).padStart(8,'0')).join('');return this.finished; }
}
// AudioWorkletGlobalScope does not promise TextEncoder. Encode Unicode scalar
// values directly, rejecting lone surrogates rather than replacing source IDs.
export function canonicalUtf8(s){
  if(typeof s!=='string')fail();let size=0;
  for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c>=0xd800&&c<=0xdfff)fail();size+=c<0x80?1:c<0x800?2:c<0x10000?3:4;if(c>0xffff)i++;}
  const out=new Uint8Array(size);let j=0;
  for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<0x80)out[j++]=c;else if(c<0x800){out[j++]=0xc0|(c>>6);out[j++]=0x80|(c&63);}else if(c<0x10000){out[j++]=0xe0|(c>>12);out[j++]=0x80|((c>>6)&63);out[j++]=0x80|(c&63);}else{out[j++]=0xf0|(c>>18);out[j++]=0x80|((c>>12)&63);out[j++]=0x80|((c>>6)&63);out[j++]=0x80|(c&63);i++;}}return out;
}
const fail = () => { throw Object.assign(new Error('Canonical fingerprint value or byte budget is invalid'),{code:'canonical_audio_budget'}); };
export class CanonicalFingerprint {
  constructor(domain,{maxBytes=64*1024*1024}={}) { this.hash=new CanonicalSha256();this.maxBytes=maxBytes;this.scratch=new Uint8Array(9);this.view=new DataView(this.scratch.buffer);this.one=this.scratch.subarray(0,1);this.five=this.scratch.subarray(0,5);this.string(domain); }
  put(bytes) { if(this.hash.bytes+bytes.length>this.maxBytes)fail();this.hash.update(bytes); }
  tag(tag) { this.scratch[0]=tag;this.put(this.one); }
  length(tag,n) { if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)fail();this.scratch[0]=tag;this.view.setUint32(1,n,true);this.put(this.five); }
  number(n) { if(!Number.isFinite(n))fail();this.scratch[0]=3;this.view.setFloat64(1,n===0?0:n,true);this.put(this.scratch); }
  string(s) { const b=canonicalUtf8(s);this.length(4,b.length);this.put(b); }
  value(value,depth=0) {
    if(depth>64)fail();
    if(value===null)this.tag(0);else if(typeof value==='boolean')this.tag(value?2:1);else if(typeof value==='number')this.number(value);else if(typeof value==='string')this.string(value);
    else if(Array.isArray(value)){this.length(5,value.length);for(const v of value)this.value(v,depth+1);}
    else if(value&&Object.getPrototypeOf(value)===Object.prototype){const keys=Object.keys(value).sort((a,b)=>{const aa=Array.from(a),bb=Array.from(b);for(let i=0;i<Math.min(aa.length,bb.length);i++){const d=aa[i].codePointAt(0)-bb[i].codePointAt(0);if(d)return d;}return aa.length-bb.length;});this.length(6,keys.length);for(const k of keys){this.string(k);this.value(value[k],depth+1);}}
    else fail();return this;
  }
  gate(index,start,end,key,velocity) { this.length(5,5);this.number(index);this.number(start);this.number(end);this.number(key);this.number(velocity); }
  hex() { return this.hash.hex(); }
}
export const canonicalFingerprint = (domain,value,options) => new CanonicalFingerprint(domain,options).value(value).hex();
