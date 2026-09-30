/** Rust supplies every token; this guard only checks complete canonical note identity coverage. */
export function validateJianpuExport(result, score) {
  const fail=()=>{throw Error('The numbered-text export is incomplete. Keep the JSON or MusicXML archive and try again with a compatible server.');};
  if(!result||typeof result.text!=='string'||!result.text.trim()||new TextEncoder().encode(result.text).byteLength>1024*1024||!Array.isArray(result.diagnostics)||!Array.isArray(result.note_map)||result.note_map.length>100000)fail();
  const expected=new Set(score.parts.flatMap(part=>part.notes.map(note=>note.id))),seen=new Set();let gaps=0;
  for(const id of result.note_map){if(id===null){gaps++;continue}if(typeof id!=='string'||!expected.has(id)||seen.has(id))fail();seen.add(id)}
  if(seen.size!==expected.size)fail();
  return{sourceNotes:seen.size,gapRests:gaps};
}
export function setupJianpuExport({getScore,pausePlayback,api}) {
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.id='jianpu-export';dialog.className='review-dialog jianpu-export';dialog.setAttribute('aria-labelledby','jianpu-export-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow">NUMBERED-TEXT EXPORT · 简谱文本导出</span><h2 id="jianpu-export-title">Review before you keep it.</h2></div><button id="jianpu-export-close" class="button ghost" aria-label="Close numbered-text export">✕</button></div>
    <p class="review-explanation">This is WorldMusicHub’s specific .jianpu text dialect, for a single monophonic lane with constant tempo, key and meter. It cannot preserve polyphony, written ties, repeats or pickups. Rust rejects unsupported structure and verifies exported note spelling, onset and duration by reimporting the text.</p>
    <div id="jianpu-export-status" class="notice" role="status" aria-live="polite"></div>
    <ul id="jianpu-export-diagnostics" class="review-warnings"></ul>
    <p class="review-explanation">Keep the original JSON as your complete source archive. This text does not retain canonical IDs, original source files/images, expressive velocity, instrument setup or engraving. Supplied rights information is carried in comments; those comments do not verify permission.</p>
    <label for="jianpu-export-text">Generated text · 生成文本</label><textarea id="jianpu-export-text" readonly rows="12" spellcheck="false"></textarea>
    <details class="jianpu-export-mapping"><summary id="jianpu-export-map-summary">Source token mapping</summary><ol id="jianpu-export-map"></ol><p id="jianpu-export-map-limit"></p></details>
    <div class="review-actions"><button id="jianpu-export-cancel" class="button secondary">Cancel · 取消</button><button id="jianpu-export-download" class="button primary" disabled>Download .jianpu · 下载</button></div>`;
  document.body.append(dialog);
  let generation=0,controller=null,prepared=null;
  function close(){generation++;controller?.abort();controller=null;prepared=null;$('jianpu-export-download').disabled=true;dialog.close()}
  for(const id of ['jianpu-export-close','jianpu-export-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  $('export-jianpu').addEventListener('click',async()=>{
    const score=getScore();if(!score)return;
    pausePlayback();controller?.abort();controller=new AbortController();const current=++generation;const signal=controller.signal;prepared=null;
    $('jianpu-export-text').value='';$('jianpu-export-map').replaceChildren();$('jianpu-export-diagnostics').replaceChildren();$('jianpu-export-map-summary').textContent='Source token mapping · pending';$('jianpu-export-map-limit').textContent='';$('jianpu-export-download').disabled=true;$('jianpu-export-status').classList.remove('error');$('jianpu-export-status').textContent='Checking this complete score and generating exact numbered text with Rust…';dialog.showModal();
    try{
      const result=await api('/api/export/jianpu',score,signal);
      if(current!==generation||signal.aborted)return;
      if(getScore()!==score){$('jianpu-export-status').textContent='The score changed during preparation. Close this preview and export again to review the current version.';return}
      const counts=validateJianpuExport(result,score);prepared={score,result};
      $('jianpu-export-text').value=result.text;
      $('jianpu-export-status').textContent=`Ready for review: ${counts.sourceNotes} source notes/rests and ${counts.gapRests} explicit gap rests. No notes were selected by the current Practice part or A–B loop; this exports the complete score.`;
      for(const diagnostic of result.diagnostics){const li=document.createElement('li');li.textContent=diagnostic.message;$('jianpu-export-diagnostics').append(li)}
      $('jianpu-export-map-summary').textContent=`Source token mapping · ${result.note_map.length} tokens`;
      for(const id of result.note_map.slice(0,100)){const li=document.createElement('li');li.textContent=id===null?'Added explicit rest for an exact written gap':`Canonical source note: ${id}`;$('jianpu-export-map').append(li)}
      $('jianpu-export-map-limit').textContent=result.note_map.length>100?'Showing the first 100 mappings. Rust verified every source note before returning this text.':'Each non-gap token maps to one canonical note or rest. The text file itself does not retain these IDs.';
      $('jianpu-export-download').disabled=false;
    }catch(error){if(current!==generation||signal.aborted)return;$('jianpu-export-status').classList.add('error');$('jianpu-export-status').textContent=`Cannot export this score to numbered text: ${error.message} JSON and MusicXML exports remain available.`}
    finally{if(current===generation)controller=null}
  });
  $('jianpu-export-download').addEventListener('click',()=>{
    if(!prepared)return;
    if(getScore()!==prepared.score){prepared=null;$('jianpu-export-download').disabled=true;$('jianpu-export-status').textContent='The current score changed. Close this preview and export again to review the current version.';return}
    const filename=`${prepared.score.id.replace(/[^\w.-]/g,'_').slice(0,120)}.jianpu`;
    const url=URL.createObjectURL(new Blob([prepared.result.text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('jianpu-export-status').textContent='Numbered-text file downloaded. Keep your full JSON/source archive as well.';
  });
  return{close};
}
