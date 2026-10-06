// Synthetic contract data only; never executable Windows or audio evidence.
import {syntheticLiveToneEvidence} from './live-tone-evidence-fixtures.js';
import {syntheticOwnedFilePicker} from './owned-file-picker-fixtures.js';
import {liveToneNavigationFixture,LIVE_TONE_NAVIGATION_FIXTURE_FILENAME} from '../scripts/prepare-live-tone-navigation-fixtures.mjs';
export function syntheticNavigationEvidence({route='settings',release='keyup'}={}){
  const original=syntheticLiveToneEvidence({keyCode:'KeyR',midi:60}),e=structuredClone(original),r=e.ready.receiver;
  let sequence=4;
  const event=()=>({sequence:++sequence,wallMs:sequence+10,graphRevision:9});
  const stopped={...e.ready.source,activeReceivers:0,ownedNodes:[{receiverId:1,connected:false,nodeConnections:0,gateConnections:0,disposed:true,disposing:false,pendingCommands:0,pendingStarts:0}]};
  const block=audioTime=>({...original.pcm.blocks[0],...event(),audioTime,tapConnected:true});
  const checkpoint=(label,audioTime,active=false)=>({...event(),label,nodes:1,callCount:1,source:structuredClone(active?e.ready.source:stopped),receiver:{...structuredClone(r),audioTime},pcm:{method:e.pcm.method,fftSize:16384,blocks:[]}});
  const down={...e.inputs[0],...event()},call={...e.calls[0],...event(),inputSequence:down.sequence},start={...e.receipts[0],...event()};
  e.inputs=[down];e.calls=[call];e.receipts=[start];e.pcm.blocks=[block(1.036)];
  function keyup(){const up={...original.inputs[1],...event(),surface:release==='keyup'?'stage-title':null,eventTime:release==='keyup'?1140:1230};e.inputs.push(up);return up;}
  function ended(){e.receipts.push({...original.receipts[1],...event(),record:{...original.receipts[1].record,reason:release==='keyup'?'release':'stopped'}});}
  if(release==='keyup'){keyup();ended();}
  const seal=row=>{row.sampling='sealed';row.closed={...event(),label:`${row.label}-sealed`,source:structuredClone(row.source),nodes:1,receiver:{...structuredClone(r),audioTime:row.pcm.blocks.at(-1).audioTime}};};
  const navigation=checkpoint('navigation',1.08,true);navigation.pcm.blocks=release==='keyup'?[1.48,1.53,1.59].map(time=>({...block(time),peak:0,energy:0,nonzeroSamples:0})):[block(1.08)];seal(navigation);e.checkpoints=[navigation];e.actions=[];
  for(const control of route==='settings'?['settings-button']:['back-to-library','lobby-home','home-song-authoring']){
    e.actions.push({...event(),type:'pointerdown',control,isTrusted:true,eventTime:1200});
    if(release==='navigation'&&e.receipts.length===1)ended();
    e.actions.push({...event(),type:'click',control,isTrusted:true,eventTime:1201});
  }
  if(release==='navigation')keyup();
  const silent=(label,audioTime)=>{const row=checkpoint(label,audioTime);e.checkpoints.push(row);row.pcm.blocks=[audioTime+.1,audioTime+.4,audioTime+.45,audioTime+.51].map(time=>({...block(time),peak:0,energy:0,nonzeroSamples:0}));seal(row);};
  silent('entered',2);
  for(const type of ['keydown','keyup'])e.inputs.push({...event(),type,code:'KeyR',isTrusted:true,repeat:false,surface:null,eventTime:type==='keydown'?2100:2140,source:structuredClone(stopped)});
  silent('blocked-input',3);silent('returned',4);silent('finished',5);
  const firstWindow=e.checkpoints[release==='keyup'?0:1],first=firstWindow.pcm.blocks.find(block=>block.audioTime>=firstWindow.receiver.audioTime+(16384+256)/48000);e.silenceEstablished={sequence:first.sequence,audioTime:first.audioTime};e.pcmCoverage='finite-checkpoint-windows';
  e.after={...original.after,...event(),source:structuredClone(stopped),receiver:{...structuredClone(r),audioTime:5.52}};
  const take={passes:[{inputs:[{midi:60,at_ms:20}],clock_segments:[{start_ms:0,end_ms:100}]}],input_evidence:{events:[{kind:'note_on',input_kind:'typing_keyboard',encoding:'key_down',raw_timestamp_ms:down.eventTime,timestamp_basis:'event_monotonic',midi:60,velocity:90,source_id:'physical-r'},{kind:'note_off',input_kind:'typing_keyboard',encoding:'key_up',raw_timestamp_ms:e.inputs[1].eventTime,timestamp_basis:'event_monotonic',midi:null,source_id:'physical-r'}]}};
  return {e,options:{route,release,takeBefore:take,takeAfter:structuredClone(take)}};
}

export function syntheticNativeLiveToneNavigationCase({route='settings',release='keyup'}={}){
 const {e,options}=syntheticNavigationEvidence({route,release}),fixture=liveToneNavigationFixture();
 const phase=`live-navigation-${route}-${release}`,actions=[],results=[],trustedActions=[],controlActions=[],roles={};
 const target={x:100,y:100,width:120,height:40},nativeKey={app_hwnd:42,foreground:42,app_process_id:71,app_enabled:true,code:'KeyR',virtual_key:82,focus_reacquired:false,pointer_clicked:false};
 function action(kind,id,eventTime=500){
  const n=actions.length+1,request={version:1,sequence:n,kind,x:160,y:120,width:1280,height:720,...(kind==='picker'?{file:LIVE_TONE_NAVIGATION_FIXTURE_FILENAME}:{})};actions.push(request);
  if(kind.startsWith('live-key-r-'))results.push({ok:true,native_key:{...structuredClone(nativeKey),held_before:kind==='live-key-r-up',held_after:kind==='live-key-r-down',held_ms:kind==='live-key-r-down'?0:release==='keyup'?40:230}});
  else{results.push({ok:true,client_click:{app_hwnd:42,foreground:42,hit_hwnd:43,hit_root:42,actual:[160,120],requested:[160,120],viewport:[1280,720]}});trustedActions.push({sequence:n,type:'click',id,code:null,isTrusted:true,repeat:false,eventTime,surface:null});const sample={target,width:1280,height:720,hitOwned:true};controlActions.push({sequence:n,id,kind,samples:[structuredClone(sample),structuredClone(sample)],request:{...request,target:structuredClone(target)},afterDispatch:{target:structuredClone(target),disabled:false},clicks:[{sequence:n,id,owned:true,trusted:true}]});}
  return n;
 }
 const pickerSequence=action('picker','import-button',50),picker=syntheticOwnedFilePicker(LIVE_TONE_NAVIGATION_FIXTURE_FILENAME,pickerSequence);
 controlActions.at(-1).clicks.push({sequence:pickerSequence,id:'score-file',owned:false,trusted:false});
 results.at(-1).owned_dialog={class:'#32770',hwnd:44,process_id:71,app_process_id:71,app_hwnd:42,root_owner_hwnd:42};results.at(-1).picker_completion={dialog_dismissed:true,app_enabled:true,owned_popup_visible:false};
 for(const [type,isTrusted]of [['click',false],['input',true],['change',true]])trustedActions.push({sequence:pickerSequence,type,id:'score-file',code:null,isTrusted,repeat:false,eventTime:50,surface:null});
 const modActions=[];for(const id of ['configure-song-mod','song-mod-all-human']){const sequence=action('click',id);modActions.push({sequence,id,kind:'click',field:null,part:null,value:null,checked:null});}
 const layout=action('select-last','song-mod-layout');modActions.push({sequence:layout,id:'song-mod-layout',kind:'select-last',field:null,part:null,value:'solo',checked:null});trustedActions.push({sequence:layout,actionSequence:layout,type:'change',id:'song-mod-layout',isTrusted:true,value:'solo',eventTime:500});for(const type of ['keydown','keyup'])trustedActions.push({sequence:layout,actionSequence:layout,type,id:'song-mod-layout',code:'End',isTrusted:true,repeat:false,eventTime:500,surface:null});
 const apply=action('click','song-mod-apply');modActions.push({sequence:apply,id:'song-mod-apply',kind:'click',field:null,part:null,value:null,checked:null});roles.play=action('click','start-performance');modActions.push({sequence:roles.play,id:'start-performance',kind:'click',field:null,part:null,value:null,checked:null});roles.keyFocus=action('click','stage-title');roles.keyDown=action('live-key-r-down','stage-title');
 if(release==='keyup')roles.keyUp=action('live-key-r-up','stage-title');
 const controls=route==='settings'?['settings-button']:['back-to-library','lobby-home','home-song-authoring'];roles.navigation=controls.map(id=>action('click',id,e.actions.find(row=>row.control===id&&row.type==='click').eventTime));
 if(release==='navigation')roles.keyUp=action('live-key-r-up',route==='settings'?'settings-title':'song-authoring-title');
 roles.beforeTake=action('click','export-takes');roles.blockedKey=action('key-r',route==='settings'?'settings-title':'song-authoring-title');roles.return=route==='authoring'?['authoring-library','resume-session'].map(id=>action('click',id)):[action('click',null)];if(route==='settings')controlActions.at(-1).closePanel='settings';roles.afterTake=action('click','export-takes');roles.score=action('click','export-button');
 for(const [i,n]of [roles.keyDown,roles.keyUp,roles.blockedKey,roles.blockedKey].entries()){const input=e.inputs[i];trustedActions.push({sequence:n,id:i===0?'stage-title':route==='settings'?'settings-title':'song-authoring-title',type:input.type,code:input.code,isTrusted:input.isTrusted,repeat:input.repeat,eventTime:input.eventTime,surface:input.surface});}
 for(const row of trustedActions)row.actionSequence=row.sequence;trustedActions.sort((a,b)=>a.sequence-b.sequence);options.takeBefore.score_id=fixture.score.id;options.takeAfter=structuredClone(options.takeBefore);
 const beforeTakeBytes=Buffer.from(JSON.stringify(options.takeBefore,null,2)),afterTakeBytes=Buffer.from(beforeTakeBytes),scoreBytes=Buffer.from(fixture.bytes),paused={position:100,mode:'practice',captured:'1',pass:'1',revision:'1',title:fixture.score.title,stageTitle:fixture.score.title},cleanup={restored:true,overflow:false,errors:[],cleanupErrors:[]};
 const keyPreparations=[{sequence:roles.keyDown,kind:'live-key-r-down',focus:'stage-title',screen:'stage',clock:{available:true,running:true,positionMs:10},timeOrigin:100000},{sequence:roles.keyUp,kind:'live-key-r-up',focus:release==='keyup'?'stage-title':null,screen:release==='keyup'||route==='settings'?'stage':'authoring',clock:{available:true,running:release==='keyup',positionMs:100},timeOrigin:100000}];
 const report={pickerObservations:[picker.observation],keyPreparations,modActions,version:1,scenario:'live-tone-navigation',phase,route,release,origin:'https://wmh.localhost',ok:true,errors:[],physicalAudio:false,sourceTitle:fixture.score.title,sourceScoreJson:fixture.bytes.toString(),actions:actions.length,actionRoles:roles,trustedActions,controlActions,files:{beforeTake:`${phase}-1.json`,afterTake:`${phase}-2.json`,score:`${phase}-3.json`},pausedBefore:paused,pausedAfter:structuredClone(paused),audio:e,cleanup:{live:structuredClone(cleanup),source:structuredClone(cleanup)}};
 return{report,exports:{beforeTakeBytes,afterTakeBytes,scoreBytes},actions,results,host:{process_id:71,actions:actions.length,live_key_held_at_close:false}};
}
