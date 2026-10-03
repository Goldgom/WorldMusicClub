/** Reviewed RPN 0 prefix only. Every source selector/value/deselect stays typed. */
export const INITIAL_SENSITIVITY_KIND='initial_pitch_bend_sensitivity';
export const INITIAL_SENSITIVITY_STEPS=Object.freeze([
  'select_most_significant_zero','select_least_significant_zero','set_semitones24',
  'set_cents_zero','deselect_most_significant','deselect_least_significant',
]);
const coordinate=origin=>`${origin?.track}:${origin?.event}`;
const order=(a,b)=>a.at_ms-b.at_ms||a.origin.track-b.origin.track||a.origin.event-b.origin.event;
export function validInitialSensitivity(song) {
  const runtime=song.runtime.events.filter(event=>event.command.kind===INITIAL_SENSITIVITY_KIND);
  const source=song.score.performance.events.filter(event=>event.command.kind===INITIAL_SENSITIVITY_KIND);
  if(runtime.length!==source.length)return false;
  const sourceByOrigin=new Map(source.map(event=>[coordinate(event.origin),event]));
  const channels=new Set();
  for(const event of runtime){
    const command=event.command,original=sourceByOrigin.get(coordinate(event.origin));
    if(!original||original.at.numerator!==0||event.at_ms!==0||event.exact_microseconds?.numerator!=='0'||event.exact_microseconds?.denominator!==1
      ||!Number.isInteger(command.channel)||command.channel<0||command.channel>15
      ||Object.keys(command).sort().join(',')!=='channel,kind,step'
      ||original.command.channel!==command.channel||original.command.step!==command.step)return false;
    channels.add(command.channel);
  }
  if(!channels.size)return true;
  // The scheduler consumes this array directly; sorting a copy must not repair
  // a malformed runtime whose replay order differs from the checked sequence.
  if(song.runtime.events.some((event,index)=>index>0&&order(song.runtime.events[index-1],event)>=0))return false;
  const merged=[...song.runtime.events,...song.runtime.notes.flatMap(note=>[
    {at_ms:note.start_ms,origin:note.attack,channel:note.channel},
    {at_ms:note.end_ms,origin:note.release,channel:note.channel},
  ])].sort(order);
  for(const channel of channels){
    const events=merged.filter(event=>(event.command?.channel??event.channel)===channel);
    const start=events.findIndex(event=>event.command?.kind===INITIAL_SENSITIVITY_KIND),first=events[start];
    if(events.some(event=>event.origin.track!==first.origin.track)
      ||events.slice(0,start).some(event=>event.command?.kind!=='instrument_program')
      ||events.filter(event=>event.command?.kind===INITIAL_SENSITIVITY_KIND).length!==6)return false;
    for(let index=0;index<6;index++){
      const event=events[start+index];
      if(event?.command?.kind!==INITIAL_SENSITIVITY_KIND||event.command.step!==INITIAL_SENSITIVITY_STEPS[index]
        ||event.origin.event!==first.origin.event+index)return false;
    }
  }
  return true;
}
export function applyInitialSensitivity(state,step) {
  if(step!==INITIAL_SENSITIVITY_STEPS[state.sensitivity_step??0])throw new Error('Invalid initial pitch-bend sensitivity order');
  switch(step){
    case 'select_most_significant_zero':state.rpn_most_significant=0;break;
    case 'select_least_significant_zero':state.rpn_least_significant=0;break;
    case 'set_semitones24':state.sensitivity_semitones=24;break;
    case 'set_cents_zero':state.sensitivity_cents=0;break;
    case 'deselect_most_significant':state.rpn_most_significant=127;break;
    case 'deselect_least_significant':state.rpn_least_significant=127;break;
  }
  state.sensitivity_step=(state.sensitivity_step??0)+1;
}
/** Sensitivity scales bend displacement; the strict profile admits only center. */
export function unbentReferenceKey(state,key) {
  if(state.pitch_bend!==0||(state.sensitivity_step!==undefined&&(state.sensitivity_step!==6
    ||state.sensitivity_semitones!==24||state.sensitivity_cents!==0
    ||state.rpn_most_significant!==127||state.rpn_least_significant!==127)))throw new Error('Unsupported pitch-bend state');
  return key+state.pitch_bend*(state.sensitivity_semitones+state.sensitivity_cents/100);
}
