import {decodeMidi, eventTimeEvidence} from './midi-messages.js';

/** Device names and IDs stay in this browser controller, never in score/take data. */
export function createMidiInputController({requestAccess, pressNote, releaseNote, releaseMatching,
  onChange = () => {}, choice = {mode:'all', id:null}, now = () => performance.now(),
  timeOrigin = () => performance.timeOrigin, getConfiguredRange = () => null}) {
  let access = null, requesting = null, phase = requestAccess ? 'idle' : 'unsupported';
  let message = '', messageCode = '', messageDetails = '', away = false, serial = 0, timingAmbiguous = false, omitted = 0;
  const bound = new Map(), queues = new WeakMap(), history = [], errors = new Map();
  const test = {active:false,last:null,held:new Map(),range:null,message:'',code:'',reason:''};
  const errorDetail = error => typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : '';
  const selected = input => choice.mode === 'all' || (choice.mode === 'single' && choice.id === input.id);
  const inputs = () => access ? [...access.inputs.values()] : [];
  const live = binding => !away && bound.get(binding.input.id) === binding && binding.end === null;
  function snapshot() {
    return {phase, choice:{...choice}, devices:inputs().map(input => ({id:input.id,name:input.name || '',
      state:input.state,connection:input.connection || (bound.get(input.id)?.ready ? 'open' : 'closed'),
      opening:Boolean(bound.get(input.id) && !bound.get(input.id).ready), error:errors.get(input.id)?.message || '', errorCode:errors.has(input.id) ? 'midi_open_failed' : '', errorDetails:errors.get(input.id)?.details || ''})),
      message, messageCode, messageDetails, configuredRange:getConfiguredRange(), canTest:!away && [...bound.values()].some(binding=>binding.ready),
      test:{active:test.active,last:test.last,held:[...test.held.values()],range:test.range,
        message:test.message,code:test.code,reason:test.reason}, omittedTimingEvents:omitted};
  }
  const emit = () => onChange(snapshot());
  // Serialize lease operations per port object. A late close must finish before
  // that same port can be reopened after a rapid selection change.
  function lease(input, operation) {
    const previous = queues.get(input) || Promise.resolve();
    const next = previous.catch(()=>{}).then(operation);
    queues.set(input,next); return next;
  }
  function retire(binding, reason, eventTime = now(), close = true) {
    if (binding.end !== null) return;
    binding.end = now();
    if (binding.input.onmidimessage === binding.handler) binding.input.onmidimessage = null;
    if (bound.get(binding.input.id) === binding) bound.delete(binding.input.id);
    if (binding.route === 'practice' && binding.ready) releaseMatching(binding.prefix,eventTime,
      {reason,generationToken:binding.token,inputKind:'midi'});
    for (const key of test.held.keys()) if(key.startsWith(binding.prefix))test.held.delete(key);
    if (close) lease(binding.input,()=>binding.input.close?.()).catch(()=>{});
  }
  function discard() {
    omitted++;messageCode='midi_timing_ambiguous';messageDetails='';
    message = `${omitted} MIDI messages with ambiguous routing time were excluded from practice. Event timestamps are required after switching key-test mode.`;
    emit();
  }
  function deliver(calledBinding,event) {
    const note=decodeMidi(event.data); if(!note)return;
    const evidence=eventTimeEvidence(event.timeStamp,{now:now(),timeOrigin:timeOrigin()});
    let binding=calledBinding;
    if(evidence.timestampBasis==='receipt_fallback') {
      if(!live(binding)||(timingAmbiguous&&binding.route!=='test')){discard();return;}
    } else {
      // Browser delivery may use a newer handler for an older timestamp. Route
      // through bounded mode intervals for this exact port object, not its name.
      binding=history.findLast(candidate=>candidate.input===calledBinding.input && candidate.ready &&
        evidence.eventWall>=candidate.start && (candidate.end===null || evidence.eventWall<candidate.end));
      if(!binding){discard();return;}
    }
    const identity={generationToken:binding.token,inputKind:'midi',channel:note.channel,liveInput:live(binding)};
    const source=`${binding.prefix}${note.channel}:${note.midi}`;
    if(binding.route==='test') {
      if(!test.active||!live(binding))return;
      if(note.kind==='panic') {for(const key of test.held.keys())if(key.startsWith(`${binding.prefix}${note.channel}:`))test.held.delete(key);}
      else {
        const observed={inputId:binding.input.id,kind:note.kind,midi:note.midi,channel:note.channel,velocity:note.velocity};
        test.last=observed;
        if(note.kind==='on') {test.held.set(source,observed);test.range=test.range?{low:Math.min(test.range.low,note.midi),high:Math.max(test.range.high,note.midi)}:{low:note.midi,high:note.midi};}
        else test.held.delete(source);
      }
      emit();return;
    }
    if(note.kind==='panic') {releaseMatching(`${binding.prefix}${note.channel}:`,event.timeStamp,{...identity,reason:`midi_cc${note.controller}`});return;}
    const encoding=(event.data[0]&0xf0)===0x80?'midi_note_off':note.kind==='off'?'midi_zero_velocity_note_on':'midi_note_on';
    if(note.kind==='on')pressNote(source,note.midi,note.velocity,event.timeStamp,{...identity,encoding,retrigger:true});
    else releaseNote(source,event.timeStamp,{...identity,encoding,midi:note.midi,velocity:note.velocity});
  }
  function bind(input) {
    const binding={input,token:{},prefix:`midi:${encodeURIComponent(input.id)}:binding-${++serial}:`,
      route:test.active?'test':'practice',start:now(),end:null,ready:false,handler:null};
    binding.handler=event=>deliver(binding,event);bound.set(input.id,binding);history.push(binding);
    // Keep current intervals even with many inputs; retire oldest completed ones.
    while(history.length>256){const index=history.findIndex(item=>item.end!==null);if(index<0)break;history.splice(index,1);}
    const install=()=>{if(!live(binding)||input.state==='disconnected')return;
      binding.ready=true;input.onmidimessage=binding.handler;errors.delete(input.id);emit();};
    // Older browser mocks and nonstandard implementations use implicit opening;
    // actual Web MIDI ports provide open/close and take the serialized path.
    if(typeof input.open!=='function'){install();return;}
    lease(input,async()=>{if(live(binding))await input.open();}).then(install,error=>{
      if(!live(binding))return;errors.set(input.id,{message:'Could not open this input. Retry Connect MIDI.',details:errorDetail(error)});
      retire(binding,'midi_open_failed',now(),false);if(test.active)setTest(false,'input_open_failed');
      message='A selected MIDI input could not be opened.';messageCode='midi_open_failed';messageDetails='';emit();
    });
  }
  function reconcile(event) {
    if(!access||away)return;
    const desired=inputs().filter(input=>input.state!=='disconnected'&&selected(input));
    if(test.active && ([...bound.values()].some(binding=>!desired.includes(binding.input)) || desired.some(input=>bound.get(input.id)?.input!==input)))setTest(false,'device_changed');
    for(const binding of [...bound.values()])if(!desired.includes(binding.input))
      retire(binding,binding.input.state==='disconnected'?'midi_disconnected':desired.some(input=>input.id===binding.input.id)?'midi_replaced':'midi_selection_changed',event?.timeStamp);
    if(test.active && !desired.length) {test.active=false;test.held.clear();test.message='Key test stopped: selected input unavailable.';test.code='midi_test_stopped';test.reason='input_unavailable';}
    for(const input of desired)if(!bound.has(input.id))bind(input);
    emit();
  }
  async function connect() {
    if(requesting)return requesting;
    if(!requestAccess){phase='unsupported';emit();return;}
    if(access){message='';messageCode='';messageDetails='';reconcile();return;}
    phase='requesting';message='';messageCode='';messageDetails='';emit();
    requesting=Promise.resolve().then(()=>requestAccess({sysex:false})).then(value=>{
      access=value;phase='ready';message='';messageCode='';messageDetails='';if(!away){access.onstatechange=reconcile;reconcile();}
    },error=>{phase='error';message='MIDI permission was not granted or input is unavailable. You can retry.';messageCode='midi_access_failed';messageDetails=errorDetail(error);})
      .finally(()=>{requesting=null;emit();});
    return requesting;
  }
  function setTest(active,reason='user') {
    active=Boolean(active);if(active===test.active)return;
    if(active&&!snapshot().canTest)return;
    timingAmbiguous=true;test.active=active;test.held.clear();
    test.code=active?'midi_test_active':'midi_test_stopped';test.reason=active?'':reason;
    test.message=active?'Visual key test only; these messages are excluded from practice.':`Key test stopped (${reason})`;
    if(active){test.last=null;test.range=null;}
    // Keep device leases while creating fresh observation/routing generations.
    const current=[...bound.values()];for(const binding of current)retire(binding,'midi_test_boundary',now(),false);
    for(const binding of current)if(binding.input.state!=='disconnected'&&!away)bind(binding.input);
    emit();
  }
  function select(next) {
    if(!next||!['all','single','none'].includes(next.mode)||(next.mode==='single'&&(typeof next.id!=='string'||!next.id)))throw Error('Invalid MIDI input choice');
    if(choice.mode===next.mode&&choice.id===next.id)return;
    if(test.active)setTest(false,'selection_changed');
    choice={mode:next.mode,id:next.mode==='single'?next.id:null};message='';messageCode='';messageDetails='';reconcile();emit();
  }
  function suspend(event) {
    away=true;if(test.active){test.active=false;test.held.clear();test.message='Key test stopped while away.';test.code='midi_test_stopped';test.reason='pagehide';}
    if(access)access.onstatechange=null;
    for(const binding of [...bound.values()])retire(binding,'pagehide',event?.timeStamp);
    emit();
  }
  function resume(){away=false;if(access){access.onstatechange=reconcile;reconcile();}emit();}
  const exportRoutingData=()=>omitted?{version:1,scope:'browser page lifetime, including time before this take',
    excluded_ambiguous_messages:omitted,reason:'No reliable timestamp could assign these messages to a retained practice or key-test interval. They are excluded from practice and input evidence; this count is not per-pass.'}:null;
  return {connect,select,setTest,suspend,resume,snapshot,refresh:emit,exportRoutingData};
}
