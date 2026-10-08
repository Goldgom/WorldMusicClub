import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartActivityPolicyStamp} from '../web/part-activity-lifecycle.js';
import {createSongMod} from '../web/song-mod.js';
const identity={songId:'test',sourceRevision:{kind:'canonical-score-v1',value:'a'.repeat(64)}};
const config={layout:'complete',showOtherParts:true,parts:[{partId:'human',performer:'human',instrument:'source',liveInstrument:'follow',muted:false,visible:true},{partId:'machine',performer:'machine',instrument:'source',liveInstrument:'follow',muted:false,visible:true}]};
const selection=()=>({kind:'parts',part_ids:['human']});
const mod=(change=()=>{},source=identity)=>{const value=structuredClone(config);change(value);return createSongMod(source,value);};
test('activity policy stamps preserve only validated display semantics and cache unchanged objects',()=>{
 const stamp=createPartActivityPolicyStamp(),initial=mod(),selected=selection(),token=stamp(initial,selected);
 assert.equal(stamp(initial,selected),token);
 for(const change of [c=>c.showOtherParts=false,c=>c.layout='solo',c=>c.parts[1].visible=false,()=>{}])assert.equal(stamp(mod(change),selection()),token);
});
for(const [name,change,selected,source]of [
 ['mute',c=>c.parts[1].muted=true],['machine timbre',c=>c.parts[1].instrument='reed'],['live timbre',c=>c.parts[0].liveInstrument='guitar'],['human ownership',c=>c.parts[1].performer='human'],['removed part',c=>c.parts.pop()],['part order',c=>c.parts.reverse()],['selection',()=>{},{kind:'parts',part_ids:['machine']}],['source revision',()=>{},undefined,{...identity,sourceRevision:{...identity.sourceRevision,value:'b'.repeat(64)}}],['song',()=>{},undefined,{...identity,songId:'other'}]
])test(`activity policy stamp invalidates ${name}, including policy revert`,()=>{
 const stamp=createPartActivityPolicyStamp(),original=stamp(mod(),selection()),changed=stamp(mod(change,source),selected||selection());assert.notEqual(changed,original);const restored=stamp(mod(),selection());assert.notEqual(restored,original);assert.notEqual(restored,changed);
});
test('invalid and absent Mod evidence never preserves a replaced policy',()=>{
 const stamp=createPartActivityPolicyStamp(),token=stamp(mod(),selection());assert.notEqual(stamp(null,selection()),token);
 const valid=mod(),before=stamp(valid,selection()),invalid=structuredClone(valid);invalid.config.parts[1].instrument='reed';assert.notEqual(stamp(invalid,selection()),before);
});
test('unchanged frame policy reads no Mod or selection contents',()=>{
 const stamp=createPartActivityPolicyStamp(),value=mod(),selected=selection(),before=stamp(value,selected);
 Object.defineProperty(value,'config',{get(){throw new Error('per-frame Mod traversal');}});
 Object.defineProperty(selected,'part_ids',{get(){throw new Error('per-frame selection traversal');}});
 assert.equal(stamp(value,selected),before);
});
