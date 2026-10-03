/** Owns only verified Blob URLs. Loading never authorizes playback. */
export function createCleanSongMedia({loadAsset,cover,background,video,createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),onStatus=()=>{}}) {
  const nodes={cover,background,pv:video},assets=new Map();let epoch=0,key=null,controller=null,authorized=false,playRequest=0,position=0,running=false,pendingPlay=null;
  const snapshot=()=>({key,media:[...assets.values()].map(({descriptor,status,error})=>({id:descriptor.id,role:descriptor.role,status,error})),running,authorized});
  const publish=()=>onStatus(snapshot());
  const pvAsset=()=>[...assets.values()].find(item=>item.descriptor.role==='pv');
  const videoTime=asset=>(position-(asset.descriptor.offset_ms||0))/1000;
  const ownsVideo=asset=>Boolean(asset?.url&&asset.status!=='error'&&video?.src===asset.url);
  const mayPlay=asset=>ownsVideo(asset)&&running&&authorized&&Number.isFinite(videoTime(asset))&&videoTime(asset)>=0&&(!asset.metadataReady||!Number.isFinite(video.duration)||videoTime(asset)<video.duration);
  function stopVideo(){playRequest++;pendingPlay=null;video?.pause?.();}
  function dispose(asset){if(asset.url){revokeObjectURL(asset.url);asset.url=null;}if(asset.node){asset.node.onload=null;asset.node.onerror=null;asset.node.onloadedmetadata=null;asset.node.onloadeddata=null;asset.node.pause?.();asset.node.removeAttribute('src');asset.node.load?.();asset.node.hidden=true;}}
  function pause(){authorized=false;running=false;stopVideo();publish();}
  function clear(){epoch++;controller?.abort();controller=null;pause();for(const asset of assets.values())dispose(asset);assets.clear();key=null;publish();}
  function failure(asset,code){asset.status='error';asset.error=code;if(asset.node===video)stopVideo();dispose(asset);publish();}
  async function select(nextKey,descriptor){clear();key=nextKey;if(!descriptor)return;controller=new AbortController();const signal=controller.signal,generation=epoch;
    await Promise.all(descriptor.media.filter(item=>nodes[item.role]).map(async item=>{const node=nodes[item.role],asset={descriptor:item,node,url:null,status:'loading',error:null,metadataReady:false};assets.set(item.id,asset);publish();
      try{const blob=await loadAsset(nextKey,item.handle,{signal});if(generation!==epoch||signal.aborted)return;asset.url=createObjectURL(blob);const current=()=>generation===epoch&&assets.get(item.id)===asset&&asset.url&&asset.status!=='error';
        node.onerror=()=>{if(current())failure(asset,'decode');};const ready=()=>{if(!current())return;asset.metadataReady=true;asset.status='ready';node.hidden=false;publish();sync({positionMs:position,running});};
        if(item.role==='pv'){node.muted=true;node.defaultMuted=true;node.autoplay=false;node.playsInline=true;node.preload='auto';node.onloadedmetadata=()=>{if(!current())return;asset.metadataReady=true;sync({positionMs:position,running});};node.onloadeddata=ready;}else node.onload=ready;
        node.hidden=true;node.src=asset.url;node.load?.();sync({positionMs:position,running});
      }catch(error){if(generation===epoch&&!signal.aborted)failure(asset,'load');}
    }));
  }
  function sync({positionMs,running:nextRunning,userGesture=false}){position=positionMs;running=Boolean(nextRunning);if(userGesture&&running)authorized=true;if(!running)authorized=false;
    const asset=pvAsset();if(!ownsVideo(asset))return;
    const time=videoTime(asset);
    // Metadata permits seeking; decoded data controls visibility, never admission.
    // Some native players need play() before preload supplies their first frame.
    if(asset.metadataReady&&Number.isFinite(time)&&Math.abs((video.currentTime||0)-Math.max(0,time))>0.15){try{video.currentTime=Math.max(0,Math.min(time,Number.isFinite(video.duration)?video.duration:Math.max(0,time)));}catch{failure(asset,'seek');return;}}
    if(!mayPlay(asset)){stopVideo();return;}
    if(video.paused===false||pendingPlay)return;
    const request=++playRequest,generation=epoch;pendingPlay=request;
    // An obsolete completion must obey the latest admission, not cancel it.
    try{Promise.resolve(video.play()).then(()=>{if((generation!==epoch||request!==playRequest||assets.get(asset.descriptor.id)!==asset)&&!mayPlay(pvAsset()))video.pause?.();}).catch(()=>{if(generation===epoch&&request===playRequest&&assets.get(asset.descriptor.id)===asset)failure(asset,'play');}).finally(()=>{if(pendingPlay===request)pendingPlay=null;});}catch{if(pendingPlay===request)pendingPlay=null;if(generation===epoch&&request===playRequest)failure(asset,'play');}
  }
  if(video){video.muted=true;video.defaultMuted=true;video.autoplay=false;video.playsInline=true;}
  return{select,sync,pause,clear,destroy:clear,snapshot};
}
