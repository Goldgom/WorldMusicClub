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

/* Real menu controls only; never change body state or invoke app controllers. */
function createAcceptanceNavigation({document,until,click}) {
  const $=id=>document.getElementById(id);
  const screens={home:'game-home',library:'song-lobby',stage:'workspace',free:'free-practice-screen'};
  function ready(screen,id) {
    const root=$(screens[screen]),control=$(id);
    if(document.body.dataset.screen!==screen||!root||root.hidden||!control||control.disabled||!root.contains(control))return false;
    if(control.closest('[hidden]')||document.querySelector('dialog[open]'))return false;
    const bounds=control.getBoundingClientRect();return bounds.width>0&&bounds.height>0;
  }
  const waitScreen=(screen,id,label)=>until(()=>ready(screen,id),label);
  async function enterLibrary() {
    await waitScreen('home','home-single-player','visible native home menu');
    click('home-single-player');
    await until(()=>ready('library','start-listen')&&$('song-lobby').dataset.previewStatus==='ready'&&$('catalog').querySelector('.catalog-item'),'visible native single-player catalog preview');
  }
  async function returnToLibrary() {
    await waitScreen('stage','back-to-library','stage library navigation');click('back-to-library');
    await waitScreen('library','lobby-home','returned native library');
  }
  async function enterFree({readyControl='free-start'}={}) {
    if(!['free-start','free-exit'].includes(readyControl))throw Error('Unsupported free-practice acceptance readiness control');
    if(document.body.dataset.screen==='stage')await returnToLibrary();
    if(document.body.dataset.screen==='library') {
      await waitScreen('library','lobby-home','library home navigation');click('lobby-home');
    }
    await waitScreen('home','start-free-practice','visible native home free-practice entry');click('start-free-practice');
    await until(()=>ready('free',readyControl)&&$('free-practice-screen').getAttribute('aria-busy')==='false','native free-practice ready');
  }
  async function exitFree() {
    await until(()=>ready('free','free-exit')&&$('free-practice-screen').getAttribute('aria-busy')==='false','native free-practice exit ready');click('free-exit');
    await waitScreen('library','lobby-home','free-practice exit returned to library');
  }
  return {ready,waitScreen,enterLibrary,returnToLibrary,enterFree,exitFree};
}
