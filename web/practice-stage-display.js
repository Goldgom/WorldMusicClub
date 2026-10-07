import {assertPracticeAssistanceDisplay} from './practice-assistance-display.js';
export {createPracticeAssistanceDisplayIndex} from './practice-assistance-display.js';

/** Presentation-only roles. Never alter source events or feed machine notes to input. */
export function practiceStageNotes({humanNotes=[],sourceNotes=[],humanPartIds=new Set(),mode='practice',layout='complete',showOthers=true,range=null,availableMidi=null,excludedMachinePartIds=new Set(),hiddenPartIds=new Set(),targetGroups=new Map(),assistance=null,ownershipIndex=null}={}) {
  const ownership=assertPracticeAssistanceDisplay(assistance,ownershipIndex);
  sourceNotes=sourceNotes.filter(note=>!hiddenPartIds.has(note.part_id));humanNotes=humanNotes.filter(note=>(targetGroups.get(note.id)?.part_ids||[note.part_id]).some(id=>!hiddenPartIds.has(id)));
  if(mode!=='practice')return sourceNotes.map(note=>({...note,practice_role:'listen'}));
  if(ownership&&humanNotes.some(note=>!ownership.isHumanTarget(note)))throw Object.assign(new TypeError('A displayed human target has no current checked ownership.'),{code:'practice_assistance_display_identity'});
  const human=humanNotes.map(note=>({...note,practice_role:'human'}));
  if(layout==='solo'||!showOthers)return human;
  const machine=sourceNotes.filter(note=>(ownership?ownership.sourceNoteRole(note)==='machine':!humanPartIds.has(note.part_id))&&!excludedMachinePartIds.has(note.part_id)&&(!availableMidi||availableMidi.has(note.midi))&&(!range||note.midi>=range[0]&&note.midi<=range[1])).map(note=>({...note,practice_role:'machine'}));
  return [...machine,...human];
}
export function markPracticeNotation(root,{sourceNotes=new Map(),humanPartIds=new Set(),mode='listen',layout='complete',showOthers=true,assistance=null,ownershipIndex=null}={}) {
  const ownership=assertPracticeAssistanceDisplay(assistance,ownershipIndex),notes=[...root.querySelectorAll('[data-note-id]')];
  const roles=notes.map(node=>{const source=sourceNotes.get(node.dataset.noteId),part=node.dataset.partId||source?.partId||node.closest('[data-notation-part-id]')?.dataset.notationPartId;
    return mode!=='practice'?'listen':ownership?(node.dataset.rest==='true'||source?.note?.pitch===null?'rest':ownership.sourceRole(node.dataset.noteId,part)||'unavailable'):part&&!humanPartIds.has(part)?'machine':'human';});
  // A stale/partial written identity cannot silently fall back to part colors.
  const unavailable=ownership&&roles.includes('unavailable');
  for(const [index,node] of notes.entries()){
    const role=unavailable&&mode==='practice'?'unavailable':roles[index],machine=role==='machine',hidden=machine&&(layout==='solo'||!showOthers);
    if(node.dataset.practiceRole!==role)node.dataset.practiceRole=role;
    node.classList.toggle('machine-note',machine);node.classList.toggle('practice-machine-hidden',hidden);
    if(role==='machine'||role==='unavailable'){node.classList.remove('active');if(node.getAttribute('aria-current')==='true')node.setAttribute('aria-current','false');}
    // Add an independent dashed enclosure, preserving every musical stroke.
    let cue=node.querySelector?.('[data-practice-machine-cue]');
    if(ownership&&machine&&!cue){
      const head=node.querySelector?.('.note-head'),cx=Number(head?.getAttribute('cx')),cy=Number(head?.getAttribute('cy'));
      const box=node.dataset.layoutBox?.split(' ').map(Number)||(head?[cx-10,cy-8,cx+10,cy+8]:null);
      if(box?.length===4&&box.every(Number.isFinite)){
        cue=node.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');cue.setAttribute('x',String(box[0]-3));cue.setAttribute('y',String(box[1]-3));cue.setAttribute('width',String(box[2]-box[0]+6));cue.setAttribute('height',String(box[3]-box[1]+6));cue.setAttribute('fill','none');cue.setAttribute('stroke','currentColor');cue.setAttribute('stroke-width','1.5');cue.setAttribute('stroke-dasharray','3 3');cue.setAttribute('aria-hidden','true');
      }else if(node.namespaceURI!=='http://www.w3.org/2000/svg'){cue=node.ownerDocument.createElement('span');cue.textContent=' ◇';cue.setAttribute('aria-hidden','true');}
      if(cue){cue.setAttribute('data-practice-machine-cue','');node.append(cue);}
    }
    if(cue&&(!ownership||!machine))cue.remove();
  }
  for(const node of root.querySelectorAll('[data-notation-part-id]')){const machine=!ownership&&mode==='practice'&&!humanPartIds.has(node.dataset.notationPartId);const role=ownership&&mode==='practice'?'mixed':machine?'machine':mode==='practice'?'human':'listen';if(node.dataset.practiceRole!==role)node.dataset.practiceRole=role;if(node.classList.contains('machine-notation-part')!==machine)node.classList.toggle('machine-notation-part',machine);}
}

/** Admitted songs and applied instrument objects are immutable display owners. */
export function createPracticeDisplayCache({getParts=()=>[]}={}) {
  let song=null,pianoGeometry=null,guitarProfile=null,excludedMachinePartIds=new Set(),pianoMidi=new Set(),guitarMidi=new Set();
  return ({cleanSong=null,instrument='piano',geometry=[],guitar=null})=>{
    if(song!==cleanSong){song=cleanSong;excludedMachinePartIds=new Set(getParts(song).filter(part=>part.percussion).map(part=>part.id));}
    if(instrument==='piano'&&pianoGeometry!==geometry){pianoGeometry=geometry;pianoMidi=new Set(geometry.map(key=>key.midi));}
    if(instrument==='guitar'&&guitarProfile!==guitar){guitarProfile=guitar;guitarMidi=new Set(guitar.tuning.flatMap(open=>Array.from({length:Math.max(0,guitar.frets-guitar.capo+1)},(_,fret)=>open+guitar.capo+fret)));}
    return {availableMidi:instrument==='piano'?pianoMidi:guitarMidi,excludedMachinePartIds};
  };
}
