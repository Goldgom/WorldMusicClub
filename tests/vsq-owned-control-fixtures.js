// Original modeled evidence for consumer unit tests only. These records never
// establish real DOM, browser, Windows, picker, audio, or acceptance evidence.
const clone=value=>structuredClone(value);

export function syntheticVsqOwnedControl(action,{id=action.kind==='picker'?'import-button':'play-button',target={x:action.x-10,y:action.y-8,width:20,height:16},state={},before={},afterDispatch={},eventId=id,stage=false,pickerDelegation=action.kind==='picker'}={}) {
 const current={target:clone(target),width:action.width,height:action.height,connected:true,disabled:false,identity:true,hitId:eventId,hitOwned:true,screen:'stage',playDisabled:false,scoreState:'session',practiceGateHidden:true,feedbackPhase:'listen',clock:{positionMs:0,running:false,completed:false,phase:'ready'},...clone(state)};
 const samples=[0,1].map(frame=>({frame,width:action.width,height:action.height,target:clone(target),modalOwner:null,hitId:eventId,hitOwned:true,...(stage?{committed:180,expected:180,laneHeight:180,transportBottom:500,viewportBottom:action.height,zoom:1,status:{committed:48,expected:48},notice:{committed:0,expected:0}}:{})}));
 const clicks=[{sequence:action.sequence,id:eventId,owned:true,trusted:true}];
 if(pickerDelegation)clicks.push({sequence:action.sequence,id:'score-file',owned:false,trusted:false});
 const dispatch=clicks.map(event=>({...event,clientX:event.trusted?action.x:0,clientY:event.trusted?action.y:0,state:clone(current)}));
 return{sequence:action.sequence,kind:action.kind,id,before:{...clone(current),...clone(before)},readiness:{screen:current.screen,completed:current.clock.completed,feedbackPhase:current.feedbackPhase,playDisabled:current.playDisabled},samples,request:{...clone(action),target:clone(target)},preDispatch:clone(current),clicks,dispatch,afterDispatch:{...clone(current),...clone(afterDispatch)}};
}

/** An options callback can map each existing native fixture action to its
 * original control ID; capture/key actions intentionally produce no receipt. */
export function syntheticVsqOwnedControls(actions,options={}) {
 return actions.filter(action=>!['capture','key-ds4'].includes(action.kind)).map(action=>syntheticVsqOwnedControl(action,typeof options==='function'?options(action):options));
}
