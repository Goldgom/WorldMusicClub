/** Per-pass input history. Canonical note times come unchanged from the Rust timeline. */
export class PracticeRecorder {
  constructor({latencyMs = 0, toleranceMs = 180} = {}) {
    this.latencyMs = latencyMs; this.toleranceMs = toleranceMs;
    this.passes = []; this.active = null; this.nextEventId = 1;
  }
  begin({wallTime, position, startMs, endMs, timeline, label = 'Take', captureEnabled = true}) {
    const pass = {id:this.passes.length + 1,label,captureEnabled,startMs,endMs,timeline,startedWall:wallTime,
      segments:[{wallStart:wallTime,wallEnd:null,positionStart:position}], inputs:[], captures:[], revision:0,
      closedWall:null,deadline:null,manualDeadline:null,requestVersion:0,inFlight:false,
      assessedRevision:-1,assessment:null,error:null,boundaryReviews:[],reviewKeys:new Set()};
    this.passes.push(pass); this.active = pass;
    for(const previous of this.passes)if(previous!==pass&&(previous.closedWall===null||previous.closedWall+this.toleranceMs>=wallTime+(startMs-position)-this.toleranceMs))for(const capture of previous.captures){const corrected=capture.event_wall_ms-this.latencyMs;const atMs=position+corrected-wallTime;if(atMs>=startMs-this.toleranceMs&&atMs<=endMs+this.toleranceMs&&this.hasEligibleTarget(pass,atMs,capture.input.midi))this.flagBoundary(previous,pass,capture)}
    return pass;
  }
  resume(wallTime, position) {
    const pass=this.active;if(!pass||pass.closedWall!==null)return null;
    const previous=pass.segments.at(-1);if(previous.wallEnd===null)return pass;
    pass.segments.push({wallStart:wallTime,wallEnd:null,positionStart:position});return pass;
  }
  pause(wallTime) {
    const segment=this.active?.segments.at(-1);
    if(segment?.wallEnd===null)segment.wallEnd=Math.max(segment.wallStart,wallTime);
  }
  closeAtEnd(wallTime) {
    const pass=this.active;if(!pass||pass.closedWall!==null)return pass;
    const segment=pass.segments.at(-1);
    const endWall=segment.wallStart+Math.max(0,pass.endMs-segment.positionStart);
    segment.wallEnd=Math.min(wallTime,endWall);
    pass.closedWall=segment.wallEnd;
    pass.deadline=pass.closedWall+Math.max(0,this.latencyMs)+this.toleranceMs;
    return pass;
  }
  requestAssessment(wallTime, {grace = true} = {}) {
    const pass=this.active;if(!pass)return null;
    this.pause(wallTime);pass.error=null;pass.requestVersion++;
    pass.manualDeadline=wallTime+(grace?Math.max(0,this.latencyMs)+this.toleranceMs:0);
    return pass;
  }
  capture({midi, eventWall, receivedWall = eventWall, velocity = 90}) {
    if(!Number.isFinite(eventWall)||!Number.isFinite(receivedWall))return null;
    const correctedWall=eventWall-this.latencyMs;
    let best=null; const candidates=[];
    for(let index=this.passes.length-1;index>=0;index--) {
      const pass=this.passes[index];
      if(!pass.captureEnabled||eventWall<pass.startedWall||(pass.closedWall!==null&&correctedWall>pass.closedWall+this.toleranceMs))continue;
      for(const segment of pass.segments) {
        const end=segment.wallEnd ?? Infinity;
        const inside=correctedWall>=segment.wallStart&&correctedWall<end;
        const tail=segment.wallEnd!==null&&correctedWall>=end&&correctedWall<=end+this.toleranceMs;
        const head=segment===pass.segments[0]&&correctedWall<segment.wallStart&&correctedWall>=segment.wallStart-this.toleranceMs;
        if(!inside&&!tail&&!head)continue;
        const atMs=segment.positionStart+correctedWall-segment.wallStart;
        if(atMs<pass.startMs-this.toleranceMs||atMs>pass.endMs+this.toleranceMs)continue;
        const rank=inside&&atMs>=pass.startMs&&atMs<pass.endMs?0:inside?1:2;
        candidates.push({pass,atMs});
        if(!best||rank<best.rank)best={pass,atMs,rank};
      }
    }
    if(!best)return null;
    const input={midi,at_ms:best.atMs,velocity};
    const capture={event_id:this.nextEventId++,event_wall_ms:eventWall,received_wall_ms:receivedWall,input};
    best.pass.inputs.push(input);best.pass.captures.push(capture);best.pass.revision++;
    for(const candidate of candidates)if(candidate.pass!==best.pass&&this.hasEligibleTarget(candidate.pass,candidate.atMs,midi))this.flagBoundary(best.pass,candidate.pass,capture);
    return {pass:best.pass,input};
  }
  hasEligibleTarget(pass, atMs, midi) { return pass.timeline.notes.some(note=>note.midi===midi&&Math.abs(note.start_ms-atMs)<=this.toleranceMs); }
  flagBoundary(owner, alternative, capture) {
    // This is a warning only. Input ownership stays on the corrected clock; Rust alone scores notes.
    const key=`${capture.event_id}:${owner.id}:${alternative.id}`;
    const review={event_id:capture.event_id,owner_pass_id:owner.id,alternative_pass_id:alternative.id,reason:'An onset is eligible near another pass boundary; cross-pass matching has not been evaluated.'};
    for(const pass of [owner,alternative])if(!pass.reviewKeys.has(key)){pass.reviewKeys.add(key);pass.boundaryReviews.push(review)}
  }
  ready(wallTime) {
    return this.passes.filter(pass=>{
      if(pass.inFlight||pass.error)return false;
      const dirty=pass.assessedRevision<pass.revision;
      const closed=pass.deadline!==null&&wallTime>=pass.deadline;
      const requested=pass.manualDeadline!==null&&wallTime>=pass.manualDeadline;
      const lateCorrection=pass.assessedRevision>=0&&pass.segments.at(-1).wallEnd!==null&&dirty;
      return (closed||requested||lateCorrection)&&(dirty||requested);
    });
  }
  submit(pass) {
    pass.inFlight=true;
    return {pass,revision:pass.revision,requestVersion:pass.requestVersion,timeline:pass.timeline,inputs:pass.inputs.map(input=>({...input}))};
  }
  complete(job, assessment) {
    const {pass}=job;pass.inFlight=false;pass.assessedRevision=job.revision;pass.assessment=assessment;pass.error=null;
    if(pass.requestVersion===job.requestVersion)pass.manualDeadline=null;
  }
  fail(job, message) {job.pass.inFlight=false;job.pass.error=String(message);}
  retryFailed() {for(const pass of this.passes)if(pass.error){pass.error=null;pass.manualDeadline=0;pass.requestVersion++;}}
  get pending() {
    return this.passes.some(pass=>!pass.error&&(pass.inFlight||pass.manualDeadline!==null||(pass.closedWall!==null&&pass.assessedRevision<pass.revision)));
  }
  exportData() {
    return {version:1,latency_ms:this.latencyMs,tolerance_ms:this.toleranceMs,passes:this.passes.map(pass=>({id:pass.id,label:pass.label,range:{start_ms:pass.startMs,end_ms:pass.endMs},timeline:pass.timeline,capture_enabled:pass.captureEnabled,clock_segments:pass.segments,grace_deadline_wall_ms:pass.deadline,manual_deadline_wall_ms:pass.manualDeadline,inputs:pass.inputs,captures:pass.captures,revision:pass.revision,assessed_revision:pass.assessedRevision,assessment:pass.assessment,error:pass.error,boundary_reviews:pass.boundaryReviews,ownership:'deterministic_corrected_clock',pending:pass.inFlight||pass.manualDeadline!==null||pass.assessedRevision<pass.revision}))};
  }
}
