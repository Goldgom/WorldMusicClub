const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_SCORE = 8 * 1024 * 1024;
const B = (n, d = 1) => ({numerator: n, denominator: d});
export function parsePitch(text) {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(text.trim());
  if (!match) throw new Error(`“${text}” is not a pitch. Use C4, F#4 or Bb3.`);
  const pitch = {step: match[1].toUpperCase(), alter: match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0, octave: Number(match[3])};
  const midi = (pitch.octave + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[pitch.step] + pitch.alter;
  if (midi < 0 || midi > 127) throw new Error(`Pitch “${text}” is outside MIDI range 0–127.`);
  return pitch;
}
export function reviewedScore({title, rows, filename, originalImage, review, crop, bpm = 90}) {
  if (!rows.length) throw new Error('Add at least one note and confirm every duration.');
  let sixteenths = 0;
  const notes = rows.map((row, index) => {
    const duration = Number(row.duration);
    if (![0.25, 0.5, 1, 2, 4].includes(duration)) throw new Error(`Choose the duration for note ${index + 1}. The recognizer does not read rhythm.`);
    const note = {id: `review-${index + 1}`, at: B(sixteenths, 4), duration: B(duration * 4, 4), pitch: row.pitch.trim() === '0' ? null : parsePitch(row.pitch), voice: '1', staff: 1, velocity: 90, tie_start: false, tie_stop: false};
    sixteenths += duration * 4; return note;
  });
  return {version:1,id:`image-review-${Date.now()}`,title:title.trim() || 'Reviewed image fragment · 图片片段',composer:'User-reviewed transcription',provenance:{kind:'user_reviewed_image',attribution:`Manually reviewed pitch and duration from ${filename}. Source rights are not verified; no reuse permission is implied.`,source_url:null,license:null},parts:[{id:'reviewed-melody',name:'Reviewed melody',instrument:'piano',notes}],tempo:[{at:B(0),bpm}],meters:[{at:B(0),numerator:4,denominator:4}],keys:[{at:B(0),fifths:0,mode:'major'}],measures:Array.from({length:Math.ceil(sixteenths/16)},(_,index)=>({number:index+1,at:B(index*4),length:B(Math.min(16,sixteenths-index*16),4)})),repeats:[],source:{format:'image-review',filename,content:JSON.stringify({original_image_data_url:originalImage,crop,recognition_review:review,manual_notes:rows,confirmed_assumptions:'Single melody, manually set note-on durations, 4/4 meter, C pitch reference. No automatic rhythm, key, accidental or chord recognition.'})}};
}
export function setupImageReview({compileScore, pausePlayback, notice}) {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog'); dialog.id = 'image-review-dialog'; dialog.className = 'review-dialog';
  dialog.innerHTML = `<div class="review-header"><div><span class="eyebrow">IMAGE TO A REVIEWED FRAGMENT · 图片片段</span><h2>Read, check, then play.</h2></div><button id="review-close" class="button ghost" aria-label="Close image review">✕</button></div><p class="review-explanation">A limited local recognizer can suggest note positions from one clean, horizontal five-line treble staff. Pitch candidates are uncertain. Rhythm, accidentals, key signatures, voices, chords and ties must be checked by you. Nothing becomes playable until you confirm the notes below.</p><div id="review-status" class="notice" role="status" aria-live="polite">Choose a region with a single staff, then analyze it locally. No image leaves this computer.</div><div class="review-preview"><canvas id="image-preview" aria-label="Selected score image and crop boundary"></canvas></div><div class="crop-controls"><label>Crop X<input id="crop-x" type="number" min="0" value="0"></label><label>Crop Y<input id="crop-y" type="number" min="0" value="0"></label><label>Width<input id="crop-width" type="number" min="1"></label><label>Height<input id="crop-height" type="number" min="1"></label><button id="analyze-image" class="button primary">Analyze region · 识别</button></div><div id="image-assumptions" class="review-warnings"></div><div class="review-edit-heading"><h3>Review every note · 逐音确认</h3><button id="review-add-note" class="button secondary">＋ Add note / rest</button></div><p class="review-explanation">Enter pitches as C4, F#4, Bb3, or 0 for a rest. Notes play sequentially left to right. Durations are measured in quarter-note beats. This editor does not preserve simultaneous voices or chords.</p><div class="review-row-labels"><span>Note</span><span>Pitch · 音高</span><span>Duration · 时值</span><span>Evidence</span><span></span></div><div id="review-notes" class="review-notes"></div><label class="review-title-label">Fragment title <input id="review-title" type="text" maxlength="200" value="Reviewed image fragment · 图片片段"></label><label class="review-confirm-label"><input id="review-confirm" type="checkbox"> I checked every pitch, accidental and duration, and understand this is a single-melody draft. 我已逐音核对音高与时值。</label><div class="review-actions"><button id="review-cancel" class="button secondary">Cancel</button><button id="review-create" class="button primary" disabled>Create practice score · 开始练习</button></div>`;
  document.body.append(dialog);
  let file, image, dataUrl, review = null, rows = [], epoch = 0, controller = null, crop = null;
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
  function updateCreate() { $('review-create').disabled = !$('review-confirm').checked || !rows.length || rows.some(row => !row.duration); }
  function renderRows() {
    $('review-notes').replaceChildren();
    rows.forEach((row,index) => {
      const element=document.createElement('div'); element.className='review-note-row';
      const number=document.createElement('span');number.textContent=String(index+1);
      const pitch=document.createElement('input');pitch.value=row.pitch;pitch.setAttribute('aria-label',`Pitch for note ${index+1}`);pitch.maxLength=5;pitch.addEventListener('input',()=>{row.pitch=pitch.value;$('review-confirm').checked=false;updateCreate()});
      const duration=document.createElement('select');duration.setAttribute('aria-label',`Duration for note ${index+1}`);
      for(const [value,label] of [['','Choose…'],['0.25','¼ beat · sixteenth'],['0.5','½ beat · eighth'],['1','1 beat · quarter'],['2','2 beats · half'],['4','4 beats · whole']]){const option=document.createElement('option');option.value=value;option.textContent=label;duration.append(option)}duration.value=row.duration;duration.addEventListener('change',()=>{row.duration=duration.value;$('review-confirm').checked=false;updateCreate()});
      const evidence=document.createElement('span');evidence.className='review-evidence';evidence.textContent=row.confidence === null?'Manual entry':`${Math.round(row.confidence*100)}% heuristic`;
      const remove=document.createElement('button');remove.type='button';remove.className='button ghost';remove.textContent='×';remove.setAttribute('aria-label',`Remove note ${index+1}`);remove.addEventListener('click',()=>{rows.splice(index,1);$('review-confirm').checked=false;renderRows()});
      element.append(number,pitch,duration,evidence,remove);$('review-notes').append(element);
    });
    if (!rows.length) {const empty=document.createElement('p');empty.className='muted';empty.textContent='No note candidates yet. Analyze the region or add notes manually.';$('review-notes').append(empty)}updateCreate();
  }
  async function open(selected) {
    if (selected.size>MAX_IMAGE) {notice('Choose a PNG or JPEG smaller than 5 MiB. Crop a single staff or reduce the image size before importing.',true);return}
    const signature = new Uint8Array(await selected.slice(0, 8).arrayBuffer());
    const png = signature.length === 8 && signature.every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
    const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
    if (!png && !jpeg) { notice('Choose an actual PNG or JPEG image. Renaming a PDF, SVG or other file does not convert it.', true); return; }
    pausePlayback();epoch++;controller?.abort();$('analyze-image').disabled=false;file=selected;review=null;rows=[];crop=null;$('review-confirm').checked=false;renderRows();$('image-assumptions').replaceChildren();
    const current=epoch;
    try {
      dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this image.'));reader.readAsDataURL(file)});
      const loaded=new Image();loaded.src=dataUrl;await loaded.decode();if(current!==epoch)return;
      if(loaded.naturalWidth*loaded.naturalHeight>16000000)throw new Error('This image exceeds 16 million pixels. Crop or resize it and try again.');
      image=loaded;$('crop-x').value='0';$('crop-y').value='0';$('crop-width').value=String(image.naturalWidth);$('crop-height').value=String(image.naturalHeight);$('review-title').value=file.name.replace(/\.[^.]+$/,'');
      status('Choose a region with a single staff, then analyze it locally. No image leaves this computer.');drawPreview();dialog.showModal();
    }catch(error){notice(`Could not open this image. ${error.message}`,true)}
  }
  function close() {epoch++;controller?.abort();dialog.close();}
  $('review-close').addEventListener('click',close);$('review-cancel').addEventListener('click',close);dialog.addEventListener('cancel',()=>{epoch++;controller?.abort()});
  for(const id of ['image-import-button','mobile-image-button'])$(id).addEventListener('click',()=>$('score-image-file').click());
  $('score-image-file').addEventListener('change',event=>{const selected=event.target.files[0];event.target.value='';if(selected)open(selected)});
  for(const id of ['crop-x','crop-y','crop-width','crop-height'])$(id).addEventListener('input',()=>{drawPreview();$('review-confirm').checked=false;updateCreate()});
  $('review-add-note').addEventListener('click',()=>{rows.push({pitch:'C4',duration:'',confidence:null});$('review-confirm').checked=false;renderRows();$('review-notes').lastElementChild.querySelector('input').focus()});
  $('review-confirm').addEventListener('change',updateCreate);
  $('analyze-image').addEventListener('click',async()=>{
    const current=++epoch;controller?.abort();controller=new AbortController();$('analyze-image').disabled=true;$('review-confirm').checked=false;updateCreate();
    try{
      crop=imageCrop();const canvas=document.createElement('canvas');canvas.width=crop.width;canvas.height=crop.height;canvas.getContext('2d').drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>MAX_SCORE)throw new Error('This region is too large after decoding. Select a smaller region.');
      status('Analyzing the selected region locally…');const response=await fetch('/api/import/image',{method:'POST',headers:{'Content-Type':'image/png'},body:blob,signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error||`Recognition returned ${response.status}.`);if(current!==epoch)return;
      review=result;rows=result.candidates.map(c=>({pitch:`${c.tentative_pitch.step}${c.tentative_pitch.octave}`,duration:'',confidence:c.confidence}));renderRows();drawPreview();
      $('image-assumptions').replaceChildren();for(const message of [...result.assumptions,...result.warnings]){const p=document.createElement('p');p.textContent=message;$('image-assumptions').append(p)}
      status(result.status==='unsupported'?'This image is outside the limited recognizer’s scope. Try a clean single-staff crop, or add the notes manually.':`${rows.length} uncertain pitch candidates. Confirm or correct every pitch and choose every duration before creating a score.`);
    }catch(error){if(error.name!=='AbortError'&&current===epoch)status(`Could not analyze this region. ${error.message} You can still add notes manually.`,true)}finally{if(current===epoch)$('analyze-image').disabled=false}
  });
  $('review-create').addEventListener('click',async()=>{
    if(!$('review-confirm').checked)return;
    try{const score=reviewedScore({title:$('review-title').value,rows,filename:file.name,originalImage:dataUrl,review,crop:crop||imageCrop()});if(new TextEncoder().encode(JSON.stringify(score)).byteLength>MAX_SCORE)throw new Error('The reviewed score with its preserved original image exceeds 8 MiB. Use a smaller source image.');$('review-create').disabled=true;const success=await compileScore(score);if(success){close();notice('Reviewed fragment loaded. Your original image and review choices are preserved in Export JSON.')}else{status('The Rust score validator could not load this draft. Close this dialog to see the error, or correct your notes and try again.',true);updateCreate()}}catch(error){status(error.message,true);updateCreate()}
  });
}
