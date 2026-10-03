import {midiName} from './music.js';

/** The two modes share physical geometry and presentation, never input ownership. */
export const pianoMinimumWidth = geometry => Math.max(640, geometry.filter(key => !key.black).length * 22);

export function createPianoToolbar({document, title, actions}) {
  const toolbar=document.createElement('div');toolbar.className='piano-stage-toolbar';toolbar.dataset.keyboardInput='off';
  title.classList.add('piano-stage-title');actions.classList.add('piano-stage-actions');toolbar.append(title,actions);return toolbar;
}

export function mountPianoStage({document,stage,scroll,surface,keyboard,canvas=null,lane=null}) {
  stage.classList.add('piano-stage-shared');scroll.classList.add('piano-scroll-shared');surface.classList.add('piano-surface-shared');keyboard.classList.add('piano-keybed-shared');
  if(!lane){lane=document.createElement('div');surface.prepend(lane);}
  lane.classList.add('piano-lanes-shared');
  let rails=lane.querySelector('.piano-rails-shared');
  if(!rails){rails=document.createElement('div');rails.className='piano-rails-shared';rails.setAttribute('aria-hidden','true');lane.prepend(rails);}
  if(canvas){canvas.classList.add('piano-falling-layer');lane.append(canvas);}
  let strike=surface.querySelector('.strike-line');
  if(!strike){strike=document.createElement('div');strike.className='strike-line';keyboard.before(strike);}
  strike.setAttribute('aria-hidden','true');return {lane,rails,strike};
}

export function renderPianoRails({document,rails,geometry}) {
  rails.replaceChildren();
  for(const key of geometry){const rail=document.createElement('i');rail.dataset.pitch=String(key.midi);rail.className=key.black?'black':'white';rail.style.left=`${key.x*100}%`;rail.style.width=`${key.width*100}%`;rails.append(rail);}
}

export function renderPianoKeybed({document,keyboard,geometry,bindings=[],labelForNote=note=>midiName(note),decorateKey=()=>{}}) {
  const fragment=document.createDocumentFragment();
  for(const position of geometry){
    const key=document.createElement('button');key.type='button';key.className=`piano-key${position.black?' black':' white'}`;
    key.dataset.midi=String(position.midi);key.dataset.keyboardPerformance='';key.style.left=`${position.x*100}%`;key.style.width=`${position.width*100}%`;
    key.title=midiName(position.midi);key.setAttribute('aria-label',labelForNote(position.midi));key.setAttribute('aria-pressed','false');
    const shortcut=document.createElement('span');shortcut.className='key-shortcut';
    const mapped=bindings.filter(binding=>binding.enabled&&binding.midi===position.midi);shortcut.textContent=mapped.map(binding=>binding.label).join(' / ');
    key.classList.toggle('mapped',mapped.length>0);if(mapped.length)key.dataset.code=mapped[0].code;key.dataset.codes=mapped.map(binding=>binding.code).join(' ');
    const note=document.createElement('span');note.className='piano-key-note';note.textContent=position.midi%12===0?midiName(position.midi):'';
    key.append(shortcut,note);decorateKey(key,position);fragment.append(key);
  }
  keyboard.replaceChildren(fragment);keyboard.dataset.low=String(geometry[0]?.midi??'');keyboard.dataset.high=String(geometry.at(-1)?.midi??'');
}

/** Notices consume the same lane budget in either mode. Reading their rendered
 * size never changes their lifetime, focus, or the musical transport. */
export function observePianoNoticeBudget({document}) {
  const window=document.defaultView,banner=document.getElementById('notice');
  if(!banner)return()=>{};
  let previous=null;
  const refresh=()=>{
    const rect=!banner.hidden&&banner.getBoundingClientRect?.();
    const css=rect&&window.getComputedStyle?.(banner);
    const height=rect?Math.ceil(rect.height+(parseFloat(css?.marginTop)||0)+(parseFloat(css?.marginBottom)||0)):0;
    if(height===previous)return;previous=height;
    document.body.style.setProperty('--piano-notice-space',`${height}px`);
  };
  const resize=window.ResizeObserver?new window.ResizeObserver(refresh):null;
  const mutation=window.MutationObserver?new window.MutationObserver(refresh):null;
  resize?.observe(banner);mutation?.observe(banner,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('resize',refresh);refresh();
  return()=>{resize?.disconnect();mutation?.disconnect();window.removeEventListener('resize',refresh);document.body.style.removeProperty('--piano-notice-space');};
}
