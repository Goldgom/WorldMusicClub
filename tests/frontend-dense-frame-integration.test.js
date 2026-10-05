// Actual app.js integration with the existing Node DOM/audio/protocol fixture.
// These arithmetic CC0 test notes and explicit fixture clocks are not browser,
// renderer-throughput, acoustic, or real-time acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {authoredScore,nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

function originalDenseFrameScore(){
  const score=authoredScore({id:'original-dense-frame-integration',title:'Original dense frame integration',composer:'WorldMusicHub original test exercise',provenance:{kind:'original_exercise',attribution:'Arithmetic notes authored for application frame regression',license:'CC0-1.0',source_url:null},source:null,tempo:[{at:{numerator:0,denominator:1},bpm:120}],repeats:[],measures:Array.from({length:4},(_,i)=>({number:i+1,at:{numerator:i*4,denominator:1},length:{numerator:4,denominator:1}}))});
  score.parts=['C','D','E','F'].map((step,part)=>({id:`original-part-${part}`,name:`Original part ${part+1}`,instrument:'piano',notes:Array.from({length:512},(_,index)=>({id:`original-${part}-${index}`,at:{numerator:index,denominator:64},duration:{numerator:1,denominator:64},pitch:{step,alter:0,octave:4},voice:'1',staff:1,velocity:90,tie_start:false,tie_stop:false}))}));
  const source=score.parts.flatMap((part,partIndex)=>part.notes.map(note=>({part,note,midi:[60,62,64,65][partIndex]})));
  const timeline={duration_ms:8000,notes:source.map(({part,note,midi})=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],part_id:part.id,midi,start_ms:note.at.numerator*500/64,duration_ms:500/64,voice:note.voice,staff:note.staff,velocity:note.velocity})).sort((a,b)=>a.start_ms-b.start_ms||a.midi-b.midi)};
  const navigation={version:1,source_measure_count:4,duration_ms:8000,diagnostics:[],occurrences:score.measures.map((measure,index)=>({id:`original-measure-${index}`,source_measure_index:index,measure_number:measure.number,source_from:measure.at,source_to:{numerator:(index+1)*4,denominator:1},start_ms:index*2000,end_ms:(index+1)*2000,repeat_region_index:null,repeat_pass:null,repeat_times:null,written_note_ids:source.filter(({note})=>Math.floor(note.at.numerator/256)===index).map(({note})=>note.id),continuing_note_ids:[]})),sounding_groups:timeline.notes.map(note=>({occurrence_id:note.id,source_note_ids:[note.id],part_id:note.part_id,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms})),written_cursor:{version:1,source_note_ids:source.map(({note})=>note.id),spans:source.map(({note},index)=>({source_note_index:index,measure_occurrence_index:Math.floor(note.at.numerator/256),start_ms:note.at.numerator*500/64,end_ms:(note.at.numerator+1)*500/64}))}};
  return{score,timeline,navigation};
}

function countTextWrites(node){
  let prototype=node,descriptor;
  while(prototype&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(prototype,'textContent');prototype=Object.getPrototypeOf(prototype);}
  assert.ok(descriptor?.get&&descriptor?.set);let writes=0;
  Object.defineProperty(node,'textContent',{configurable:true,get(){return descriptor.get.call(this);},set(value){writes++;return descriptor.set.call(this,value);}});
  return{count:()=>writes,reset:()=>{writes=0;}};
}

function captureCanvas(canvas){
  Object.defineProperties(canvas,{clientWidth:{configurable:true,value:1280},clientHeight:{configurable:true,value:240}});
  const fills=[],outlines=[],labels=[];let rectangle=null;
  const context=new Proxy({
    roundRect(...args){rectangle=args;},
    fill(){fills.push({rectangle:[...rectangle],shadow:this.shadowBlur,color:this.fillStyle});},
    stroke(){outlines.push({rectangle:[...rectangle],width:this.lineWidth,color:this.strokeStyle});},
    fillText(...args){labels.push(args);},
  },{get(target,key){return Object.hasOwn(target,key)?target[key]:(()=>{});}});
  canvas.getContext=()=>context;
  return{fills,outlines,labels,reset(){fills.length=outlines.length=labels.length=0;}};
}

test('actual app frames retain all dense source notes while avoiding unchanged writes and future shadows',async()=>{
  const {score,timeline,navigation}=originalDenseFrameScore(),before=structuredClone({score,timeline,navigation}),server=await nativeScoreServer({scores:[score]});
  server.setRoute(({path,body})=>{
    if(path==='/api/compile'&&body.id===score.id){assert.deepEqual(body,score);return nativeResponse({score,timeline,diagnostics:[]});}
    if(path==='/api/notation-navigation'){assert.deepEqual(body,score);return nativeResponse(navigation);}
  });
  let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock});
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);
    await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-listen').disabled);
    Object.defineProperty(app.$('notation'),'clientWidth',{configurable:true,value:1280});
    const canvas=captureCanvas(app.$('falling-notes'));app.$('count-in').checked=false;
    await app.click('start-listen');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');clock=app.sourceStartWall();app.renderAudioTo((clock-1000)/1000);const sourceZeroWall=clock;
    await app.click('staff-button');if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
    app.$('notation-scope').value='all';app.emit(app.$('notation-scope'),'change');
    app.frame();await app.until(()=>app.$('written-cursor-status').dataset.status==='ready','Original source cursor did not load');app.frame();
    const notes=[...app.$('notation').querySelectorAll('.score-note')];assert.equal(notes.length,2048);
    assert.deepEqual(new Set(notes.map(node=>node.dataset.noteId)),new Set(timeline.notes.map(note=>note.id)));
    let attributes=0,classes=0;
    for(const node of notes){const set=node.setAttribute,toggle=node.classList.toggle;node.setAttribute=function(...args){if(args[0]==='aria-current')attributes++;return Reflect.apply(set,this,args);};node.classList.toggle=function(...args){classes++;return Reflect.apply(toggle,this,args);};}
    const timeWrites=countTextWrites(app.$('time-label')),statusWrites=countTextWrites(app.$('transport-status'));
    const frame=()=>{app.renderAudioTo((clock-1000)/1000);canvas.reset();app.frame();return canvas.fills.map(row=>structuredClone(row));};
    const expectedFalling=position=>timeline.notes.filter(note=>note.start_ms+note.duration_ms>position&&note.start_ms<=position+4000);
    const checkPaint=(rows,position)=>{
      const expected=expectedFalling(position),sounding=expected.filter(note=>note.start_ms<=position&&note.start_ms+note.duration_ms>position);
      assert.equal(rows.length,expected.length,'Every original falling target must be painted');assert.equal(canvas.outlines.length,expected.length);
      assert.equal(rows.filter(row=>row.shadow===6).length,sounding.length);assert.ok(rows.every(row=>row.shadow===0||row.shadow===6));
      assert.equal(rows.filter(row=>row.color==='#f4ce78').length,sounding.length);assert.ok(rows.every(row=>row.rectangle.every(Number.isFinite)));
      assert.ok(canvas.outlines.every(row=>row.width===1&&row.color==='#eaffff55'));
    };
    const first=frame();checkPaint(first,0);assert.equal(first.length,2048);assert.equal(app.$('time-label').textContent,'0:00 / 0:08');
    attributes=classes=0;timeWrites.reset();statusWrites.reset();
    for(let index=0;index<20;index++)assert.deepEqual(frame(),first);
    assert.equal(attributes,0);assert.equal(classes,0);assert.equal(timeWrites.count(),0);assert.equal(statusWrites.count(),0);
    clock+=8;const second=frame();checkPaint(second,readPlaybackClock(app.document).positionMs);
    assert.equal(attributes,8,'Only the four previous and four next identities change aria-current');assert.equal(classes,8);
    assert.deepEqual(notes.filter(node=>node.classList.contains('active')).map(node=>node.dataset.noteId).sort(),score.parts.map((_,part)=>`original-${part}-1`).sort());
    assert.deepEqual(notes.filter(node=>node.getAttribute('aria-current')==='true').map(node=>node.dataset.noteId).sort(),score.parts.map((_,part)=>`original-${part}-1`).sort());
    assert.equal(timeWrites.count(),0,'Moving within the same displayed second does not rewrite the time label');
    clock=sourceZeroWall+1200;frame();assert.equal(timeWrites.count(),1,'The next displayed second still updates');assert.equal(app.$('time-label').textContent,'0:01 / 0:08');
    assert.equal(app.$('hud-captured').textContent,'0');assert.equal(app.requests.filter(row=>row.path==='/api/assess').length,0);
    assert.deepEqual({score,timeline,navigation},before);assert.deepEqual(JSON.parse(server.records.get(key).score_json),score);
  }finally{await app.close();}
});
