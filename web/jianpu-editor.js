export const JIANPU_EXAMPLE = `format=worldmusichub-jianpu-text-v1
title=Small steps · 文本练习
composer=WorldMusicHub original exercise
1=C4
mode=major
tempo=90
meter=4/4
1 2 3 0 |
4:1/2 5:1/2 6 7 1' |
1' - - - |
`;
export function setupJianpuEditor({onImport, pausePlayback}) {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog'); dialog.id = 'jianpu-editor'; dialog.className = 'review-dialog jianpu-editor';
  dialog.innerHTML = `<div class="review-header"><div><span class="eyebrow">NUMBERED-NOTATION TEXT · 简谱文本</span><h2>Write a small melody.</h2></div><button id="jianpu-editor-close" class="button ghost" aria-label="Close numbered-notation editor">✕</button></div><p class="review-explanation">This uses WorldMusicHub’s specific monophonic text format. It does not read arbitrary Jianpu text, lyrics, printed scores or images. Rust validates every token and preserves your original text locally.</p><label for="jianpu-text">Score text · 乐谱文本</label><textarea id="jianpu-text" autofocus spellcheck="false" autocapitalize="off" aria-describedby="jianpu-syntax"></textarea><details id="jianpu-syntax" class="jianpu-syntax"><summary>Format guide · 格式说明</summary><ul><li>Put headers first: 1=C4, mode=major or minor, tempo=90, meter=4/4. Degree 1 is the tonic in both modes.</li><li>Separate tokens with spaces. 1–7 are notes; 0 is a rest. A plain token lasts one quarter-note beat.</li><li>Use :n/d for exact duration, such as 1:1/2. A final dot adds half the duration: 1. or 1:1/2.</li><li>An apostrophe raises an octave (1'); a comma lowers it (1,). A prefix # or b alters a scale degree.</li><li>A separate - extends the preceding note/rest by one beat. A separate | asserts a complete bar.</li><li>Chords, pickups, lyrics, repeats, underlines, octave dots and other dialects are rejected. A final incomplete bar has no closing |.</li></ul></details><div id="jianpu-editor-status" class="notice" role="status" hidden></div><div class="review-actions"><button id="jianpu-example" class="button secondary">Restore original example</button><button id="jianpu-editor-cancel" class="button secondary">Cancel</button><button id="jianpu-editor-load" class="button primary">Load practice score · 导入练习</button></div>`;
  document.body.append(dialog); $('jianpu-text').value = JIANPU_EXAMPLE;
  let controller = null; let request = 0;
  function close() { request++; controller?.abort(); controller = null; $('jianpu-editor-load').disabled = false; dialog.close(); }
  for (const id of ['jianpu-editor-close','jianpu-editor-cancel']) $(id).addEventListener('click', close);
  dialog.addEventListener('cancel', () => { request++; controller?.abort(); controller = null; $('jianpu-editor-load').disabled = false; });
  for (const id of ['jianpu-editor-button','mobile-jianpu-button']) $(id).addEventListener('click', () => { pausePlayback(); $('jianpu-editor-status').hidden = true; dialog.showModal(); });
  function cancelPendingEdit() { if (controller) { request++; controller.abort(); controller = null; $('jianpu-editor-load').disabled = false; $('jianpu-editor-status').textContent = 'Text changed. Load the updated draft when you are ready.'; } }
  $('jianpu-text').addEventListener('input', cancelPendingEdit);
  $('jianpu-example').addEventListener('click', () => { cancelPendingEdit(); $('jianpu-text').value = JIANPU_EXAMPLE; $('jianpu-editor-status').hidden = true; });
  $('jianpu-editor-load').addEventListener('click', async () => {
    const text = $('jianpu-text').value;
    $('jianpu-editor-status').hidden = false;
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) { $('jianpu-editor-status').textContent = 'This format is limited to 1 MiB of UTF-8 text. Use a smaller fragment.'; return; }
    const current = ++request; controller?.abort(); controller = new AbortController(); $('jianpu-editor-load').disabled = true;
    $('jianpu-editor-status').textContent = 'Validating notes, durations and barlines with Rust…';
    try { const loaded = await onImport(text, controller.signal); if (current !== request) return; if (loaded) { controller = null; dialog.close(); } else $('jianpu-editor-status').textContent = 'The score was not loaded. Check the import message and correct the text.'; }
    catch (error) { if (current === request && error.name !== 'AbortError') $('jianpu-editor-status').textContent = error.message; }
    finally { if (current === request) { controller = null; $('jianpu-editor-load').disabled = false; } }
  });
}
