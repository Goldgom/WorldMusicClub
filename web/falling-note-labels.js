export const FALLING_NOTE_LABELS_KEY='worldmusichub.falling-note-labels.v1';
export function readFallingNoteLabels(storage=globalThis.localStorage){try{return storage?.getItem(FALLING_NOTE_LABELS_KEY)==='true';}catch{return false;}}
export function setupFallingNoteLabels({document,i18n,onChange=()=>{},storage=globalThis.localStorage}){
  let enabled=readFallingNoteLabels(storage);const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');label.className='falling-note-label-setting';input.type='checkbox';input.id='falling-note-labels';input.checked=enabled;label.append(input,text);document.querySelector('#settings-dialog .shell-dialog-content').append(label);
  const redraw=()=>{text.textContent=i18n.locale==='en'?'Show letters and symbols on falling notes':'显示滑块上的字母和符号';};
  input.addEventListener('change',()=>{enabled=input.checked;try{storage?.setItem(FALLING_NOTE_LABELS_KEY,String(enabled));}catch{/* The current presentation choice remains usable without storage. */}onChange(enabled);});i18n.subscribe(redraw);redraw();return{enabled:()=>enabled};
}
