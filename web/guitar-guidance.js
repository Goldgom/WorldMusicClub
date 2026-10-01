import {midiName} from './music.js';
import {mappedSourceIds} from './physical-targets.js';
import {TimelineIndex} from './transport.js';

export const GUITAR_LOOKAHEAD_MS=4000;
export const GUITAR_VISIBLE_TARGETS=8;
const seconds=ms=>(ms/1000).toFixed(3);
const countdown=ms=>`${Math.max(0,ms/1000).toFixed(1)}s`;

/** Read Rust-expanded occurrences/targets only. This never groups attacks or chooses fingering. */
export function guitarGuidanceView({index,groups=new Map(),parts=[],position=0,segmentStart=0,segmentEnd=Infinity,running=false,hasStarted=false,completed=false,mode='listen',loopIteration=null}) {
  if(!index)return{phase:'pending',state:'Waiting for checked guitar targets · 等待目标',items:[],additional:0,additionalSounding:0,additionalUpcoming:0};
  const notes=index.notes,from=Math.max(segmentStart,position),to=Math.min(segmentEnd,position+GUITAR_LOOKAHEAD_MS);
  // The index also supplies sounding durations, including a tie crossing a loop boundary.
  // Filtering the boundary is presentation-only; assessment retains the complete Rust plan.
  const available=completed?[]:index.range(from,to).filter(note=>note.start_ms<segmentEnd);
  let low=0,high=notes.length;
  while(low<high){const mid=(low+high)>>>1;if(notes[mid].start_ms<from)low=mid+1;else high=mid;}
  const next=notes[low]?.start_ms<segmentEnd?notes[low]:null;
  const sounding=position>=segmentStart&&available.some(note=>note.start_ms<=position);
  const phase=completed?'complete':!running&&hasStarted?'paused':position<segmentStart?'count-in':!hasStarted?'ready':sounding?'sounding':'rest';
  const prefix={complete:'Complete',paused:'Paused · 已暂停',ready:'Ready · 准备', 'count-in':'Count-in · 预备',sounding:'Sounding in score · 乐谱发声',rest:'Rest in selected part · 当前声部休止'}[phase];
  const state=(completed?'No upcoming onsets · 已结束':next?`${prefix} · next onset in ${countdown(next.start_ms-position)}`:`${prefix} · no upcoming onsets`)+(loopIteration?` · Loop ${loopIteration}`:'');
  const current=available.filter(note=>note.start_ms<segmentStart||note.start_ms<=position),upcoming=available.filter(note=>note.start_ms>=segmentStart&&note.start_ms>position);
  // Long score durations cannot consume every card and hide all next attacks.
  const currentCount=Math.min(current.length,GUITAR_VISIBLE_TARGETS-Math.min(upcoming.length,6));
  const visible=[...current.slice(0,currentCount),...upcoming.slice(0,GUITAR_VISIBLE_TARGETS-currentCount)];
  const items=visible.map(note=>{
    const group=groups.get(note.id),sourceIds=[...mappedSourceIds(note,group)],occurrenceIds=[...(group?.source_occurrence_ids||[note.id])],active=position>=segmentStart&&note.start_ms<=position;
    const continuing=!active&&note.start_ms<segmentStart;
    const partIds=[...(group?.part_ids||[note.part_id])],partLabel=partIds.map(id=>parts.find(part=>part.id===id)?.name||'Selected part').join(' + ');
    return{id:note.id,midi:note.midi,pitch:midiName(note.midi),startMs:note.start_ms,durationMs:note.duration_ms,sourceIds,occurrenceIds,partIds,identity:`${partLabel}${note.voice?` · voice ${note.voice}`:''}${sourceIds.length>1?' · tied':''}`,phase:active?'sounding':continuing?'continuing':'upcoming',time:active?'Sounding':continuing?`Continues in ${countdown(segmentStart-position)}`:`In ${countdown(note.start_ms-position)}`,onset:`At ${seconds(note.start_ms)}s`,kind:mode==='practice'?'Target':'Occurrence'};
  });
  const additionalSounding=current.length-currentCount,additionalUpcoming=upcoming.length-(visible.length-currentCount);
  return{phase,state,items,additional:additionalSounding+additionalUpcoming,additionalSounding,additionalUpcoming};
}

/** No live region or animation: stable cards update only when their displayed values change. */
export function setupGuitarGuidance(document) {
  const root=document.getElementById('guitar-guidance'),status=document.getElementById('guitar-guidance-state'),list=document.getElementById('guitar-guidance-items'),overflow=document.getElementById('guitar-guidance-overflow'),sources=document.getElementById('guitar-guidance-sources');
  let signature='',sourceSignature='',cards=new Map(),timeline=null,index=null;
  return context=>{
    if(context.timeline!==timeline){timeline=context.timeline;index=timeline?new TimelineIndex(timeline.notes):null;}
    const view=guitarGuidanceView({...context,index}),nextSignature=JSON.stringify(view);
    if(nextSignature===signature)return view;
    signature=nextSignature;root.dataset.phase=view.phase;status.textContent=view.state;
    const nextCards=new Map();
    for(const item of view.items){
      let card=cards.get(item.id);
      if(!card){card=document.createElement('li');card.className='guitar-target';for(const name of ['pitch','time','onset','identity']){const span=document.createElement(name==='pitch'?'strong':'span');span.className=`guitar-target-${name}`;card.append(span);}}
      card.dataset.targetId=item.id;card.dataset.startMs=String(item.startMs);card.dataset.durationMs=String(item.durationMs);card.dataset.sourceIds=JSON.stringify(item.sourceIds);card.dataset.occurrenceIds=JSON.stringify(item.occurrenceIds);card.dataset.phase=item.phase;
      card.querySelector('.guitar-target-pitch').textContent=item.pitch;card.querySelector('.guitar-target-time').textContent=item.time;card.querySelector('.guitar-target-onset').textContent=item.onset;
      card.querySelector('.guitar-target-identity').textContent=item.identity;
      card.title=`${item.kind}: ${item.id}. Source occurrences: ${item.occurrenceIds.join(', ')}. Source notes: ${item.sourceIds.join(', ')}. Parts: ${item.partIds.join(', ')}. Duration in score: ${seconds(item.durationMs)}s. Sustain and fingering are not scored.`;
      card.setAttribute('aria-description',card.title);nextCards.set(item.id,card);
    }
    // Keep existing card nodes and horizontal scroll while the countdown changes.
    for(const[id,card]of cards)if(!nextCards.has(id))card.remove();
    let previous=null;for(const card of nextCards.values()){if(card!== (previous?previous.nextElementSibling:list.firstElementChild))list.insertBefore(card,previous?previous.nextElementSibling:list.firstElementChild);previous=card;}
    cards=nextCards;overflow.hidden=!view.additional;overflow.textContent=view.additional?`+${view.additional} more: ${view.additionalSounding} sounding, ${view.additionalUpcoming} upcoming. All source and assessment targets are retained.`:'';
    const nextSources=JSON.stringify([...cards.values()].map(card=>[card.dataset.startMs,card.querySelector('.guitar-target-pitch').textContent,card.title]));
    if(nextSources!==sourceSignature){sourceSignature=nextSources;sources.replaceChildren(...[...cards.values()].map(card=>{const li=document.createElement('li');li.textContent=`${card.querySelector('.guitar-target-pitch').textContent} at ${seconds(Number(card.dataset.startMs))}s. ${card.title}`;return li;}));}
    return view;
  };
}
