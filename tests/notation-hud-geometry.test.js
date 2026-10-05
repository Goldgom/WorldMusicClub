import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNotationHudClear} from './notation-hud-geometry.js';

const box=(id,left,top,right,bottom,painted=true)=>({id,painted,rect:{left,top,right,bottom},visible:{left,top,right,bottom}});
test('HUD overlap rejects an otherwise completely unclipped exact staff cue',()=>{
 const target=box('original-upper-staff',164,108,184,122),panel=box('performance-status-copy',118,100,270,130);
 const proof={viewport:{width:1033,height:403},locale:'zh-CN',phase:'pending',cueState:'paused',status:box('status',10,55,1020,85),targets:[target],panels:[panel]};
 assert.deepEqual(target.visible,target.rect,'This is the old fraction=1 blind spot');
 assert.throws(()=>assertNotationHudClear(proof),/HUD performance-status-copy overlaps current notation original-upper-staff/);
 panel.rect=panel.visible={left:118,top:55,right:270,bottom:85};assert.doesNotThrow(()=>assertNotationHudClear(proof));
});

test('running and paused HUD geometry checks every voice, ignores hidden panels and permits genuine clipping',()=>{
 const targets=[box('original-upper-voice',160,110,180,130),box('original-lower-voice',160,200,180,220)];
 for(const id of ['onset-counter','hud-result','performance-hint','stage-cue']){
  const panel=box(id,170,205,220,240),proof={targets,status:box('status',10,55,1020,85),panels:[panel],phase:'capturing',cueState:null};
  assert.throws(()=>assertNotationHudClear(proof),new RegExp(`HUD ${id} overlaps current notation original-lower-voice`));
  panel.painted=false;assert.doesNotThrow(()=>assertNotationHudClear(proof));
  panel.painted=true;panel.visible={left:200,top:205,right:220,bottom:220};assert.throws(()=>assertNotationHudClear(proof),/stays fully readable/,'Clipping away the HUD is not an occlusion fix');
  panel.rect=panel.visible;assert.doesNotThrow(()=>assertNotationHudClear(proof));
 }
 assert.throws(()=>assertNotationHudClear({targets:[],panels:[]}),/Current notation must exist/);
});
