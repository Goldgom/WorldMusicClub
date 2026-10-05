export const FALLING_NOTE_LABELS_KEY='worldmusichub.falling-note-labels.v1';

// Access to the browser's storage property can itself throw. Resolve it only
// inside the read/write guards, including when no explicit storage was passed.
const preferenceStorage=storage=>storage===undefined?globalThis.localStorage:storage;
function readPreference(storage){
  try{
    const target=preferenceStorage(storage);
    if(typeof target?.getItem!=='function')return{enabled:false,message:'unavailable'};
    return{enabled:target.getItem(FALLING_NOTE_LABELS_KEY)==='true',message:null};
  }catch{return{enabled:false,message:'unavailable'};}
}
export function readFallingNoteLabels(storage){return readPreference(storage).enabled;}

export function setupFallingNoteLabels({document,i18n,onChange=()=>{},storage}){
  let {enabled,message}=readPreference(storage);
  const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span'),status=document.createElement('p');
  label.className='falling-note-label-setting';input.type='checkbox';input.id='falling-note-labels';input.checked=enabled;label.append(input,text);
  status.id='falling-note-labels-status';status.className='muted';status.setAttribute('role','status');input.setAttribute('aria-describedby',status.id);
  document.querySelector('#settings-dialog .shell-dialog-content').append(label,status);
  const redraw=()=>{
    const english=i18n.locale==='en';
    text.textContent=english?'Show letters and symbols on falling notes':'显示滑块上的字母和符号';
    status.hidden=!message;
    status.textContent=message==='unavailable'?(english?'Labels start off because browser storage is unavailable. Changes apply to this tab.':'浏览器存储不可用，滑块文字默认关闭。更改仅在当前标签页生效。'):message==='unsaved'?(english?'This choice applies to this tab but could not be saved.':'此选择已在当前标签页生效，但未能保存。'):'';
  };
  input.addEventListener('change',()=>{
    enabled=input.checked;message='unsaved';
    try{const target=preferenceStorage(storage);if(typeof target?.setItem==='function'){target.setItem(FALLING_NOTE_LABELS_KEY,String(enabled));message=null;}}
    catch{/* The current presentation choice remains usable without storage. */}
    redraw();onChange(enabled);
  });
  i18n.subscribe(redraw);redraw();return{enabled:()=>enabled};
}
