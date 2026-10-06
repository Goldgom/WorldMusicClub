import {getAppI18n} from './app-locale.js';
import {importSkinFiles, openSkinStorage, restoreSkinRecord, skinRecord} from './skin-storage.js';

const COPY = {
  en: {
    title: 'Piano skin', choice: 'Installed skin', builtin: 'Built-in appearance', empty: 'No imported skin',
    manifest: 'Skin JSON (v1, up to 64 KiB)', image: 'Referenced background PNG (optional, up to 2 MiB)',
    import: 'Import and use skin', use: 'Use selected skin', reset: 'Reset to built-in appearance',
    help: 'One imported skin is kept on this browser profile. Import replaces it only after validation and saving succeed. Your light, dark or custom appearance preference is kept.',
    scope: 'Custom note colors, markers, patterns and piano keys are supported. Background images decorate the home artwork only. The score lane, notation ink and declarative layout remain built in.',
    loading: 'Reading the saved skin…', importing: 'Validating and saving the skin…', saving: 'Saving the skin choice…',
    ready: 'Built-in appearance is selected.', active: 'Imported skin is selected and saved for this browser profile.',
    savedDefault: 'Built-in appearance restored. Your imported skin is still available.',
    invalidSaved: 'The saved skin could not be read or validated. Built-in appearance is in use. Import a valid skin to replace it.',
    failed: 'The skin was not changed. Check the JSON and its referenced PNG, then try again.',
    storage: 'The skin was not changed because local storage is unavailable or full. Free space or reopen this browser profile and try again.',
    unavailable: 'Local skin storage is unavailable. Built-in appearance is in use; import can be retried.',
    fallback: 'Some declared images are missing or unsupported; the solid background is used.',
    background: 'Stage background images are unsupported here. A valid supplied PNG is used only as home decoration.',
    layout: 'This skin’s layout settings are unsupported here; the existing note and keyboard geometry is kept.',
    human: 'Human notes', machine: 'Accompaniment notes', attribution: 'Attribution',
  },
  'zh-CN': {
    title: '钢琴皮肤', choice: '已安装皮肤', builtin: '内置外观', empty: '尚未导入皮肤',
    manifest: '皮肤 JSON（v1，最多 64 KiB）', image: '所引用的背景 PNG（可选，最多 2 MiB）',
    import: '导入并使用皮肤', use: '使用所选皮肤', reset: '恢复内置外观',
    help: '此浏览器配置保留一个导入皮肤。验证并保存成功后才会替换。原有浅色、深色或自定义外观偏好会保留。',
    scope: '支持音符颜色、标记、纹理和钢琴键样式。背景图片仅用于首页装饰。谱面区域、记谱颜色和声明式布局仍使用内置设置。',
    loading: '正在读取已保存的皮肤…', importing: '正在验证并保存皮肤…', saving: '正在保存皮肤选择…',
    ready: '已选择内置外观。', active: '已使用导入皮肤，并保存到此浏览器配置。',
    savedDefault: '已恢复内置外观。仍可再次选择已导入的皮肤。',
    invalidSaved: '无法读取或验证已保存的皮肤，已使用内置外观。请导入有效皮肤以替换。',
    failed: '皮肤未更改。请检查 JSON 及其引用的 PNG 后重试。',
    storage: '本地存储不可用或已满，皮肤未更改。请释放空间或重新打开此浏览器配置后重试。',
    unavailable: '本地皮肤存储不可用，当前使用内置外观。可重试导入。',
    fallback: '部分声明的图片缺失或不受支持，已使用纯色背景。',
    background: '此处不支持谱面区域背景图片。所提供的有效 PNG 仅用于首页装饰。',
    layout: '此处不支持该皮肤的布局设置，保留现有音符及琴键几何布局。',
    human: '人演奏音符', machine: '伴奏音符', attribution: '来源说明',
  },
};

export function setupSkinSettings({document = globalThis.document, i18n = getAppI18n(document), runtime,
  openStorage = () => openSkinStorage(), importFiles = importSkinFiles, onChange = () => {}} = {}) {
  const host = document.querySelector('.theme-settings');
  if (!host || !runtime) return null;
  const panel = document.createElement('section');panel.className = 'skin-settings';panel.id = 'skin-settings';
  panel.dataset.keyboardInput = 'off';panel.setAttribute('aria-labelledby', 'skin-settings-title');
  // Static markup only. Skin names and attribution are assigned with textContent.
  panel.innerHTML = '<h3 id="skin-settings-title"></h3><p id="skin-help"></p><p id="skin-scope"></p><label><span id="skin-choice-label"></span><select id="skin-choice"><option value="default"></option><option value="imported" disabled></option></select></label><div class="skin-actions"><button id="skin-use" type="button" class="button secondary"></button><button id="skin-reset" type="button" class="button secondary"></button></div><label><span id="skin-manifest-label"></span><input id="skin-manifest" type="file" accept=".json,application/json"></label><label><span id="skin-image-label"></span><input id="skin-image" type="file" accept=".png,image/png"></label><button id="skin-import" type="button" class="button secondary"></button><p id="skin-status" role="status" aria-live="polite"></p><ul id="skin-diagnostics"></ul><p id="skin-attribution"></p><div id="skin-legend"><span><i data-skin-legend="human" aria-hidden="true"></i><span id="skin-human-label"></span></span><span><i data-skin-legend="machine" aria-hidden="true"></i><span id="skin-machine-label"></span></span></div>';
  host.append(panel);
  const $ = id => panel.querySelector(`#${id}`), choice = $('skin-choice'), file = $('skin-manifest'), image = $('skin-image');
  const builtin = choice.querySelector('[value="default"]'), imported = choice.querySelector('[value="imported"]');
  let selected = 'default', installed = null, diagnostics = [], storage = null, busy = true, disposed = false;
  let status = 'loading', detail = '', generation = 0;
  const copy = () => COPY[i18n.locale === 'en' ? 'en' : 'zh-CN'];
  const setChoice = value => { choice.value = value; };
  function render() {
    const text = copy();
    for (const [id, key] of Object.entries({'skin-settings-title': 'title', 'skin-help': 'help', 'skin-scope': 'scope',
      'skin-choice-label': 'choice', 'skin-manifest-label': 'manifest', 'skin-image-label': 'image', 'skin-import': 'import',
      'skin-use': 'use', 'skin-reset': 'reset', 'skin-human-label': 'human', 'skin-machine-label': 'machine'})) $(id).textContent = text[key];
    builtin.textContent = text.builtin;imported.textContent = installed?.resolved.skin.name ?? text.empty;imported.disabled = !installed;
    panel.setAttribute('aria-busy', String(busy));panel.dataset.selected = selected;
    for (const node of [choice, file, image]) node.disabled = busy;
    // Keep the initiating button focusable while saving. Native disabled would
    // discard its focus; the guarded action handler owns duplicate admission.
    for (const node of [$('skin-import'), $('skin-use'), $('skin-reset')]) node.setAttribute('aria-disabled', String(busy || node.id === 'skin-import' && !file.files?.length));
    $('skin-status').textContent = text[status] + (detail ? ` (${detail})` : '');
    $('skin-attribution').textContent = installed ? `${text.attribution}: ${installed.resolved.skin.author} · ${installed.resolved.skin.license} · ${installed.resolved.skin.attribution}` : '';
    const messages = [];
    if (diagnostics.some(item => item.code === 'skin_feature_unsupported' && item.path === 'layout_bands')) messages.push(text.layout);
    if (diagnostics.some(item => item.code === 'skin_feature_unsupported' && item.path === 'background_image')) messages.push(text.background);
    if (diagnostics.some(item => item.code !== 'skin_feature_unsupported')) messages.push(text.fallback);
    $('skin-diagnostics').replaceChildren(...messages.map(message => { const row = document.createElement('li');row.textContent = message;return row; }));
    $('skin-legend').hidden = selected !== 'imported';
    if (selected === 'imported') for (const role of ['human', 'machine']) {
      const marker = panel.querySelector(`[data-skin-legend="${role}"]`), note = installed.resolved.skin.notes[role];
      marker.dataset.marker = note.marker;marker.dataset.pattern = note.pattern;
      marker.style.backgroundColor = note.fill;marker.style.color = note.outline;
    }
  }
  async function connection() {
    if (storage) return storage;
    const opened = await openStorage();
    if (disposed) { opened.close();throw new Error('Skin settings closed'); }
    return storage = opened;
  }
  async function commit(nextSelected, nextInstalled, ticket) {
    const db = await connection();
    if (disposed || ticket !== generation) return;
    await db.write(skinRecord(nextSelected, nextInstalled));
    if (disposed || ticket !== generation) return;
    // Persistence succeeds before any visual change. A failed replacement never
    // removes the currently displayed skin or its saved bytes.
    selected = nextSelected;installed = nextInstalled;
    diagnostics = runtime.apply(selected === 'imported' ? installed.resolved : null);
    setChoice(selected);status = selected === 'imported' ? 'active' : installed ? 'savedDefault' : 'ready';detail = '';
    onChange();
  }
  async function action(kind) {
    if (busy || disposed || kind === 'import' && !file.files?.length) return;
    const ticket = ++generation;busy = true;status = kind === 'import' ? 'importing' : 'saving';detail = '';render();
    try {
      if (kind === 'import') {
        const next = await importFiles(file.files?.[0], image.files?.[0] ?? null);
        if (disposed || ticket !== generation) return;
        await commit('imported', next, ticket);
      } else await commit(kind === 'reset' ? 'default' : choice.value, installed, ticket);
    } catch (error) {
      if (disposed || ticket !== generation) return;
      status = error?.code?.startsWith('skin_storage_') ? 'storage' : 'failed';
      detail = typeof error?.code === 'string' ? error.code : '';
      if (status === 'storage') { storage?.close();storage = null; }
      setChoice(selected);
    } finally { if (!disposed && ticket === generation) { busy = false;render(); } }
  }
  const onImport = () => { void action('import'); }, onUse = () => { void action('use'); }, onReset = () => { void action('reset'); };
  $('skin-import').addEventListener('click', onImport);$('skin-use').addEventListener('click', onUse);$('skin-reset').addEventListener('click', onReset);
  file.addEventListener('change', render);
  const unsubscribe = i18n.subscribe(render);
  const ready = (async () => {
    const ticket = ++generation;
    try {
      const db = await connection(), record = await db.read(), restored = await restoreSkinRecord(record);
      if (disposed || ticket !== generation) return;
      selected = restored.selected;installed = restored.installed;
      diagnostics = runtime.apply(selected === 'imported' ? installed.resolved : null);
      setChoice(selected);status = selected === 'imported' ? 'active' : 'ready';
      onChange();
    } catch (error) {
      if (disposed || ticket !== generation) return;
      status = ['skin_storage_unavailable', 'skin_storage_blocked'].includes(error?.code) ? 'unavailable' : 'invalidSaved';
    } finally { if (!disposed && ticket === generation) { busy = false;render(); } }
  })();
  render();
  return {ready, destroy() { disposed = true;generation++;unsubscribe();storage?.close();file.removeEventListener('change', render);
    $('skin-import').removeEventListener('click', onImport);$('skin-use').removeEventListener('click', onUse);$('skin-reset').removeEventListener('click', onReset);panel.remove(); }};
}
