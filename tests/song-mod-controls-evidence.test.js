import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSongModActionHistory} from '../scripts/verify-song-mod-controls.mjs';
import {syntheticSongModControls} from './song-mod-control-evidence-fixtures.js';

test('Mod receipts bind the actual native kinds, source-part options and trusted events',()=>{
  const report=syntheticSongModControls({mute:true}),actions=report.modActions.map(row=>({sequence:row.sequence,kind:row.kind}));
  validateSongModActionHistory(report,{actions,requireTrusted:true});
  for(const change of [
    r=>delete r.modActions,
    r=>r.modActions[1].sequence=r.modActions[0].sequence,
    r=>r.modActions[1].kind='click',
    r=>r.modActions[1].part='different-source-part',
    r=>r.modActions[1].value='human',
    r=>r.modActions[1].field='unknown',
    r=>r.modActions[3].checked='true',
    r=>r.modActions[0].id='start-practice',
    r=>r.trusted[2].trusted=false,
    r=>r.trusted[2].modField='instrument',
    r=>r.trusted[2].actionSequence++,
    r=>r.trusted.push({...r.trusted[2]}),
    r=>r.trusted.push({...r.trusted[2],trusted:false}),
    r=>r.trusted[3].checked=false,
  ]){const changed=structuredClone(report);change(changed);assert.throws(()=>validateSongModActionHistory(changed,{actions,requireTrusted:true}));}
  const changed=structuredClone(actions);changed[2].kind='select-last';assert.throws(()=>validateSongModActionHistory(report,{actions:changed,requireTrusted:true}));
});

test('Mod layout and timbre accept only their finite real option routes',()=>{
  const report=syntheticSongModControls();
  for(const row of [
    {kind:'select-first',id:'song-mod-layout',value:'complete'},
    {kind:'select-last',id:'song-mod-layout',value:'solo'},
    {kind:'select-first',field:'instrument',part:'original-first',value:'source'},
    {kind:'select-second',field:'instrument',part:'original-first',value:'sine'},
    {kind:'select-last',field:'instrument',part:'original-first',value:'reed'},
  ]){const changed=structuredClone(report);changed.modActions.push({sequence:++changed.actions,id:null,field:null,part:null,checked:null,...row});validateSongModActionHistory(changed);changed.modActions.at(-1).kind='click';assert.throws(()=>validateSongModActionHistory(changed));}
});

test('actual native and hosted routes never activate hidden legacy performance controls',async()=>{
 const {readFile,readdir}=await import('node:fs/promises');
 const nativeDir=new URL('../crates/desktop-shell/',import.meta.url),hostedDir=new URL('../scripts/',import.meta.url);
 const native=(await readdir(nativeDir)).filter(name=>name.endsWith('acceptance.js')||name==='smoke.js'||name==='acceptance-wait.js');
 const hosted=(await readdir(hostedDir)).filter(name=>/^hosted-.*-check\.mjs$/.test(name));
 for(const [base,names]of [[nativeDir,native],[hostedDir,hosted]])for(const name of names){const source=await readFile(new URL(name,base),'utf8');assert.doesNotMatch(source,/['"#](?:start-listen|start-practice|start-complete-practice|vsq-listen-basic|vsq-practice-basic)['"\s)]/,name);}
 const helper=await readFile(new URL('hosted-song-mod-controls.mjs',hostedDir),'utf8');assert.doesNotMatch(helper,/dispatchEvent|\.evaluate\([^\n]*\.click\(|\.value\s*=(?!=)|\.checked\s*=(?!=)/);
 const rhythm=await readFile(new URL('hosted-rhythm-check.mjs',hostedDir),'utf8');
 const hashLoop=rhythm.match(/for \(const name of \[([^\]]+)\]\) \{\s*sourceHashes\[name\] =/);assert.ok(hashLoop,'Rhythm evidence must hash its declared source files');
 const bound=[...hashLoop[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 for(const file of ['web/song-mod.js','web/song-mod-view.js','scripts/hosted-song-mod-controls.mjs','web/piano-viewport-budget.js'])assert.equal(bound.filter(name=>name===file).length,1,`Rhythm source binding must retain ${file} exactly once`);
});
