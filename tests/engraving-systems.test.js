import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEngravingSystemBreaks,readEngravingSystems} from '../web/engraving-systems.js';

function fixture({rows=[[0,1],[2,3]],staves=2,indices=[0,1,2,3],matrix={a:1,b:0,c:0,d:1,e:30,f:50}}={}){
  const source=indices.map((_,index)=>({MeasureNumber:index?7:0}));
  const coordinates=indices.map(sourceMeasureIndex=>({sourceMeasureIndex,offset:{numerator:0,denominator:1}}));
  const systems=rows.map((row,index)=>{
    const system={StaffLines:Array.from({length:staves},()=>({})),PositionAndShape:{AbsolutePosition:{x:4,y:3+index*20},BorderLeft:-2,BorderRight:80,BorderTop:-1,BorderBottom:12}};
    system.GraphicalMeasures=row.map(model=>Array.from({length:staves},()=>({parentSourceMeasure:source[model],ParentMusicSystem:system,staffEntries:[]})));
    return system;
  });
  const page={MusicSystems:systems},svg={isConnected:true,getScreenCTM:()=>matrix,getBoundingClientRect:()=>({width:1000,height:500})};
  const backend={graphicalMusicPage:page,getSvgElement:()=>svg};
  const renderer={Sheet:{SourceMeasures:source},EngravingRules:{},GraphicSheet:{MusicPages:[page]},Drawer:{Backends:[backend],calculatePixelDistance:units=>units*10}};
  return {renderer,coordinates,source,systems,page,svg,backend,mount:{contains:node=>node===svg},matrix};
}

test('two grand-staff systems remain two temporal rows, including silent measures',()=>{
  const value=fixture(),layout=readEngravingSystems(value.renderer,value.mount,value.coordinates,{fromMeasure:1,toMeasure:4});
  assert.equal(layout.status,'ready');
  assert.equal(layout.systems.length,2);
  assert.deepEqual(layout.systems.map(row=>row.sourceMeasureIndices),[[0,1],[2,3]]);
  assert.deepEqual(layout.systems.map(row=>row.staffCount),[2,2]);
  assert.equal(layout.systems[0].measures.length,2,'Repeated graphical staves do not duplicate source measures');
  assert.deepEqual(layout.systems[0].rect,{left:40,right:880,top:60,bottom:210,width:840,height:150});
});

test('one multi-instrument system is not mistaken for multiple sequential rows',()=>{
  const value=fixture({rows:[[0,1,2,3]],staves:5});
  const layout=readEngravingSystems(value.renderer,value.mount,value.coordinates);
  assert.equal(layout.systems.length,1);
  assert.equal(layout.systems[0].staffCount,5);
  assert.deepEqual(layout.systems[0].sourceMeasureIndices,[0,1,2,3]);
});

test('SVG screen matrix handles zoom, fit, translation and current scroll exactly once',()=>{
  const value=fixture({matrix:{a:.75,b:0,c:0,d:.75,e:7,f:-80}});
  value.renderer.Zoom=1.2;
  const first=readEngravingSystems(value.renderer,value.mount,value.coordinates).systems[0].rect;
  assert.deepEqual(first,{left:14.5,right:644.5,top:-72.5,bottom:40,width:630,height:112.5});
  value.matrix.f=-120;
  assert.equal(readEngravingSystems(value.renderer,value.mount,value.coordinates).systems[0].top,first.top-40,'Fresh geometry follows scrolling without a renderer rebuild');
});

test('all rectangle corners are transformed rather than assuming unrotated SVG',()=>{
  const value=fixture({matrix:{a:0,b:1,c:-1,d:0,e:500,f:0}});
  assert.deepEqual(readEngravingSystems(value.renderer,value.mount,value.coordinates).systems[0].rect,{left:340,right:490,top:10,bottom:850,width:150,height:840});
});

test('fragment rows retain exact source coordinates and ignore duplicate printed labels',()=>{
  const value=fixture({rows:[[0,1],[2,3]],indices:[9,9,10,11]});
  value.coordinates[1].offset={numerator:1,denominator:2};
  const layout=readEngravingSystems(value.renderer,value.mount,value.coordinates,{fromMeasure:10,toMeasure:12});
  assert.deepEqual(layout.systems.map(row=>row.sourceMeasureIndices),[[9],[10,11]]);
  assert.deepEqual(layout.systems[0].measures[1],{sourceMeasureIndex:9,offset:{numerator:1,denominator:2},modelMeasureIndex:1});
});

test('extra cautionary measures and nondisplayed tie context do not become row identities',()=>{
  const value=fixture();
  value.systems[0].GraphicalMeasures.push([{IsExtraGraphicalMeasure:true}]);
  const layout=readEngravingSystems(value.renderer,value.mount,value.coordinates,{fromMeasure:2,toMeasure:3});
  assert.deepEqual(layout.systems.map(row=>row.sourceMeasureIndices),[[1],[2]]);
});

test('different pages use their own exact backend and SVG transform',()=>{
  const value=fixture(),page={MusicSystems:[value.systems.pop()]},svg={isConnected:true,getScreenCTM:()=>({a:1,b:0,c:0,d:1,e:30,f:550}),getBoundingClientRect:()=>({width:1000,height:500})};
  value.renderer.GraphicSheet.MusicPages.push(page);
  value.renderer.Drawer.Backends.push({graphicalMusicPage:page,getSvgElement:()=>svg});
  const old=value.mount.contains;value.mount.contains=node=>old(node)||node===svg;
  const layout=readEngravingSystems(value.renderer,value.mount,value.coordinates);
  assert.equal(layout.status,'ready');assert.deepEqual(layout.systems.map(row=>row.pageIndex),[0,1]);assert.equal(layout.systems[1].top,760);
});

test('missing, hidden, stale or unverified geometry remains unavailable',()=>{
  for(const change of [
    value=>{value.svg.isConnected=false;},
    value=>{value.svg.getScreenCTM=()=>null;},
    value=>{value.matrix.a=0;},
    value=>{value.svg.getBoundingClientRect=()=>({width:0,height:0});},
    value=>{value.svg.ownerDocument={defaultView:{getComputedStyle:()=>({visibility:'hidden'})}};},
    value=>{value.backend.graphicalMusicPage={};},
    value=>{value.systems[0].GraphicalMeasures[0][0].ParentMusicSystem={};},
    value=>{value.systems[0].GraphicalMeasures[0][0].parentSourceMeasure={};},
    value=>{value.systems[0].PositionAndShape.BorderBottom=NaN;},
    value=>{value.renderer.Sheet.SourceMeasures.pop();},
    value=>{value.mount.contains=()=>false;},
  ]){
    const value=fixture();change(value);
    assert.deepEqual(readEngravingSystems(value.renderer,value.mount,value.coordinates),{status:'unavailable',systems:[]});
  }
});

test('requested row boundaries affect only source-measure starts in the disposable model',()=>{
  const value=fixture({indices:[8,9,9,10,11,12,12,13]}),before=structuredClone(value.coordinates);
  assert.equal(applyEngravingSystemBreaks(value.renderer,value.coordinates,{fromMeasure:10,toMeasure:14,measuresPerRow:2}),true);
  assert.deepEqual(value.source.map((measure,index)=>measure.printNewSystemXml?index:null).filter(index=>index!==null),[4,7]);
  assert.deepEqual(value.coordinates,before);
  assert.equal(value.renderer.EngravingRules.NewSystemAtXMLNewSystemAttribute,true);
  assert.equal(value.renderer.EngravingRules.RenderXMeasuresPerLineAkaSystem,undefined,'A fragment is never counted as a complete source bar');
});

test('invalid row options or model correspondence do not partially set boundaries',()=>{
  for(const measuresPerRow of [undefined,0,-1,1.5,65,'2']){
    const value=fixture();assert.equal(applyEngravingSystemBreaks(value.renderer,value.coordinates,{fromMeasure:1,toMeasure:4,measuresPerRow}),false);
    assert.ok(value.source.every(measure=>measure.printNewSystemXml===undefined));
  }
  const value=fixture();value.coordinates[2].sourceMeasureIndex=-1;
  assert.equal(applyEngravingSystemBreaks(value.renderer,value.coordinates,{fromMeasure:1,toMeasure:4,measuresPerRow:2}),false);
  assert.ok(value.source.every(measure=>measure.printNewSystemXml===undefined));
});
