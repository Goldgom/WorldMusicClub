import { PracticeModel, EXERCISE, DEGREES, OPEN_STRINGS, TOTAL_BEATS, pitchName, formatTime } from './model.js';
import { translate } from './locales.js';

export function mountApp(document, window) {
  const $ = (id) => document.getElementById(id);
  const model = new PracticeModel(() => window.performance.now());
  let locale = 'zh-CN', theme = 'dark', screen = 'lobby', hasSession = false;
  let sound = true, audio = null, noticeTimer, lastInputPitch = null, lastFrameKey = '', lastScheduled = -1;
  const held = new Map(), voices = new Set();
  const ctx = $('stage').getContext?.('2d');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const t = (key, params) => translate(locale, key, params);
  // Preferences only. No exercise, input, or session data is persisted by this spike.
  try {
    const saved = JSON.parse(window.localStorage.getItem('wmh-ui-spike.preferences') || '{}');
    if (['zh-CN', 'en'].includes(saved.locale)) locale = saved.locale;
    if (['dark', 'light'].includes(saved.theme)) theme = saved.theme;
  } catch { /* Private browsing or corrupt preferences: Chinese/dark defaults. */ }
  const savePreferences = () => { try { window.localStorage.setItem('wmh-ui-spike.preferences', JSON.stringify({ locale, theme })); } catch {} };
  function showNotice(key) {
    $('notice').textContent = t(key);
    $('notice').dataset.key = key;
    $('notice').hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { $('notice').hidden = true; }, 3500);
  }
  function stopVoices() {
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices.clear();
    lastScheduled = -1;
  }
  async function unlockAudio() {
    if (!sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('audio unavailable');
      audio ||= new AudioContext();
      if (audio.state === 'suspended') await audio.resume();
    } catch { sound = false; showNotice('soundUnavailable'); render(); }
  }
  function tone(pitch, delay = 0, length = 0.3) {
    if (!sound || !audio || audio.state !== 'running') return;
    const start = audio.currentTime + Math.max(0, delay);
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.14, start + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    voices.add(oscillator); oscillator.start(start); oscillator.stop(start + length + 0.02);
  }
  function scheduleAudio() {
    if (screen !== 'practice' || model.status !== 'playing' || model.mode !== 'guided' || !sound) return;
    const snap = model.snapshot();
    if (snap.status !== 'playing') return;
    const horizon = snap.position + 0.1 * snap.bpm / 60;
    for (const note of EXERCISE) {
      if (note.beat > lastScheduled && note.beat >= snap.position - 0.07 * snap.bpm / 60 && note.beat < horizon) {
        tone(note.pitch, (note.beat - snap.position) * 60 / snap.bpm, Math.min(.5, 0.7 * 60 / snap.bpm));
        lastScheduled = note.beat;
      }
    }
  }
  function clearHeld() { held.clear(); refreshHeld(); }
  function refreshHeld() {
    const pitches = new Set(held.values());
    for (const element of document.querySelectorAll('[data-pitch]')) element.classList.toggle('is-held', pitches.has(Number(element.dataset.pitch)));
  }
  async function press(pitch, source, token) {
    if (screen !== 'practice' || held.has(token)) return;
    held.set(token, pitch); lastInputPitch = pitch;
    model.input(pitch, source);
    refreshHeld(); render();
    await unlockAudio();
    if (screen === 'practice' && held.has(token)) tone(pitch);
  }
  function release(token) { held.delete(token); refreshHeld(); }
  function pause(reason) {
    const wasPlaying = model.status === 'playing';
    model.pause(); stopVoices(); clearHeld(); render();
    if (wasPlaying && reason) showNotice(reason);
  }
  function navigate(destination) {
    if (destination === 'lobby') pause();
    screen = destination;
    $('lobby').hidden = screen !== 'lobby';
    $('practice').hidden = screen !== 'practice';
    $('resume-session').hidden = !hasSession;
    window.history.replaceState(null, '', screen === 'lobby' ? '#lobby' : '#practice');
    render(true); draw();
    $('main').focus({ preventScroll: true });
  }
  function start(mode) {
    stopVoices(); clearHeld(); model.reset(mode); lastInputPitch = null; hasSession = true;
    buildScore(); navigate('practice');
  }
  function buildFretboard() {
    const board = $('fretboard'); board.replaceChildren();
    board.append(document.createElement('span'));
    for (let fret = 0; fret <= 12; fret++) {
      const label = document.createElement('span'); label.className = 'fret-label';
      label.textContent = fret === 0 ? '0' : String(fret); board.append(label);
    }
    OPEN_STRINGS.forEach((pitch, index) => {
      const label = document.createElement('span'); label.className = 'string-label';
      label.textContent = `${index + 1} ${['E', 'B', 'G', 'D', 'A', 'E'][index]}`;
      label.setAttribute('aria-label', t('stringLabel', { string: index + 1 })); board.append(label);
      for (let fret = 0; fret <= 12; fret++) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'fret';
        button.dataset.pitch = String(pitch + fret); button.dataset.fret = String(fret); button.dataset.string = String(index + 1);
        const chosen = index === 1 ? DEGREES.find(note => note.fret === fret) : null;
        const dot = document.createElement('span'); dot.textContent = chosen ? String(chosen.degree) : String(fret);
        if (chosen) button.classList.add('on-path');
        button.append(dot); board.append(button);
        const token = `fret-${index}-${fret}`;
        button.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          button.setPointerCapture?.(event.pointerId);
          press(pitch + fret, 'pointer', token);
        });
        button.addEventListener('pointerup', () => release(token));
        button.addEventListener('pointercancel', () => release(token));
        button.addEventListener('lostpointercapture', () => release(token));
        button.addEventListener('click', (event) => {
          if (event.detail !== 0) return;
          press(pitch + fret, 'button', token);
          window.setTimeout(() => release(token), 200);
        });
      }
    });
    const shortcuts = $('shortcut-keys'); shortcuts.replaceChildren();
    for (const note of DEGREES) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = String(note.degree);
      button.dataset.pitch = String(note.pitch); button.dataset.degree = String(note.degree);
      button.addEventListener('click', () => { const token = `shortcut-${note.degree}`; press(note.pitch, 'button', token); window.setTimeout(() => release(token), 220); });
      shortcuts.append(button);
    }
  }
  function buildScore() {
    const content = $('score-content'); content.replaceChildren();
    if (model.mode === 'free') {
      const empty = document.createElement('p'); empty.className = 'empty-input'; empty.id = 'empty-input'; content.append(empty);
      const recent = document.createElement('div'); recent.className = 'recent-inputs'; recent.id = 'recent-inputs'; content.append(recent);
      return;
    }
    for (let measure = 1; measure <= 8; measure++) {
      const row = document.createElement('div'); row.className = 'score-measure';
      const label = document.createElement('span'); label.className = 'measure-number'; label.textContent = String(measure).padStart(2, '0'); row.append(label);
      for (const note of EXERCISE.filter(note => note.measure === measure)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'score-note';
        button.dataset.index = String(note.beat);
        const strong = document.createElement('strong'); strong.textContent = String(note.degree);
        const small = document.createElement('small'); small.textContent = note.name;
        button.append(strong, small);
        button.addEventListener('click', () => { stopVoices(); model.seek(note.beat); render(true); draw(); });
        row.append(button);
      }
      content.append(row);
    }
  }
  function localize() {
    document.documentElement.lang = locale; document.documentElement.dataset.theme = theme;
    document.title = t('pageTitle'); $('locale').value = locale;
    for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
    for (const element of document.querySelectorAll('[data-title]')) element.title = t(element.dataset.title);
    for (const element of document.querySelectorAll('[data-aria]')) element.setAttribute('aria-label', t(element.dataset.aria));
    for (const element of document.querySelectorAll('.fret')) {
      const name = t('fretNote', { string: element.dataset.string, fret: element.dataset.fret, note: pitchName(Number(element.dataset.pitch)) });
      element.setAttribute('aria-label', name); element.title = name;
    }
    for (const element of document.querySelectorAll('.string-label')) element.setAttribute('aria-label', t('stringLabel', { string: element.textContent.split(' ')[0] }));
    for (const element of document.querySelectorAll('#shortcut-keys button')) element.setAttribute('aria-label', `${t('keyboardHint', { key: element.dataset.degree })}, ${pitchName(Number(element.dataset.pitch))}`);
    for (const element of document.querySelectorAll('.score-note')) {
      const note = EXERCISE[Number(element.dataset.index)];
      element.setAttribute('aria-label', `${t('measure', { current: note.measure, total: 8 })}, ${note.degree}, ${note.name}, ${t('notePosition', note)}`);
    }
    $('theme-label').textContent = t(theme); $('theme').setAttribute('aria-label', `${t('theme')}: ${t(theme)}`);
    $('notice').textContent = $('notice').dataset.key ? t($('notice').dataset.key) : '';
    $('score-heading').textContent = t(model.mode === 'free' ? 'recentInputs' : 'scoreTitle');
    $('score-subtitle').textContent = t(model.mode === 'free' ? 'localSession' : 'scoreSubtitle');
    $('score-help').textContent = t(model.mode === 'free' ? 'recentHelp' : 'scoreHelp');
    $('practice-heading').textContent = t(model.mode === 'free' ? 'freeTitle' : 'songTitle');
    $('mode-label').textContent = t(model.mode);
    $('path-heading').textContent = t(model.mode === 'free' ? 'freeCurrent' : 'path');
    $('path-detail').hidden = model.mode === 'free';
    $('tempo').disabled = model.mode === 'free';
    $('progress').disabled = model.mode === 'free';
    $('duration').textContent = model.mode === 'free' ? t('elapsed') : formatTime(TOTAL_BEATS * 60 / model.bpm);
  }
  function render(full = false) {
    const snap = model.snapshot();
    const frameKey = `${snap.index}:${snap.status}:${snap.inputCount}:${locale}:${theme}:${snap.mode}:${sound}`;
    $('elapsed').textContent = formatTime(snap.seconds);
    $('progress').value = String(snap.position);
    $('progress').setAttribute('aria-valuetext', `${Math.round(snap.progress * 100)}%`);
    if (!full && frameKey === lastFrameKey) return;
    lastFrameKey = frameKey;
    localize();
    $('practice').dataset.status = snap.status; $('practice').dataset.mode = snap.mode;
    $('status').textContent = t(snap.status); $('input-count').textContent = String(snap.inputCount);
    const playKey = { ready: 'play', playing: 'pause', paused: 'resume', finished: 'replay' }[snap.status];
    $('play-label').textContent = t(playKey); $('play-icon').textContent = snap.status === 'playing' ? 'Ⅱ' : '▶';
    $('sound-label').textContent = t(sound ? 'soundOn' : 'soundOff'); $('sound').setAttribute('aria-pressed', String(sound));
    $('sound').setAttribute('aria-label', `${t('sound')}: ${t(sound ? 'soundOn' : 'soundOff')}`);
    $('stage-hint').textContent = t(snap.mode === 'free' && snap.status === 'ready' ? 'freeDetail' : 'inputHint');
    $('current-degree').textContent = snap.mode === 'free' ? '♪' : String(snap.note.degree);
    $('current-pitch').textContent = snap.mode === 'free' ? (lastInputPitch === null ? t('freeCurrent') : pitchName(lastInputPitch)) : `${snap.note.name} · ${snap.note.solfege}`;
    $('current-position').textContent = snap.mode === 'free' ? t('freeNext') : `${t('notePosition', snap.note)} · ${t('keyboardHint', { key: snap.note.degree })}`;
    const next = EXERCISE[snap.index + 1];
    $('next-note').textContent = snap.mode === 'free' ? '1 · 2 · 3 · 4 · 5 · 6 · 7' : next ? `${next.degree} / ${next.name}` : t('endNote');
    $('measure-label').textContent = snap.mode === 'free' ? t('localSession') : t('measure', { current: snap.measure, total: 8 });
    $('stage-overlay').hidden = snap.status !== 'finished' && snap.mode !== 'free';
    $('stage-overlay').replaceChildren();
    if (!$('stage-overlay').hidden) {
      const title = document.createElement('strong'), description = document.createElement('span');
      title.textContent = t(snap.mode === 'free' ? 'freeStage' : 'complete');
      description.textContent = t(snap.mode === 'free' ? 'inputHint' : 'completeBody');
      $('stage-overlay').append(title, description);
    }
    for (const element of document.querySelectorAll('.score-note')) {
      const index = Number(element.dataset.index); element.classList.toggle('active', index === snap.index);
      element.classList.toggle('past', index < snap.index);
      if (index === snap.index) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
    }
    for (const element of document.querySelectorAll('.fret')) element.classList.toggle('is-current', snap.mode === 'guided' && Number(element.dataset.string) === snap.note.string && Number(element.dataset.fret) === snap.note.fret);
    for (const element of document.querySelectorAll('#shortcut-keys button')) element.classList.toggle('is-current', snap.mode === 'guided' && Number(element.dataset.degree) === snap.note.degree);
    if (snap.mode === 'free') {
      $('empty-input').textContent = t('emptyInput'); $('empty-input').hidden = snap.inputCount > 0;
      $('recent-inputs').replaceChildren(...model.inputs.map(input => { const el = document.createElement('span'); el.textContent = pitchName(input.pitch); return el; }));
    }
    if (snap.status === 'finished') stopVoices();
  }
  function draw() {
    if (!ctx || screen !== 'practice') return;
    const canvas = $('stage'), rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const styles = window.getComputedStyle(document.documentElement), color = name => styles.getPropertyValue(name).trim();
    const snap = model.snapshot(), compact = height < 100, top = compact ? 12 : 26, bottom = height - (compact ? 12 : 24);
    const step = (bottom - top) / 5, nowX = Math.max(58, width * .19), unit = (width - nowX - 20) / 6;
    ctx.font = `${compact ? 8 : 10}px system-ui`; ctx.textAlign = 'left';
    for (let index = 0; index < 6; index++) {
      const y = top + index * step; ctx.strokeStyle = color('--canvas-line'); ctx.lineWidth = index >= 3 ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(25, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillStyle = color('--subtle'); ctx.fillText(String(index + 1), 4, y + 3);
    }
    ctx.fillStyle = color('--canvas-now'); ctx.globalAlpha = .06; ctx.fillRect(nowX - 13, 0, 26, height); ctx.globalAlpha = 1;
    ctx.strokeStyle = color('--canvas-now'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, height); ctx.stroke();
    if (snap.mode !== 'guided' || snap.status === 'finished') return;
    const position = reducedMotion ? Math.floor(snap.position) : snap.position;
    for (const note of EXERCISE) {
      const relative = note.beat - position;
      if (relative < -1 || relative > 7) continue;
      const x = nowX + relative * unit, y = top + (note.string - 1) * step;
      const active = note.beat === snap.index, noteWidth = Math.max(compact ? 26 : 34, Math.min(46, unit * .62)), noteHeight = compact ? 21 : 32;
      ctx.globalAlpha = relative < -0.2 ? .3 : 1;
      ctx.fillStyle = color(active ? '--canvas-now' : '--canvas-note');
      ctx.beginPath(); ctx.roundRect(x - noteWidth / 2, y - noteHeight / 2, noteWidth, noteHeight, compact ? 5 : 8); ctx.fill();
      if (active) {ctx.strokeStyle = color('--text'); ctx.lineWidth = 1.5; ctx.stroke();}
      ctx.fillStyle = color('--canvas-text'); ctx.font = `600 ${compact ? 12 : 17}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText(String(note.degree), x, y + (compact ? 4 : 6));
      if (!compact) {ctx.fillStyle = color('--muted'); ctx.font = '9px system-ui'; ctx.fillText(t('fretLabel', { fret: note.fret }), x, y + 32);}
    }
    ctx.globalAlpha = 1;
  }
  $('start-guided').addEventListener('click', () => start('guided'));
  $('start-free').addEventListener('click', () => start('free'));
  $('back').addEventListener('click', () => navigate('lobby'));
  $('brand').addEventListener('click', (event) => { event.preventDefault(); navigate('lobby'); });
  $('resume-session').addEventListener('click', () => navigate('practice'));
  $('play').addEventListener('click', async () => {
    if (model.status === 'playing') { pause(); return; }
    // Start immediately so a repeated click can cancel pending audio activation.
    model.play(); render(true); draw(); await unlockAudio(); scheduleAudio();
  });
  $('reset').addEventListener('click', () => { stopVoices(); clearHeld(); model.reset(); lastInputPitch = null; render(true); draw(); });
  $('progress').addEventListener('input', () => { stopVoices(); model.seek(Number($('progress').value)); render(true); draw(); });
  $('tempo').addEventListener('change', () => { stopVoices(); model.setTempo(Number($('tempo').value)); render(true); draw(); });
  $('sound').addEventListener('click', async () => { sound = !sound; if (!sound) stopVoices(); else await unlockAudio(); render(true); });
  $('theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; savePreferences(); render(true); draw(); });
  $('locale').addEventListener('change', () => { locale = $('locale').value === 'en' ? 'en' : 'zh-CN'; savePreferences(); render(true); draw(); });
  document.addEventListener('keydown', (event) => {
    if (screen !== 'practice' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    if (event.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    const match = /^(?:Digit|Numpad)([1-7])$/.exec(event.code);
    if (!match) return;
    event.preventDefault(); press(DEGREES[Number(match[1]) - 1].pitch, 'keyboard', event.code);
  });
  document.addEventListener('keyup', (event) => release(event.code));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('pauseOnHide'); });
  window.addEventListener('blur', () => pause('pauseOnHide'));
  window.addEventListener('resize', draw);
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#lobby') navigate('lobby');
    else if (window.location.hash === '#practice' && hasSession) navigate('practice');
    else if (!hasSession) navigate('lobby');
  });
  buildFretboard(); buildScore(); render(true);
  let lastPaint = -1;
  function frame(timestamp) {
    if (screen === 'practice') {
      render();
      const snap = model.snapshot(), paintKey = snap.status === 'playing' && !reducedMotion ? timestamp : `${snap.position}:${theme}:${locale}`;
      if (paintKey !== lastPaint) { draw(); lastPaint = paintKey; }
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
  window.setInterval(scheduleAudio, 25);
  // Narrow deterministic entry for hosted acceptance, returned to DOM tests only.
  return { model, snapshot: () => model.snapshot(), render, draw, start, navigate };
}

if (typeof document !== 'undefined') mountApp(document, window);
