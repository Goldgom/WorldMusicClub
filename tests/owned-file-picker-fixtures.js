// Synthetic contract fixtures only, never real chooser or platform evidence.
export function syntheticOwnedPickerGestures(){
 const state={button:0,buttons:0,defaultPrevented:false,activation:{isActive:true,hasBeenActive:true},focus:{hasFocus:true,activeId:'import-button',visibility:'visible'},trigger:{id:'import-button',tag:'BUTTON',type:'submit',disabled:false,connected:true,inert:false},input:{id:'score-file',tag:'INPUT',type:'file',disabled:false,connected:true,inert:false,multiple:true},dialog:{id:'import-tools-dialog',open:true,modal:true}};
 return[['before-action',null,null],['pointerdown','import-button',true],['pointerup','import-button',true],['click','import-button',true],['click','score-file',false],['input','score-file',true],['change','score-file',true]].map(([type,targetId,trusted])=>({...structuredClone(state),observedAtMs:1050,eventTimeMs:type==='before-action'?null:50,type,targetId,trusted}));
}
export function syntheticOwnedFilePicker(filename,sequence=1){
 const selected=type=>({type,trusted:true,id:'score-file',sequence,originalControl:true,filename,fileCount:1,eventTimeMs:50});
 const observation={sequence,filename,completed:true,gestures:syntheticOwnedPickerGestures(),delegatedClicks:[{type:'click',trusted:false,id:'score-file',sequence,originalControl:true}],inputs:[selected('input')],changes:[selected('change')]};
 const events=['input','change'].map(type=>{const {sequence,...event}=selected(type);return{...event,pickerSequence:sequence};});
 return{observation,events};
}
