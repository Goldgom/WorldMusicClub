import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,parseHTML} from 'linkedom';
import {fixture} from './frontend-fixtures.js';
import {validateEngravingNoteMap,matchEngravingModel,createEngravingNoteBindings} from '../web/engraving-note-map.js';
import {renderEngravedStaff} from '../web/engraving.js';
import {createNotationRenderGroup} from '../web/notation-render-group.js';

const clone=structuredClone,beat=n=>({numerator:n,denominator:1});
function example(){
  const score=clone(fixture),seed=score.parts[0].notes[0];score.parts[0].id='part';
  score.parts[0].notes=[{...clone(seed),id:'short',at:beat(0),duration:beat(1),pitch:{step:'C',alter:0,octave:4}},{...clone(seed),id:'long',at:beat(0),duration:beat(2),pitch:{step:'D',alter:0,octave:4}},{...clone(seed),id:'rest',at:beat(2),duration:beat(1),pitch:null,voice:'2'},{...clone(seed),id:'split',at:beat(3),duration:beat(2),pitch:{step:'E',alter:0,octave:4}}];
  score.measures=[{number:7,at:beat(0),length:beat(4)},{number:7,at:beat(4),length:beat(4)}];
  const segment=(source,xml,index,at,duration,extra={})=>({xml_note_id:xml,source_note_id:source,part_id:'part',xml_part_id:'P1',source_measure_index:index,measure_number:7,staff:1,voice:source==='rest'?'2':'1',lane:1,xml_voice:source==='rest'?'2':'1',at:beat(at),measure_at:beat(at-index*4),duration:beat(duration),pitch:clone(score.parts[0].notes.find(note=>note.id===source).pitch),tie_start:false,tie_stop:false,chord:false,...extra});
  const noteMap={version:1,segments:[segment('long','N1_2_1',0,0,2),segment('short','N1_1_1',0,0,1,{chord:true}),segment('split','N1_4_1',0,3,1,{tie_start:true}),segment('rest','N1_3_1',0,2,1),segment('split','N1_4_2',1,4,1,{tie_stop:true})]};
  const xml='<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Fixture</part-name></score-part></part-list><part id="P1"><measure number="7"><attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="N1_2_1"><pitch><step>D</step><alter>0</alter><octave>4</octave></pitch><duration>6</duration><voice>1</voice><staff>1</staff></note><note id="N1_1_1"><chord/><pitch><step>C</step><alter>0</alter><octave>4</octave></pitch><duration>3</duration><voice>1</voice><staff>1</staff></note><forward><duration>3</duration></forward><note id="N1_4_1"><pitch><step>E</step><alter>0</alter><octave>4</octave></pitch><duration>3</duration><tie type="start"/><voice>1</voice><staff>1</staff><notations><tied type="start"/></notations></note><backup><duration>12</duration></backup><forward><duration>6</duration></forward><note id="N1_3_1"><rest/><duration>3</duration><voice>2</voice><staff>1</staff></note><forward><duration>3</duration></forward></measure><measure number="7"><note id="N1_4_2"><pitch><step>E</step><alter>0</alter><octave>4</octave></pitch><duration>3</duration><tie type="stop"/><voice>1</voice><staff>1</staff><notations><tied type="stop"/></notations></note><forward><duration>9</duration></forward></measure></part></score-partwise>';
  return {score,xml,identity:{score,noteMap,partIdMap:{part:'P1'},voiceIdMap:[{part_id:'part',staff:1,voice:'1',lane:1,xml_voice:'1'},{part_id:'part',staff:1,voice:'2',lane:1,xml_voice:'2'}]}};
}
const checked=spec=>validateEngravingNoteMap(new DOMParser().parseFromString(spec.xml,'application/xml'),spec.identity);
class ModelPitch{static OctaveXmlDifference=3;constructor(pitch){this.FundamentalNote={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[pitch.step];this.AccidentalHalfTones=pitch.alter;this.Octave=pitch.octave-3}}
const fraction=value=>({WholeValue:0,Numerator:value.numerator,Denominator:4*value.denominator});
function model(spec){
  const instrument={IdString:'P1',Visible:true,Staves:[]},staff={ParentInstrument:instrument};instrument.Staves.push(staff);
  const measures=spec.score.measures.map(measure=>({measureListIndex:999,Duration:fraction(measure.length),AbsoluteTimestamp:fraction(measure.at),VerticalSourceStaffEntryContainers:[]})),byXml=new Map();
  for(const segment of spec.identity.noteMap.segments){const voice={ParentVoice:{VoiceId:Number(segment.xml_voice)},Timestamp:fraction(segment.measure_at),Notes:[]},note={ParentStaff:staff,SourceMeasure:measures[segment.source_measure_index],ParentVoiceEntry:voice,Length:fraction(segment.duration),Pitch:segment.pitch?new ModelPitch(segment.pitch):undefined,PrintObject:true,isRest:()=>segment.pitch===null};voice.Notes.push(note);note.SourceMeasure.VerticalSourceStaffEntryContainers.push({StaffEntries:[{VoiceEntries:[voice]}]});byXml.set(segment.xml_note_id,note)}
  const tied = spec.identity.noteMap.segments.filter(segment => segment.tie_start || segment.tie_stop).map(segment => byXml.get(segment.xml_note_id));
  if(tied.length){const tie={Notes:tied};for(const note of tied)note.NoteTie=tie;}
  return {Sheet:{Instruments:[instrument],SourceMeasures:measures},EngravingRules:{},byXml};
}
function mountEnvironment(){
  const {document}=parseHTML('<html><body><div id="mount"></div></body></html>'),window={},mount=document.getElementById('mount');
  Object.defineProperty(document,'defaultView',{configurable:true,value:window});
  window.getComputedStyle=element=>({display:element.style.display||'block',visibility:element.style.visibility||'visible',opacity:element.getAttribute('opacity')||'1',fill:element.getAttribute('fill')||'#123456'});
  mount.getBoundingClientRect=()=>({x:5,y:10,width:800,height:500});
  return {document,window,mount};
}
function graphics(renderer,mount,spec){
  const document=mount.ownerDocument,svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),groups=new Map(),graphical=new Map(),paths=new Map();mount.replaceChildren(svg);
  const keyFor=s=>JSON.stringify([s.xml_part_id,s.source_measure_index,s.xml_voice,s.measure_at]);
  for(const segment of spec.identity.noteMap.segments){const key=keyFor(segment);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(segment)}
  for(const [groupNumber,segments]of [...groups.values()].entries()){
    // Deliberately use pitch order, unlike the XML's long-note-first chord order.
    segments.sort((a,b)=>(a.pitch?.step||'').localeCompare(b.pitch?.step||''));
    const outer=document.createElementNS(svg.namespaceURI,'g'),inner=document.createElementNS(svg.namespaceURI,'g');inner.classList.add('vf-note');outer.append(inner);svg.append(outer);
    const vf={note_heads:segments.map(()=>({})),keys:segments.map(s=>s.pitch?`${s.pitch.step.toLowerCase()}/${s.pitch.octave}`:'b/4'),getAttribute:name=>name==='el'?outer:null},heads=[];
    segments.forEach((segment,index)=>{const head=document.createElementNS(svg.namespaceURI,'g');head.classList.add('vf-notehead');const path=document.createElementNS(svg.namespaceURI,'path');if(segment.source_note_id!=='short')path.setAttribute('fill','#abcdef');path.setAttribute('d','M0 0h8v7z');head.append(path);inner.append(head);head.getBoundingClientRect=()=>({x:20+index*10,y:20+groupNumber*30,width:8,height:7});heads.push(head);paths.set(segment.xml_note_id,path);
      const note=renderer.byXml.get(segment.xml_note_id);graphical.set(note,{sourceNote:note,vfnote:[vf,index],vfnoteIndex:index,vfpitch:[vf.keys[index]],notehead:()=>vf.note_heads[index],getSVGGElement:()=>outer,getVFNoteSVG:()=>inner,getNoteheadSVGs:()=>heads});
    });
  }
  renderer.EngravingRules.GNote=note=>graphical.get(note);return {graphical,paths,svg};
}
function bound(spec=example(),options={},env=mountEnvironment()){const renderer=model(spec),paint=graphics(renderer,env.mount,spec),validation=checked(spec),changes=[];const output=createEngravingNoteBindings(renderer,env.mount,validation,{fromMeasure:1,toMeasure:2,partIds:['P1'],color:'#f7cf68',onChange:value=>changes.push(value),...options});return {...env,renderer,...paint,validation,output,changes,spec}}

function cueTurns(env){
  let serial=0;const frames=new Map(),tasks=new Map();
  env.window.performance={now:()=>0};
  env.window.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};env.window.cancelAnimationFrame=id=>frames.delete(id);
  env.window.setTimeout=fn=>{tasks.set(++serial,fn);return serial;};env.window.clearTimeout=id=>tasks.delete(id);
  const run=queue=>{const batch=[...queue.values()];queue.clear();for(const fn of batch)fn();};
  return{frames,tasks,frame:()=>run(frames),task:()=>run(tasks),turn(){run(frames);run(tasks);}};
}

// Original exact 512-note page. No imported score, renderer output or user data.
function denseCueExample(prefix){
  const spec=example(),seed=spec.score.parts[0].notes[0],segments=[],measures=[];
  spec.score.parts[0].notes=[];spec.score.measures=[];
  for(let measure=0;measure<8;measure++){
    spec.score.measures.push({number:measure+1,at:beat(measure*4),length:beat(4)});const notes=[];
    for(let index=0;index<64;index++){
      const id=`${prefix}-${measure*64+index}`,xmlId=`N${measure}_${index}`,at={numerator:measure*64+index,denominator:16},duration={numerator:1,denominator:16};
      spec.score.parts[0].notes.push({...clone(seed),id,at,duration});
      segments.push({xml_note_id:xmlId,source_note_id:id,part_id:'part',xml_part_id:'P1',source_measure_index:measure,measure_number:measure+1,staff:1,voice:'1',lane:1,xml_voice:'1',at,measure_at:{numerator:index,denominator:16},duration,pitch:clone(seed.pitch),tie_start:false,tie_stop:false,chord:false});
      notes.push(`<note id="${xmlId}"><pitch><step>C</step><alter>0</alter><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>`);
    }
    measures.push(`<measure number="${measure+1}">${measure===0?'<attributes><divisions>16</divisions></attributes>':''}${notes.join('')}</measure>`);
  }
  spec.identity.noteMap.segments=segments;spec.identity.voiceIdMap=spec.identity.voiceIdMap.slice(0,1);
  spec.xml=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Original dense cues</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`;
  return spec;
}

test('complete note manifest preserves chords, unequal lengths, rests and split notes with repeated measure labels',()=>{
  const spec=example(),before=clone(spec),result=checked(spec);assert.equal(result.ok,true);assert.equal(result.segments.length,5);assert.deepEqual(spec,before);assert.equal(result.sources.size,4);
  const matched=matchEngravingModel(model(spec),result);assert.ok(matched.matches.every(entry=>entry.note));assert.equal(matched.matches.filter(entry=>entry.segment.source_note_id==='split').length,2);assert.deepEqual(matched.diagnostics,[]);
});
test('manifest validation refuses missing, unknown, altered, overlapping or unmapped source/XML identities',()=>{
  for(const mutate of [s=>delete s.identity.noteMap,s=>s.identity.noteMap.version=2,s=>s.identity.noteMap.segments.pop(),s=>s.identity.noteMap.segments[0].source_note_id='missing',s=>s.identity.noteMap.segments[0].xml_note_id='wrong',s=>s.identity.noteMap.segments[0].duration.numerator=1,s=>s.identity.noteMap.segments[0].chord=true,s=>s.identity.noteMap.segments[2].tie_start=false,s=>s.identity.noteMap.segments[4].source_measure_index=0,s=>s.identity.partIdMap.part='P2',s=>s.identity.voiceIdMap[1].xml_voice='1',s=>s.xml=s.xml.replace('<step>D</step>','<step>E</step>'),s=>s.xml=s.xml.replace('<backup><duration>12</duration>','<backup><duration>15</duration>'),s=>s.xml=s.xml.replace('id="N1_3_1"','id="N1_4_1"')]){const spec=example();mutate(spec);assert.equal(checked(spec).status,'unavailable')}
  assert.equal(validateEngravingNoteMap(new DOMParser().parseFromString('<score-partwise/>','application/xml')).status,'not-requested');
});
test('model matching requires exact fractions, voice/staff identity and one unique Note object',()=>{
  const spec=example(),validated=checked(spec);
  for(const mutate of [r=>r.byXml.get('N1_2_1').Length.Denominator=46340,r=>r.byXml.get('N1_2_1').ParentVoiceEntry.ParentVoice.VoiceId=99,r=>r.byXml.get('N1_2_1').Pitch.AccidentalHalfTones=1,r=>r.byXml.get('N1_2_1').SourceMeasure={},r=>{const n=r.byXml.get('N1_2_1');n.ParentVoiceEntry.Notes.push({...n})}]){const renderer=model(spec);mutate(renderer);const result=matchEngravingModel(renderer,validated);assert.equal(result.matches.find(entry=>entry.segment.xml_note_id==='N1_2_1').note,null);assert.ok(result.diagnostics.length)}
});
test('indexed chord coloring marks only the requested member and restores exact missing/present fills',()=>{
  const env=bound(),before=env.mount.innerHTML;assert.equal(env.output.mappingStatus().status,'ready');assert.equal(env.output.mappingStatus().verifiedGlyphCount,5);
  assert.equal(env.output.setExpectedWrittenNotes({sourceNoteIds:['long','short'],sourceMeasureIndex:0}),true);assert.equal(env.paths.get('N1_1_1').getAttribute('fill'),'#f7cf68');assert.equal(env.paths.get('N1_2_1').getAttribute('fill'),'#f7cf68');
  env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(env.paths.get('N1_1_1').hasAttribute('fill'),false);assert.equal(env.paths.get('N1_2_1').getAttribute('fill'),'#f7cf68');assert.equal(env.paths.get('N1_3_1').getAttribute('fill'),'#abcdef');env.output.clearExpectedWrittenNotes();assert.equal(env.mount.innerHTML,before);
});
test('separate non-color cues preserve musical SVG and update without geometry or child creation',()=>{
  const env=bound(example(),{cueColor:'#17251d'}),before=env.svg.innerHTML,cues=[...env.mount.querySelectorAll('.engraving-expected-cue')];
  assert.equal(cues.length,5);assert.ok(cues.every(cue=>cue.hidden));assert.equal(env.mount.querySelector('.engraving-expected-cues').getAttribute('aria-hidden'),'true');
  let reads=0;for(const graphical of env.graphical.values()){const group=graphical.getNoteheadSVGs()[graphical.vfnoteIndex],original=group.getBoundingClientRect;group.getBoundingClientRect=()=>{reads++;return original()}}
  for(let frame=0;frame<20;frame++)env.output.setExpectedWrittenNotes({sourceNoteIds:frame%2?['long']:['long','short'],sourceMeasureIndex:0});
  assert.equal(reads,0);assert.deepEqual(cues.filter(cue=>!cue.hidden).map(cue=>cue.dataset.sourceNoteId),['long']);assert.deepEqual([...env.mount.querySelectorAll('.engraving-expected-cue')],cues);
  env.output.setExpectedWrittenNotes({sourceNoteIds:['rest'],sourceMeasureIndex:0});assert.deepEqual(cues.filter(cue=>!cue.hidden).map(cue=>cue.dataset.sourceNoteId),['rest']);
  env.output.clearExpectedWrittenNotes();assert.ok(cues.every(cue=>cue.hidden));assert.equal(env.svg.innerHTML,before);
  env.output.dispose();assert.equal(env.mount.querySelector('.engraving-expected-cues'),null);assert.equal(env.svg.innerHTML,before);
});
test('expected bounds are fresh, exact to the written segment and omit stale or unavailable glyphs',()=>{
  const env=bound();env.output.setExpectedWrittenNotes({sourceNoteIds:['split'],sourceMeasureIndex:1});let bounds=env.output.expectedNoteBounds();assert.equal(bounds.status,'ready');assert.equal(bounds.rects.length,1);assert.equal(bounds.rects[0].xmlNoteId,'N1_4_2');
  const g=env.graphical.get(env.renderer.byXml.get('N1_4_2')),head=g.getNoteheadSVGs()[g.vfnoteIndex];head.getBoundingClientRect=()=>({x:13,y:27,width:8,height:7});bounds=env.output.expectedNoteBounds();assert.equal(bounds.rects[0].left,13);assert.equal(bounds.rects[0].top,27);
  head.remove();bounds=env.output.expectedNoteBounds();assert.equal(bounds.status,'unavailable');assert.deepEqual(bounds.rects,[]);assert.deepEqual(bounds.unavailableSourceNoteIds,['split']);env.output.dispose();assert.deepEqual(env.output.expectedNoteBounds().rects,[]);
  const page=bound(example(),{fromMeasure:2,toMeasure:2});page.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.deepEqual(page.output.expectedNoteBounds().unavailableSourceNoteIds,['long']);
});
test('fit refresh keeps active and future cues on their exact owned glyphs without per-frame reads',()=>{
  const env=bound(example(),{cueColor:'#17251d'}),glyph=env.paths.get('N1_2_1').parentElement;
  const cue=[...env.mount.querySelectorAll('.engraving-expected-cue')].find(node=>node.dataset.xmlNoteId==='N1_2_1');
  env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});
  const painted=env.svg.innerHTML;let reads=0;
  env.mount.getBoundingClientRect=()=>({x:30,y:40,width:600,height:400});
  glyph.getBoundingClientRect=()=>{reads++;return{x:70,y:85,width:6,height:5.25};};
  assert.equal(env.output.refreshExpectedCueGeometry(),true);
  assert.equal(cue.style.left,'37px');assert.equal(cue.style.top,'42px');assert.equal(cue.style.width,'12px');assert.equal(cue.style.height,'11.25px');assert.equal(cue.hidden,false);
  const bounds=env.output.expectedNoteBounds();assert.deepEqual(bounds.rects.map(({left,top,right,bottom})=>({left,top,right,bottom})),[{left:67,top:82,right:79,bottom:93.25}]);
  assert.equal(env.svg.innerHTML,painted,'Fit refresh changes only the separate cue, never musical SVG');
  env.output.clearExpectedWrittenNotes();glyph.getBoundingClientRect=()=>{reads++;return{x:90,y:100,width:8,height:7};};reads=0;env.output.refreshExpectedCueGeometry();assert.equal(cue.hidden,true);assert.equal(reads,0,'A hidden future cue is invalidated without measuring it');
  env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(reads,1,'The first activation remeasures its exact glyph before showing the cue');assert.equal(cue.style.left,'57px');assert.equal(cue.style.top,'57px');assert.equal(cue.hidden,false);
  for(let frame=0;frame<20;frame++)env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(reads,1,'Repeated display updates reuse the current geometry epoch');
  glyph.remove();env.output.refreshExpectedCueGeometry();assert.equal(cue.hidden,true);env.output.dispose();assert.equal(env.output.refreshExpectedCueGeometry(),false);
});

test('cue fitting batches every owned geometry read before style writes and keeps stable visibility quiet',()=>{
  const env=bound(example(),{cueColor:'#17251d'}),cues=[...env.mount.querySelectorAll('.engraving-expected-cue')];
  env.output.setExpectedWrittenNotes({sourceNoteIds:['short','long'],sourceMeasureIndex:0});
  const first=cues[0],initialLeft=first.style.left;let reads=0,expectedLeft=initialLeft;
  for(const name of ['clientLeft','clientTop','scrollLeft','scrollTop'])Object.defineProperty(env.mount,name,{configurable:true,get(){assert.equal(first.style.left,expectedLeft,'Mount layout metrics must also be read before cue styles are written');return 0;}});
  for(const graphical of env.graphical.values()){
    const group=graphical.getNoteheadSVGs()[graphical.vfnoteIndex],original=group.getBoundingClientRect;
    group.getBoundingClientRect=()=>{reads++;assert.equal(first.style.left,expectedLeft,'No cue style may be written while glyph measurements are still being read');const box=original();return{...box,x:box.x+50};};
  }
  env.output.refreshExpectedCueGeometry();assert.equal(reads,2,'Only the two active cues need fitting');assert.notEqual(first.style.left,initialLeft);
  expectedLeft=first.style.left;reads=0;env.output.expectedNoteBounds();assert.equal(reads,2);
  let visibilityWrites=0;
  for(const cue of cues){let proto=cue,descriptor;while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,'hidden');proto=Object.getPrototypeOf(proto);}assert.equal(typeof descriptor?.set,'function');Object.defineProperty(cue,'hidden',{configurable:true,get(){return descriptor.get.call(this)},set(value){visibilityWrites++;descriptor.set.call(this,value)}});}
  const before=env.mount.innerHTML;env.output.refreshExpectedCueGeometry();assert.equal(env.mount.innerHTML,before,'Stable refresh does not change styles or hidden attributes');assert.equal(visibilityWrites,0,'Unchanged visibility cannot retrigger the fit MutationObserver');
  env.output.dispose();
});

test('adopting and fitting 2048 exact owned cues measures only the current notes, then lazily refreshes future notes',()=>{
  const pages=Array.from({length:4},(_,part)=>bound(denseCueExample(`original-part-${part}`),{toMeasure:8,cueColor:'#17251d'}));
  const source=JSON.stringify(pages.map(page=>page.spec)),stats={mount:0,glyph:0,style:0};let shift=0;
  for(const env of pages){
    assert.equal(env.validation.ok,true);assert.equal(env.output.mappingStatus().verifiedGlyphCount,512);
    const mountBox=env.mount.getBoundingClientRect,style=env.window.getComputedStyle;
    env.mount.getBoundingClientRect=()=>{stats.mount++;return mountBox();};
    env.window.getComputedStyle=node=>{stats.style++;return style(node);};
    for(const graphical of env.graphical.values()){
      const head=graphical.getNoteheadSVGs()[graphical.vfnoteIndex],box=head.getBoundingClientRect;
      head.getBoundingClientRect=()=>{stats.glyph++;const value=box();return{...value,x:value.x+shift};};
    }
  }
  const group=createNotationRenderGroup(pages.map(page=>({mount:page.mount,renderer:page.output,noteIds:new Set(page.spec.score.parts[0].notes.map(note=>note.id))})));
  group.refreshExpectedCueGeometry();assert.deepEqual(stats,{mount:0,glyph:0,style:0},'An adopted page has no active cues and must not read all 2048 noteheads');
  const first={sourceNoteIds:['original-part-0-0','original-part-2-0'],sourceMeasureIndex:0};
  shift=100;assert.equal(group.setExpectedWrittenNotes(first),true);assert.equal(stats.glyph,2);assert.equal(stats.mount,2);
  const cue=pages[0].mount.querySelector('[data-source-note-id="original-part-0-0"]');assert.equal(cue.hidden,false);assert.equal(cue.style.left,'112px');
  const measured={...stats};for(let frame=0;frame<40;frame++)group.setExpectedWrittenNotes(first);assert.deepEqual(stats,measured,'Stable display frames do not repeat lazy reads');
  shift=200;group.refreshExpectedCueGeometry();assert.equal(stats.glyph,4,'Fit reads only the two current heads');assert.equal(cue.style.left,'212px');
  group.clearExpectedWrittenNotes();const cleared={...stats};shift=300;group.refreshExpectedCueGeometry();assert.deepEqual(stats,cleared,'Refitting a quiet page invalidates without measuring hidden cues');
  group.setExpectedWrittenNotes({sourceNoteIds:['original-part-1-65','original-part-3-66'],sourceMeasureIndex:1});assert.equal(stats.glyph,6,'A later source measure reads only its two newly active heads');
  const future=pages[1].mount.querySelector('[data-source-note-id="original-part-1-65"]');assert.equal(future.hidden,false);assert.equal(future.style.left,'312px');
  group.setExpectedWrittenNotes(first);assert.equal(stats.glyph,8,'Previously measured cues are rechecked after the latest fit');assert.equal(cue.style.left,'312px');
  assert.equal(group.mappingStatus().verifiedGlyphCount,2048);assert.equal(JSON.stringify(pages.map(page=>page.spec)),source,'Source score, exact times and IDs remain unchanged');
  group.dispose();assert.ok(pages.every(page=>page.mount.querySelector('.engraving-expected-cues')===null));
});

test('lazy chord cue measurements finish before fills, visibility or presentation styles change',()=>{
  const env=bound(example(),{cueColor:'#17251d'}),before=env.mount.innerHTML;let reads=0;
  env.output.refreshExpectedCueGeometry();
  const origin=env.mount.getBoundingClientRect;env.mount.getBoundingClientRect=()=>{assert.equal(env.mount.innerHTML,before);return origin();};
  for(const xmlId of ['N1_1_1','N1_2_1']){const head=env.paths.get(xmlId).parentElement,box=head.getBoundingClientRect;head.getBoundingClientRect=()=>{reads++;assert.equal(env.mount.innerHTML,before,'Every incoming glyph is measured before changing any selected fill or cue');return{...box(),x:80+reads*10};};}
  env.output.setExpectedWrittenNotes({sourceNoteIds:['short','long'],sourceMeasureIndex:0});assert.equal(reads,2);
  assert.equal([...env.mount.querySelectorAll('.engraving-expected-cue')].filter(cue=>!cue.hidden).length,2);env.output.dispose();
});

test('one shared document primes all four original dense parts in bounded read-before-write turns before later attacks',()=>{
  const shared=mountEnvironment(),turns=cueTurns(shared),parts=[];let reads=0,shift=100,readingSnapshot=null;
  for(let part=0;part<4;part++){
    const mount=shared.document.createElement('div');shared.document.body.append(mount);mount.getBoundingClientRect=()=>({x:5,y:10,width:800,height:500});
    const env=bound(denseCueExample(`shared-part-${part}`),{toMeasure:8,cueColor:'#17251d'},{...shared,mount});parts.push(env);
    for(const graphical of env.graphical.values()){
      const head=graphical.getNoteheadSVGs()[graphical.vfnoteIndex],box=head.getBoundingClientRect;
      head.getBoundingClientRect=()=>{reads++;if(readingSnapshot!==null)assert.equal(shared.document.body.innerHTML,readingSnapshot,'Every scheduled geometry read precedes every cue write in the entire document');const value=box();return{...value,x:value.x+shift};};
    }
  }
  const source=JSON.stringify(parts.map(part=>part.spec)),group=createNotationRenderGroup(parts.map(part=>({mount:part.mount,renderer:part.output,noteIds:new Set(part.spec.score.parts[0].notes.map(note=>note.id))})));
  group.refreshExpectedCueGeometry();assert.equal(reads,0);assert.equal(turns.frames.size,1,'Four bindings share exactly one pending frame');assert.equal(turns.tasks.size,0);
  for(let part=0;part<4;part++){
    turns.frame();assert.equal(reads,part*32,'Preparation waits for the frame and then a separate task');assert.equal(turns.tasks.size,1);
    readingSnapshot=shared.document.body.innerHTML;turns.task();readingSnapshot=null;assert.equal(reads,(part+1)*32,'One turn visits at most 32 cues across all renderers');
    const cue=parts[part].mount.querySelector(`[data-source-note-id="shared-part-${part}-0"]`);assert.equal(cue.style.left,'112px');assert.equal(cue.hidden,true,'Preparation never activates a future note');
  }
  const first={sourceNoteIds:parts.map((_,part)=>`shared-part-${part}-0`),sourceMeasureIndex:0};
  group.setExpectedWrittenNotes(first);assert.equal(reads,128,'All four first attacks use their freshly primed exact geometry');
  group.clearExpectedWrittenNotes();let steps=4;
  while(turns.frames.size||turns.tasks.size){const before=reads;turns.turn();assert.ok(reads-before<=32);assert.ok(++steps<=64,'The queue drains after one bounded pass through the admitted entries');}
  assert.equal(reads,2048);assert.equal(steps,64);
  for(let measure=0;measure<8;measure++)for(let note=0;note<64;note++)group.setExpectedWrittenNotes({sourceNoteIds:parts.map((_,part)=>`shared-part-${part}-${measure*64+note}`),sourceMeasureIndex:measure});
  assert.equal(reads,2048,'The complete original dense attack sequence adds no lazy geometry reads after priming');
  assert.equal(JSON.stringify(parts.map(part=>part.spec)),source);group.dispose();assert.equal(turns.frames.size+turns.tasks.size,0);
});

test('repeated fit epochs coalesce priming, keep immediate exact fallback, and cancel on disposal',()=>{
  const env=mountEnvironment(),turns=cueTurns(env),page=bound(example(),{cueColor:'#17251d'},env),cue=page.mount.querySelector('[data-xml-note-id="N1_1_1"]'),head=page.paths.get('N1_1_1').parentElement;
  let x=100,reads=0;head.getBoundingClientRect=()=>{reads++;return{x,y:20,width:8,height:7};};
  page.output.refreshExpectedCueGeometry();turns.frame();assert.equal(turns.tasks.size,1);
  page.output.refreshExpectedCueGeometry();page.output.refreshExpectedCueGeometry();assert.equal(turns.tasks.size,0);assert.equal(turns.frames.size,1,'New epochs replace queued work instead of stacking tasks');
  page.output.setExpectedWrittenNotes({sourceNoteIds:['short'],sourceMeasureIndex:0});assert.equal(cue.style.left,'92px');assert.equal(cue.hidden,false);assert.equal(reads,1,'An attack before priming uses the exact current glyph');
  page.output.clearExpectedWrittenNotes();x=150;page.output.refreshExpectedCueGeometry();turns.turn();assert.equal(cue.style.left,'142px');assert.equal(cue.hidden,true);assert.equal(reads,2);
  page.output.setExpectedWrittenNotes({sourceNoteIds:['short'],sourceMeasureIndex:0});assert.equal(cue.hidden,false);assert.equal(reads,2);
  page.output.clearExpectedWrittenNotes();page.output.refreshExpectedCueGeometry();turns.frame();const before=reads;page.output.dispose();turns.turn();assert.equal(reads,before);assert.equal(turns.frames.size+turns.tasks.size,0);assert.equal(page.mount.querySelector('.engraving-expected-cues'),null);
});

test('cue preparation yields on its wall-time budget without dropping remaining exact glyphs',()=>{
  const env=mountEnvironment(),turns=cueTurns(env),page=bound(example(),{cueColor:'#17251d'},env);let clock=0,reads=0;
  env.window.performance.now=()=>clock;
  for(const graphical of page.graphical.values()){
    const head=graphical.getNoteheadSVGs()[graphical.vfnoteIndex],box=head.getBoundingClientRect;
    head.getBoundingClientRect=()=>{reads++;clock+=3;return{...box(),x:100};};
  }
  page.output.refreshExpectedCueGeometry();turns.turn();assert.equal(reads,2,'The 4ms budget stops after the second indivisible 3ms measurement');assert.equal(turns.frames.size,1);
  turns.turn();assert.equal(reads,4);turns.turn();assert.equal(reads,5);assert.equal(turns.frames.size+turns.tasks.size,0);
  assert.ok([...page.mount.querySelectorAll('.engraving-expected-cue')].every(cue=>cue.style.left==='92px'&&cue.hidden));
  page.output.setExpectedWrittenNotes({sourceNoteIds:['short','long','rest'],sourceMeasureIndex:0});assert.equal(reads,5,'All retained work completes with exact future positions');page.output.dispose();
});

test('a failed speculative cue measurement stays stale for an exact retry on the real attack',()=>{
  for(const failure of ['origin','glyph']){
    const env=mountEnvironment(),turns=cueTurns(env),page=bound(example(),{cueColor:'#17251d'},env),cue=page.mount.querySelector('[data-xml-note-id="N1_1_1"]'),head=page.paths.get('N1_1_1').parentElement;
    let unavailable=true,reads=0;const origin=page.mount.getBoundingClientRect;
    page.mount.getBoundingClientRect=()=>{if(unavailable&&failure==='origin')throw Error('Temporarily unavailable origin');return origin();};
    head.getBoundingClientRect=()=>{reads++;if(unavailable&&failure==='glyph')throw Error('Temporarily unavailable glyph');return{x:100,y:20,width:8,height:7};};
    page.output.refreshExpectedCueGeometry();assert.doesNotThrow(()=>turns.turn());assert.equal(cue.hidden,true);const before=reads;
    unavailable=false;page.output.setExpectedWrittenNotes({sourceNoteIds:['short'],sourceMeasureIndex:0});assert.equal(reads,before+1,'The real attack retries instead of accepting failed speculative geometry');assert.equal(cue.hidden,false);assert.equal(cue.style.left,'92px');page.output.dispose();
  }
});

test('a superseded or disposed measurement batch cannot write cues or resurrect its queue',()=>{
  for(const action of ['fit','dispose']){
    const env=mountEnvironment(),turns=cueTurns(env),page=bound(example(),{cueColor:'#17251d'},env),cue=page.mount.querySelector('[data-xml-note-id="N1_1_1"]'),head=page.paths.get('N1_1_1').parentElement,initial=cue.style.left;
    let triggered=false;head.getBoundingClientRect=()=>{if(!triggered){triggered=true;if(action==='fit')page.output.refreshExpectedCueGeometry();else page.output.dispose();}return{x:100,y:20,width:8,height:7};};
    page.output.refreshExpectedCueGeometry();turns.turn();assert.equal(cue.style.left,initial,'Obsolete reads cannot publish their coordinates');
    if(action==='fit'){assert.equal(turns.frames.size,1);turns.turn();assert.equal(cue.style.left,'92px');page.output.dispose();}
    assert.equal(turns.frames.size+turns.tasks.size,0);
  }
});

test('unreadable or unowned lazy cue geometry stays hidden and cannot abort the expected-note update',()=>{
  for(const failure of ['origin','style','box','hidden','replaced','reparented','empty']){
    const env=bound(example(),{cueColor:'#17251d'}),path=env.paths.get('N1_1_1'),head=path.parentElement,cue=env.mount.querySelector('[data-xml-note-id="N1_1_1"]');
    env.output.refreshExpectedCueGeometry();
    if(failure==='origin')env.mount.getBoundingClientRect=()=>{throw Error('Unavailable mount geometry');};
    if(failure==='style')env.window.getComputedStyle=()=>{throw Error('Unavailable glyph style');};
    if(failure==='box')head.getBoundingClientRect=()=>{throw Error('Unavailable glyph box');};
    if(failure==='hidden')path.style.display='none';
    if(failure==='replaced')path.replaceWith(path.cloneNode(true));
    if(failure==='reparented')env.svg.append(head);
    if(failure==='empty')head.getBoundingClientRect=()=>({x:20,y:30,width:0,height:7});
    const request={sourceNoteIds:['short'],sourceMeasureIndex:0};
    for(let frame=0;frame<3;frame++){assert.doesNotThrow(()=>env.output.setExpectedWrittenNotes(request),failure);assert.equal(cue.hidden,true,failure);env.output.clearExpectedWrittenNotes();}
    assert.equal(env.output.mappingStatus().verifiedGlyphCount,5,'Optional cue geometry does not rewrite admitted source/model ownership');env.output.dispose();
  }
});

test('fresh bounds refuse replaced, reparented and hidden owned paths and hide their non-color cues',()=>{
  for(const mutate of [
    ({path})=>{path.style.display='none'},
    ({path})=>{path.setAttribute('opacity','0')},
    ({path})=>{path.setAttribute('fill','none')},
    ({path})=>{path.setAttribute('fill','rgba(0, 0, 0, 0)')},
    ({path})=>{path.replaceWith(path.cloneNode(true))},
    ({head,env})=>{env.svg.append(head)},
    ({head})=>{head.getBoundingClientRect=()=>({x:10,y:20,width:0,height:7})},
  ]){
    const env=bound(example(),{cueColor:'#17251d'}),path=env.paths.get('N1_1_1'),head=path.parentElement;
    env.output.setExpectedWrittenNotes({sourceNoteIds:['short','long'],sourceMeasureIndex:0});assert.equal(env.output.expectedNoteBounds().status,'ready');
    mutate({env,path,head});const bounds=env.output.expectedNoteBounds();assert.equal(bounds.status,'partial');assert.deepEqual(bounds.rects.map(rect=>rect.sourceNoteId),['long']);assert.deepEqual(bounds.unavailableSourceNoteIds,['short']);
    assert.deepEqual([...env.mount.querySelectorAll('.engraving-expected-cue')].filter(cue=>!cue.hidden).map(cue=>cue.dataset.sourceNoteId),['long']);env.output.dispose();assert.equal(env.mount.querySelector('.engraving-expected-cues'),null);
  }
});
test('split and rest selection uses the explicit source measure ordinal; hidden pages are not missing mappings',()=>{
  const env=bound(example(),{fromMeasure:2,toMeasure:2});assert.equal(env.output.mappingStatus().verifiedGlyphCount,1);assert.equal(env.output.mappingStatus().bindings.filter(entry=>entry.status==='not-displayed').length,4);
  env.output.setExpectedWrittenNotes({sourceNoteIds:['split'],sourceMeasureIndex:1});assert.equal(env.paths.get('N1_4_2').getAttribute('fill'),'#f7cf68');assert.equal(env.paths.get('N1_4_1').getAttribute('fill'),'#abcdef');env.output.clearExpectedWrittenNotes();
  const all=bound();all.output.setExpectedWrittenNotes({sourceNoteIds:['rest'],sourceMeasureIndex:0});assert.equal(all.paths.get('N1_3_1').getAttribute('fill'),'#f7cf68');assert.equal(all.paths.get('N1_4_1').getAttribute('fill'),'#abcdef');
});
test('unknown or duplicate expected IDs clear prior highlights and do not repeat status announcements',()=>{
  const env=bound(),before=env.mount.innerHTML;env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});
  for(const value of [{sourceNoteIds:['long','long'],sourceMeasureIndex:0},{sourceNoteIds:['missing'],sourceMeasureIndex:0},{sourceNoteIds:'long',sourceMeasureIndex:0},{sourceNoteIds:['short'],sourceMeasureIndex:1},{sourceNoteIds:[],sourceMeasureIndex:99}])assert.equal(env.output.setExpectedWrittenNotes(value),false);
  assert.equal(env.mount.innerHTML,before);assert.equal(env.changes.length,1);assert.equal(env.output.mappingStatus().status,'unavailable');env.output.clearExpectedWrittenNotes();assert.equal(env.output.mappingStatus().status,'ready');
});
test('bad chord indices, hidden glyphs and unsupported shapes produce partial mapping without changing static staff',()=>{
  for(const mutate of [g=>g.vfnoteIndex=99,g=>g.vfnote[1]=7,g=>g.vfpitch[0]='wrong',g=>g.sourceNote.PrintObject=false,g=>g.getNoteheadSVGs()[g.vfnoteIndex].style.visibility='hidden',g=>g.getNoteheadSVGs()[g.vfnoteIndex].firstChild.setAttribute('fill','none')]){
    const spec=example(),env=mountEnvironment(),renderer=model(spec),paint=graphics(renderer,env.mount,spec);mutate(paint.graphical.get(renderer.byXml.get('N1_2_1')));const before=env.mount.innerHTML,output=createEngravingNoteBindings(renderer,env.mount,checked(spec),{fromMeasure:1,toMeasure:2,partIds:['P1'],color:'#f7cf68'});assert.equal(output.mappingStatus().status,'partial');assert.equal(output.mappingStatus().bindings.find(entry=>entry.xmlNoteId==='N1_2_1').status,'unavailable');output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(env.mount.innerHTML,before);
  }
});
test('shared DOM heads expose the complete source set and remain unchanged',()=>{
  const spec=example(),env=mountEnvironment(),renderer=model(spec),paint=graphics(renderer,env.mount,spec),short=paint.graphical.get(renderer.byXml.get('N1_1_1')),long=paint.graphical.get(renderer.byXml.get('N1_2_1'));
  const shared=short.getNoteheadSVGs()[0];long.getNoteheadSVGs=()=>[shared,shared];const before=env.mount.innerHTML;
  const output=createEngravingNoteBindings(renderer,env.mount,checked(spec),{fromMeasure:1,toMeasure:2,partIds:['P1'],color:'#f7cf68'}),status=output.mappingStatus();assert.equal(status.status,'partial');assert.deepEqual(status.diagnostics.find(item=>item.code==='engraving_shared_glyph').sourceNoteIds.sort(),['long','short']);output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(env.mount.innerHTML,before);
});
test('coincident unisons in distinct voices stay partial despite unique source/model identities',()=>{
  const spec=example();spec.score.parts[0].notes[0].pitch.step='D';spec.score.parts[0].notes[0].voice='3';Object.assign(spec.identity.noteMap.segments[1],{pitch:{step:'D',alter:0,octave:4},voice:'3',xml_voice:'3',chord:false});spec.identity.voiceIdMap.push({part_id:'part',staff:1,voice:'3',lane:1,xml_voice:'3'});
  spec.xml=spec.xml.replace('<note id="N1_1_1"><chord/><pitch><step>C','<backup><duration>6</duration></backup><note id="N1_1_1"><pitch><step>D').replace('<duration>3</duration><voice>1</voice><staff>1</staff></note><forward>','<duration>3</duration><voice>3</voice><staff>1</staff></note><forward><duration>3</duration></forward><forward>');
  const env=mountEnvironment(),renderer=model(spec),paint=graphics(renderer,env.mount,spec),validation=checked(spec);assert.equal(validation.ok,true);for(const id of ['N1_1_1','N1_2_1']){const graphical=paint.graphical.get(renderer.byXml.get(id));graphical.getNoteheadSVGs()[graphical.vfnoteIndex].getBoundingClientRect=()=>({x:30,y:40,width:8,height:7})}
  const before=env.mount.innerHTML,output=createEngravingNoteBindings(renderer,env.mount,validation,{fromMeasure:1,toMeasure:2,partIds:['P1'],color:'#f7cf68'});assert.equal(output.mappingStatus().verifiedGlyphCount,3);assert.deepEqual(output.mappingStatus().diagnostics.find(item=>item.code==='engraving_shared_glyph').sourceNoteIds.sort(),['long','short']);output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});assert.equal(env.mount.innerHTML,before);
});
test('canonically equivalent Unicode source IDs remain exact and independent',()=>{
  const spec=example();spec.score.parts[0].notes[0].id='é';spec.score.parts[0].notes[1].id='e\u0301';for(const segment of spec.identity.noteMap.segments){if(segment.source_note_id==='short')segment.source_note_id='é';else if(segment.source_note_id==='long')segment.source_note_id='e\u0301'}
  const env=bound(spec);assert.equal(env.output.mappingStatus().verifiedGlyphCount,5);env.output.setExpectedWrittenNotes({sourceNoteIds:['é'],sourceMeasureIndex:0});assert.equal(env.paths.get('N1_1_1').getAttribute('fill'),'#f7cf68');assert.equal(env.paths.get('N1_2_1').getAttribute('fill'),'#abcdef');env.output.dispose();assert.equal(env.output.mappingStatus().verifiedGlyphCount,0);
});
test('coincident heads with different accidentals cannot masquerade as distinct visual identities',()=>{
  const spec=example(),pitch={step:'D',alter:1,octave:4};spec.score.parts[0].notes[0].pitch=pitch;spec.identity.noteMap.segments[1].pitch=clone(pitch);spec.xml=spec.xml.replace('<step>C</step><alter>0</alter>','<step>D</step><alter>1</alter>');
  const env=mountEnvironment(),renderer=model(spec),paint=graphics(renderer,env.mount,spec);for(const id of ['N1_1_1','N1_2_1']){const g=paint.graphical.get(renderer.byXml.get(id));g.getNoteheadSVGs()[g.vfnoteIndex].getBoundingClientRect=()=>({x:30,y:40,width:8,height:7})}
  const before=env.mount.innerHTML,output=createEngravingNoteBindings(renderer,env.mount,checked(spec),{fromMeasure:1,toMeasure:2,partIds:['P1'],color:'#f7cf68'});assert.equal(output.mappingStatus().verifiedGlyphCount,3);assert.deepEqual(output.mappingStatus().diagnostics.find(item=>item.code==='engraving_shared_glyph').sourceNoteIds.sort(),['long','short']);output.setExpectedWrittenNotes({sourceNoteIds:['short'],sourceMeasureIndex:0});assert.equal(env.mount.innerHTML,before);
});
test('duplicate manifest identity tuples never select the first surviving model note',()=>{
  const spec=example();Object.assign(spec.score.parts[0].notes[0],{pitch:{step:'D',alter:0,octave:4},duration:beat(2)});Object.assign(spec.identity.noteMap.segments[1],{pitch:{step:'D',alter:0,octave:4},duration:beat(2)});spec.xml=spec.xml.replace('<step>C</step>','<step>D</step>').replace('<duration>3</duration><voice>1</voice><staff>1</staff></note>','<duration>6</duration><voice>1</voice><staff>1</staff></note>');
  const validated=checked(spec);assert.equal(validated.ok,true);const renderer=model(spec);renderer.byXml.get('N1_1_1').ParentVoiceEntry.Notes=[];
  for(const segments of [validated.segments,[...validated.segments].reverse()]){const output=matchEngravingModel(renderer,{...validated,segments});assert.ok(output.matches.filter(entry=>['long','short'].includes(entry.segment.source_note_id)).every(entry=>entry.note===null&&entry.reason==='engraving_note_identity_ambiguous'));assert.deepEqual(output.diagnostics.find(item=>item.code==='engraving_note_identity_ambiguous').sourceNoteIds.sort(),['long','short'])}
});
test('an unavailable renderer model still reports the actual requested segment count',()=>{
  const spec=example(),env=mountEnvironment(),renderer={Sheet:{SourceMeasures:[],Instruments:[]}},output=createEngravingNoteBindings(renderer,env.mount,checked(spec),{fromMeasure:1,toMeasure:1,partIds:['P1'],color:'#f7cf68'});assert.equal(output.mappingStatus().status,'unavailable');assert.equal(output.mappingStatus().displayedSegmentCount,4);assert.equal(output.mappingStatus().verifiedGlyphCount,0);
});
test('detached glyph generations and disposed handles cannot color a replacement mount',()=>{
  const env=bound(),before=env.mount.innerHTML;env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});env.paths.get('N1_2_1').parentElement.remove();assert.equal(env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0}),false);assert.equal(env.output.mappingStatus().verifiedGlyphCount,0);env.output.dispose();env.mount.innerHTML=before;assert.equal(env.output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0}),false);assert.equal(env.mount.innerHTML,before);
});
test('adapter rebuilds glyph bindings after resize, reapplies expected state, and never renders on note updates',async()=>{
  const spec=example(),env=mountEnvironment();let width=900;Object.defineProperty(env.mount,'clientWidth',{configurable:true,get:()=>width});// Linkedom's XML wildcard traversal differs from native DOMParser; shim only
  // the test parser, while the renderer remains a deliberate non-layout double.
  env.window.DOMParser=class{parseFromString(input,type){const document=new DOMParser().parseFromString(input,type),native=document.getElementsByTagName.bind(document);for(const element of document.querySelectorAll('*'))Object.defineProperty(element,'namespaceURI',{value:'',configurable:true});document.getElementsByTagName=name=>name==='*'?document.querySelectorAll('*'):native(name);return document}};const instances=[];
  class Renderer{constructor(mount){this.mount=mount;Object.assign(this,model(spec));this.Version='2.1.3-release';this.renders=0;instances.push(this)}async load(document){for(const [index,measure] of [...document.querySelectorAll('measure')].entries())for(const _padding of measure.querySelectorAll('note[print-object="no"]'))this.Sheet.SourceMeasures[index].VerticalSourceStaffEntryContainers.push({StaffEntries:[{VoiceEntries:[{Notes:[{PrintObject:false,isRest:()=>true}]}]}]})}updateGraphic(){}render(){this.renders++;this.paint=graphics(this,this.mount,spec)}clear(){this.mount.replaceChildren()}}
  env.window.opensheetmusicdisplay={OpenSheetMusicDisplay:Renderer};const changes=[];
  const output=await renderEngravedStaff(env.mount,spec.xml,{identity:spec.identity,responsive:false,fromMeasure:1,toMeasure:2,onMappingChange:value=>changes.push(value)});assert.equal(output.ok,true,output.message);assert.equal(output.mappingStatus().verifiedGlyphCount,5);const renderer=instances[0];
  assert.equal(output.renderGeneration(),1);assert.equal(output.resize(),true);assert.equal(output.renderGeneration(),1);assert.match(renderer.mount.getAttribute('aria-label'),/轮廓符头表示预期谱面音符/);
  const originalCues=[...renderer.mount.querySelectorAll('.engraving-expected-cue')];assert.equal(originalCues.length,5);
  for(let i=0;i<10;i++)output.setExpectedWrittenNotes({sourceNoteIds:i%2?['long']:['short'],sourceMeasureIndex:0});assert.equal(renderer.renders,1);const old=renderer.paint.paths.get('N1_2_1');output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0});width=700;assert.equal(output.resize(),true);assert.equal(renderer.renders,2);assert.notEqual(renderer.paint.paths.get('N1_2_1'),old);assert.equal(old.getAttribute('fill'),'#abcdef');assert.equal(renderer.paint.paths.get('N1_2_1').getAttribute('fill'),'#925b12');assert.equal(changes.length,2);output.clearExpectedWrittenNotes();assert.equal(renderer.paint.paths.get('N1_2_1').getAttribute('fill'),'#abcdef');output.dispose();assert.equal(output.mappingStatus().verifiedGlyphCount,0);assert.equal(output.setExpectedWrittenNotes({sourceNoteIds:['long'],sourceMeasureIndex:0}),false);
  assert.equal(output.renderGeneration(),2);assert.ok(originalCues.every(cue=>!cue.isConnected));assert.equal(env.mount.querySelector('.engraving-expected-cues'),null);assert.deepEqual(output.expectedNoteBounds().rects,[]);
});
