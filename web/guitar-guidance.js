import {getAppI18n} from './app-locale.js';
import {midiName} from './music.js';
import {mappedSourceIds} from './physical-targets.js';
import {TimelineIndex} from './transport.js';
import {guitarChoiceLabel,guitarPickingLabel,guitarAssignmentIndex,guitarRowLabel} from './guitar-fingering-view.js';

export const GUITAR_LOOKAHEAD_MS=4000;
// This is a budget for later-future detail cards, never for either live hand shape.
export const GUITAR_VISIBLE_TARGETS=8;
const seconds=(ms,i18n)=>i18n.formatNumber(ms/1000,{minimumFractionDigits:3,maximumFractionDigits:3});
const countdown=(ms,i18n)=>i18n.formatNumber(Math.max(0,ms/1000),{minimumFractionDigits:1,maximumFractionDigits:1});
const unique=values=>[...new Set(values)];
const endOf=note=>note.start_ms+note.duration_ms;
const emptyGroups=()=>({items:[],currentItems:[],nextItems:[],nextShapeItems:[],currentNotes:[],nextNotes:[],currentChoices:[],nextChoices:[],retainedChoices:[],releaseChoices:[],nextOnsetMs:null,additional:0,additionalSounding:0,additionalUpcoming:0,transition:'',profile:null});

/** Select complete groups from Rust-expanded times. This never chooses a fingering. */
export function guitarGuidanceView({index,groups=new Map(),parts=[],position=0,segmentStart=0,segmentEnd=Infinity,running=false,hasStarted=false,completed=false,mode='listen',loopIteration=null,plan=null,profile=plan?.profile,showPicking=false,i18n=getAppI18n()}) {
  const t=(key,params)=>i18n.t('guitar.runtime.'+key,params);
  if(!index)return{...emptyGroups(),phase:'pending',state:t('pending'),profile};
  const notes=index.notes,at=Math.max(segmentStart,position),assignments=guitarAssignmentIndex(plan);
  const available=completed||at>=segmentEnd?[]:index.range(at,Math.max(at,Math.min(segmentEnd,position+GUITAR_LOOKAHEAD_MS))).filter(note=>note.start_ms<segmentEnd);
  const currentNotes=available.filter(note=>note.start_ms<=position||note.start_ms<segmentStart);
  // Next means a strictly later attack; a held note never becomes a new loop attack.
  let low=0,high=notes.length;
  while(low<high){const mid=(low+high)>>>1;if(notes[mid].start_ms<=position||notes[mid].start_ms<segmentStart)low=mid+1;else high=mid;}
  const next=completed||at>=segmentEnd?null:notes[low]?.start_ms<segmentEnd?notes[low]:null;
  const nextOnsetMs=next?.start_ms??null,nextNotes=[];
  if(next)for(let i=low;i<notes.length&&notes[i].start_ms===nextOnsetMs;i++)nextNotes.push(notes[i]);
  const sounding=position>=segmentStart&&currentNotes.length>0;
  const phase=completed?'complete':!running&&hasStarted?'paused':position<segmentStart?'count-in':!hasStarted?'ready':sounding?'sounding':'rest';
  const prefix=t('phase.'+phase);
  let state=completed?t('complete'):next?t('next',{phase:prefix,seconds:countdown(nextOnsetMs-position,i18n)}):t('noNext',{phase:prefix});
  if(loopIteration)state=t('loop',{state,count:loopIteration});
  function itemFor(note){
    const group=groups.get(note.id),sourceIds=[...mappedSourceIds(note,group)],occurrenceIds=[...(group?.source_occurrence_ids||[note.id])];
    const active=position>=segmentStart&&note.start_ms<=position,continuing=!active&&note.start_ms<segmentStart;
    const partIds=[...(group?.part_ids||[note.part_id])],partLabel=partIds.map(id=>parts.find(part=>part.id===id)?.name||t('selectedPart')).join(' + ');
    const allChoices=occurrenceIds.map(id=>assignments.get(id)).filter(Boolean);
    // A physical target may combine unisons of different durations. Preserve its
    // source mapping, but never keep an individually released occurrence held.
    const chosen=allChoices.filter(choice=>!(active||continuing)||choice.end_ms>at);
    const route=allChoices.length===occurrenceIds.length&&chosen.length?chosen.map(choice=>guitarChoiceLabel(choice,profile,i18n)).join(' / '):t('noRoute');
    const picking=showPicking&&chosen.length?t('pickingHelp',{hints:unique(chosen.map(choice=>guitarPickingLabel(choice,i18n))).join(' / ')}):'';
    let identity=note.voice?t('voice',{part:partLabel,voice:String(note.voice)}):partLabel;
    if(sourceIds.length>1)identity=t('grouped',{identity});
    return{route,picking,choices:chosen,id:note.id,midi:note.midi,pitch:midiName(note.midi),startMs:note.start_ms,endMs:endOf(note),durationMs:note.duration_ms,sourceIds,occurrenceIds,partIds,identity,phase:active?'sounding':continuing?'continuing':'upcoming',time:active?t('sounding'):i18n.t(continuing?'instrument.continues':'instrument.in',{seconds:countdown((continuing?segmentStart:note.start_ms)-position,i18n)}),onset:i18n.t('instrument.onset',{seconds:seconds(note.start_ms,i18n)}),kind:t(mode==='practice'?'target':'occurrence')};
  }
  const currentItems=currentNotes.map(itemFor),nextItems=nextNotes.map(itemFor);
  const required=new Set([...currentNotes,...nextNotes].map(note=>note.id)),later=available.filter(note=>!required.has(note.id));
  const laterBudget=Math.max(0,GUITAR_VISIBLE_TARGETS-currentItems.length-nextItems.length),laterItems=later.slice(0,laterBudget).map(itemFor);
  const items=[...currentItems,...nextItems,...laterItems],currentChoices=currentItems.flatMap(item=>item.choices);
  const retainedChoices=next?currentChoices.filter(choice=>choice.end_ms>nextOnsetMs):[];
  const retainedIds=new Set(retainedChoices.map(choice=>choice.occurrence_id));
  const releaseChoices=currentChoices.filter(choice=>!retainedIds.has(choice.occurrence_id));
  const nextShapeItems=[...currentItems.map(item=>({...item,choices:item.choices.filter(choice=>retainedIds.has(choice.occurrence_id)),phase:'held'})).filter(item=>item.choices.length),...nextItems];
  const nextChoices=nextItems.flatMap(item=>item.choices);
  const fretRange=choices=>{const frets=choices.filter(choice=>choice.fret>0).map(choice=>choice.fret);if(!frets.length)return choices.length?t('openRange'):t('noRange');const low=Math.min(...frets),high=Math.max(...frets);return low===high?i18n.formatNumber(low):`${i18n.formatNumber(low)}–${i18n.formatNumber(high)}`;};
  const transition=plan?.status==='ready'?t('transition',{current:fretRange(currentChoices),next:fretRange([...retainedChoices,...nextChoices]),holds:retainedChoices.length,releases:releaseChoices.length}):t('noCompleteRoute');
  const additionalUpcoming=later.length-laterItems.length;
  return{phase,state,items,currentItems,nextItems,nextShapeItems,currentNotes,nextNotes,currentChoices,nextChoices,retainedChoices,releaseChoices,nextOnsetMs,additional:additionalUpcoming,additionalSounding:0,additionalUpcoming,transition,profile,segmentStart,segmentEnd,position};
}

function choiceDescription(choice,profile,role,i18n){
  return i18n.t('guitar.runtime.choiceDescription',{role,choice:guitarChoiceLabel(choice,profile,i18n),pitch:midiName(choice.midi),start:seconds(choice.start_ms,i18n),end:seconds(choice.end_ms,i18n),occurrence:choice.occurrence_id,sources:(choice.source_note_ids||[]).join(', ')});
}

/** A complete current/next route matrix, independent of full-fretboard scrolling. */
function renderLiveRoute(document,root,view,i18n,localeOnly=false){
  const t=(key,params)=>i18n.t('guitar.runtime.'+key,params);
  root.dataset.stringCount=String(view.profile?.tuning?.length||0);
  root.dataset.currentCount=String(view.currentChoices.length);root.dataset.nextCount=String(view.nextChoices.length);root.dataset.heldCount=String(view.retainedChoices.length);
  root.dataset.nextOnsetMs=view.nextOnsetMs===null?'':String(view.nextOnsetMs);
  const fragment=document.createDocumentFragment();
  const legend=document.createElement('p');legend.className='guitar-live-legend';
  legend.textContent=t('legend',{next:view.nextOnsetMs===null?t('noNextAttack'):t('nextAt',{seconds:seconds(view.nextOnsetMs,i18n)}),capo:view.profile?.capo||0});fragment.append(legend);
  const current=new Map(),next=new Map();
  for(const choice of view.currentChoices){if(!current.has(choice.string))current.set(choice.string,[]);current.get(choice.string).push(choice);}
  const retained=new Set(view.retainedChoices.map(choice=>choice.occurrence_id));
  for(const choice of [...view.retainedChoices,...view.nextChoices]){if(!next.has(choice.string))next.set(choice.string,[]);next.get(choice.string).push(choice);}
  const tuning=view.profile?.tuning||[];
  // Bands keep all 1–12 configured strings; none is hidden by a six-card policy.
  for(let start=0;start<tuning.length;start+=6){
    const rows=tuning.slice(start,start+6),band=document.createElement('div');band.className='guitar-live-band';band.style.setProperty('--guitar-route-strings',String(rows.length));band.setAttribute('role','table');band.setAttribute('aria-label',t('band',{from:start+1,to:start+rows.length}));
    const row=document.createElement('div');row.className='guitar-live-row guitar-live-tuning';row.setAttribute('role','row');
    const heading=document.createElement('span');heading.className='guitar-live-row-label';heading.textContent=t('rowHeading');heading.setAttribute('role','columnheader');row.append(heading);
    rows.forEach((pitch,i)=>{const label=document.createElement('span');label.textContent=i18n.formatNumber(start+i+1);label.title=guitarRowLabel(view.profile,start+i+1,i18n);label.setAttribute('role','columnheader');label.setAttribute('aria-label',label.title);row.append(label);});band.append(row);
    for(const[kind,label,map]of [['current',t(view.position<view.segmentStart?'entry':'now'),current],['next',t('nextHeading'),next]]){
      const row=document.createElement('div');row.className=`guitar-live-row guitar-live-${kind}`;row.setAttribute('role','row');const heading=document.createElement('span');heading.className='guitar-live-row-label';heading.textContent=label;heading.setAttribute('role','rowheader');row.append(heading);
      rows.forEach((_,i)=>{
        const string=start+i+1,cell=document.createElement('div');cell.className='guitar-live-cell';cell.dataset.string=String(string);cell.dataset.phase=kind;cell.setAttribute('role','cell');
        const choices=map.get(string)||[];
        if(!choices.length){cell.textContent='—';cell.setAttribute('aria-label',t(kind==='current'?'emptyCurrent':'emptyNext',{row:string}));}
        const positions=new Map();
        for(const choice of choices){const key=`${choice.fret}:${choice.finger}`;if(!positions.has(key))positions.set(key,[]);if(!positions.get(key).some(other=>other.occurrence_id===choice.occurrence_id))positions.get(key).push(choice);}
        for(const samePosition of positions.values()){
          const choice=samePosition[0],isHeld=samePosition.some(choice=>retained.has(choice.occurrence_id)),marker=document.createElement('span');marker.className='guitar-live-choice';
          const action=kind==='next'?(isHeld?'hold':'new'):isHeld?'hold':'release';marker.dataset.action=action;marker.dataset.occurrenceId=choice.occurrence_id;marker.dataset.occurrenceIds=JSON.stringify(samePosition.map(choice=>choice.occurrence_id));marker.dataset.sourceIds=JSON.stringify(unique(samePosition.flatMap(choice=>choice.source_note_ids||[])));marker.dataset.assignments=JSON.stringify(samePosition);marker.dataset.string=String(string);marker.dataset.fret=String(choice.fret);marker.dataset.finger=String(choice.finger);marker.dataset.startMs=String(choice.start_ms);marker.dataset.endMs=String(choice.end_ms);
          const position=document.createElement('strong');position.className='guitar-live-position';position.textContent=`${i18n.formatNumber(choice.fret)} / ${i18n.formatNumber(choice.finger)}`;
          const detail=document.createElement('span');detail.className='guitar-live-action';detail.textContent=kind==='current'&&!isHeld?t('releaseShort',{seconds:i18n.formatNumber(Math.max(...samePosition.map(choice=>choice.end_ms))/1000,{maximumFractionDigits:3})}):t(action==='release'?'releaseAction':action);
          marker.append(position,detail);marker.title=samePosition.map(choice=>choiceDescription(choice,view.profile,t('role',{position:label,action:t(retained.has(choice.occurrence_id)?'hold':kind==='current'?'releaseAction':'newAttack')}),i18n)).join(' ');marker.setAttribute('aria-label',marker.title);cell.append(marker);
        }
        row.append(cell);
      });band.append(row);
    }
    fragment.append(band);
  }
  if(!view.currentChoices.length&&!view.nextChoices.length&&!view.retainedChoices.length){const empty=document.createElement('p');empty.className='guitar-live-empty';empty.textContent=t(view.items.length?'emptyRoute':view.phase==='pending'?'pending':'emptySelection');fragment.append(empty);}
  const transition=document.createElement('p');transition.id='guitar-live-transition';transition.textContent=view.transition;transition.title=t('transitionHelp');fragment.append(transition);
  // A locale redraw updates the existing route nodes and accessible text in place.
  // The retained score choices and original route markers are not replaced.
  if(localeOnly&&root.childNodes.length===fragment.childNodes.length){
    const patch=(node,next)=>{if(node.nodeType===3){node.nodeValue=next.nodeValue;return;}for(const name of ['title','aria-label']){const value=next.getAttribute?.(name);if(value!==null&&value!==undefined)node.setAttribute(name,value);}if(node.childNodes.length!==next.childNodes.length)return;for(let i=0;i<node.childNodes.length;i++)patch(node.childNodes[i],next.childNodes[i]);};
    for(let i=0;i<root.childNodes.length;i++)patch(root.childNodes[i],fragment.childNodes[i]);
  }else root.replaceChildren(fragment);
}

/** No live region or animation: stable cards update only when displayed values change. */
export function setupGuitarGuidance(document,{i18n=getAppI18n(document)}={}) {
  const t=(key,params)=>i18n.t('guitar.runtime.'+key,params);
  const root=document.getElementById('guitar-guidance'),status=document.getElementById('guitar-guidance-state'),list=document.getElementById('guitar-guidance-items'),overflow=document.getElementById('guitar-guidance-overflow'),sources=document.getElementById('guitar-guidance-sources');
  let live=document.getElementById('guitar-live-route');
  if(!live){live=document.createElement('div');live.id='guitar-live-route';live.setAttribute('aria-label',t('liveLabel'));root.insertBefore(live,list);}
  // Rich identities, optional picking and later cards stay available without
  // competing with the complete live shape for small-landscape stage height.
  const details=sources.closest('details');
  if(details){details.insertBefore(list,sources);details.insertBefore(overflow,sources);const help=root.querySelector('.guitar-guidance-help');if(help){help.textContent=t('help');details.insertBefore(help,sources);}}
  let signature='',liveSignature='',sourceSignature='',cards=new Map(),timeline=null,index=null,lastContext=null;
  function render(context,{localeOnly=false}={}){
    lastContext=context;live.setAttribute('aria-label',t('liveLabel'));const help=root.querySelector('.guitar-guidance-help');if(help)help.textContent=t('help');
    if(context.timeline!==timeline){timeline=context.timeline;index=timeline?new TimelineIndex(timeline.notes):null;}
    const view=guitarGuidanceView({...context,index,i18n}),nextSignature=JSON.stringify([view,i18n.revision]);
    if(nextSignature===signature)return view;
    signature=nextSignature;root.dataset.phase=view.phase;status.textContent=view.state;
    const nextLive=JSON.stringify([view.profile,view.phase,view.currentChoices,view.nextChoices,view.retainedChoices,view.nextOnsetMs,view.position<view.segmentStart,view.transition,Boolean(view.items.length),i18n.revision]);
    if(nextLive!==liveSignature){liveSignature=nextLive;renderLiveRoute(document,live,view,i18n,localeOnly);}
    const nextCards=new Map();
    for(const item of view.items){
      let card=cards.get(item.id);
      if(!card){card=document.createElement('li');card.className='guitar-target';for(const name of ['pitch','time','onset','identity','route','picking','release']){const span=document.createElement(name==='pitch'?'strong':'span');span.className=`guitar-target-${name}`;card.append(span);}}
      card.dataset.targetId=item.id;card.dataset.startMs=String(item.startMs);card.dataset.durationMs=String(item.durationMs);card.dataset.sourceIds=JSON.stringify(item.sourceIds);card.dataset.occurrenceIds=JSON.stringify(item.occurrenceIds);card.dataset.phase=item.phase;
      card.querySelector('.guitar-target-pitch').textContent=item.pitch;card.querySelector('.guitar-target-time').textContent=item.time;card.querySelector('.guitar-target-onset').textContent=item.onset;
      card.querySelector('.guitar-target-identity').textContent=item.identity;
      card.querySelector('.guitar-target-route').textContent=item.route;card.querySelector('.guitar-target-picking').textContent=item.picking;card.querySelector('.guitar-target-picking').hidden=!item.picking;
      card.querySelector('.guitar-target-release').textContent=i18n.t('instrument.release',{seconds:seconds(item.endMs,i18n)});
      card.dataset.route=JSON.stringify(item.choices.map(choice=>({string:choice.string,fret:choice.fret,finger:choice.finger})));
      card.title=t('cardDescription',{kind:item.kind,id:item.id,occurrences:item.occurrenceIds.join(', '),sources:item.sourceIds.join(', '),parts:item.partIds.join(', '),duration:seconds(item.durationMs,i18n),end:seconds(item.endMs,i18n),route:item.route,picking:item.picking});
      card.setAttribute('aria-description',card.title);nextCards.set(item.id,card);
    }
    for(const[id,card]of cards)if(!nextCards.has(id))card.remove();
    let previous=null;for(const card of nextCards.values()){if(card!==(previous?previous.nextElementSibling:list.firstElementChild))list.insertBefore(card,previous?previous.nextElementSibling:list.firstElementChild);previous=card;}
    cards=nextCards;overflow.hidden=!view.additional;overflow.textContent=view.additional?t('overflow',{count:view.additional}):'';
    const nextSources=JSON.stringify([...cards.values()].map(card=>[card.dataset.startMs,card.querySelector('.guitar-target-pitch').textContent,card.title]));
    if(nextSources!==sourceSignature){sourceSignature=nextSources;sources.replaceChildren(...[...cards.values()].map(card=>{const li=document.createElement('li');li.textContent=t('sourceDescription',{pitch:card.querySelector('.guitar-target-pitch').textContent,seconds:seconds(Number(card.dataset.startMs),i18n),description:card.title});return li;}));}
    return view;
  }
  const unsubscribe=i18n.subscribe(()=>{if(lastContext)render(lastContext,{localeOnly:true});});
  render.destroy=unsubscribe;return render;
}
