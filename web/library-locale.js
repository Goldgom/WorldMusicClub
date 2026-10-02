import schema from './locales/library-schema.js';

// Bind only app-owned leaf text. Controls, source text, drafts and listeners stay intact.
export function localizeLibraryElements(root,i18n){
 for(const button of root.querySelectorAll('button')){button.style.whiteSpace='normal';button.style.maxWidth='100%'}
 for(const element of root.querySelectorAll('[data-library-text]'))element.textContent=i18n.t(element.getAttribute('data-library-text'));
 for(const [marker,attribute]of [['data-library-aria','aria-label'],['data-library-placeholder','placeholder']])for(const element of root.querySelectorAll(`[${marker}]`))element.setAttribute(attribute,i18n.t(element.getAttribute(marker)));
}
export function libraryIssue(error){
 const key=typeof error?.code==='string'?`library.error.${error.code}`:'';
 const known=Object.hasOwn(schema,key),parts=[],codes=[],reasons=[];
 let current=error;const seen=new Set();
 while(current&&!seen.has(current)){
  seen.add(current);const currentKey=typeof current.code==='string'?`library.error.${current.code}`:'';
  if(typeof current.code==='string')codes.push(current.code);
  if(Object.hasOwn(schema,currentKey)){if(current!==error)reasons.push({key:currentKey,params:current.params||{}})}else if(typeof current.message==='string')parts.push(current.message);
  current=current.cause;
 }
 return {key:known?key:'library.error.external',params:known?error.params||{}:{},error:true,details:parts.join('\n'),codes,reasons};
}
export function localizedStatus(node,i18n){
 const document=node.ownerDocument,text=document.createElement('span'),details=document.createElement('details'),summary=document.createElement('summary'),original=document.createElement('p'),codes=document.createElement('p');
 original.style.whiteSpace='pre-wrap';original.style.overflowWrap='anywhere';codes.style.overflowWrap='anywhere';details.append(summary,original,codes);node.replaceChildren(text,details);let state=null;
 function render(){
  text.textContent=state?[state.contextKey?i18n.t(state.contextKey):'',i18n.t(state.key,state.params||{}),...(state.reasons||[]).map(reason=>i18n.t(reason.key,reason.params||{}))].filter(Boolean).join(' '):'';node.classList.toggle('error',Boolean(state?.error));
  summary.textContent=i18n.t('library.details');original.textContent=state?.details||'';original.hidden=!state?.details;
  codes.textContent=state?.codes?.length?`${i18n.t('library.diagnosticCode')}: ${state.codes.join(', ')}`:'';codes.hidden=!state?.codes?.length;
  details.hidden=!state?.details&&!state?.codes?.length;
 }
 return{render,set(key,params={},error=false){state=typeof key==='object'?key:{key,params,error};render()},message(state){return [i18n.t(state.key,state.params||{}),...(state.reasons||[]).map(reason=>i18n.t(reason.key,reason.params||{})),state.details?`${i18n.t('library.details')}: ${state.details}`:'',state.codes?.length?`${i18n.t('library.diagnosticCode')}: ${state.codes.join(', ')}`:''].filter(Boolean).join(' ')}};
}
