import {getAppI18n} from './app-locale.js';
import {createReviewLocale, reviewError} from './review-locale.js';
import {currentFormatMetadata} from './format-metadata.js';
import {imageMetadata, IMAGE_LIMITS} from './image-metadata.js';
const MAX_IMAGE = IMAGE_LIMITS.bytes;
const MAX_SCORE = 8 * 1024 * 1024;
export const MAX_REVIEW_NOTES = 512;
// A twelfth of a quarter beat represents all supported binary and triplet choices exactly.
export const REVIEW_DURATIONS = Object.freeze([
  {value:'0.25',ticks:3,label:'¼ beat · sixteenth',key:'review.image.duration.sixteenth'},
  {value:'1/3',ticks:4,label:'⅓ beat · eighth triplet',key:'review.image.duration.eighthTriplet'},
  {value:'0.5',ticks:6,label:'½ beat · eighth',key:'review.image.duration.eighth'},
  {value:'2/3',ticks:8,label:'⅔ beat · quarter triplet',key:'review.image.duration.quarterTriplet'},
  {value:'0.75',ticks:9,label:'¾ beat · dotted eighth',key:'review.image.duration.dottedEighth'},
  {value:'1',ticks:12,label:'1 beat · quarter',key:'review.image.duration.quarter'},
  {value:'1.5',ticks:18,label:'1½ beats · dotted quarter',key:'review.image.duration.dottedQuarter'},
  {value:'2',ticks:24,label:'2 beats · half',key:'review.image.duration.half'},
  {value:'3',ticks:36,label:'3 beats · dotted half',key:'review.image.duration.dottedHalf'},
  {value:'4',ticks:48,label:'4 beats · whole',key:'review.image.duration.whole'}
].map(choice=>Object.freeze(choice)));
const durationTicks=new Map(REVIEW_DURATIONS.map(choice=>[choice.value,choice.ticks]));
function exactBeats(ticks) { let a=ticks,b=12;while(b){[a,b]=[b,a%b]}return {numerator:ticks/a,denominator:12/a}; }
const B = (n, d = 1) => ({numerator: n, denominator: d});
export function parsePitch(text) {
  const match = /^([A-Ga-g])(##|bb|#|b)?(-?\d)$/.exec(text.trim());
  if (!match) throw reviewError('review.image.invalidPitch',`“${text}” is not a pitch. Use C4, F#4, Bb3, F##4 or Bbb3.`,{pitch:text});
  const pitch = {step: match[1].toUpperCase(), alter: {'#':1,'##':2,b:-1,bb:-2}[match[2]] ?? 0, octave: Number(match[3])};
  const midi = (pitch.octave + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[pitch.step] + pitch.alter;
  if (midi < 0 || midi > 127) throw reviewError('review.image.pitchRange',`Pitch “${text}” is outside MIDI range 0–127.`,{pitch:text});
  return pitch;
}
export function reviewedScore({title, rows, filename, originalImage, review, crop, bpm = 90}) {
  if (!Array.isArray(rows) || !rows.length) throw reviewError('review.image.addFirst','Add at least one note and confirm every duration.');
  if (rows.length > MAX_REVIEW_NOTES) throw reviewError('review.image.tooMany',`An image-review fragment supports at most ${MAX_REVIEW_NOTES} notes/rests. Split the source into smaller fragments; no rows were discarded.`,{limit:MAX_REVIEW_NOTES});
  let ticks = 0;
  const notes = rows.map((row, index) => {
    const duration = durationTicks.get(String(row.duration));
    if (duration === undefined) throw reviewError('review.image.chooseDuration',`Choose the duration for note ${index + 1}. The recognizer does not read rhythm.`,{note:index+1});
    const pitch = row.pitch.trim() === '0' ? null : parsePitch(row.pitch);
    const note = {id: `review-${index + 1}`, at: exactBeats(ticks), duration: exactBeats(duration), pitch, voice: '1', staff: 1, velocity: pitch ? 90 : 0, tie_start: false, tie_stop: false};
    ticks += duration; return note;
  });
  return {version:1,format_metadata:currentFormatMetadata(),id:`image-review-${Date.now()}`,title:title.trim() || 'Reviewed image fragment · 图片片段',composer:'User-reviewed transcription',provenance:{kind:'user_reviewed_image',attribution:`Manually reviewed pitch and duration from ${filename}. Source rights are not verified; no reuse permission is implied.`,source_url:null,license:null},parts:[{id:'reviewed-melody',name:'Reviewed melody',instrument:'piano',notes}],tempo:[{at:B(0),bpm}],meters:[{at:B(0),numerator:4,denominator:4}],keys:[{at:B(0),fifths:0,mode:'major'}],measures:Array.from({length:Math.ceil(ticks/48)},(_,index)=>({number:index+1,at:B(index*4),length:exactBeats(Math.min(48,ticks-index*48))})),repeats:[],source:{format:'image-review',filename,content:JSON.stringify({original_image_data_url:originalImage,crop,recognition_review:review,manual_notes:rows,manual_duration_unit:'quarter_note_beats',duration_choices:'worldmusichub-image-review-v2',confirmed_assumptions:'Single melody, manually set note-on durations, 4/4 meter, C pitch reference. No automatic rhythm, key, accidental or chord recognition.'})}};
}
export function setupImageReview({onImport, pausePlayback, notice,onExternalOmr, document = globalThis.document, i18n = getAppI18n(document)}) {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog'); dialog.id = 'image-review-dialog'; dialog.className = 'review-dialog';
  dialog.innerHTML = `<div class="review-header"><div><span class="eyebrow"><span data-review-i18n="review.image.eyebrow"></span></span><h2><span data-review-i18n="review.image.title"></span></h2></div><button id="review-close" class="button ghost" aria-label="" data-review-i18n-aria-label="review.image.closeAria">✕</button></div><p class="review-explanation session-replacement-note"><span data-review-i18n="review.replacement"></span></p><p class="review-explanation"><span data-review-i18n="review.image.explanation"></span></p><p class="review-explanation"><span data-review-i18n="review.image.externalHelp"></span> <button id="review-external-output" class="button secondary"><span data-review-i18n="review.image.external"></span></button></p><div id="review-status" class="notice" role="status" aria-live="polite"><span data-review-i18n="review.image.initial"></span></div><div class="review-preview"><canvas id="image-preview" aria-label="" data-review-i18n-aria-label="review.image.previewAria"></canvas></div><div class="crop-controls"><label><span data-review-i18n="review.image.cropX"></span><input id="crop-x" type="number" min="0" value="0"></label><label><span data-review-i18n="review.image.cropY"></span><input id="crop-y" type="number" min="0" value="0"></label><label><span data-review-i18n="review.image.width"></span><input id="crop-width" type="number" min="1"></label><label><span data-review-i18n="review.image.height"></span><input id="crop-height" type="number" min="1"></label><button id="analyze-image" class="button primary"><span data-review-i18n="review.image.analyze"></span></button></div><div id="image-assumptions" class="review-warnings"></div><div class="review-edit-heading"><h3><span data-review-i18n="review.image.notesHeading"></span></h3><button id="review-add-note" class="button secondary"><span data-review-i18n="review.image.add"></span></button></div><p class="review-explanation"><span data-review-i18n="review.image.syntax"></span></p><p id="review-note-limit" class="review-explanation" role="status"></p><div class="review-row-labels"><span data-review-i18n="review.image.note"></span><span data-review-i18n="review.image.pitch"></span><span data-review-i18n="review.image.duration"></span><span data-review-i18n="review.image.evidence"></span><span></span></div><div id="review-notes" class="review-notes"></div><label class="review-title-label"><span data-review-i18n="review.image.fragmentTitle"></span><input id="review-title" type="text" maxlength="200" value=""></label><label class="review-confirm-label"><input id="review-confirm" type="checkbox"><span data-review-i18n="review.image.confirm"></span></label><div class="review-actions"><button id="review-cancel" class="button secondary"><span data-review-i18n="review.image.cancel"></span></button><button id="review-create" class="button primary" disabled><span data-review-i18n="review.image.load"></span></button></div>`;
  document.body.append(dialog);
  const locale=createReviewLocale(dialog,i18n),{m}=locale;
  const tell=(message,error=false)=>notice(()=>locale.render(message),error);
  let file, image, dataUrl, review = null, rows = [], epoch = 0, controller = null, crop = null, createController = null, createRequest = 0;
  function status(message, error = false) { locale.text($('review-status'),message); $('review-status').classList.toggle('error', error); }
  function imageCrop() {
    const result = {x:Number($('crop-x').value),y:Number($('crop-y').value),width:Number($('crop-width').value),height:Number($('crop-height').value)};
    if (!Object.values(result).every(Number.isInteger) || result.x < 0 || result.y < 0 || result.width < 1 || result.height < 1 || result.x + result.width > image.naturalWidth || result.y + result.height > image.naturalHeight) throw reviewError('review.image.cropInvalid','Crop must stay inside the image. Use whole pixel values and a width and height of at least 1.');
    return result;
  }
  function drawPreview() {
    if (!image) return;
    const canvas = $('image-preview'); const scale = Math.min(1, 1200 / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let region; try { region = imageCrop(); } catch { return; }
    ctx.strokeStyle = '#bf7737'; ctx.lineWidth = 2; ctx.strokeRect(region.x*scale,region.y*scale,region.width*scale,region.height*scale);
    if (review && crop) for (const candidate of review.candidates) { const b=candidate.bounds; ctx.strokeStyle='#327448';ctx.strokeRect((crop.x+b.x)*scale,(crop.y+b.y)*scale,b.width*scale,b.height*scale); }
  }
  function cancelCreate(){createRequest++;createController?.abort();createController=null;updateCreate();}
  function invalidateDraft(){
    const pending=Boolean(createController||controller);cancelCreate();epoch++;controller?.abort();controller=null;$('analyze-image').disabled=false;$('review-confirm').checked=false;updateCreate();
    if(pending)status(m('review.image.changed'));
  }
  function updateCreate() { $('review-create').disabled = Boolean(createController) || !$('review-confirm').checked || !rows.length || rows.length>MAX_REVIEW_NOTES || rows.some(row => !row.duration); }
  function renderRows() {
    $('review-notes').replaceChildren();
    $('review-add-note').disabled=rows.length>=MAX_REVIEW_NOTES;
    locale.text($('review-note-limit'),m('review.image.noteLimit',{count:rows.length,limit:MAX_REVIEW_NOTES}));
    rows.forEach((row,index) => {
      const element=document.createElement('div'); element.className='review-note-row';
      const number=document.createElement('span');number.textContent=String(index+1);
      const pitch=document.createElement('input');pitch.value=row.pitch;locale.attr(pitch,'aria-label',m('review.image.pitchAria',{note:index+1}));pitch.maxLength=5;pitch.addEventListener('input',()=>{row.pitch=pitch.value;invalidateDraft()});
      const duration=document.createElement('select');locale.attr(duration,'aria-label',m('review.image.durationAria',{note:index+1}));
      for(const {value,key} of [{value:'',key:'review.image.choose'},...REVIEW_DURATIONS]){const option=document.createElement('option');option.value=value;locale.text(option,m(key));duration.append(option)}duration.value=row.duration;duration.addEventListener('change',()=>{row.duration=duration.value;invalidateDraft()});
      const evidence=document.createElement('span');evidence.className='review-evidence';locale.text(evidence,row.confidence === null?m('review.image.manual'):m('review.image.heuristic',{percent:Math.round(row.confidence*100)}));
      const remove=document.createElement('button');remove.type='button';remove.className='button ghost';remove.textContent='×';locale.attr(remove,'aria-label',m('review.image.removeAria',{note:index+1}));remove.addEventListener('click',()=>{rows.splice(index,1);invalidateDraft();renderRows()});
      element.append(number,pitch,duration,evidence,remove);$('review-notes').append(element);
    });
    if (!rows.length) {const empty=document.createElement('p');empty.className='muted';locale.text(empty,m('review.image.empty'));$('review-notes').append(empty)}updateCreate();
  }
  async function open(selected) {
    cancelCreate();const current=++epoch;controller?.abort();controller=null;$('analyze-image').disabled=false;
    if (selected.size>MAX_IMAGE) {tell(m('review.image.fileLimit'),true);return}
    $('analyze-image').disabled=true;
    try {
      const bytes=new Uint8Array(await selected.arrayBuffer());if(current!==epoch)return;
      const metadata=imageMetadata(bytes); // Pixel allocation is permitted only after bounded dimensions are known.
      const candidateUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reviewError('review.image.readFailed','Could not read this image.'));reader.readAsDataURL(selected)});
      if(current!==epoch)return;
      const loaded=new Image();loaded.src=candidateUrl;await loaded.decode();if(current!==epoch)return;
      if(loaded.naturalWidth<1||loaded.naturalHeight<1||loaded.naturalWidth>IMAGE_LIMITS.axis||loaded.naturalHeight>IMAGE_LIMITS.axis||loaded.naturalWidth*loaded.naturalHeight>IMAGE_LIMITS.pixels)throw reviewError('review.image.dimensions','Decoded image dimensions exceed the supported bounds. Crop or resize it.');
      // EXIF orientation can swap axes; preserve the displayed orientation for the crop.
      if(loaded.naturalWidth*loaded.naturalHeight!==metadata.width*metadata.height)throw reviewError('review.image.dimensionsChanged','The browser decoded a different image size. Re-export it as a still PNG and try again.');
      pausePlayback();file=selected;dataUrl=candidateUrl;image=loaded;review=null;rows=[];crop=null;
      $('review-confirm').checked=false;renderRows();$('image-assumptions').replaceChildren();
      $('crop-x').value='0';$('crop-y').value='0';$('crop-width').value=String(image.naturalWidth);$('crop-height').value=String(image.naturalHeight);$('review-title').value=file.name.replace(/\.[^.]+$/,'');
      status(m('review.image.initial'));drawPreview();if(!dialog.open)dialog.showModal();
    }catch(error){if(current===epoch)tell(m('review.image.openFailed',{detail:locale.error(error)}),true)}
    finally{if(current===epoch){controller=null;$('analyze-image').disabled=false}}
  }
  function close() {epoch++;controller?.abort();controller=null;cancelCreate();dialog.close();}
  $('review-external-output').addEventListener('click',()=>{const original=file;close();onExternalOmr?.(original)});
  $('review-close').addEventListener('click',close);$('review-cancel').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  for(const id of ['image-import-button','mobile-image-button'])$(id).addEventListener('click',()=>$('score-image-file').click());
  $('score-image-file').addEventListener('change',event=>{const selected=event.target.files[0];event.target.value='';if(selected)open(selected)});
  for(const id of ['crop-x','crop-y','crop-width','crop-height'])$(id).addEventListener('input',()=>{invalidateDraft();drawPreview()});
  $('review-add-note').addEventListener('click',()=>{if(rows.length>=MAX_REVIEW_NOTES){status(m('review.image.full',{limit:MAX_REVIEW_NOTES}),true);return}rows.push({pitch:'C4',duration:'',confidence:null});invalidateDraft();renderRows();$('review-notes').lastElementChild.querySelector('input').focus()});
  $('review-confirm').addEventListener('change',()=>{if(!$('review-confirm').checked)cancelCreate();updateCreate()});
  $('review-title').addEventListener('input',invalidateDraft);
  $('analyze-image').addEventListener('click',async()=>{
    cancelCreate();const current=++epoch;controller?.abort();controller=new AbortController();const signal=controller.signal;$('analyze-image').disabled=true;$('review-confirm').checked=false;updateCreate();
    try{
      const requestedCrop=imageCrop();const canvas=document.createElement('canvas');canvas.width=requestedCrop.width;canvas.height=requestedCrop.height;canvas.getContext('2d').drawImage(image,requestedCrop.x,requestedCrop.y,requestedCrop.width,requestedCrop.height,0,0,requestedCrop.width,requestedCrop.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(current!==epoch||signal.aborted)return;if(!blob||blob.size>MAX_SCORE)throw reviewError('review.image.regionLarge','This region is too large after decoding. Select a smaller region.');
      status(m('review.image.analyzing'));const response=await fetch('/api/import/image',{method:'POST',headers:{'Content-Type':'image/png'},body:blob,signal});const result=await response.json();if(!response.ok)throw (result.error?new Error(result.error):reviewError('review.image.recognitionStatus',`Recognition returned ${response.status}.`,{status:response.status}));if(current!==epoch)return;
      if(result.candidates.length>MAX_REVIEW_NOTES)throw reviewError('review.image.candidateLimit',`This region has more than ${MAX_REVIEW_NOTES} candidates. Choose a smaller fragment; the current manual rows were kept.`,{limit:MAX_REVIEW_NOTES});
      crop=requestedCrop;review=result;rows=result.candidates.map(c=>({pitch:`${c.tentative_pitch.step}${c.tentative_pitch.octave}`,duration:'',confidence:c.confidence}));renderRows();drawPreview();
      $('image-assumptions').replaceChildren();for(const message of [...result.assumptions,...result.warnings]){const p=document.createElement('p');locale.text(p,locale.error({message}));$('image-assumptions').append(p)}
      status(result.status==='unsupported'?m('review.image.unsupported'):m('review.image.candidates',{count:rows.length}));
    }catch(error){if(error.name!=='AbortError'&&current===epoch)status(m('review.image.analyzeFailed',{detail:locale.error(error)}),true)}finally{if(current===epoch){controller=null;$('analyze-image').disabled=false}}
  });
  $('review-create').addEventListener('click',async()=>{
    if(!$('review-confirm').checked||createController)return;
    const current=++createRequest;createController=new AbortController();const signal=createController.signal;updateCreate();
    try{
      const score=reviewedScore({title:$('review-title').value,rows,filename:file.name,originalImage:dataUrl,review,crop:crop||imageCrop()});
      if(new TextEncoder().encode(JSON.stringify(score)).byteLength>MAX_SCORE)throw reviewError('review.image.scoreLimit','The reviewed score with its preserved original image exceeds 8 MiB. Use a smaller source image.');
      status(m('review.image.validating'));
      const success=await onImport(score,signal);if(current!==createRequest||signal.aborted)return;
      if(success){createController=null;close();tell(m('review.image.loaded'))}else status(m('review.image.notLoaded'),true);
    }catch(error){if(current===createRequest&&!signal.aborted)status(locale.error(error),true)}
    finally{if(current===createRequest){createController=null;updateCreate()}}
  });
  return {open,close,destroy(){close();locale.destroy();dialog.remove()}};
}
