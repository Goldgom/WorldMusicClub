import test from 'node:test';
import assert from 'node:assert/strict';
import {notationMeasuresPerRow,planNotationRows,revealNotationRows} from '../web/notation-row-window.js';
const rows=Array.from({length:4},(_,index)=>({sourceMeasureIndices:[index*2,index*2+1],staffCount:2,rect:{top:20+index*170,bottom:170+index*170,left:0,right:600}}));
test('adjacent score systems advance by one row, preserving the next row and final pair',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7].map(index=>planNotationRows(rows,index).first),[0,0,1,1,2,2,2,2]);
  for(let index=0;index<8;index++){const plan=planNotationRows(rows,index);assert.equal(plan.rows.length,2);assert.equal(plan.rows[1],rows[plan.first+1]);}
  assert.equal(planNotationRows(rows,6,{more:true}).nextFrom,6);
  assert.equal(planNotationRows(rows,6).nextFrom,null);
});
test('repeat, backwards seek and source replacement depend only on current verified source index',()=>{
  assert.deepEqual([0,4,2,6,0,2].map(index=>planNotationRows(rows,index).first),[0,2,1,2,0,1]);
  assert.equal(planNotationRows([{sourceMeasureIndices:[0],rect:rows[0].rect}],0).rows.length,1);
  assert.equal(planNotationRows(rows,100),null);assert.equal(planNotationRows([],0),null);
});
test('a grand staff remains a single system; short final scores retain both systems',()=>{
  assert.equal(planNotationRows(rows.slice(0,2),3).rows.length,2);
  assert.equal(planNotationRows(rows.slice(0,1),1).rows.length,1);
  assert.deepEqual([320,599,600,999,1000].map(notationMeasuresPerRow),[1,1,2,2,4]);
});
test('fragmented source measure follows its actual generated system using verified glyph bounds',()=>{
  const fragments=rows.map(row=>({...row,sourceMeasureIndices:[0]}));
  assert.equal(planNotationRows(fragments,0,{expectedRects:[{top:370,bottom:390}]}).first,2);
});
test('small windows reflow for two complete readable rows; pause and resize do not change the selected system',()=>{
  const properties=new Map(),stage={style:{setProperty:(key,value)=>properties.set(key,value)}};
  const viewport={dataset:{},scrollTop:0,scrollLeft:0,getBoundingClientRect:()=>({top:0,bottom:100}),scrollTo({top}){this.scrollTop=top;}};
  const plan=revealNotationRows({systems:rows,sourceMeasureIndex:2,viewport,stage});
  assert.equal(plan.height,344);assert.equal(properties.get('--notation-row-height'),'344px');assert.equal(viewport.dataset.notationRows,'2');assert.equal(viewport.scrollTop,178);
  const moved=rows.map(row=>({...row,rect:{...row.rect,top:row.rect.top-178,bottom:row.rect.bottom-178}}));
  revealNotationRows({systems:moved,sourceMeasureIndex:2,viewport,stage});assert.equal(viewport.scrollTop,178);
  const resized=moved.map(row=>({...row,rect:{...row.rect,bottom:row.rect.bottom+40}}));
  assert.equal(revealNotationRows({systems:resized,sourceMeasureIndex:2,viewport,stage}).height,384);
});

test('long native rows keep all pitch/numbered targets beyond the 32-beat renderer bound',async()=>{
 const {renderBasicKeyPage}=await import('../web/basic-key-numbered.js');const {fixture}=await import('./frontend-fixtures.js');
 const score=structuredClone(fixture);score.measures=Array.from({length:4},(_,index)=>({number:index+1,at:{numerator:index*12,denominator:1},length:{numerator:12,denominator:1}}));score.parts[0].notes=[0,16,31,36,47].map((at,index)=>({...score.parts[0].notes[0],id:`long-${index}`,at:{numerator:at,denominator:1},duration:{numerator:1,denominator:1}}));
 const page={score,interpreted_notes:[]};for(const mode of ['staff','jianpu']){const result=renderBasicKeyPage(page,mode,{width:1100,measureFrom:0,measureTo:4});assert.deepEqual(result.renderedIds,score.parts[0].notes.map(note=>note.id));for(const id of result.renderedIds)assert.ok(result.html.includes(`data-note-id="${id}"`));}
});

test('adjacent native preview cues keep their own page-local measure identity for a held source note',async()=>{
 const {createNotationRenderGroup}=await import('../web/notation-render-group.js');const updates=[],clears=[];
 const members=[0,1].map(offset=>({sourceMeasureOffset:offset,sourceMeasureIndices:[offset],noteIds:new Set(['held']),renderer:{mappingStatus:()=>({status:'ready'}),setExpectedWrittenNotes:value=>{updates.push({offset,...value});return true;},clearExpectedWrittenNotes:()=>clears.push(offset)}}));
 const group=createNotationRenderGroup(members);group.setExpectedWrittenNotes({sourceMeasureIndex:0,sourceNoteIds:['held']});assert.deepEqual(updates,[{offset:0,sourceMeasureIndex:0,sourceNoteIds:['held']}]);assert.deepEqual(clears,[1]);
 updates.length=0;clears.length=0;group.setExpectedWrittenNotes({sourceMeasureIndex:1,sourceNoteIds:['held']});assert.deepEqual(updates,[{offset:1,sourceMeasureIndex:0,sourceNoteIds:['held']}]);assert.deepEqual(clears,[0]);
});

test('basic adjacent native rows highlight only the current source-measure copy of a sustained ID',async()=>{
 const {parseHTML}=await import('linkedom');const {updateWrittenNoteHighlights}=await import('../web/performance-view.js');
 const {document}=parseHTML('<section data-notation-native-row="4" data-notation-measure-count="1"><g class="score-note" data-note-id="held"></g></section><section data-notation-native-row="5" data-notation-measure-count="1"><g class="score-note" data-note-id="held"></g></section>');
 updateWrittenNoteHighlights(document,['held'],4);assert.deepEqual([...document.querySelectorAll('.score-note')].map(node=>node.classList.contains('active')),[true,false]);
 updateWrittenNoteHighlights(document,['held'],5);assert.deepEqual([...document.querySelectorAll('.score-note')].map(node=>node.classList.contains('active')),[false,true]);
});

test('native row geometry includes wide verified system ink rather than only its bounded block wrapper',async()=>{
 const {createNotationRenderGroup}=await import('../web/notation-render-group.js');
 const group=createNotationRenderGroup([{rowIndex:0,sourceMeasureIndices:[0],rowMount:{getBoundingClientRect:()=>({top:0,bottom:200,left:0,right:400})},renderer:{systemLayout:()=>({systems:[{rect:{top:10,bottom:190,left:0,right:1800}}]})}}]);
 assert.equal(group.systemLayout().systems[0].rect.right,1800);
});

test('short 2/4 native rows never borrow the next measure label from the renderer minimum span',async()=>{
 const {renderBasicKeyPage}=await import('../web/basic-key-numbered.js');const {fixture}=await import('./frontend-fixtures.js');const {parseHTML}=await import('linkedom');
 const score=structuredClone(fixture);score.measures=[0,2].map((at,index)=>({number:index+1,at:{numerator:at,denominator:1},length:{numerator:2,denominator:1}}));score.parts[0].notes=score.measures.map((measure,index)=>({...score.parts[0].notes[0],id:`short-${index}`,at:measure.at,duration:{numerator:1,denominator:1}}));
 const {document}=parseHTML(renderBasicKeyPage({score},'staff',{width:320,measureFrom:0,measureTo:1}).html);assert.deepEqual([...document.querySelectorAll('.measure-number')].map(node=>node.textContent),['1']);
});
