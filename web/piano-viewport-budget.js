import {createPianoBudgetUpdate} from './piano-layout-budget.js';

/** Client rectangles include CSS zoom; custom properties consume unzoomed px. */
export function pianoViewportBudget({viewportBottom,laneHeight,transportBottom,zoom=1,bottomPadding=0,minimum=100}){
  if(![viewportBottom,laneHeight,transportBottom,zoom,bottomPadding,minimum].every(Number.isFinite)||zoom<=0||laneHeight<=0||minimum<=0)return null;
  const available=Math.floor(((viewportBottom-transportBottom+laneHeight)/zoom-bottomPadding)*100)/100;
  return{height:Math.max(minimum,available),available,deficit:Math.max(0,minimum-available)};
}

/** Header wrapping, guides, notices and transport all consume real space.
 * Never subtract a HUD from the desired music size when the viewport has room.
 * Hidden modes keep the shared visible-mode capacity until measured again. */
export function observePianoViewportBudget({document,window=document.defaultView}){
  let disposed=false,context='',capacities=new Map();const observed=new Set();
  const observer=window.ResizeObserver?new window.ResizeObserver(()=>update.schedule()):null;
  const update=createPianoBudgetUpdate({document,window,property:'--piano-available-lane-height',measure(){
    const normal=document.getElementById('workspace'),free=document.getElementById('free-practice-screen');
    for(const root of [normal,free])if(root)for(const node of [root,...root.querySelectorAll('.piano-workspace-heading,.play-panel,.free-performance-panel,.piano-stage-toolbar,.performance-status,.piano-keybed-shared,.piano-transport,.keyboard-input-footer,.keyboard-pan,#piano-fingering-guidance')])if(!observed.has(node)){observed.add(node);observer?.observe(node);}
    const mode=document.body.dataset.screen==='free'?'free':'normal',root=mode==='free'?free:normal;
    if(!root||root.hidden||!root.classList.contains('piano-workspace'))return;
    const lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport'),keyboard=root.querySelector('.piano-keybed-shared');
    if(!lane||!transport||!keyboard)return;
    const laneRect=lane.getBoundingClientRect?.(),transportRect=transport.getBoundingClientRect?.(),keyboardRect=keyboard.getBoundingClientRect?.();
    if(!laneRect||!transportRect||!keyboardRect)return;
    const laneSize=parseFloat(window.getComputedStyle?.(lane)?.height),zoom=Math.round(laneRect.height/laneSize*1000)/1000;
    if(!laneRect.width||!transportRect.height||!Number.isFinite(zoom)||zoom<=0)return;
    const key=JSON.stringify([window.innerWidth,window.innerHeight,zoom,keyboardRect.height/zoom,document.documentElement.lang,root.getBoundingClientRect?.().top||0]);
    if(key!==context){context=key;capacities=new Map();}
    const visual=window.visualViewport,viewportBottom=Math.min(window.innerHeight,visual?visual.offsetTop+visual.height:window.innerHeight);
    const plan=pianoViewportBudget({viewportBottom,laneHeight:laneRect.height,transportBottom:transportRect.bottom+(root.scrollTop||0)*zoom,zoom,bottomPadding:parseFloat(window.getComputedStyle?.(root)?.paddingBottom)||0});
    if(!plan)return;
    capacities.set(mode,plan.height);
    return `${Math.min(...capacities.values())}px`;
  }});
  const refresh=()=>{if(!disposed)update.schedule();};
  window.addEventListener('resize',refresh);window.visualViewport?.addEventListener('resize',refresh);refresh();
  return{refresh,destroy(){disposed=true;observer?.disconnect();window.removeEventListener('resize',refresh);window.visualViewport?.removeEventListener('resize',refresh);update.dispose();}};
}
