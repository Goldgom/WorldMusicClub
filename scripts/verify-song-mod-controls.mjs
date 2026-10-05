import assert from 'node:assert/strict';

const buttons=new Set(['configure-song-mod','edit-song-mod','song-mod-all-human','song-mod-all-machine','song-mod-restore','song-mod-apply','song-mod-cancel','start-performance']);
const selectValues={performer:{'select-first':'human','select-last':'machine'},instrument:{'select-first':'source','select-second':'sine','select-last':'reed'}};

/** Bind visible Mod receipts to the same sequential native action stream. */
export function validateSongModActionHistory(report,{actions,requireTrusted=false,requiredControls=['configure-song-mod','song-mod-apply','start-performance']}={}) {
  assert.ok(Number.isSafeInteger(report.actions)&&report.actions>0,'Mod history needs the actual action count');
  assert.ok(Array.isArray(report.modActions)&&report.modActions.length>0&&report.modActions.length<=report.actions,'Bounded Mod action history is required');
  let previous=0;
  for(const row of report.modActions){
    assert.ok(Number.isSafeInteger(row.sequence)&&row.sequence>previous&&row.sequence<=report.actions,'Mod receipts must follow the actual native action order');previous=row.sequence;
    assert.ok(['click','select-first','select-second','select-last'].includes(row.kind),'Unsupported Mod action kind');
    const field=row.field??null,part=row.part??null;
    if(field){
      assert.ok(typeof part==='string'&&part.length>0&&part.length<=512&&!row.id,'Mod field must bind its original source part');
      if(selectValues[field]){assert.ok(Object.hasOwn(selectValues[field],row.kind),'Mod select requires its bounded native option action');assert.equal(selectValues[field][row.kind],row.value,'Mod select action does not match its visible option');assert.equal(row.checked??null,null);}
      else{assert.ok(['mute','visible'].includes(field),'Unknown Mod field');assert.equal(row.kind,'click');assert.equal(typeof row.checked,'boolean');}
    }else{
      assert.equal(part,null,'A global Mod control cannot claim a source part');
      if(buttons.has(row.id))assert.equal(row.kind,'click');
      else if(row.id==='song-mod-layout'){assert.ok(['select-first','select-last'].includes(row.kind));assert.equal(row.value,row.kind==='select-first'?'complete':'solo','Mod layout must use an actual bounded option');}
      else{assert.equal(row.id,'song-mod-show-others','Unknown visible Mod control');assert.equal(row.kind,'click');assert.equal(typeof row.checked,'boolean');}
    }
    if(actions){assert.equal(actions[row.sequence-1]?.sequence,row.sequence,'Missing native Mod action');assert.equal(actions[row.sequence-1]?.kind,row.kind,'Mod receipt is not bound to its actual native action');}
    if(requireTrusted){
      assert.ok(Array.isArray(report.trusted),'Mod control events are required');
      const eventType=field||row.id==='song-mod-layout'||row.id==='song-mod-show-others'?'change':'click';
      const matches=report.trusted.filter(event=>event.actionSequence===row.sequence&&event.type===eventType&&(field?event.modField===field&&event.part===part:event.id===row.id));
      assert.equal(matches.length,1,'Mod action needs exactly one matching trusted control event');
      assert.equal(matches[0].trusted,true,'Mod control event must be trusted');
      if(row.kind.startsWith('select-'))assert.equal(matches[0].value,row.value,'Mod selection receipt and trusted value differ');
      if(typeof row.checked==='boolean')assert.equal(matches[0].checked,row.checked,'Mod checkbox receipt and trusted value differ');
    }
  }
  for(const id of requiredControls)assert.ok(report.modActions.some(row=>row.id===id&&row.kind==='click'),`Missing visible Mod action: ${id}`);
  return report.modActions;
}
