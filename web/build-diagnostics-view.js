import {getAppI18n} from './app-locale.js';
import {buildDiagnosticsText, readBuildDiagnostics} from './build-diagnostics.js';

const COPY = {
  en: {
    title: 'Version & diagnostics',
    help: 'Read this app’s compiled Rust build and running process. Reading is local. Package versions do not establish an exact source revision.',
    privacy: 'The full executable path below may contain your username. Copied text excludes that path unless you select the option below. Diagnostics contain no music or library contents.',
    hashNote: 'The hash describes the file at the executable path when first read, not the loaded memory image. That snapshot is cached for this process. Refresh checks for changes; it does not hash the file again.',
    browserNote: 'The source revision of the browser assets is unknown. The Rust build below does not identify the JavaScript currently loaded in the page.',
    read: 'Read build information', refresh: 'Refresh build information', copy: 'Copy diagnostics', select: 'Select diagnostic text', includePath: 'Include full path when copying', report: 'Diagnostic text',
    idle: 'Build identity has not been read. Source revision and process identity are unknown.',
    loading: 'Reading build information…', ready: 'Build information received. Unavailable fields remain unknown.',
    unsupported: 'This app does not support build diagnostics. Its exact source revision and process identity are unknown.',
    unavailable: 'Build information could not be read. Retry when this app is available.',
    invalid: 'The app returned unreadable build information. The unverified identity remains unknown.',
    timeout: 'Reading build information timed out. Retry to read the identity.',
    cancelled: 'Reading was cancelled. Read again to check the identity.',
    copying: 'Copying diagnostic text…', copied: 'Diagnostic text copied.', fallback: 'Clipboard access is unavailable. Select the diagnostic text and copy it manually.', selected: 'Diagnostic text selected. Copy it manually.',
    unknown: 'Unknown', clean: 'Clean at compile time', dirty: 'Uncommitted changes at compile time', sourceUnavailable: 'Source identity unavailable',
    desktop: 'Native desktop app', browser: 'Browser with local Rust server',
    ok: 'Recorded file hash', unavailableHash: 'Unknown: file hash unavailable', too_large: 'Unknown: file exceeds hashing limit', changed: 'Unknown: executable path or file changed since the snapshot',
    packageVersion: 'Rust package version', sourceSha: 'Compiled source HEAD SHA', sourceTree: 'Compiled source HEAD tree', sourceCount: 'Compiled source commit count', sourceStatus: 'Compiled source state', sourceError: 'Source diagnostic code', target: 'Compilation target',
    runtime: 'Runtime', transport: 'Transport', processId: 'Running process ID', os: 'Operating system', arch: 'Architecture', path: 'Actual executable path', hashStatus: 'Executable file hash status', hash: 'File SHA-256 at recorded path', size: 'Recorded executable file bytes', checkedAt: 'File snapshot checked at (UTC)', executableError: 'Executable diagnostic code',
  },
  'zh-CN': {
    title: '版本与诊断',
    help: '读取此应用编译时的 Rust 构建信息和实际运行进程。读取仅在本地进行。软件版本号不能确定具体源码版本。',
    privacy: '下方完整可执行文件路径可能包含用户名。默认复制不包含此路径，只有勾选下方选项后才会加入。诊断不包含乐曲或曲库内容。',
    hashNote: '哈希对应首次读取时可执行文件路径上的文件，不是已加载的内存映像。此进程会缓存该快照；刷新仅检查变化，不会重新计算哈希。',
    browserNote: '浏览器页面资源的源码版本未知。下方 Rust 构建信息不能证明页面当前加载的 JavaScript 版本。',
    read: '读取构建信息', refresh: '刷新构建信息', copy: '复制诊断信息', select: '选择诊断文本', includePath: '复制时包含完整路径', report: '诊断文本',
    idle: '尚未读取构建信息。源码版本和进程身份未知。', loading: '正在读取构建信息…', ready: '已读取构建信息。无法确认的字段仍显示未知。',
    unsupported: '此应用不支持构建诊断。具体源码版本和进程身份未知。', unavailable: '无法读取构建信息。请在此应用可用时重试。',
    invalid: '应用返回了无法确认的构建信息，未经验证的身份仍为未知。', timeout: '读取构建信息超时。请重试。', cancelled: '已取消读取。请重新读取以确认身份。',
    copying: '正在复制诊断文本…', copied: '已复制诊断文本。', fallback: '剪贴板不可用。请选择诊断文本并手动复制。', selected: '已选择诊断文本，请手动复制。',
    unknown: '未知', clean: '编译时无未提交改动', dirty: '编译时有未提交改动', sourceUnavailable: '源码身份不可用', desktop: '原生桌面应用', browser: '浏览器与本地 Rust 服务',
    ok: '已记录文件哈希', unavailableHash: '未知：文件哈希不可用', too_large: '未知：文件超过哈希大小上限', changed: '未知：可执行文件路径或文件在快照后发生变化',
    packageVersion: 'Rust 软件版本', sourceSha: '编译源码 HEAD SHA', sourceTree: '编译源码 HEAD 树', sourceCount: '编译源码提交数', sourceStatus: '编译源码状态', sourceError: '源码诊断代码', target: '编译目标平台',
    runtime: '运行方式', transport: '连接方式', processId: '实际运行进程 ID', os: '操作系统', arch: '体系结构', path: '实际可执行文件路径', hashStatus: '可执行文件哈希状态', hash: '已记录路径文件的 SHA-256', size: '已记录可执行文件字节数', checkedAt: '文件快照检查时间（UTC）', executableError: '可执行文件诊断代码',
  },
};
const ROWS = ['runtime', 'transport', 'packageVersion', 'sourceSha', 'sourceTree', 'sourceCount', 'sourceStatus', 'sourceError', 'target', 'processId', 'os', 'arch', 'path', 'hashStatus', 'hash', 'size', 'checkedAt', 'executableError'];

/** Install inside the existing Settings modal, whose open path owns playback pause. */
export function setupBuildDiagnosticsView({document = globalThis.document, i18n = getAppI18n(document), fetcher = globalThis.fetch, origin = globalThis.location?.origin,
  clipboard = () => globalThis.navigator?.clipboard, timeoutMs = 10000, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout} = {}) {
  const dialog = document.getElementById('settings-dialog'), host = dialog?.querySelector('.shell-dialog-content');
  if (!host) throw new Error('Set up Settings before build diagnostics.');
  if (document.getElementById('build-diagnostics')) throw new Error('Build diagnostics are already initialized.');
  const section = document.createElement('section');section.id = 'build-diagnostics';section.className = 'build-diagnostics';section.dataset.keyboardInput = 'off';section.setAttribute('aria-labelledby', 'build-diagnostics-title');
  // Only fixed markup; server strings go through textContent or textarea.value.
  section.innerHTML = '<h3 id="build-diagnostics-title"></h3><p id="build-diagnostics-help"></p><button type="button" class="button secondary" id="build-diagnostics-read"></button><p id="build-diagnostics-status" role="status" aria-live="polite"></p><dl id="build-diagnostics-fields"></dl><p id="build-diagnostics-hash-note"></p><p id="build-diagnostics-browser-note"></p><p id="build-diagnostics-privacy"></p><label class="build-diagnostics-path-choice"><input type="checkbox" id="build-diagnostics-include-path"><span id="build-diagnostics-path-label"></span></label><label for="build-diagnostics-text" id="build-diagnostics-text-label"></label><textarea id="build-diagnostics-text" readonly rows="12" spellcheck="false" wrap="soft" aria-describedby="build-diagnostics-privacy"></textarea><div class="build-diagnostics-actions"><button type="button" class="button secondary" id="build-diagnostics-copy"></button><button type="button" class="button secondary" id="build-diagnostics-select"></button></div><p id="build-diagnostics-copy-status" role="status" aria-live="polite"></p>';
  host.append(section);
  const $ = id => section.querySelector(`#build-diagnostics-${id}`), rows = new Map();
  for (const key of ROWS) {
    const row = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
    value.id = `build-diagnostics-value-${key}`;row.append(label, value);$('fields').append(row);rows.set(key, {label, value});
  }
  let model = null, state = 'idle', copyState = '', request = null, timer = null, copyTimer = null, generation = 0, copyGeneration = 0, disposed = false;
  const visible = () => !disposed && dialog.open && !document.hidden;
  function render() {
    if (disposed) return;
    const t = COPY[i18n.locale === 'en' ? 'en' : 'zh-CN'], source = model?.compiled ?? {}, process = model?.native ?? {};
    const labels = {title: 'title', help: 'help', 'hash-note': 'hashNote', 'browser-note': 'browserNote', privacy: 'privacy', 'path-label': 'includePath', 'text-label': 'report', copy: 'copy', select: 'select'};
    for (const [id, key] of Object.entries(labels)) $(id).textContent = t[key];
    $('read').textContent = t[state === 'idle' ? 'read' : 'refresh'];$('read').setAttribute('aria-disabled', String(state === 'loading'));
    section.setAttribute('aria-busy', String(state === 'loading'));section.dataset.state = state;
    $('copy').setAttribute('aria-disabled', String(state === 'loading' || copyState === 'copying'));
    $('status').textContent = t[state];$('copy-status').textContent = copyState ? t[copyState] : '';
    const values = {
      runtime: process.transport === 'native-protocol-no-listener' ? t.desktop : process.transport === 'loopback-only' ? t.browser : t.unknown,
      transport: process.transport === 'unknown' ? t.unknown : process.transport,
      packageVersion: source.package_version, sourceSha: source.source_sha, sourceTree: source.source_tree, sourceCount: source.source_commit_count,
      sourceStatus: source.source_status === 'clean' ? t.clean : source.source_status === 'dirty' ? t.dirty : source.source_status === 'unavailable' ? t.sourceUnavailable : t.unknown,
      sourceError: source.source_error, target: source.target, processId: process.process_id, os: process.os, arch: process.arch, path: process.executable_path,
      hashStatus: process.executable_hash_status === 'unavailable' ? t.unavailableHash : t[process.executable_hash_status] ?? t.unknown,
      hash: process.executable_sha256, size: process.executable_bytes,
      checkedAt: process.executable_checked_at_unix_ms === null || process.executable_checked_at_unix_ms === undefined ? null : new Date(process.executable_checked_at_unix_ms).toISOString(),
      executableError: process.executable_error,
    };
    for (const [key, nodes] of rows) { nodes.label.textContent = t[key];nodes.value.textContent = values[key] === null || values[key] === undefined ? t.unknown : String(values[key]); }
    const report = buildDiagnosticsText(model, {status: state, includePath: $('include-path').checked === true});
    // Keep manual selection intact when only a status or the language changes.
    if ($('text').value !== report) $('text').value = report;
  }
  function cancelCopy() { copyGeneration++;if (copyTimer !== null) clearTimer(copyTimer);copyTimer = null;copyState = ''; }
  function cancelRead() {
    generation++;if (timer !== null) clearTimer(timer);timer = null;request?.abort();request = null;
    if (state === 'loading') state = 'cancelled';
  }
  async function read() {
    if (!visible() || state === 'loading') return;
    cancelCopy();const ticket = ++generation, controller = new AbortController();request = controller;model = null;state = 'loading';let timedOut = false;render();
    timer = setTimer(() => { timedOut = true;controller.abort(); }, timeoutMs);
    try {
      const result = await readBuildDiagnostics({fetcher, origin, signal: controller.signal});
      if (disposed || ticket !== generation || !visible()) return;
      model = result;state = 'ready';
    } catch (error) {
      if (disposed || ticket !== generation || !visible()) return;
      state = timedOut ? 'timeout' : ['unsupported', 'invalid', 'unavailable'].includes(error?.code) ? error.code : error?.name === 'AbortError' ? 'cancelled' : 'unavailable';
    } finally {
      if (ticket === generation) { if (timer !== null) clearTimer(timer);timer = null;request = null;render(); }
    }
  }
  function selectText() {
    const textarea = $('text');
    try { textarea.focus({preventScroll: true});textarea.select(); }
    catch { try { textarea.setSelectionRange(0, textarea.value.length); } catch { /* Text stays visible and selectable. */ } }
  }
  async function copy() {
    if (!visible() || state === 'loading' || copyState === 'copying') return;
    const ticket = ++copyGeneration, report = $('text').value;
    copyState = 'copying';render();
    const fallback = () => { if (disposed || ticket !== copyGeneration || !visible()) return;copyGeneration++;if (copyTimer !== null) clearTimer(copyTimer);copyTimer = null;copyState = 'fallback';render();selectText(); };
    try {
      const target = clipboard();
      if (typeof target?.writeText !== 'function') { fallback();return; }
      copyTimer = setTimer(fallback, 5000);
      // Called only by this explicit Copy action, never by render, read or refresh.
      await target.writeText(report);
      if (disposed || ticket !== copyGeneration || !visible()) return;
      if (copyTimer !== null) clearTimer(copyTimer);copyTimer = null;copyState = 'copied';render();
    } catch { fallback(); }
  }
  const onRead = () => { void read(); }, onCopy = () => { void copy(); };
  const onSelect = () => { if (!visible()) return;cancelCopy();copyState = 'selected';render();selectText(); };
  const onPath = () => { cancelCopy();render(); };
  const onClose = () => { cancelRead();cancelCopy();$('include-path').checked = false;render(); };
  const onHidden = () => { if (document.hidden) onClose(); };
  $('read').addEventListener('click', onRead);$('copy').addEventListener('click', onCopy);$('select').addEventListener('click', onSelect);$('include-path').addEventListener('change', onPath);
  dialog.addEventListener('close', onClose);dialog.addEventListener('cancel', onClose);document.addEventListener('visibilitychange', onHidden);document.defaultView?.addEventListener('pagehide', onClose);
  const unsubscribe = i18n.subscribe(render);render();
  return {element: section, destroy() {
    if (disposed) return;
    cancelRead();cancelCopy();disposed = true;unsubscribe();
    $('read').removeEventListener('click', onRead);$('copy').removeEventListener('click', onCopy);$('select').removeEventListener('click', onSelect);$('include-path').removeEventListener('change', onPath);
    dialog.removeEventListener('close', onClose);dialog.removeEventListener('cancel', onClose);document.removeEventListener('visibilitychange', onHidden);document.defaultView?.removeEventListener('pagehide', onClose);section.remove();
  }};
}
