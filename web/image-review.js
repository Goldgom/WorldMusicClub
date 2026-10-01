import {currentFormatMetadata} from './format-metadata.js';
import {imageMetadata, IMAGE_LIMITS} from './image-metadata.js';
const MAX_IMAGE = IMAGE_LIMITS.bytes;
const MAX_SCORE = 8 * 1024 * 1024;
export const MAX_REVIEW_NOTES = 512;
// A twelfth of a quarter beat represents all supported binary and triplet choices exactly.
export const REVIEW_DURATIONS = Object.freeze([
  {value:'0.25',ticks:3,label:'¼ beat · sixteenth'},
  {value:'1/3',ticks:4,label:'⅓ beat · eighth triplet'},
  {value:'0.5',ticks:6,label:'½ beat · eighth'},
  {value:'2/3',ticks:8,label:'⅔ beat · quarter triplet'},
  {value:'0.75',ticks:9,label:'¾ beat · dotted eighth'},
  {value:'1',ticks:12,label:'1 beat · quarter'},
  {value:'1.5',ticks:18,label:'1½ beats · dotted quarter'},
  {value:'2',ticks:24,label:'2 beats · half'},
  {value:'3',ticks:36,label:'3 beats · dotted half'},
  {value:'4',ticks:48,label:'4 beats · whole'}
].map(choice=>Object.freeze(choice)));
const durationTicks=new Map(REVIEW_DURATIONS.map(choice=>[choice.value,choice.ticks]));
function exactBeats(ticks) { let a=ticks,b=12;while(b){[a,b]=[b,a%b]}return {numerator:ticks/a,denominator:12/a}; }
const B = (n, d = 1) => ({numerator: n, denominator: d});
export function parsePitch(text) {
  const match = /^([A-Ga-g])(##|bb|#|b)?(-?\d)$/.exec(text.trim());
  if (!match) throw new Error(`“${text}” is not a pitch. Use C4, F#4, Bb3, F##4 or Bbb3.`);
  const pitch = {step: match[1].toUpperCase(), alter: {'#':1,'##':2,b:-1,bb:-2}[match[2]] ?? 0, octave: Number(match[3])};
  const midi = (pitch.octave + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[pitch.step] + pitch.alter;
  if (midi < 0 || midi > 127) throw new Error(`Pitch “${text}” is outside MIDI range 0–127.`);
  return pitch;
}
export function reviewedScore({title, rows, filename, originalImage, review, crop, bpm = 90}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Add at least one note and confirm every duration.');
  if (rows.length > MAX_REVIEW_NOTES) throw new Error(`An image-review fragment supports at most ${MAX_REVIEW_NOTES} notes/rests. Split the source into smaller fragments; no rows were discarded.`);
  let ticks = 0;
  const notes = rows.map((row, index) => {
    const duration = durationTicks.get(String(row.duration));
    if (duration === undefined) throw new Error(`Choose the duration for note ${index + 1}. The recognizer does not read rhythm.`);
    const pitch = row.pitch.trim() === '0' ? null : parsePitch(row.pitch);
    const note = {id: `review-${index + 1}`, at: exactBeats(ticks), duration: exactBeats(duration), pitch, voice: '1', staff: 1, velocity: pitch ? 90 : 0, tie_start: false, tie_stop: false};
    ticks += duration; return note;
  });
  return {version:1,format_metadata:currentFormatMetadata(),id:`image-review-${Date.now()}`,title:title.trim() || 'Reviewed image fragment · 图片片段',composer:'User-reviewed transcription',provenance:{kind:'user_reviewed_image',attribution:`Manually reviewed pitch and duration from ${filename}. Source rights are not verified; no reuse permission is implied.`,source_url:null,license:null},parts:[{id:'reviewed-melody',name:'Reviewed melody',instrument:'piano',notes}],tempo:[{at:B(0),bpm}],meters:[{at:B(0),numerator:4,denominator:4}],keys:[{at:B(0),fifths:0,mode:'major'}],measures:Array.from({length:Math.ceil(ticks/48)},(_,index)=>({number:index+1,at:B(index*4),length:exactBeats(Math.min(48,ticks-index*48))})),repeats:[],source:{format:'image-review',filename,content:JSON.stringify({original_image_data_url:originalImage,crop,recognition_review:review,manual_notes:rows,manual_duration_unit:'quarter_note_beats',duration_choices:'worldmusichub-image-review-v2',confirmed_assumptions:'Single melody, manually set note-on durations, 4/4 meter, C pitch reference. No automatic rhythm, key, accidental or chord recognition.'})}};
}
export function setupImageReview({onImport, pausePlayback, notice,onExternalOmr}) {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog'); dialog.id = 'image-review-dialog'; dialog.className = 'review-dialog';
  dialog.innerHTML = `<div class="review-header"><div><span class="eyebrow">IMAGE TO A REVIEWED FRAGMENT · 图片片段</span><h2>Read, check, then play.</h2></div><button id="review-close" class="button ghost" aria-label="Close image review">✕</button></div><p class="review-explanation session-replacement-note">Loading, opening or activating this score replaces the paused score and clears its in-memory take history. Export take data in Results first to keep it. Playback stays paused. 使用此乐谱会替换当前乐谱，请先导出需要保留的练习记录。</p><p class="review-explanation">A limited local recognizer can suggest note positions from one clean, horizontal five-line treble staff. Pitch candidates are uncertain. Rhythm, accidentals, key signatures, voices, chords and ties must be checked by you. Nothing becomes playable until you confirm the notes below.</p><p class="review-explanation">Already generated a richer result separately? Narrow-draft manual note edits are not transferred between workflows. <button id="review-external-output" class="button secondary">Review Audiveris output with this image</button></p><div id="review-status" class="notice" role="status" aria-live="polite">Choose a region with a single staff, then analyze it locally. No image leaves this computer.</div><div class="review-preview"><canvas id="image-preview" aria-label="Selected score image and crop boundary"></canvas></div><div class="crop-controls"><label>Crop X<input id="crop-x" type="number" min="0" value="0"></label><label>Crop Y<input id="crop-y" type="number" min="0" value="0"></label><label>Width<input id="crop-width" type="number" min="1"></label><label>Height<input id="crop-height" type="number" min="1"></label><button id="analyze-image" class="button primary">Analyze region · 识别</button></div><div id="image-assumptions" class="review-warnings"></div><div class="review-edit-heading"><h3>Review every note · 逐音确认</h3><button id="review-add-note" class="button secondary">＋ Add note / rest</button></div><p class="review-explanation">Enter pitches as C4, F#4, Bb3, F##4, Bbb3, or 0 for a rest. Notes play sequentially left to right. Durations are measured in exact quarter-note beats. Dotted and triplet choices are manual; rhythm is never inferred. This editor does not preserve simultaneous voices or chords.</p><p id="review-note-limit" class="review-explanation" role="status"></p><div class="review-row-labels"><span>Note</span><span>Pitch · 音高</span><span>Duration · 时值</span><span>Evidence</span><span></span></div><div id="review-notes" class="review-notes"></div><label class="review-title-label">Fragment title <input id="review-title" type="text" maxlength="200" value="Reviewed image fragment · 图片片段"></label><label class="review-confirm-label"><input id="review-confirm" type="checkbox"> I checked every pitch, accidental and duration, and understand this is a single-melody draft. 我已逐音核对音高与时值。</label><div class="review-actions"><button id="review-cancel" class="button secondary">Cancel</button><button id="review-create" class="button primary" disabled>Load reviewed score · 使用已审阅乐谱</button></div>`;
  document.body.append(dialog);
  let file, image, dataUrl, review = null, rows = [], epoch = 0, controller = null, crop = null, createController = null, createRequest = 0;
  function status(message, error = false) { $('review-status').textContent = message; $('review-status').classList.toggle('error', error); }
  function imageCrop() {
    const result = {x:Number($('crop-x').value),y:Number($('crop-y').value),width:Number($('crop-width').value),height:Number($('crop-height').value)};
    if (!Object.values(result).every(Number.isInteger) || result.x < 0 || result.y < 0 || result.width < 1 || result.height < 1 || result.x + result.width > image.naturalWidth || result.y + result.height > image.naturalHeight) throw new Error('Crop must stay inside the image. Use whole pixel values and a width and height of at least 1.');
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
    if(pending)status('Draft changed. Pending recognition or score loading was cancelled; review and confirm the current notes again.');
  }
  function updateCreate() { $('review-create').disabled = Boolean(createController) || !$('review-confirm').checked || !rows.length || rows.length>MAX_REVIEW_NOTES || rows.some(row => !row.duration); }
  function renderRows() {
    $('review-notes').replaceChildren();
    $('review-add-note').disabled=rows.length>=MAX_REVIEW_NOTES;
    $('review-note-limit').textContent=`${rows.length} / ${MAX_REVIEW_NOTES} notes and rests. This is a bounded single-melody fragment; split longer music into smaller images. Existing rows are never truncated to meet the limit.`;
    rows.forEach((row,index) => {
      const element=document.createElement('div'); element.className='review-note-row';
      const number=document.createElement('span');number.textContent=String(index+1);
      const pitch=document.createElement('input');pitch.value=row.pitch;pitch.setAttribute('aria-label',`Pitch for note ${index+1}`);pitch.maxLength=5;pitch.addEventListener('input',()=>{row.pitch=pitch.value;invalidateDraft()});
      const duration=document.createElement('select');duration.setAttribute('aria-label',`Duration for note ${index+1}`);
      for(const {value,label} of [{value:'',label:'Choose…'},...REVIEW_DURATIONS]){const option=document.createElement('option');option.value=value;option.textContent=label;duration.append(option)}duration.value=row.duration;duration.addEventListener('change',()=>{row.duration=duration.value;invalidateDraft()});
      const evidence=document.createElement('span');evidence.className='review-evidence';evidence.textContent=row.confidence === null?'Manual entry':`${Math.round(row.confidence*100)}% heuristic`;
      const remove=document.createElement('button');remove.type='button';remove.className='button ghost';remove.textContent='×';remove.setAttribute('aria-label',`Remove note ${index+1}`);remove.addEventListener('click',()=>{rows.splice(index,1);invalidateDraft();renderRows()});
      element.append(number,pitch,duration,evidence,remove);$('review-notes').append(element);
    });
    if (!rows.length) {const empty=document.createElement('p');empty.className='muted';empty.textContent='No note candidates yet. Analyze the region or add notes manually.';$('review-notes').append(empty)}updateCreate();
  }
  async function open(selected) {
    cancelCreate();const current=++epoch;controller?.abort();controller=null;$('analyze-image').disabled=false;
    if (selected.size>MAX_IMAGE) {notice('Choose a PNG or JPEG smaller than 5 MiB. Crop a single staff or reduce the image size before importing.',true);return}
    $('analyze-image').disabled=true;
    try {
      const bytes=new Uint8Array(await selected.arrayBuffer());if(current!==epoch)return;
      const metadata=imageMetadata(bytes); // Pixel allocation is permitted only after bounded dimensions are known.
      const candidateUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this image.'));reader.readAsDataURL(selected)});
      if(current!==epoch)return;
      const loaded=new Image();loaded.src=candidateUrl;await loaded.decode();if(current!==epoch)return;
      if(loaded.naturalWidth<1||loaded.naturalHeight<1||loaded.naturalWidth>IMAGE_LIMITS.axis||loaded.naturalHeight>IMAGE_LIMITS.axis||loaded.naturalWidth*loaded.naturalHeight>IMAGE_LIMITS.pixels)throw new Error('Decoded image dimensions exceed the supported bounds. Crop or resize it.');
      // EXIF orientation can swap axes; preserve the displayed orientation for the crop.
      if(loaded.naturalWidth*loaded.naturalHeight!==metadata.width*metadata.height)throw new Error('The browser decoded a different image size. Re-export it as a still PNG and try again.');
      pausePlayback();file=selected;dataUrl=candidateUrl;image=loaded;review=null;rows=[];crop=null;
      $('review-confirm').checked=false;renderRows();$('image-assumptions').replaceChildren();
      $('crop-x').value='0';$('crop-y').value='0';$('crop-width').value=String(image.naturalWidth);$('crop-height').value=String(image.naturalHeight);$('review-title').value=file.name.replace(/\.[^.]+$/,'');
      status('Choose a region with a single staff, then analyze it locally. No image leaves this computer.');drawPreview();if(!dialog.open)dialog.showModal();
    }catch(error){if(current===epoch)notice(`Could not open this image. ${error.message}`,true)}
    finally{if(current===epoch){controller=null;$('analyze-image').disabled=false}}
  }
  function close() {epoch++;controller?.abort();controller=null;cancelCreate();dialog.close();}
  $('review-external-output').addEventListener('click',()=>{const original=file;close();onExternalOmr?.(original)});
  $('review-close').addEventListener('click',close);$('review-cancel').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  for(const id of ['image-import-button','mobile-image-button'])$(id).addEventListener('click',()=>$('score-image-file').click());
  $('score-image-file').addEventListener('change',event=>{const selected=event.target.files[0];event.target.value='';if(selected)open(selected)});
  for(const id of ['crop-x','crop-y','crop-width','crop-height'])$(id).addEventListener('input',()=>{invalidateDraft();drawPreview()});
  $('review-add-note').addEventListener('click',()=>{if(rows.length>=MAX_REVIEW_NOTES){status(`This fragment already has ${MAX_REVIEW_NOTES} notes/rests. Keep these rows and start a separate fragment for more music.`,true);return}rows.push({pitch:'C4',duration:'',confidence:null});invalidateDraft();renderRows();$('review-notes').lastElementChild.querySelector('input').focus()});
  $('review-confirm').addEventListener('change',()=>{if(!$('review-confirm').checked)cancelCreate();updateCreate()});
  $('review-title').addEventListener('input',invalidateDraft);
  $('analyze-image').addEventListener('click',async()=>{
    cancelCreate();const current=++epoch;controller?.abort();controller=new AbortController();const signal=controller.signal;$('analyze-image').disabled=true;$('review-confirm').checked=false;updateCreate();
    try{
      const requestedCrop=imageCrop();const canvas=document.createElement('canvas');canvas.width=requestedCrop.width;canvas.height=requestedCrop.height;canvas.getContext('2d').drawImage(image,requestedCrop.x,requestedCrop.y,requestedCrop.width,requestedCrop.height,0,0,requestedCrop.width,requestedCrop.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(current!==epoch||signal.aborted)return;if(!blob||blob.size>MAX_SCORE)throw new Error('This region is too large after decoding. Select a smaller region.');
      status('Analyzing the selected region locally…');const response=await fetch('/api/import/image',{method:'POST',headers:{'Content-Type':'image/png'},body:blob,signal});const result=await response.json();if(!response.ok)throw new Error(result.error||`Recognition returned ${response.status}.`);if(current!==epoch)return;
      if(result.candidates.length>MAX_REVIEW_NOTES)throw new Error(`This region has more than ${MAX_REVIEW_NOTES} candidates. Choose a smaller fragment; the current manual rows were kept.`);
      crop=requestedCrop;review=result;rows=result.candidates.map(c=>({pitch:`${c.tentative_pitch.step}${c.tentative_pitch.octave}`,duration:'',confidence:c.confidence}));renderRows();drawPreview();
      $('image-assumptions').replaceChildren();for(const message of [...result.assumptions,...result.warnings]){const p=document.createElement('p');p.textContent=message;$('image-assumptions').append(p)}
      status(result.status==='unsupported'?'This image is outside the limited recognizer’s scope. Try a clean single-staff crop, or add the notes manually.':`${rows.length} uncertain pitch candidates. Confirm or correct every pitch and choose every duration before creating a score.`);
    }catch(error){if(error.name!=='AbortError'&&current===epoch)status(`Could not analyze this region. ${error.message} You can still add notes manually.`,true)}finally{if(current===epoch){controller=null;$('analyze-image').disabled=false}}
  });
  $('review-create').addEventListener('click',async()=>{
    if(!$('review-confirm').checked||createController)return;
    const current=++createRequest;createController=new AbortController();const signal=createController.signal;updateCreate();
    try{
      const score=reviewedScore({title:$('review-title').value,rows,filename:file.name,originalImage:dataUrl,review,crop:crop||imageCrop()});
      if(new TextEncoder().encode(JSON.stringify(score)).byteLength>MAX_SCORE)throw new Error('The reviewed score with its preserved original image exceeds 8 MiB. Use a smaller source image.');
      status('Validating your explicitly confirmed draft with Rust…');
      const success=await onImport(score,signal);if(current!==createRequest||signal.aborted)return;
      if(success){createController=null;close();notice('Reviewed fragment loaded. Your original image and review choices are preserved in Export JSON.')}else status('The Rust score validator could not load this draft. Close this dialog to see the error, or correct your notes and try again.',true);
    }catch(error){if(current===createRequest&&!signal.aborted)status(error.message,true)}
    finally{if(current===createRequest){createController=null;updateCreate()}}
  });
}
