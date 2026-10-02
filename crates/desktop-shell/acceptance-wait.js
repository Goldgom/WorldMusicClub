/* Pure deadline helpers shared by injected acceptance and ordinary Node tests. */
function createAcceptanceWait({setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  async function bounded(operation,label,milliseconds=25000) {
    const controller=new AbortController();let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(()=>operation(controller.signal)),
        new Promise((_,reject)=>{timer=setTimer(()=>{reject(Error(`Timed out: ${label}`));controller.abort();},milliseconds);})
      ]);
    } finally {clearTimer(timer);}
  }
  async function until(condition,label,milliseconds=25000) {
    return bounded(async signal=>{
      while(!signal.aborted) {
        if(await condition(signal))return;
        if(!signal.aborted)await new Promise(resolve=>setTimer(resolve,100));
      }
    },label,milliseconds);
  }
  async function json(fetch,path,options,milliseconds=25000) {
    return bounded(async signal=>{
      const response=await fetch(path,{...options,signal}),value=await response.json();
      if(!response.ok)throw Error(`${path}: ${value.error || response.status}`);
      return value;
    },`response ${path}`,milliseconds);
  }
  return {bounded,until,json};
}
