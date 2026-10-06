// Original synthetic pixels and metadata for consumer tests only, never GUI proof.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
export function syntheticCapturePng({width=640,height=360,uniform=false,filter=0,alpha=null}={}){
 const crc=bytes=>{let value=0xffffffff;for(const b of bytes){value^=b;for(let bit=0;bit<8;bit++)value=value>>>1^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const channels=alpha===null?3:4;header[9]=channels===3?2:6;const rgb=Buffer.alloc(width*height*channels),raw=Buffer.alloc((width*channels+1)*height);let seed=17,first,nonBlack=0,different=0,min=255,max=0;
 for(let at=0;at<rgb.length;at++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;rgb[at]=channels===4&&at%channels===3?alpha:uniform?0:seed>>>24;}
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){
  raw[y*(width*channels+1)]=filter;
  for(let x=0;x<width*channels;x++){const at=y*width*channels+x,left=x>=channels?rgb[at-channels]:0,above=y?rgb[at-width*channels]:0,corner=y&&x>=channels?rgb[at-width*channels-channels]:0;raw[y*(width*channels+1)+x+1]=(rgb[at]-(filter===0?0:filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):paeth(left,above,corner)))&255;}
 }
 for(let at=0;at<rgb.length;at+=channels){const r=rgb[at],g=rgb[at+1],b=rgb[at+2],value=r*65536+g*256+b;first??=value;if(value)nonBlack++;if(value!==first)different++;min=Math.min(min,r,g,b);max=Math.max(max,r,g,b);}
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 return{bytes,width,height,non_black_pixels:nonBlack,different_pixels:different,channel_min:min,channel_max:max};
}
export function syntheticPassiveCapture({picture=syntheticCapturePng(),native={source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),executable_sha256:'3'.repeat(64)},phase='vsq-seed',processId=101,sequence=17}={}){
 const {bytes,...pixels}=picture,{width,height}=pixels;
 const target={process_id:processId,owner_process_id:processId,hwnd:1010,root_hwnd:1010,foreground_hwnd:1010,visible:true,enabled:true,client_rect:[0,0,width,height],client_origin:[0,31],client_screen:[0,31,width,31+height],work_area:[0,0,width,31+height],viewport:[width,height],device_pixel_ratio:1,window_dpi:96,system_dpi:96,window_awareness:1,caller_awareness:1,monitor_scale_percent:100,monitor_scale_hresult:0,monitor_count:1,monitor_rect:[0,0,width,31+height],windows_above:[]};
 return{version:1,kind:'foreground-client-pixels',method:'CopyFromScreen',phase,sequence,source_sha:native.source_sha,source_tree:native.source_tree,executable_sha256:native.executable_sha256,before:target,after:structuredClone(target),input:{pointer_moved:false,pointer_clicked:false,focus_changed:false,keyboard_sent:false},file:`native-action-${phase}-${sequence}.png`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...pixels,timings:{started_ms:0,target_checked_ms:1,copy_started_ms:2,copy_finished_ms:3,target_rechecked_ms:4,pixels_verified_ms:5,png_saved_ms:6,finished_ms:7}};
}
