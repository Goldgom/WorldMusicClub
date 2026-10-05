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
    await until(()=>ready('library',$('configure-song-mod')?'configure-song-mod':'start-listen')&&$('song-lobby').dataset.previewStatus==='ready'&&$('catalog').querySelector('.catalog-item'),'visible native single-player catalog preview');
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

/* Visible Mod controls use the caller's existing owned pointer/keyboard route.
 * This helper never writes app state, dispatches events, or touches hidden legacy
 * controls. Reading a row identifies a source part; Start is a separate action. */
function createAcceptanceSongMod({document,native,until}) {
  const $=id=>document.getElementById(id),history=[];
  const fields=()=>[...document.querySelectorAll('#song-mod-parts [data-mod-performer]')];
  const node=(kind,part)=>[...document.querySelectorAll(`#song-mod-parts [data-mod-${kind}]`)].find(n=>n.dataset[`mod${kind[0].toUpperCase()}${kind.slice(1)}`]===part);
  const act=async(kind,target)=>{if(!target||target.disabled||target.closest('[hidden]'))throw Error('Visible Mod control unavailable');const sequence=await native(kind,target);history.push({sequence,kind,id:target.id||null,part:target.closest('.song-mod-part')?.dataset.partId||null,value:target.value??null});return sequence;};
  async function open(){await act('click',$(document.body.dataset.screen==='stage'?'edit-song-mod':'configure-song-mod'));await until(()=>$('song-mod-dialog').open,'visible Song Mod dialog');}
  async function choose(humans,{layout,showOthers,visible,muted,instrument}={}) {
    if(!Array.isArray(humans)&&!['all','none'].includes(humans))throw Error('Explicit Mod human parts required');
    if(humans==='all'||humans==='none')await act('click',$(humans==='all'?'song-mod-all-human':'song-mod-all-machine'));
    else{const ids=fields().map(n=>n.dataset.modPerformer);if(humans.some(id=>!ids.includes(id)))throw Error('Mod human part absent from source');for(const n of fields()){const value=humans.includes(n.dataset.modPerformer)?'human':'machine';if(n.value!==value)await act(value==='human'?'select-first':'select-last',n);}}
    if(layout&&$('song-mod-layout').value!==layout){if(!['complete','solo'].includes(layout))throw Error('Unsupported Mod layout');await act(layout==='complete'?'select-first':'select-last',$('song-mod-layout'));}
    if(typeof showOthers==='boolean'&&$('song-mod-show-others').checked!==showOthers)await act('click',$('song-mod-show-others'));
    for(const [kind,values]of [['visible',visible],['mute',muted]])if(values)for(const [part,value]of Object.entries(values)){const n=node(kind,part);if(!n||typeof value!=='boolean')throw Error('Invalid Mod checkbox');if(n.checked!==value)await act('click',n);}
    if(instrument)for(const [part,value]of Object.entries(instrument)){const n=node('instrument',part);if(!n||!['source','sine','reed'].includes(value))throw Error('No bounded native action for requested Mod sound');if(n.value!==value)await act(value==='source'?'select-first':value==='sine'?'select-second':'select-last',n);}
  }
  async function apply(){const sequence=await act('click',$('song-mod-apply'));await until(()=>!$('song-mod-dialog').open,'Mod applied');return sequence;}
  async function configure(humans,options){await open();await choose(humans,options);return apply();}
  async function start(humans,options){await configure(humans,options);const sequence=await act('click',$('start-performance'));await until(()=>document.body.dataset.screen==='stage','Start performance admitted');return sequence;}
  async function cancel(){return act('click',$('song-mod-cancel'));}
  async function restore(){return act('click',$('song-mod-restore'));}
  return{open,choose,apply,configure,start,cancel,restore,history,fields};
}
