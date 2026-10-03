import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {keyboardGeometry} from '../web/music.js';
import {mountPianoStage,renderPianoKeybed,renderPianoRails,createPianoToolbar,pianoMinimumWidth} from '../web/piano-stage-view.js';

test('shared stage mounting keeps the original interactive keybed, falling canvas and strike nodes',()=>{
  const {document}=parseHTML('<section id="stage"><div id="scroll"><div id="surface"><canvas></canvas><div class="strike-line"></div><div id="keyboard"><button data-midi="60" aria-pressed="true"></button></div></div></div></section>');
  const stage=document.getElementById('stage'),scroll=document.getElementById('scroll'),surface=document.getElementById('surface'),keyboard=document.getElementById('keyboard'),canvas=document.querySelector('canvas'),strike=surface.querySelector('.strike-line'),key=keyboard.firstElementChild;
  let presses=0;key.addEventListener('click',()=>presses++);
  const first=mountPianoStage({document,stage,scroll,surface,keyboard,canvas});
  const second=mountPianoStage({document,stage,scroll,surface,keyboard,canvas,lane:first.lane});
  assert.equal(first.lane,second.lane);assert.equal(first.rails,second.rails);assert.equal(first.strike,strike);assert.equal(second.strike,strike);assert.equal(canvas.parentElement,first.lane);assert.equal(keyboard.firstElementChild,key);assert.equal(key.getAttribute('aria-pressed'),'true');key.click();assert.equal(presses,1);
  assert.equal(surface.querySelectorAll('.piano-lanes-shared').length,1);assert.equal(surface.querySelectorAll('.piano-rails-shared').length,1);assert.equal(surface.querySelectorAll('.strike-line').length,1);assert.equal(first.lane.nextElementSibling,strike);assert.equal(strike.nextElementSibling,keyboard);
});

test('both mode keybeds have identical configured chromatic geometry, labels and rail coordinates',()=>{
  const {document}=parseHTML('<main></main>');
  for(const [count,lowest]of [[49,48],[61,36],[76,28],[88,21],[12,115]]){
    const geometry=keyboardGeometry(count,lowest),normal=document.createElement('div'),free=document.createElement('div'),rails=document.createElement('div');
    const bindings=[{code:'KeyR',label:'R',midi:60,enabled:true},{code:'KeyA',label:'alias',midi:60,enabled:true},{code:'KeyQ',label:'disabled',midi:61,enabled:false},{code:'KeyZ',label:'outside',midi:127,enabled:true}];
    const options={document,geometry,bindings,labelForNote:midi=>`Play MIDI ${midi}`};
    renderPianoKeybed({...options,keyboard:normal});renderPianoKeybed({...options,keyboard:free,decorateKey:key=>key.classList.add('free-practice-key')});renderPianoRails({document,rails,geometry});
    const details=node=>[...node.children].map(key=>({midi:Number(key.dataset.midi),left:key.style.left,width:key.style.width,black:key.classList.contains('black'),label:key.getAttribute('aria-label'),pressed:key.getAttribute('aria-pressed'),disabled:key.disabled,legend:key.querySelector('.key-shortcut').textContent}));
    assert.deepEqual(details(normal),details(free));assert.equal(normal.children.length,count);assert.deepEqual([normal.firstElementChild.dataset.midi,normal.lastElementChild.dataset.midi],[String(lowest),String(lowest+count-1)]);
    assert.deepEqual([...rails.children].map(node=>({midi:Number(node.dataset.pitch),left:node.style.left,width:node.style.width,black:node.classList.contains('black')})),details(normal).map(({midi,left,width,black})=>({midi,left,width,black})));
    assert.equal(pianoMinimumWidth(geometry),Math.max(640,geometry.filter(key=>!key.black).length*22));
    if(lowest<=60&&lowest+count>60){assert.equal(normal.querySelector('[data-midi="60"] .key-shortcut').textContent,'R / alias');assert.equal(normal.querySelector('[data-midi="61"] .key-shortcut').textContent,'');}
    assert.equal(normal.querySelector('[data-code="KeyZ"]'),null,'An out-of-range PC binding never silently expands the configured visual range');
    assert.ok([...normal.children].every(key=>!key.disabled),'Visual range is independent of whether a PC shortcut maps to a key');
  }
});

test('shared toolbar reuses mode-owned action handlers and marks them as nonmusical controls',()=>{
  const {document}=parseHTML('<h2>Piano</h2><div><button>Sound</button></div>'),title=document.querySelector('h2'),actions=document.querySelector('div'),button=actions.firstElementChild;let count=0;button.addEventListener('click',()=>count++);
  const toolbar=createPianoToolbar({document,title,actions});assert.equal(toolbar.dataset.keyboardInput,'off');assert.equal(toolbar.firstElementChild,title);assert.equal(toolbar.lastElementChild,actions);assert.equal(actions.firstElementChild,button);button.click();assert.equal(count,1);
});
