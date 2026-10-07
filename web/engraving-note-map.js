import {basicKeyEngravingBoundaries,basicKeyEngravingViewVersion} from './basic-key-notation.js';
import {assertPracticeAssistanceDisplay} from './practice-assistance-display.js';
/** Verify display identity only. Rust owns every performance interval. */
import {ENGRAVING_SOURCE_LIMITS,proveEngravingProjectionModelNotes,engravingProjectionModelCoordinates} from './engraving-projection.js';
const VERSION=1,MAX_BYTES=ENGRAVING_SOURCE_LIMITS.mapBytes,MAX_SEGMENTS=ENGRAVING_SOURCE_LIMITS.notes;
const admittedPageBoundaries=new WeakMap();
const nativeAdmissions=new WeakMap();
const nativeSnapshot=validated=>JSON.stringify([validated.score,validated.segments,validated.partIdMap,[...validated.boundaryTies],[...validated.sources].map(([id,source])=>[id,source.part.id,source.note])]);
const documentSnapshot=document=>JSON.stringify(Array.from(document.childNodes).map(node=>node.nodeType===1?[1,node.outerHTML]:[node.nodeType,node.nodeName,node.nodeValue]));
function rememberNativeAdmission(document,validated,viewVersion){
  if(typeof document.documentElement.outerHTML!=='string')fail('The native source document cannot provide an immutable XML snapshot.');
  nativeAdmissions.set(validated.boundaryTies,{
    document,viewVersion,xml:documentSnapshot(document),score:validated.score,segments:validated.segments,
    segmentObjects:[...validated.segments],sources:validated.sources,partIdMap:validated.partIdMap,
    sourceObjects:[...validated.sources].map(([id,source])=>({id,source,note:source.note,part:source.part})),
    snapshot:nativeSnapshot(validated),
  });
}
function nativeAdmission(validated){
  const proof=nativeAdmissions.get(validated.boundaryTies);
  if(!proof||validated.version!==VERSION||proof.score!==validated.score||proof.segments!==validated.segments||proof.sources!==validated.sources||proof.partIdMap!==validated.partIdMap||
    proof.segmentObjects.length!==validated.segments.length||proof.segmentObjects.some((segment,index)=>segment!==validated.segments[index])||
    proof.sourceObjects.length!==validated.sources.size||proof.sourceObjects.some(item=>validated.sources.get(item.id)!==item.source||item.source.note!==item.note||item.source.part!==item.part)||
    documentSnapshot(proof.document)!==proof.xml||nativeSnapshot(validated)!==proof.snapshot)fail('The native source admission changed after validation.');
  return proof;
}
/** A copied identity or retained key with changed data cannot authorize a view. */
export function isAdmittedNativeEngravingSource(sourceDocument,validated){
  try{const proof=nativeAdmission(validated);return proof.viewVersion===2&&proof.document===sourceDocument;}catch{return false;}
}
const STEPS=['C','D','E','F','G','A','B'],NATURAL=[0,2,4,5,7,9,11];
const diagnostic=(code,message,segments=[])=>({code,message,sourceNoteIds:[...new Set(segments.map(s=>s.source_note_id))],xmlNoteIds:[...new Set(segments.map(s=>s.xml_note_id))]});
const fail=message=>{throw Error(message)};
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const rational=value=>{if(!value||!integer(value.numerator)||!integer(value.denominator,1))fail('A written-note time is not an exact supported rational.');return [BigInt(value.numerator),BigInt(value.denominator)]};
const add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]];
const sub=(a,b)=>[a[0]*b[1]-b[0]*a[1],a[1]*b[1]];
const compare=(a,b)=>a[0]*b[1]-b[0]*a[1];
const equal=(a,b)=>compare(a,b)===0n;
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){const next=a%b;a=b;b=next}return a||1n};
const fractionKey=value=>{const divisor=gcd(value[0],value[1]);return `${value[0]/divisor}/${value[1]/divisor}`};
const children=(node,name)=>Array.from(node?.children||[]).filter(child=>child.localName===name);
const one=(node,name,required=true)=>{const found=children(node,name);if(found.length>1||required&&!found.length)fail(`The generated XML has an invalid ${name} field.`);return found[0]};
function numberText(node,min=0,max=Number.MAX_SAFE_INTEGER){const text=node?.textContent?.trim();if(!/^-?\d+$/.test(text||'')||!integer(Number(text),min,max))fail('The generated XML has an invalid integer field.');return Number(text)}
function pitchKey(pitch){if(pitch===null)return 'rest';if(!pitch||!STEPS.includes(pitch.step)||!integer(pitch.alter,-2,2)||!integer(pitch.octave,-1,9))fail('A written pitch is unsupported.');return `${pitch.step}:${pitch.alter}:${pitch.octave}`}
const segmentKey=(part,measure,staff,voice,at,duration,pitch)=>JSON.stringify([part,measure,staff,voice,fractionKey(at),fractionKey(duration),pitchKey(pitch)]);
function xmlPitch(note){const rest=one(note,'rest',false),pitch=one(note,'pitch',false);if(Boolean(rest)===Boolean(pitch))fail('A generated note must be exactly one pitch or rest.');if(rest)return null;return {step:one(pitch,'step').textContent.trim(),alter:one(pitch,'alter',false)?numberText(one(pitch,'alter'),-2,2):0,octave:numberText(one(pitch,'octave'),-1,9)}}
function tieFlags(note){const flags={start:false,stop:false};for(const tie of children(note,'tie')){const type=tie.getAttribute('type');if(!Object.hasOwn(flags,type)||flags[type])fail('Generated XML tie flags are inconsistent.');flags[type]=true}const notations=one(note,'notations',false),written={start:false,stop:false};for(const tie of children(notations,'tied')){const type=tie.getAttribute('type');if(!Object.hasOwn(written,type)||written[type])fail('Generated written tie flags are inconsistent.');written[type]=true}if(flags.start!==written.start||flags.stop!==written.stop)fail('Sounding and written XML tie flags disagree.');return flags}

/** Validate the complete Rust manifest against both the source score and parsed XML. */
export function validateEngravingNoteMap(document,identity){
  try{
    if(!identity)return {ok:false,status:'not-requested',diagnostics:[]};
    const {score,noteMap,partIdMap,voiceIdMap}=identity,boundaryTies=basicKeyEngravingBoundaries(identity);
    if(!noteMap)fail('This export has no complete written-note identity map. Static notation remains available.');
    if(noteMap.version!==VERSION)fail('The written-note identity map requires a compatible renderer version.');
    if(!score||!Array.isArray(score.parts)||!Array.isArray(score.measures)||!Array.isArray(noteMap.segments)||!noteMap.segments.length||noteMap.segments.length>MAX_SEGMENTS||new TextEncoder().encode(JSON.stringify(noteMap)).byteLength>MAX_BYTES||!Array.isArray(voiceIdMap))fail('The written-note identity map is incomplete or exceeds its display limit.');
    let measureEnd = [0n, 1n];
    for (const measure of score.measures) { const start = rational(measure.at), length = rational(measure.length); if (length[0] <= 0n || !equal(start, measureEnd)) fail('Canonical measures are not contiguous exact positive intervals.'); measureEnd = add(start, length); }
    const xmlParts=children(document.documentElement,'part'),sources=new Map(),parts=new Map(),voices=new Map(),xmlVoices=new Set(),xmlIds=new Set(),coverage=new Map();
    if(xmlParts.length!==score.parts.length||!partIdMap||typeof partIdMap!=='object'||Array.isArray(partIdMap)||Object.keys(partIdMap).length!==score.parts.length)fail('The complete generated part map does not match the source score.');
    for(const part of score.parts){
      const xmlPart=Object.hasOwn(partIdMap,part.id)?partIdMap[part.id]:null;
      if(typeof part.id!=='string'||parts.has(part.id)||typeof xmlPart!=='string'||!xmlPart||xmlIds.has(xmlPart)||!xmlParts.some(node=>node.getAttribute('id')===xmlPart)||!Array.isArray(part.notes))fail('A generated part identity is missing or duplicated.');
      parts.set(part.id,part);xmlIds.add(xmlPart);
      for(const note of part.notes){if(typeof note.id!=='string'||!note.id||sources.has(note.id)||sources.size>=MAX_SEGMENTS)fail('Canonical note identities are missing, duplicated or exceed the display limit.');pitchKey(note.pitch);sources.set(note.id,{note,part});coverage.set(note.id,[])}
    }
    for(const voice of voiceIdMap){
      const key=JSON.stringify([voice.part_id,voice.staff,voice.voice,voice.lane]);
      const xmlKey=JSON.stringify([voice.part_id,voice.xml_voice]);
      if(!parts.has(voice.part_id)||!integer(voice.staff,1,8)||typeof voice.voice!=='string'||!integer(voice.lane,1,256)||typeof voice.xml_voice!=='string'||!/^[1-9]\d*$/.test(voice.xml_voice)||!integer(Number(voice.xml_voice),1,2000)||voices.has(key)||xmlVoices.has(xmlKey))fail('A generated voice identity is missing or duplicated.');
      voices.set(key,voice.xml_voice);xmlVoices.add(xmlKey);
    }
    const byXmlId=new Map(),segments=noteMap.segments,usedVoices=new Set();
    for(const segment of segments){
      const source=sources.get(segment.source_note_id),measure=score.measures[segment.source_measure_index];
      if(!source||typeof segment.xml_note_id!=='string'||!segment.xml_note_id||byXmlId.has(segment.xml_note_id)||!integer(segment.source_measure_index,0,score.measures.length-1)||!measure||segment.measure_number!==measure.number||segment.part_id!==source.part.id||segment.xml_part_id!==partIdMap[source.part.id]||segment.staff!==source.note.staff||segment.voice!==source.note.voice||voices.get(JSON.stringify([segment.part_id,segment.staff,segment.voice,segment.lane]))!==segment.xml_voice||pitchKey(segment.pitch)!==pitchKey(source.note.pitch)||typeof segment.tie_start!=='boolean'||typeof segment.tie_stop!=='boolean'||typeof segment.chord!=='boolean')fail('A written segment does not match its canonical note, part, voice or measure.');
      const at=rational(segment.at),duration=rational(segment.duration),relative=rational(segment.measure_at),start=rational(source.note.at),end=add(start,rational(source.note.duration)),measureStart=rational(measure.at),measureEnd=add(measureStart,rational(measure.length)),segmentEnd=add(at,duration);
      if(duration[0]<=0n||!equal(add(measureStart,relative),at)||compare(at,start)<0n||compare(segmentEnd,end)>0n||compare(at,measureStart)<0n||compare(segmentEnd,measureEnd)>0n||segment.tie_start!==Boolean(source.note.pitch&&(compare(segmentEnd,end)<0n||source.note.tie_start||boundaryTies?.get(source.note.id)?.outgoing))||segment.tie_stop!==Boolean(source.note.pitch&&(compare(at,start)>0n||source.note.tie_stop||boundaryTies?.get(source.note.id)?.incoming)))fail('A written segment changes source duration, measure position or tie identity.');
      byXmlId.set(segment.xml_note_id,segment);coverage.get(segment.source_note_id).push({at,end:segmentEnd});
      usedVoices.add(JSON.stringify([segment.part_id,segment.staff,segment.voice,segment.lane]));
    }
    if(usedVoices.size!==voices.size)fail('The generated voice map contains an unaccounted engraving lane.');
    for(const [id,spans]of coverage){const source=sources.get(id).note;spans.sort((a,b)=>compare(a.at,b.at)<0n?-1:compare(a.at,b.at)>0n?1:0);let next=rational(source.at);for(const span of spans){if(!equal(next,span.at))fail('Written segments omit or overlap part of a canonical note.');next=span.end}if(!equal(next,add(rational(source.at),rational(source.duration))))fail('Written segments do not retain every complete canonical note and rest.')}
    const seen=new Set();
    for(const part of xmlParts){let divisions=null;const xmlPartId=part.getAttribute('id'),measures=children(part,'measure');if(measures.length!==score.measures.length)fail('The generated XML measure count does not match the complete source.');
      for(let measureIndex=0;measureIndex<measures.length;measureIndex++){
        const measure=measures[measureIndex];let cursor=[0n,1n],previous=null;
        if(measure.getAttribute('number')!==String(score.measures[measureIndex].number))fail('A generated XML measure label does not match its ordinal source measure.');
        for(const node of Array.from(measure.children)){
          if(node.localName==='attributes'){const value=one(node,'divisions',false);if(value)divisions=numberText(value,1,1000000);continue}
          if(node.localName==='forward'||node.localName==='backup'){if(!divisions)fail('Generated XML divisions are missing.');const amount=[BigInt(numberText(one(node,'duration'),1,1000000000)),BigInt(divisions)];cursor=node.localName==='forward'?add(cursor,amount):sub(cursor,amount);if(cursor[0]<0n || compare(cursor, rational(score.measures[measureIndex].length))>0n)fail('The generated XML moves outside its measure.');previous=null;continue}
          if(node.localName!=='note')continue;
          const id=node.getAttribute('id'),segment=byXmlId.get(id);if(!segment||seen.has(id)||!divisions||node.getAttribute('print-object')==='no'||one(node,'grace',false)||one(node,'cue',false))fail('A generated XML note is missing, duplicated or unsupported for exact highlighting.');
          const chord=Boolean(one(node,'chord',false)),duration=[BigInt(numberText(one(node,'duration'),1,1000000000)),BigInt(divisions)],voice=one(node,'voice').textContent.trim(),staff=numberText(one(node,'staff'),1,8),pitch=xmlPitch(node),ties=tieFlags(node);
          if(chord&&(!previous||previous.voice!==voice||previous.staff!==staff||previous.rest||pitch===null))fail('Generated XML chord membership is inconsistent.');
          const at=chord?previous.at:cursor;
          if(segment.xml_part_id!==xmlPartId||segment.source_measure_index!==measureIndex||segment.xml_voice!==voice||segment.staff!==staff||segment.chord!==chord||!equal(rational(segment.measure_at),at)||!equal(rational(segment.duration),duration)||pitchKey(segment.pitch)!==pitchKey(pitch)||segment.tie_start!==ties.start||segment.tie_stop!==ties.stop)fail('The written-note map disagrees with the generated XML.');
          seen.add(id);previous={at,voice,staff,rest:pitch===null};if(!chord)cursor=add(at,duration);
        }
        if(!equal(cursor, rational(score.measures[measureIndex].length)))fail('The generated XML does not retain the complete source measure clock.');
      }
    }
    if(seen.size!==segments.length)fail('The complete identity map and XML note counts differ.');
    if(boundaryTies)admittedPageBoundaries.set(boundaryTies,new Map([...boundaryTies].map(([id,flags])=>[id,Object.freeze({...flags})])));
    const validated={ok:true,status:'ready',version:VERSION,segments:[...segments],sources,score,partIdMap,boundaryTies,diagnostics:boundaryTies?.size?[diagnostic('engraving_page_continuations','Open page-edge ties are verified against complete source intervals. Continuation records retain the full source duration; notation outside this page is not loaded.')]:[]};
    if(boundaryTies)rememberNativeAdmission(document,validated,basicKeyEngravingViewVersion(identity));
    return validated;
  }catch(error){return {ok:false,status:'unavailable',diagnostics:[diagnostic('engraving_note_map_unavailable',error.message)]}}
}

function modelFraction(value){if(!value||!integer(value.WholeValue)||!integer(value.Numerator)||!integer(value.Denominator,1))fail('The renderer has an unsupported written fraction.');return [4n*(BigInt(value.WholeValue)*BigInt(value.Denominator)+BigInt(value.Numerator)),BigInt(value.Denominator)]}
function modelPitch(note){if(note.isRest())return null;const pitch=note.Pitch,index=NATURAL.indexOf(pitch?.FundamentalNote);if(index<0||pitch.constructor.OctaveXmlDifference!==3)fail('The renderer has an unsupported source pitch.');const result={step:STEPS[index],alter:pitch.AccidentalHalfTones,octave:pitch.Octave+3};pitchKey(result);return result}

/** Model matching uses exact written identity; geometry never assigns a source ID. */
export function matchEngravingModel(renderer,validated,{includeContext=false}={}){
  if(!validated.ok)return {...validated,matches:[]};
  try{
    const measures=renderer.Sheet?.SourceMeasures,instruments=renderer.Sheet?.Instruments;
    const projection = validated.projection;
    const coordinates=projection?.kind==='source-bound-measure-fragments-v1'?engravingProjectionModelCoordinates(projection,validated.score):null;
    if(coordinates&&!coordinates.ok)fail('The source-bound model fragment coordinates changed after validation.');
    const sourceIndices=coordinates?coordinates.measures.map(measure=>measure.sourceMeasureIndex):projection?.sourceMeasureIndices||validated.score.measures.map((_,index)=>index);
    if(!Array.isArray(measures)||measures.length!==sourceIndices.length||new Set(measures).size!==measures.length||!Array.isArray(instruments))fail('The renderer cannot expose an exact source-measure identity table.');
    const ordinals=new Map(measures.map((measure,index)=>[measure,sourceIndices[index]])),offsets=new Map(measures.map((measure,index)=>[measure,coordinates?rational(coordinates.measures[index].offset):[0n,1n]])),notes=new Set(),index=new Map(),diagnostics=[];
    for(const measure of measures)for(const container of measure.VerticalSourceStaffEntryContainers||[])for(const staffEntry of container.StaffEntries||[])for(const voice of staffEntry?.VoiceEntries||[])for(const note of voice.Notes||[])notes.add(note);
    for(const note of notes){
      if (note.PrintObject === false) continue; // Generated timing padding has no canonical identity.
      try{const staff=note.ParentStaff,instrument=staff?.ParentInstrument,staffIndex=instrument?.Staves?.indexOf(staff),measure=ordinals.get(note.SourceMeasure),voice=note.ParentVoiceEntry?.ParentVoice?.VoiceId;
        if(!instruments.includes(instrument)||!integer(staffIndex)||!integer(measure)||!integer(voice,1,2000))continue;
        const key=segmentKey(instrument.IdString,measure,staffIndex+1,String(voice),add(modelFraction(note.ParentVoiceEntry.Timestamp),offsets.get(note.SourceMeasure)),modelFraction(note.Length),modelPitch(note));
        if(!index.has(key))index.set(key,[]);index.get(key).push(note);
      }catch{/* An unsupported model note cannot be used as an approximate match. */}
    }
    const used=new Set(),matches=[],expected=new Map(),keys=new Map(),reported=new Set();
    const matchIndices = includeContext ? sourceIndices : projection?.displayedSourceMeasureIndices || sourceIndices;
    const displayed = segment => !projection || projection.partIds.includes(segment.xml_part_id) && matchIndices.includes(segment.source_measure_index);
    for(const segment of validated.segments.filter(displayed)){const key=segmentKey(segment.xml_part_id,segment.source_measure_index,segment.staff,segment.xml_voice,rational(segment.measure_at),rational(segment.duration),segment.pitch);keys.set(segment,key);if(!expected.has(key))expected.set(key,[]);expected.get(key).push(segment)}
    for(const segment of validated.segments){if (!displayed(segment)) {matches.push({segment,note:null,reason:'not-displayed'});continue}const key=keys.get(segment),candidates=index.get(key)||[],ambiguous=expected.get(key).length!==1||candidates.length>1||used.has(candidates[0]);
      if(candidates.length!==1||ambiguous){const code=ambiguous?'engraving_note_identity_ambiguous':'engraving_note_identity_missing';if(!reported.has(key)){reported.add(key);diagnostics.push(diagnostic(code,ambiguous?'The source and renderer do not have a one-to-one written identity; no candidate was selected.':'No exact renderer note matches this segment. Rounded or missing fractions are never approximated.',expected.get(key)))}matches.push({segment,note:null,reason:code});continue}
      used.add(candidates[0]);matches.push({segment,note:candidates[0]});
    }
    return {...validated,matches,diagnostics};
  }catch(error){return {...validated,ok:false,status:'unavailable',matches:[],diagnostics:[diagnostic('engraving_model_unavailable',error.message)]}}
}

/**
 * The pinned reader drops an entire chain when its first stop+start is an
 * explicitly admitted incoming page continuation. Rebuild only that proven
 * within-page chain from its existing exact Note objects. No outside note,
 * XML flag, pitch, duration, or general missing tie is invented or replaced.
 */
export function restoreSourceBoundPageTies(renderer,validated,Tie,types,limits){
  if(validated.boundaryTies){try{nativeAdmission(validated);}catch{return {ok:false,key:'tieContext'};}}
  if(nativeAdmissions.get(validated.boundaryTies)?.viewVersion===2)return reconstructNativeRenditionTies(renderer,validated,Tie,types,limits);
  const collision=restoreSourceBoundAccidentalCollisions(renderer,validated,Tie,types);
  if(!collision.ok)return collision;
  const chains=validated.projection?.tieChains||[];
  if(!validated.ok||!validated.boundaryTies?.size||!chains.length)return collision;
  const boundaries=admittedPageBoundaries.get(validated.boundaryTies);
  if(!boundaries)return {ok:false,key:'tieContext'};
  const matched=matchEngravingModel(renderer,validated,{includeContext:true});
  if(!matched.ok||matched.diagnostics.length)return {ok:false,key:'tieContext'};
  const byId=new Map(matched.matches.map(match=>[match.segment.xml_note_id,match]));
  const repairs=[];
  for(const chain of chains){
    const matches=chain.map(id=>byId.get(id)),first=matches[0]?.segment;
    if(!first||!boundaries.get(first.source_note_id)?.incoming||!first.tie_stop)continue;
    const sourceRecord=validated.sources.get(first.source_note_id),source=sourceRecord?.note;
    if(!source||!equal(rational(first.at),rational(source.at)))continue;
    if(matches.length<2||new Set(matches.map(match=>match?.note)).size!==matches.length||matches.some((match,index)=>{
      const segment=match?.segment,previous=matches[index-1]?.segment;
      return !match?.note||!segment.pitch||segment.source_note_id!==first.source_note_id||segment.part_id!==sourceRecord.part.id||
        segment.staff!==source.staff||segment.voice!==source.voice||segment.xml_voice!==first.xml_voice||segment.lane!==first.lane||
        pitchKey(segment.pitch)!==pitchKey(source.pitch)||!segment.tie_stop||
        (index<matches.length-1&&!segment.tie_start)||
        (previous&&!equal(add(rational(previous.at),rational(previous.duration)),rational(segment.at)));
    }))return {ok:false,key:'tieContext'};
    const last=matches.at(-1).segment;
    if(!equal(add(rational(last.at),rational(last.duration)),add(rational(source.at),rational(source.duration))))return {ok:false,key:'tieContext'};
    // Existing or partially populated ties still face the ordinary strict
    // membership check. This path only addresses the reader's all-missing case.
    if(matches.some(match=>match.note.NoteTie))continue;
    repairs.push(matches.map(match=>match.note));
  }
  if(repairs.length&&(typeof Tie!=='function'||types?.SIMPLE!==''))return {ok:false,key:'tieContext'};
  try{
    for(const notes of repairs){const tie=new Tie(notes[0],types.SIMPLE);for(const note of notes.slice(1))tie.AddNote(note);}
  }catch{return {ok:false,key:'tieContext'};}
  return {ok:true,restored:collision.restored+repairs.length};
}

/** Native v2 source intervals own this graph; the parser's old ties do not. */
function reconstructNativeRenditionTies(renderer,validated,Tie,types,limits){
  let saved;
  try{
    const admission=nativeAdmission(validated),boundaries=admittedPageBoundaries.get(validated.boundaryTies);
    if(admission.viewVersion!==2||!boundaries||!limits||!integer(limits.notes,1,2000)||typeof Tie!=='function'||types?.SIMPLE!=='')fail('Unsupported native tie model.');
    // Native basic-key XML carries plain source-derived ties, without authored
    // tie-number/direction/slide semantics that this adapter could erase.
    for(const element of admission.document.querySelectorAll('tie,tied'))if(Array.from(element.attributes).some(attribute=>attribute.name!=='type'))fail('Authored tie styling is not a native interval.');
    if(admission.document.querySelector('slide,glissando,hammer-on,pull-off'))fail('Non-simple authored ties cannot be reconstructed.');
    const inventory=proveEngravingProjectionModelNotes(renderer.Sheet,validated.projection,validated.score,limits);
    if(!inventory.ok||inventory.sourceDocument!==admission.document||!Array.isArray(inventory.notes))fail('The full native model was not independently proved.');
    const model=new Set(inventory.notes);
    if(model.size!==inventory.notes.length)fail('Duplicate model note ownership.');
    const matched=matchEngravingModel(renderer,validated,{includeContext:true});
    if(!matched.ok||matched.diagnostics.length)fail('Native segments need unique exact model identities.');
    const selectedParts=new Set(validated.projection.partIds),selectedMeasures=new Set(validated.projection.sourceMeasureIndices),groups=new Map(),visible=new Set();
    for(const match of matched.matches){
      const segment=match.segment,selected=selectedParts.has(segment.xml_part_id)&&selectedMeasures.has(segment.source_measure_index);
      if(!selected){if(match.note)fail('Unexpected off-view model binding.');continue;}
      const note=match.note,source=validated.sources.get(segment.source_note_id);
      if(!note||!model.has(note)||visible.has(note)||note.PrintObject!==true||note.IsGraceNote||note.IsCueNote||!source)fail('A visible source note is missing, duplicated or hidden.');
      const canonical=source.note,pitch=canonical.pitch;
      if(canonical.voice!=='1'||canonical.staff!==1||canonical.tie_start!==false||canonical.tie_stop!==false||!pitch)fail('Only native basic-key interval semantics may define this graph.');
      const midi=(pitch.octave+1)*12+NATURAL[STEPS.indexOf(pitch.step)]+pitch.alter;
      const steps=['C','C','D','D','E','F','F','G','G','A','A','B'],alters=[0,1,0,1,0,0,1,0,1,0,1,0];
      if(!integer(midi,0,127)||pitch.step!==steps[midi%12]||pitch.alter!==alters[midi%12]||pitch.octave!==Math.floor(midi/12)-1)fail('Native nominal pitch spelling changed.');
      if(segment.part_id!==source.part.id||segment.staff!==canonical.staff||segment.voice!==canonical.voice||pitchKey(segment.pitch)!==pitchKey(pitch))fail('A native segment changed its source identity.');
      visible.add(note);
      if(!groups.has(segment.source_note_id))groups.set(segment.source_note_id,{source,items:[]});
      groups.get(segment.source_note_id).items.push({segment,note});
    }
    // Unlike expected-segment matching alone, every actual Note must be owned:
    // visible source notes are a bijection, and only proved padding is hidden.
    for(const note of inventory.notes)if(note.PrintObject===true?!visible.has(note):note.PrintObject!==false||!note.isRest()||visible.has(note))fail('An extra, unsupported or hidden pitched model note exists.');
    const chains=[];
    for(const [id,group]of groups){
      const source=group.source.note,flags=boundaries.get(id)||{incoming:false,outgoing:false};
      group.items.sort((left,right)=>{const order=compare(rational(left.segment.at),rational(right.segment.at));return order<0n?-1:order>0n?1:0;});
      let next=rational(source.at);const first=group.items[0].segment;
      for(const [index,item]of group.items.entries()){
        const segment=item.segment,duration=rational(segment.duration);
        if(duration[0]<=0n||!equal(rational(segment.at),next)||segment.xml_voice!==first.xml_voice||segment.lane!==first.lane||
          segment.tie_stop!==(index>0||flags.incoming)||segment.tie_start!==(index+1<group.items.length||flags.outgoing))fail('Source coverage or a page boundary is unproved.');
        next=add(next,duration);
      }
      if(!equal(next,add(rational(source.at),rational(source.duration))))fail('The loaded model lacks a complete clipped source interval.');
      if(group.items.length>1)chains.push(group.items.map(item=>item.note));
    }
    const chained=new Set(chains.flat()),partitionMatches=()=>{
      for(const notes of chains){const tie=notes[0].NoteTie;if(!tie||tie.Type!==types.SIMPLE||!Array.isArray(tie.Notes)||tie.Notes.length!==notes.length||notes.some((note,index)=>note.NoteTie!==tie||tie.Notes[index]!==note))return false;}
      return inventory.notes.every(note=>chained.has(note)||note.NoteTie==null);
    };
    // A parser relation may be incomplete or wrong, but it cannot introduce a
    // foreign object outside the independently proved actual model inventory.
    const priorTies=new Set();
    for(const note of inventory.notes){const tie=note.NoteTie;if(tie==null||priorTies.has(tie))continue;priorTies.add(tie);if(typeof tie!=='object'||tie.Type!==types.SIMPLE||!Array.isArray(tie.Notes)||tie.Notes.length>limits.notes||tie.Notes.some(member=>!model.has(member)))fail('An old tie has unsupported semantics or an off-model member.');}
    const verifyResult=()=>{
      nativeAdmission(validated);
      const after=proveEngravingProjectionModelNotes(renderer.Sheet,validated.projection,validated.score,limits);
      if(!after.ok||after.sourceDocument!==admission.document||after.notes.length!==inventory.notes.length||after.notes.some(note=>!model.has(note))||
        !partitionMatches()||!validateEngravingModelTies(renderer,validated).ok)fail('The complete native tie transaction failed its postconditions.');
    };
    if(partitionMatches()){
      verifyResult();
      return {ok:true,restored:0};
    }
    saved=new Map(inventory.notes.map(note=>[note,note.NoteTie]));
    for(const note of inventory.notes)note.NoteTie=undefined;
    for(const notes of chains){const tie=new Tie(notes[0],types.SIMPLE);for(const note of notes.slice(1))tie.AddNote(note);}
    verifyResult();
    return {ok:true,restored:chains.length};
  }catch{
    if(saved)for(const [note,tie]of saved)note.NoteTie=tie;
    return {ok:false,key:'tieContext'};
  }
}

/** Pinned-reader fingerprint: staff-global natural-pitch lookup ignores alter. */
function restoreSourceBoundAccidentalCollisions(renderer,validated,Tie,types){
  const unchanged=()=>({ok:true,restored:0}),refused=()=>({ok:false,key:'tieContext'});
  if(!validated.ok||!admittedPageBoundaries.has(validated.boundaryTies))return unchanged();
  const chains=validated.projection?.tieChains||[];
  if(chains.length<2)return unchanged();
  const matched=matchEngravingModel(renderer,validated,{includeContext:true});
  if(!matched.ok||matched.diagnostics.length)return refused();
  const byId=new Map(matched.matches.map(match=>[match.segment.xml_note_id,match])),groups=[],owner=new Map();
  for(const chain of chains){
    const matches=chain.map(id=>byId.get(id)),first=matches[0]?.segment,source=validated.sources.get(first?.source_note_id);
    if(!source||matches.length<2||!equal(rational(first.at),rational(source.note.at)))return unchanged();
    for(let index=0;index<matches.length;index++){
      const match=matches[index],segment=match?.segment,prior=matches[index-1]?.segment;
      if(!match?.note||owner.has(match.note)||!segment.pitch||segment.source_note_id!==first.source_note_id||segment.part_id!==source.part.id||
        segment.staff!==source.note.staff||segment.voice!==source.note.voice||segment.xml_voice!==first.xml_voice||segment.lane!==first.lane||
        pitchKey(segment.pitch)!==pitchKey(source.note.pitch)||(prior&&(!prior.tie_start||!segment.tie_stop||!equal(add(rational(prior.at),rational(prior.duration)),rational(segment.at)))))return unchanged();
      owner.set(match.note,groups.length);
    }
    const last=matches.at(-1).segment;
    if(!equal(add(rational(last.at),rational(last.duration)),add(rational(source.note.at),rational(source.note.duration))))return unchanged();
    groups.push({first,notes:matches.map(match=>match.note)});
  }
  const correct=group=>{const tie=group.notes[0].NoteTie;return tie&&Array.isArray(tie.Notes)&&tie.Notes.length===group.notes.length&&group.notes.every((note,index)=>note.NoteTie===tie&&tie.Notes[index]===note);};
  const handled=new Set(),repairs=[];
  for(let seed=0;seed<groups.length;seed++){
    if(handled.has(seed)||correct(groups[seed])||groups[seed].notes.every(note=>!note.NoteTie))continue;
    const members=new Set(),ties=new Set(),queue=[seed];
    while(queue.length){
      const index=queue.pop();if(members.has(index))continue;members.add(index);
      for(const note of groups[index].notes){
        const tie=note.NoteTie;
        if(!tie||!Array.isArray(tie.Notes)||tie.Notes.length<2||new Set(tie.Notes).size!==tie.Notes.length||tie.Type!==types?.SIMPLE)return unchanged();
        ties.add(tie);
        for(const member of tie.Notes){if(member.NoteTie!==tie||!owner.has(member))return unchanged();queue.push(owner.get(member));}
      }
    }
    if(members.size<2||ties.size!==members.size)return unchanged();
    const expected=new Set([...members].flatMap(index=>groups[index].notes)),actual=new Set([...ties].flatMap(tie=>tie.Notes));
    if(expected.size!==actual.size||[...expected].some(note=>!actual.has(note)))return unchanged();
    const signatures=new Set([...members].map(index=>{const segment=groups[index].first;return JSON.stringify([segment.xml_part_id,segment.staff,segment.pitch.step,segment.pitch.octave]);}));
    if(signatures.size!==1||new Set([...members].map(index=>groups[index].first.pitch.alter)).size<2)return unchanged();
    // Every wrong tie must exhibit the known different-alter collision. A
    // merely similar malformed/partial/extra-note graph is never repaired.
    if([...ties].some(tie=>new Set(tie.Notes.map(note=>groups[owner.get(note)].first.pitch.alter)).size<2))return unchanged();
    for(const index of members){handled.add(index);repairs.push(groups[index].notes);}
  }
  if(!repairs.length)return unchanged();
  if(typeof Tie!=='function'||types?.SIMPLE!=='')return refused();
  const prior=new Map(repairs.flat().map(note=>[note,note.NoteTie]));
  try{
    // All source, membership and collision checks finish before this synchronous
    // transaction. A constructor failure restores every previous model pointer.
    for(const notes of repairs){const tie=new Tie(notes[0],types.SIMPLE);for(const note of notes.slice(1))tie.AddNote(note);}
    if(repairs.some(notes=>{const tie=notes[0].NoteTie;return !tie||tie.Notes.length!==notes.length||notes.some((note,index)=>note.NoteTie!==tie||tie.Notes[index]!==note);}))throw Error('Incomplete exact tie transaction');
  }catch{for(const [note,tie]of prior)note.NoteTie=tie;return refused();}
  return {ok:true,restored:repairs.length};
}

/** XML flags alone do not prove the pinned reader retained a visible tie. */
export function validateEngravingModelTies(renderer, validated) {
  const chains = validated.projection?.tieChains || [];
  if (!chains.length) return {ok:true};
  const matched = matchEngravingModel(renderer, validated, {includeContext:true});
  if (!matched.ok) return {ok:false,key:'tieContext'};
  const byId = new Map(matched.matches.map(match => [match.segment.xml_note_id, match.note]));
  for (const chain of chains) {
    const notes = chain.map(id => byId.get(id)), tie = notes[0]?.NoteTie;
    if (notes.some(note => !note) || !tie || !Array.isArray(tie.Notes) || tie.Notes.length !== notes.length ||
        notes.some((note, index) => note.NoteTie !== tie || tie.Notes[index] !== note)) return {ok:false,key:'tieContext'};
  }
  return {ok:true};
}

function visibleGlyph(group,mount){
  const view=mount.ownerDocument?.defaultView;
  if(!mount.contains(group)||!group.isConnected||typeof view?.getComputedStyle!=='function')return false;
  for(let element=group;element;element=element.parentElement){const style=view.getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;if(element===mount)return true}
  return false;
}
function paintedPath(path,mount){
  if(!visibleGlyph(path,mount))return false;
  const fill=mount.ownerDocument.defaultView.getComputedStyle(path).fill;
  return fill!=='none'&&fill!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(fill||'');
}
function headFor(note,renderer,mount){
  const graphical=renderer.EngravingRules?.GNote?.(note);
  if(!graphical||graphical.sourceNote!==note||note.PrintObject!==true||note.IsGraceNote||note.IsCueNote||note.Notehead||graphical.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.isMultiRestMeasure?.())fail('This note has no supported individual ordinary staff glyph.');
  const vf=graphical.vfnote?.[0],index=graphical.vfnoteIndex,heads=graphical.getNoteheadSVGs?.(),modelHeads=vf?.note_heads;
  if(!integer(index)||graphical.vfnote?.[1]!==index||!Array.isArray(heads)||!Array.isArray(modelHeads)||!heads.length||heads.length!==modelHeads.length||index>=heads.length||graphical.notehead?.()!==modelHeads[index]||vf.getAttribute?.('el')!==graphical.getSVGGElement?.())fail('The pinned chord-head index relationship could not be verified.');
  if(!note.isRest()&&(!Array.isArray(vf.keys)||vf.keys[index]!==graphical.vfpitch?.[0]))fail('The rendered chord key does not match its graphical note index.');
  const group=heads[index],parent=graphical.getVFNoteSVG?.();
  if(!group?.classList?.contains('vf-notehead')||group.parentElement!==parent||!visibleGlyph(group,mount))fail('The notehead is hidden or belongs to another render.');
  const paths=Array.from(group.children||[]),box=group.getBoundingClientRect();
  if(!paths.length||paths.some(path=>path.localName!=='path'||path.getAttribute('fill')==='none'||path.getAttribute('fill')==='transparent')||!['x','y','width','height'].every(key=>Number.isFinite(box[key]))||box.width<=0||box.height<=0)fail('This notehead shape cannot be marked without changing its meaning.');
  if(!paths.every(path=>paintedPath(path,mount)))fail('A transparent notehead must remain hidden.');
  return {group,parent,paths,box};
}

// One cooperative cue batch per document, shared by every part renderer. Hidden
// future cues must not turn four sequential note updates into read/write/read
// layout barriers. No task may visit more than 32 entries, including stale skips.
// The 4ms read budget yields after the current indivisible glyph measurement.
const cuePreparationQueues=new WeakMap(),CUE_PREPARATION_BATCH=32,CUE_PREPARATION_MS=4;
function prepareCueGeometry(document,step){
  const view=document.defaultView;
  if(!['requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'].every(key=>typeof view?.[key]==='function'))return()=>{};
  let queue=cuePreparationQueues.get(document);
  if(!queue){
    const jobs=new Set();let frame=null,timer=null;
    const now=()=>typeof view.performance?.now==='function'?view.performance.now():Date.now();
    const schedule=()=>{
      if(!jobs.size||frame!==null||timer!==null)return;
      frame=view.requestAnimationFrame(()=>{
        frame=null;
        timer=view.setTimeout(()=>{
          timer=null;
          const job=jobs.values().next().value;
          if(job){jobs.delete(job);let pending=false;try{pending=job(CUE_PREPARATION_BATCH,now()+CUE_PREPARATION_MS,now);}catch{/* Optional geometry cannot interrupt playback. */}if(pending)jobs.add(job);}
          schedule();
        },0);
      });
    };
    queue={add(job){jobs.add(job);schedule();},remove(job){jobs.delete(job);if(!jobs.size){if(frame!==null)view.cancelAnimationFrame(frame);if(timer!==null)view.clearTimeout(timer);frame=null;timer=null;}}};
    cuePreparationQueues.set(document,queue);
  }
  queue.add(step);return()=>queue.remove(step);
}

/** Bind only verified current-render glyphs. No update below invokes OSMD.render(). */
export function createEngravingNoteBindings(renderer,mount,validated,{fromMeasure,toMeasure,partIds,color,cueColor,onChange=()=>{}}){
  const matched=matchEngravingModel(renderer,validated),entries=[],diagnostics=[],snapshots=new Map(),allowedByMeasure=new Map();let disposed=false,invalidated=false,current=new Set(),currentRequest=null,inputDiagnostic=null,cueLayer=null,cueEpoch=0,stopCuePreparation=null,practiceHumans=null,practiceOwnership=null;
  for(const segment of validated.segments||[]){if(!allowedByMeasure.has(segment.source_measure_index))allowedByMeasure.set(segment.source_measure_index,new Set());allowedByMeasure.get(segment.source_measure_index).add(segment.source_note_id)}
  if(!matched.ok)diagnostics.push(...matched.diagnostics);
  else{const displayedIds=new Set(validated.segments.filter(segment=>partIds.includes(segment.xml_part_id)&&segment.source_measure_index>=fromMeasure-1&&segment.source_measure_index<=toMeasure-1).map(segment=>segment.xml_note_id));diagnostics.push(...matched.diagnostics.filter(item=>item.xmlNoteIds.some(id=>displayedIds.has(id))))}
  const candidates=matched.ok?matched.matches:validated.ok?validated.segments.map(segment=>({segment,note:null,reason:'engraving_model_unavailable'})):[];
  for(const item of candidates||[]){
    const {segment,note}=item,entry={...item,status:'not-displayed',reason:null,glyph:null};entries.push(entry);
    if(!partIds.includes(segment.xml_part_id)||segment.source_measure_index<fromMeasure-1||segment.source_measure_index>toMeasure-1)continue;
    entry.status='unavailable';
    if(!note){entry.reason=item.reason;continue}
    try{entry.glyph=headFor(note,renderer,mount);entry.status='bound'}catch(error){entry.reason='engraving_glyph_unavailable';diagnostics.push(diagnostic(entry.reason,error.message,[segment]))}
  }
  // Distinct source identities can share one DOM head or be visually coincident
  // unisons. Geometry only vetoes an ambiguous visual result; it never assigns ID.
  const shared=new Map(),byHead=new Map(),byPosition=new Map();
  const join=(left,right)=>{if(!shared.has(left))shared.set(left,new Set([left]));if(!shared.has(right))shared.set(right,new Set([right]));shared.get(left).add(right);shared.get(right).add(left)};
  for(const entry of entries){if(entry.status!=='bound')continue;const s=entry.segment;
    for(const other of byHead.get(entry.glyph.group)||[])join(entry,other);
    if(!byHead.has(entry.glyph.group))byHead.set(entry.glyph.group,[]);byHead.get(entry.glyph.group).push(entry);
    const key=JSON.stringify([s.xml_part_id,s.source_measure_index,s.staff,fractionKey(rational(s.measure_at))]);
    for(const other of byPosition.get(key)||[])if(['x','y','width','height'].every(axis=>Math.abs(entry.glyph.box[axis]-other.glyph.box[axis])<0.5))join(entry,other);
    if(!byPosition.has(key))byPosition.set(key,[]);byPosition.get(key).push(entry);
  }
  const visited=new Set();
  for(const start of shared.keys()){if(visited.has(start))continue;const group=[],queue=[start];while(queue.length){const entry=queue.pop();if(visited.has(entry))continue;visited.add(entry);group.push(entry);queue.push(...shared.get(entry)||[])}for(const entry of group){entry.status='unavailable';entry.reason='engraving_shared_glyph'}diagnostics.push(diagnostic('engraving_shared_glyph','These written segments share an indistinguishable notehead. Their complete source set is retained; no individual head is guessed.',group.map(entry=>entry.segment)))}
  for(const entry of entries)if(entry.status==='bound')for(const path of entry.glyph.paths)if(!snapshots.has(path))snapshots.set(path,{present:path.hasAttribute('fill'),fill:path.getAttribute('fill')});
  // Separate presentation markers never change a musical glyph's shape, style,
  // bounding box or identity. Fit/resize can change SVG paint without rebinding
  // its model, so owned presentation markers have an explicit geometry refresh.
  function prepareCues(){
    if(cueLayer||!entries.some(entry=>entry.status==='bound'))return;
    const origin=mount.getBoundingClientRect();cueLayer=mount.ownerDocument.createElement('div');cueLayer.className='engraving-expected-cues';cueLayer.setAttribute('aria-hidden','true');cueLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:visible';
    for(const entry of entries)if(entry.status==='bound'){
      const box=entry.glyph.box,cue=mount.ownerDocument.createElement('span');cue.className='engraving-expected-cue';cue.hidden=true;
      cue.dataset.sourceNoteId=entry.segment.source_note_id;cue.dataset.xmlNoteId=entry.segment.xml_note_id;cue.dataset.sourceMeasureIndex=String(entry.segment.source_measure_index);
      cue.style.cssText=`position:absolute;box-sizing:border-box;left:${box.x-origin.x-3}px;top:${box.y-origin.y-3}px;width:${box.width+6}px;height:${box.height+6}px;border:2px solid ${cueColor||'#17251d'};border-radius:3px;pointer-events:none`;
      entry.cue=cue;entry.cueEpoch=cueEpoch;entry.cueUsable=true;cueLayer.append(cue);
    }
    mount.append(cueLayer);
  }
  if(cueColor)prepareCues();
  const summary=()=>{
    const displayed=entries.filter(entry=>entry.status!=='not-displayed'),bound=displayed.filter(entry=>entry.status==='bound'),allDiagnostics=inputDiagnostic?[...diagnostics,inputDiagnostic]:diagnostics;
    return {status:disposed?'unavailable':!validated.ok?validated.status:inputDiagnostic||!matched.ok?'unavailable':bound.length===displayed.length?'ready':bound.length?'partial':'unavailable',version:VERSION,segmentCount:validated.segments?.length||0,displayedSegmentCount:displayed.length,verifiedGlyphCount:new Set(bound.map(entry=>entry.glyph.group)).size,bindings:entries.map(entry=>({xmlNoteId:entry.segment.xml_note_id,sourceNoteId:entry.segment.source_note_id,sourceMeasureIndex:entry.segment.source_measure_index,status:entry.status,...(entry.reason?{reason:entry.reason}:{})})),diagnostics:allDiagnostics.map(item=>({...item,sourceNoteIds:[...item.sourceNoteIds],xmlNoteIds:[...item.xmlNoteIds]}))};
  };
  const notify=()=>{try{onChange(summary())}catch{/* Presentation listeners cannot acquire glyph ownership. */}};
  const restore=path=>{const original=snapshots.get(path);if(original?.present)path.setAttribute('fill',original.fill);else path.removeAttribute('fill')};
  function ownedBox(entry){
    const {group,parent,paths}=entry.glyph;
    const intact=group.parentElement===parent&&group.children.length===paths.length&&visibleGlyph(group,mount)&&paths.every(path=>path.parentElement===group&&paintedPath(path,mount));
    const box=intact?group.getBoundingClientRect():null;
    return box&&['x','y','width','height'].every(key=>Number.isFinite(box[key]))&&box.width>0&&box.height>0?box:null;
  }
  function placeCue(entry,box,origin){
    if(!entry.cue)return;
    entry.cueEpoch=cueEpoch;entry.cueUsable=Boolean(box);
    if(!box){if(!entry.cue.hidden)entry.cue.hidden=true;if(entry.roleCue)entry.roleCue.hidden=true;return;}
    const values={left:box.x-origin.x-3,top:box.y-origin.y-3,width:box.width+6,height:box.height+6};
    for(const [key,value]of Object.entries(values)){const text=`${value}px`;if(entry.cue.style[key]!==text)entry.cue.style[key]=text;}
    const hidden=!current.has(entry);if(entry.cue.hidden!==hidden)entry.cue.hidden=hidden;
    if(entry.roleCue){for(const [key,value]of Object.entries(values))entry.roleCue.style[key]=`${value}px`;entry.roleCue.hidden=false;}
  }
  function cueOrigin(){
    const box=mount.getBoundingClientRect();
    return{x:box.x+(mount.clientLeft||0)-(mount.scrollLeft||0),y:box.y+(mount.clientTop||0)-(mount.scrollTop||0)};
  }
  function refreshExpectedCueGeometry(){
    if(disposed||invalidated||!cueLayer)return false;
    // Adoption and fitting invalidate all cue coordinates, but hidden future
    // cues need no layout work. Recheck their exact owned glyphs on first use.
    // A prepared page with no current notes therefore performs no geometry reads.
    cueEpoch++;
    stopCuePreparation?.();
    const epoch=cueEpoch;let cursor=0;
    stopCuePreparation=prepareCueGeometry(mount.ownerDocument,(limit,deadline,now)=>{
      if(disposed||invalidated||cueEpoch!==epoch)return false;
      const measured=[];let origin=null,readOrigin=false,visited=0;
      while(cursor<entries.length&&visited++<limit){
        const entry=entries[cursor++];
        if(entry.cue&&entry.status==='bound'&&entry.cueEpoch!==epoch){
          if(!readOrigin){readOrigin=true;try{origin=cueOrigin();}catch{}}
          let box=null;try{if(origin)box=ownedBox(entry);}catch{}measured.push({entry,box});
        }
        if(disposed||invalidated||cueEpoch!==epoch)return false;
        if(now()>=deadline)break;
      }
      if(measured.length){
        // The whole batch is read before a single cue is changed. Ownership,
        // visibility and future positions come from the real glyphs, not scale
        // inference. Current membership is consulted only when writing cues.
        if(disposed||invalidated||cueEpoch!==epoch)return false;
        // A speculative failure must remain stale: an actual attack may retry
        // after a temporary hidden surface or unavailable layout has recovered.
        for(const {entry,box}of measured){if(box)placeCue(entry,box,origin);else if(!entry.cue.hidden)entry.cue.hidden=true;}
      }
      return cursor<entries.length;
    });
    if(!current.size)return true;
    const origin=cueOrigin();
    // Read current geometry before writing any presentation style.
    // Alternating reads and writes forces one synchronous layout per source note.
    const measured=[...current].filter(entry=>entry.cue).map(entry=>({entry,box:ownedBox(entry)}));
    for(const {entry,box}of measured)placeCue(entry,box,origin);
    return true;
  }
  function clear(announce=true){for(const entry of current){for(const path of entry.glyph.paths)restore(path);if(entry.cue)entry.cue.hidden=true}current.clear();currentRequest=null;const changed=Boolean(inputDiagnostic);inputDiagnostic=null;if(changed&&!disposed&&announce)notify()}
  function reject(){const alreadyRejected=Boolean(inputDiagnostic);clear(false);inputDiagnostic=diagnostic('engraving_expected_notes_invalid','Current written-note identities do not match this score and measure. Highlighting is cleared; playback is unchanged.');if(!alreadyRejected)notify();return false}
  function clearRoles(){for(const entry of entries)if(entry.status==='bound'){entry.roleCue?.remove();entry.roleCue=null;const group=entry.glyph.group;group.removeAttribute('data-practice-role');group.removeAttribute('data-practice-part-id');group.removeAttribute('data-practice-machine-retained');}}
  function setPracticeAssistance(value){
    clear();clearRoles();practiceOwnership=null;practiceHumans=value?.assistance?new Set():null;
    if(!value?.assistance)return;
    const ownership=assertPracticeAssistanceDisplay(value.assistance,value.ownershipIndex);
    const displayed=entries.filter(entry=>entry.status==='bound');
    const roles=displayed.map(entry=>entry.segment.pitch===null?'rest':ownership.sourceRole(entry.segment.source_note_id,entry.segment.part_id));
    if(roles.some(role=>!role))throw Object.assign(new TypeError('A written glyph has no current source-unit ownership.'),{code:'practice_assistance_display_identity'});
    prepareCues();practiceOwnership=ownership;practiceHumans=null;
    for(const [index,entry]of displayed.entries()){
      const role=roles[index],group=entry.glyph.group;group.setAttribute('data-practice-role',role);group.setAttribute('data-practice-part-id',entry.segment.part_id);
      if(role!=='machine')continue;
      // Only noteheads are individually proved here. Stems, flags, accidentals
      // and beams can be shared with a human chord member. Keep the full source
      // notation, with a visible role cue; the view discloses this restriction.
      if(value.showMachine===false)group.setAttribute('data-practice-machine-retained','true');
      if(entry.cue){
        const cue=entry.cue.cloneNode(false);cue.className='engraving-machine-cue';cue.style.borderStyle='dashed';cue.style.borderColor='var(--skin-machine-fill, #8a91ac)';cue.hidden=false;cue.dataset.practiceRole='machine';entry.roleCue=cue;cueLayer.append(cue);
      }
    }
  }
  return {
    mappingStatus:summary,
    setPracticeAssistance,
    setPracticePartIds(ids){clear();clearRoles();practiceOwnership=null;const human=ids===null?null:new Set(ids);practiceHumans=human;for(const entry of entries)if(entry.status==='bound'){const group=entry.glyph.group;if(!mount.contains(group)||!group.isConnected)continue;if(human){group.setAttribute('data-practice-role',human.has(entry.segment.part_id)?'human':'machine');group.setAttribute('data-practice-part-id',entry.segment.part_id);}}},
    refreshExpectedCueGeometry,
    expectedNoteBounds(){
      if(disposed||invalidated||!currentRequest)return {status:'unavailable',rects:[],unavailableSourceNoteIds:[]};
      const rects=[],found=new Set(),origin=cueLayer?cueOrigin():null;
      const measured=[...current].map(entry=>({entry,box:ownedBox(entry)}));
      for(const {entry,box}of measured){
        // Reuse the exact owned nodes, never search for a replacement glyph.
        // A detached/reparented head or replaced/hidden path is not evidence for
        // scrolling, even when the old group itself still has a nonempty box.
        if(entry.cue)placeCue(entry,box,origin);
        if(!box)continue;
        found.add(entry.segment.xml_note_id);
        const margin=entry.cue?3:0;
        rects.push({sourceNoteId:entry.segment.source_note_id,xmlNoteId:entry.segment.xml_note_id,sourceMeasureIndex:entry.segment.source_measure_index,left:box.x-margin,top:box.y-margin,right:box.x+box.width+margin,bottom:box.y+box.height+margin,width:box.width+2*margin,height:box.height+2*margin});
      }
      const unavailableSourceNoteIds=currentRequest.sourceNoteIds.filter(id=>entries.some(entry=>entry.segment.source_note_id===id&&entry.segment.source_measure_index===currentRequest.sourceMeasureIndex&&!found.has(entry.segment.xml_note_id)));
      return {status:!rects.length?'unavailable':unavailableSourceNoteIds.length?'partial':'ready',rects,unavailableSourceNoteIds};
    },
    clearExpectedWrittenNotes(){if(disposed)return false;clear();return true},
    setExpectedWrittenNotes(value){
      if(disposed||invalidated)return false;
      const ids=value?.sourceNoteIds,measure=value?.sourceMeasureIndex;
      if(!validated.ok||!matched.ok){clear();return false}
      if(!Array.isArray(ids)||!integer(measure,0,validated.score.measures.length-1)||ids.some(id=>typeof id!=='string'||!validated.sources.has(id))||new Set(ids).size!==ids.length||ids.some(id=>!allowedByMeasure.get(measure)?.has(id)))return reject();
      if(inputDiagnostic){inputDiagnostic=null;notify()}
      const wanted=new Set(ids),next=new Set(entries.filter(entry=>entry.status==='bound'&&(practiceOwnership?practiceOwnership.isHumanSource(entry.segment.source_note_id,entry.segment.part_id):!practiceHumans||practiceHumans.has(entry.segment.part_id))&&entry.segment.source_measure_index===measure&&wanted.has(entry.segment.source_note_id)));
      if([...next].some(entry=>!mount.contains(entry.glyph.group)||!entry.glyph.group.isConnected)){clear(false);invalidated=true;const old=entries.filter(entry=>entry.status==='bound');for(const entry of old){entry.status='unavailable';entry.reason='engraving_glyph_stale'}diagnostics.push(diagnostic('engraving_glyph_stale','The rendered noteheads changed. Highlighting is cleared until the display is rebuilt.',old.map(entry=>entry.segment)));notify();return false}
      const stale=[...next].filter(entry=>entry.cue&&entry.cueEpoch!==cueEpoch);let origin=null;
      // Optional presentation geometry must not throw into the playback update.
      // An unreadable new cue stays hidden until a later geometry refresh.
      try{if(stale.length)origin=cueOrigin();}catch{}
      const measured=stale.map(entry=>{let box=null;try{if(origin)box=ownedBox(entry)}catch{}return{entry,box};});
      for(const entry of current)if(!next.has(entry)){for(const path of entry.glyph.paths)restore(path);if(entry.cue)entry.cue.hidden=true}
      for(const entry of next)if(!current.has(entry)){for(const path of entry.glyph.paths)path.setAttribute('fill',color);if(entry.cue&&entry.cueEpoch===cueEpoch)entry.cue.hidden=!entry.cueUsable}
      current=next;currentRequest={sourceNoteIds:[...ids],sourceMeasureIndex:measure};
      for(const {entry,box}of measured)placeCue(entry,box,origin);
      return true;
    },
    dispose(){if(disposed)return;clearRoles();stopCuePreparation?.();stopCuePreparation=null;clear();disposed=true;cueLayer?.remove();cueLayer=null;for(const entry of entries)if(entry.status==='bound'){entry.status='unavailable';entry.reason='engraving_view_disposed'}snapshots.clear()},
  };
}
