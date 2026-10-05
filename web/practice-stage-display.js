/** Presentation-only roles. Never alter source events or feed machine notes to input. */
export function practiceStageNotes({humanNotes=[],sourceNotes=[],humanPartIds=new Set(),mode='practice',layout='complete',showOthers=true,range=null,availableMidi=null,excludedMachinePartIds=new Set(),hiddenPartIds=new Set(),targetGroups=new Map()}={}) {
  sourceNotes=sourceNotes.filter(note=>!hiddenPartIds.has(note.part_id));humanNotes=humanNotes.filter(note=>(targetGroups.get(note.id)?.part_ids||[note.part_id]).some(id=>!hiddenPartIds.has(id)));
  if(mode!=='practice')return sourceNotes.map(note=>({...note,practice_role:'listen'}));
  const human=humanNotes.map(note=>({...note,practice_role:'human'}));
  if(layout==='solo'||!showOthers)return human;
  const machine=sourceNotes.filter(note=>!humanPartIds.has(note.part_id)&&!excludedMachinePartIds.has(note.part_id)&&(!availableMidi||availableMidi.has(note.midi))&&(!range||note.midi>=range[0]&&note.midi<=range[1])).map(note=>({...note,practice_role:'machine'}));
  return [...machine,...human];
}
export function markPracticeNotation(root,{sourceNotes=new Map(),humanPartIds=new Set(),mode='listen'}={}) {
  for(const node of root.querySelectorAll('[data-note-id]')){const source=sourceNotes.get(node.dataset.noteId),part=source?.partId||node.dataset.partId||node.closest('[data-notation-part-id]')?.dataset.notationPartId;const machine=mode==='practice'&&part&&!humanPartIds.has(part);const role=machine?'machine':mode==='practice'?'human':'listen';if(node.dataset.practiceRole!==role)node.dataset.practiceRole=role;if(node.classList.contains('machine-note')!==Boolean(machine))node.classList.toggle('machine-note',Boolean(machine));if(machine&&node.classList.contains('active'))node.classList.remove('active');}
  for(const node of root.querySelectorAll('[data-notation-part-id]')){const machine=mode==='practice'&&!humanPartIds.has(node.dataset.notationPartId);const role=machine?'machine':mode==='practice'?'human':'listen';if(node.dataset.practiceRole!==role)node.dataset.practiceRole=role;if(node.classList.contains('machine-notation-part')!==machine)node.classList.toggle('machine-notation-part',machine);}
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
