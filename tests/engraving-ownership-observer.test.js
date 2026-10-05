// Original DOM/model doubles: these exercise passive ownership, not OSMD paint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DOMParser,parseHTML} from 'linkedom';
const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
function environment(){
 const {document}=parseHTML('<html><body><div id="engraved-staff"></div><div id="staged" data-notation-preparation="" inert></div><div id="elsewhere"></div></body></html>');
 const dimensions=node=>{node.getBoundingClientRect=()=>({x:100,y:100,width:100,height:40});return node;};for(const node of document.querySelectorAll('*'))dimensions(node);
 const style=node=>({display:node.style.display||'block',visibility:node.style.visibility||'visible',opacity:node.style.opacity||'1'});
 Object.defineProperty(document,'defaultView',{value:{getComputedStyle:style}});
 class Renderer{
  constructor(container){this.container=container;}
  load(xml){this.clear();this.xml=xml;const instrument={IdString:'P1',Staves:[]},staff={ParentInstrument:instrument};instrument.Staves.push(staff);
   this.Sheet={SourceMeasures:[...xml.querySelectorAll('note[id]')].map((node,index)=>{const measure={VerticalSourceStaffEntryContainers:[]};const note={id:node.getAttribute('id'),PrintObject:true,SourceMeasure:measure,ParentStaff:staff,ParentVoiceEntry:{ParentVoice:{VoiceId:1},Timestamp:{Numerator:0,Denominator:1}},Length:{Numerator:1,Denominator:1},Pitch:{FundamentalNote:0,AccidentalHalfTones:0,Octave:1},isRest:()=>false,getAbsoluteTimestamp:()=>({Numerator:index,Denominator:1})};measure.VerticalSourceStaffEntryContainers=[{StaffEntries:[{VoiceEntries:[{Notes:[note]}]}]}];return measure;})};return Promise.resolve('actual load');}
  render(){this.container.replaceChildren();const svg=dimensions(document.createElement('svg'));this.container.append(svg);this.heads=new Map();
   const notes=this.Sheet.SourceMeasures.map(measure=>measure.VerticalSourceStaffEntryContainers[0].StaffEntries[0].VoiceEntries[0].Notes[0]);
   for(const note of notes){const head=dimensions(document.createElement('g'));head.className='vf-notehead';svg.append(head);this.heads.set(note,head);note.NoteTie={Notes:notes};}
   this.EngravingRules={GNote:note=>({vfnoteIndex:0,getNoteheadSVGs:()=>[this.heads.get(note)]})};this.GraphicSheet={MeasureList:[]};return 'actual render';}
  clear(){this.container.replaceChildren();delete this.Sheet;delete this.GraphicSheet;}
 }
 const realm=vm.createContext({opensheetmusicdisplay:{OpenSheetMusicDisplay:Renderer}});
 vm.runInContext(source.slice(0,source.indexOf('\n(() => {'))+'\nglobalThis.observe=observeBasicKeyEngraving;globalThis.ownership=createEngravingOwnershipObserver;',realm);
 const xml=prefix=>new DOMParser().parseFromString(`<score-partwise><part id="P1"><measure><note id="${prefix}-one"><tie type="start"/></note><note id="${prefix}-two"><tie type="stop"/></note></measure></part></score-partwise>`,'application/xml');
 const mount=parent=>{const node=dimensions(document.createElement('div'));document.getElementById(parent).append(node);return node;};
 return {document,Renderer,realm,xml,mount};
}

test('Basic snapshot keeps each loaded XML with its actual visible renderer despite a later staged or disposed instance',async()=>{
 const env=environment(),observer=await env.realm.observe(env.document),current=new env.Renderer(env.mount('engraved-staff')),staged=new env.Renderer(env.mount('staged'));
 try{
  await current.load(env.xml('current'));current.render();const first=observer.snapshot();
  await staged.load(env.xml('next'));staged.render();
  let value=observer.snapshot();assert.deepEqual([...value.xmlNotes].map(note=>note.id),['current-one','current-two']);assert.equal(value.ownership.rendererId,first.ownership.rendererId);assert.equal(value.ownership.renderId,first.ownership.renderId);
  staged.clear();value=observer.snapshot();assert.equal(value.notes.length,2);assert.equal(value.ownership.rendererId,first.ownership.rendererId,'Disposed last renderer must not replace the live owner');
  const unrelated=new env.Renderer(env.mount('elsewhere'));await unrelated.load(env.xml('unrelated'));unrelated.render();assert.equal(observer.snapshot().ownership.rendererId,first.ownership.rendererId);
 }finally{assert.equal(observer.restore(),true);}
});

test('moving the same prepared SVG objects into the current root adopts their own source and model',async()=>{
 const env=environment(),observer=await env.realm.observe(env.document),old=new env.Renderer(env.mount('engraved-staff')),prepared=new env.Renderer(env.mount('staged'));
 try{
  await old.load(env.xml('old'));old.render();await prepared.load(env.xml('prepared'));prepared.render();const actualSvg=prepared.container.querySelector('svg');
  const previous=observer.snapshot().ownership.rendererId;env.document.getElementById('engraved-staff').replaceChildren(prepared.container);old.clear();
  const adopted=observer.snapshot();assert.notEqual(adopted.ownership.rendererId,previous);assert.deepEqual([...adopted.xmlNotes].map(note=>note.id),['prepared-one','prepared-two']);assert.equal(prepared.container.querySelector('svg'),actualSvg);assert.equal(adopted.notes.length,2);
 }finally{observer.restore();}
});

for(const mutation of ['disposed','sheet','graphic','different-svg','foreign-head','hidden','inert'])test(`visible ownership refuses ${mutation} output instead of borrowing another renderer`,async()=>{
 const env=environment(),observer=await env.realm.observe(env.document),current=new env.Renderer(env.mount('engraved-staff')),other=new env.Renderer(env.mount('elsewhere'));
 try{
  await current.load(env.xml('current'));current.render();await other.load(env.xml('other'));other.render();
  if(mutation==='disposed')delete current.Sheet;
  if(mutation==='sheet')current.Sheet={...current.Sheet};
  if(mutation==='graphic')current.GraphicSheet={...current.GraphicSheet};
  if(mutation==='different-svg'){const original=current.container.querySelector('svg'),copy=original.cloneNode(true);copy.getBoundingClientRect=original.getBoundingClientRect;current.container.replaceChildren(copy);}
  if(mutation==='foreign-head')current.EngravingRules.GNote=()=>({vfnoteIndex:0,getNoteheadSVGs:()=>[other.container.querySelector('g')]});
  if(mutation==='hidden')current.container.style.visibility='hidden';
  if(mutation==='inert')current.container.setAttribute('inert','');
  assert.throws(()=>observer.snapshot(),/ownership|owner|SVG|unavailable|disposed|changed/);
 }finally{observer.restore();}
});

test('load-only and forged DOM attributes cannot stand in for an observed render; clear invalidates retained nodes',async()=>{
 const env=environment(),observer=await env.realm.observe(env.document),current=new env.Renderer(env.mount('engraved-staff'));
 try{
  await current.load(env.xml('current'));const svg=env.document.createElement('svg');svg.getBoundingClientRect=()=>({width:100,height:40});svg.dataset.rendererId='1';svg.dataset.renderId='1';current.container.append(svg);
  assert.throws(()=>observer.snapshot(),/observed loaded renderer/);current.render();const actual=current.container.querySelector('svg');observer.snapshot();current.clear();current.container.append(actual);assert.throws(()=>observer.snapshot(),/observed loaded renderer/);
 }finally{observer.restore();}
});
