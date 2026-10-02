import {getAppI18n} from './app-locale.js';
import {createReviewLocale} from './review-locale.js';
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
export function setupJianpuEditor({onImport, pausePlayback, document = globalThis.document, i18n = getAppI18n(document)}) {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog'); dialog.id = 'jianpu-editor'; dialog.className = 'review-dialog jianpu-editor';
  dialog.innerHTML = `<div class="review-header"><div><span class="eyebrow"><span data-review-i18n="review.jianpu.eyebrow"></span></span><h2><span data-review-i18n="review.jianpu.title"></span></h2></div><button id="jianpu-editor-close" class="button ghost" aria-label="" data-review-i18n-aria-label="review.jianpu.closeAria">✕</button></div><p class="review-explanation session-replacement-note"><span data-review-i18n="review.replacement"></span></p><p class="review-explanation"><span data-review-i18n="review.jianpu.explanation"></span></p><label for="jianpu-text"><span data-review-i18n="review.jianpu.scoreText"></span></label><textarea id="jianpu-text" autofocus spellcheck="false" autocapitalize="off" aria-describedby="jianpu-syntax"></textarea><details id="jianpu-syntax" class="jianpu-syntax"><summary><span data-review-i18n="review.jianpu.guide"></span></summary><ul><li><span data-review-i18n="review.jianpu.syntaxHeaders"></span></li><li><span data-review-i18n="review.jianpu.syntaxTokens"></span></li><li><span data-review-i18n="review.jianpu.syntaxDuration"></span></li><li><span data-review-i18n="review.jianpu.syntaxOctave"></span></li><li><span data-review-i18n="review.jianpu.syntaxExtend"></span></li><li><span data-review-i18n="review.jianpu.syntaxLimits"></span></li></ul></details><div id="jianpu-editor-status" class="notice" role="status" hidden></div><div class="review-actions"><button id="jianpu-example" class="button secondary"><span data-review-i18n="review.jianpu.example"></span></button><button id="jianpu-editor-cancel" class="button secondary"><span data-review-i18n="review.jianpu.cancel"></span></button><button id="jianpu-editor-load" class="button primary"><span data-review-i18n="review.jianpu.load"></span></button></div>`;
  document.body.append(dialog); const locale = createReviewLocale(dialog, i18n), {m} = locale;
  const status = message => locale.text($('jianpu-editor-status'), message);
  $('jianpu-text').value = JIANPU_EXAMPLE;
  let controller = null; let request = 0;
  function close() { request++; controller?.abort(); controller = null; $('jianpu-editor-load').disabled = false; dialog.close(); }
  for (const id of ['jianpu-editor-close','jianpu-editor-cancel']) $(id).addEventListener('click', close);
  dialog.addEventListener('cancel', () => { request++; controller?.abort(); controller = null; $('jianpu-editor-load').disabled = false; });
  for (const id of ['jianpu-editor-button','mobile-jianpu-button']) $(id).addEventListener('click', () => { pausePlayback(); $('jianpu-editor-status').hidden = true; dialog.showModal(); });
  function cancelPendingEdit() { if (controller) { request++; controller.abort(); controller = null; $('jianpu-editor-load').disabled = false; status(m('review.jianpu.changed')); } }
  $('jianpu-text').addEventListener('input', cancelPendingEdit);
  $('jianpu-example').addEventListener('click', () => { cancelPendingEdit(); $('jianpu-text').value = JIANPU_EXAMPLE; $('jianpu-editor-status').hidden = true; });
  $('jianpu-editor-load').addEventListener('click', async () => {
    const text = $('jianpu-text').value;
    $('jianpu-editor-status').hidden = false;
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) { status(m('review.jianpu.limit')); return; }
    const current = ++request; controller?.abort(); controller = new AbortController(); $('jianpu-editor-load').disabled = true;
    status(m('review.jianpu.pending'));
    try { const loaded = await onImport(text, controller.signal); if (current !== request) return; if (loaded) { controller = null; dialog.close(); } else status(m('review.jianpu.notLoaded')); }
    catch (error) { if (current === request && error.name !== 'AbortError') status(locale.error(error)); }
    finally { if (current === request) { controller = null; $('jianpu-editor-load').disabled = false; } }
  });
  return {close, destroy(){close(); locale.destroy(); dialog.remove();}};
}
