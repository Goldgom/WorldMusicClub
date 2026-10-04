// Hosted acceptance only. Install before navigation; each event must belong to
// one actual coordinate click. Never synthesize input events or set files on a
// locator that did not arrive through the browser's real FileChooser event.
import assert from 'node:assert/strict';
import path from 'node:path';
import {AUTHORING_PAIR_ALIAS,AUTHORING_FIXTURE_FILENAMES} from './prepare-song-authoring-fixtures.mjs';
export function authoringPickerFiles(alias,directory){
 const names=alias===AUTHORING_PAIR_ALIAS?[AUTHORING_FIXTURE_FILENAMES.strict,AUTHORING_FIXTURE_FILENAMES.events]:alias===AUTHORING_FIXTURE_FILENAMES.blocked?[AUTHORING_FIXTURE_FILENAMES.blocked]:null;
 assert.ok(names,'Outside the finite original authoring picker aliases');return names.map(name=>path.join(directory,name));
}
export function createAuthoringHostedChooser(page,{timeoutMs=10000,onError=()=>{},now=()=>performance.timeOrigin+performance.now(),pickerFiles=authoringPickerFiles}={}) {
 const evidence={version:1,timeline:[],events:[],late_events:0,extra_events:0,unowned_events:0,omitted_events:0};let active=null,stopped=false,lastSequence=null,lastOutcome=null;const reportedErrors=new Set();
 const fail=error=>{const value=error instanceof Error?error:Error(String(error));const message=String(value);if(!reportedErrors.has(message)&&reportedErrors.size<8){reportedErrors.add(message);onError(message);}active?.reject?.(value);};
 const mark=(stage,sequence=null)=>{if(evidence.timeline.length>=32){evidence.omitted_events++;fail(Error('Authoring chooser timeline exceeded 32 events'));return;}evidence.timeline.push({order:evidence.timeline.length+1,stage,sequence,atMs:now()});};
 function observe(chooser){
  if(!active){evidence.unowned_events++;if(lastOutcome==='failed')evidence.late_events++;else evidence.extra_events++;}
  else if(active.received)evidence.extra_events++;
  if(evidence.events.length>=4){evidence.omitted_events++;fail(Error('Authoring hosted chooser evidence exceeded four events'));return;}
  const row={sequence:active?.sequence??null,afterSequence:active?null:lastSequence,owned:active!==null,samePage:chooser.page()===page,multiple:chooser.isMultiple(),state:'received',atMs:now()};evidence.events.push(row);mark('chooser-event',row.sequence);
  if(!active){fail(Error('Authoring browser opened a late or unowned chooser'));return;}
  if(active.received){row.state='duplicate';fail(Error('Authoring browser opened repeated choosers for one action'));return;}
  active.received=true;active.resolve({chooser,row});
 }
 page.on('filechooser',observe);mark('listener-installed');
 return{evidence,navigation(stage){assert.ok(['start','end'].includes(stage));mark(`navigation-${stage}`);},async choose(action,file){
  assert.ok(!stopped&&!active,'Authoring hosted chooser ownership unavailable');const files=pickerFiles(action.file,file);let timer;
  const owner={sequence:action.sequence,received:false,stage:'waiting-event',cancelled:false};active=owner;lastSequence=action.sequence;lastOutcome='pending';mark('action-armed',action.sequence);
  const event=new Promise((resolve,reject)=>{owner.resolve=resolve;owner.reject=reject;});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Authoring actual filechooser #${action.sequence} ${owner.stage} exceeded ${timeoutMs}ms`)),timeoutMs);});const started=Date.now();
  try {
   // This observer predates navigation. Preserve exactly one browser click at
   // the renderer-checked point, without private API calls or a fixed sleep.
   mark('mouse-click-start',action.sequence);const click=page.mouse.click(action.x,action.y).then(()=>mark('mouse-click-end',action.sequence));
   return await Promise.race([(async()=>{const [,{chooser,row}]=await Promise.all([click,event]);
   if(owner.cancelled)throw Error('Authoring chooser action expired before input observation');owner.stage='input-identity';
   assert.equal(row.samePage,true,'Authoring chooser belongs to another page');assert.equal(row.multiple,true,'Authoring chooser lost the original multi-file input');
   row.input=await chooser.element().evaluate(input=>({id:input.id,tag:input.tagName,type:input.type,disabled:input.disabled,multiple:input.multiple,connected:input.isConnected}));
   assert.deepEqual(row.input,{id:'authoring-files',tag:'INPUT',type:'file',disabled:false,multiple:true,connected:true},'Authoring chooser is not the original enabled authoring-files input');
   assert.equal(evidence.events.filter(event=>event.sequence===action.sequence).length,1,'Authoring action did not own exactly one chooser');
   if(owner.cancelled)throw Error('Authoring chooser action expired before file selection');owner.stage='set-files';row.selected_count=files.length;row.selected_filenames=files.map(file=>path.basename(file));await chooser.setFiles(files,{timeout:Math.max(1,timeoutMs-(Date.now()-started))});if(owner.cancelled)throw Error('Authoring chooser action expired during file selection');row.state='files-set';mark('files-set',action.sequence);lastOutcome='completed';return row;})(),deadline]);
  } catch(error){lastOutcome='failed';mark('action-failed',action.sequence);throw error;}
  finally {owner.cancelled=true;clearTimeout(timer);if(active===owner)active=null;}
 },assertComplete(sequences){
  assert.equal(evidence.omitted_events+evidence.late_events+evidence.extra_events+evidence.unowned_events,0,'Authoring late, extra, unowned or omitted chooser evidence');
  assert.deepEqual(evidence.events.map(row=>({sequence:row.sequence,owned:row.owned,samePage:row.samePage,multiple:row.multiple,state:row.state})),sequences.map(sequence=>({sequence,owned:true,samePage:true,multiple:true,state:'files-set'})),'Authoring browser chooser must pair uniquely with its owned action');
  assert.ok(!active,'Authoring chooser is still pending');assert.equal(evidence.timeline[0]?.stage,'listener-installed');assert.ok(evidence.timeline.findIndex(row=>row.stage==='navigation-start')>0,'Authoring listener must precede navigation');
 },stop(){stopped=true;page.off('filechooser',observe);if(active)fail(Error('Authoring hosted chooser observer stopped during its owned action'));active=null;}};
}
