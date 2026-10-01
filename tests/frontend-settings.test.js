import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setupThemes,contrastRatio,THEME_PALETTES} from '../web/themes.js';
import {validLatency,loadLatency,saveLatency,readLatencyPreference} from '../web/practice-settings.js';
function withStorage(storage,fn){const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{return fn()}finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage}}
class Element{constructor(value=''){this.value=value;this.hidden=true;this.textContent='';this.listeners=new Map()}addEventListener(name,fn){this.listeners.set(name,fn)}emit(name){this.listeners.get(name)?.()}}
function themeDom({stored=null,readFailure=false,writeFailure=false,dark=false}={}){
 const originals=Object.fromEntries(['document','matchMedia','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),values=new Map(),nodes=new Map(['theme-mode','theme-accent','theme-background','custom-theme-controls','theme-storage-status'].map(id=>[id,new Element()])),style={setProperty:(key,value)=>values.set(key,value)},root={dataset:{},style},media={matches:dark,addEventListener(name,fn){this.change=fn},emit(value){this.matches=value;this.change?.()}};
 const storage={value:stored,getItem(){if(readFailure)throw Error('Storage unavailable');return this.value},setItem(key,value){if(writeFailure)throw Error('Storage quota');this.value=value}};
 for(const[key,value]of Object.entries({document:{getElementById:id=>nodes.get(id),documentElement:root},matchMedia:()=>media,localStorage:storage}))Object.defineProperty(globalThis,key,{configurable:true,value});
 return{nodes,root,values,media,storage,restore(){for(const[key,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}};
}
test('latency settings reject coerced arrays and booleans while preserving valid signed offsets',()=>{
 for(const value of[true,false,[140],[-20],[],{},null,undefined])assert.equal(validLatency(value),false,JSON.stringify(value));
 for(const value of[-500,0,500,'-40','120'])assert.equal(validLatency(value),true);
 for(const stored of['true','false','[140]','{}','""','not JSON'])withStorage({getItem:()=>stored},()=>assert.equal(loadLatency(),0));
 withStorage({getItem:()=>'-140'},()=>assert.equal(loadLatency(),-140));
});
test('settings writes report success only when the browser actually accepts the value',()=>{
 withStorage({setItem(){throw Error('Quota')}},()=>assert.equal(saveLatency(120),false));let saved;withStorage({setItem(key,value){saved={key,value}}},()=>{assert.equal(saveLatency('120'),true);assert.deepEqual(saved,{key:'worldmusichub.latency',value:'120'});assert.equal(saveLatency([80]),false);assert.equal(saved.value,'120')});
});
test('theme storage failure remains visible while custom colors and system changes work in the current tab',()=>{
 const env=themeDom({readFailure:true,writeFailure:true,dark:true});try{setupThemes();assert.equal(env.root.dataset.theme,'dark');assert.equal(env.nodes.get('theme-storage-status').hidden,false);assert.match(env.nodes.get('theme-storage-status').textContent,/this tab|session/i);env.nodes.get('theme-mode').value='custom';env.nodes.get('theme-accent').value='#ffffff';env.nodes.get('theme-background').value='#000000';env.nodes.get('theme-mode').emit('change');assert.equal(env.root.dataset.themeMode,'custom');assert.equal(env.values.get('--green'),'#ffffff');assert.equal(env.values.get('--page-background'),'#000000');assert.equal(env.nodes.get('theme-storage-status').hidden,false);assert.match(env.nodes.get('theme-storage-status').textContent,/not.*saved|could not.*save/i);env.media.emit(false);assert.equal(env.root.dataset.theme,'dark');env.nodes.get('theme-mode').value='system';env.nodes.get('theme-mode').emit('change');assert.equal(env.root.dataset.theme,'light');env.media.emit(true);assert.equal(env.root.dataset.theme,'dark')}finally{env.restore()}
});
test('custom theme tokens survive a fresh setup and system changes never overwrite the stored mode',()=>{
 const env=themeDom({stored:JSON.stringify({mode:'custom',accent:'#ab1245',background:'#121212'}),dark:false});let stored;try{setupThemes();assert.equal(env.root.dataset.theme,'dark');assert.equal(env.values.get('--green'),'#ab1245');env.nodes.get('theme-background').value='#fefefe';env.nodes.get('theme-background').emit('input');stored=env.storage.value;assert.equal(env.root.dataset.theme,'light');assert.equal(env.nodes.get('theme-storage-status').hidden,true);env.media.emit(true);assert.equal(env.root.dataset.theme,'light');assert.equal(env.storage.value,stored)}finally{env.restore()}
 const restored=themeDom({stored,dark:true});try{setupThemes();assert.equal(restored.nodes.get('theme-mode').value,'custom');assert.equal(restored.values.get('--green'),'#ab1245');assert.equal(restored.values.get('--page-background'),'#fefefe')}finally{restored.restore()}
});
test('focus treatment has contrasting light and dark rings and covers multiline editors',async()=>{
 const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8');assert.match(css,/textarea:focus-visible/);assert.match(css,/outline:\s*3px solid var\(--focus-ring\)/);assert.match(css,/box-shadow:\s*0 0 0 2px var\(--focus-halo\)/);
 for(const dark of[false,true]){const env=themeDom({dark});try{setupThemes();const primary=env.values.get('--focus-ring'),halo=env.values.get('--focus-halo');assert.ok(contrastRatio(primary,halo)>=7);for(const background of[...Object.values(THEME_PALETTES).flatMap(p=>[p.paper,p.surface,p.background]),'#000000','#ffffff','#ce9d3d','#777777'])assert.ok(Math.max(contrastRatio(primary,background),contrastRatio(halo,background))>=4.5)}finally{env.restore()}}
 assert.match(css,/\.skip-link\{[^}]*background:var\(--paper\)[^}]*color:var\(--ink\)/);
});
test('corrupt theme storage falls back explicitly and a successful replacement clears the warning',()=>{
 for(const stored of['{broken','{"mode":"future-theme"}']){const env=themeDom({stored,dark:false});try{setupThemes();assert.equal(env.root.dataset.themeMode,'system');assert.equal(env.nodes.get('theme-storage-status').hidden,false);assert.match(env.nodes.get('theme-storage-status').textContent,/Saved appearance/);env.nodes.get('theme-mode').value='dark';env.nodes.get('theme-mode').emit('change');assert.equal(env.nodes.get('theme-storage-status').hidden,true);assert.equal(JSON.parse(env.storage.value).mode,'dark')}finally{env.restore()}}
});

test('latency restoration distinguishes absent, corrupt and unavailable browser storage',()=>{
 withStorage({getItem:()=>null},()=>assert.deepEqual(readLatencyPreference(),{value:0,message:''}));
 withStorage({getItem:()=>'[140]'},()=>{const preference=readLatencyPreference();assert.equal(preference.value,0);assert.match(preference.message,/invalid.*not applied/)});
 withStorage({getItem(){throw Error('Disabled')}},()=>{const preference=readLatencyPreference();assert.equal(preference.value,0);assert.match(preference.message,/storage is unavailable/)});
});
