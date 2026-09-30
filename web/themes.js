const THEMES = new Set(['light', 'dark', 'system', 'custom']);
export function validHex(value) { return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value); }
export function isDark(hex) { const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 135; }
export function validTheme(value) { return value && THEMES.has(value.mode) ? {mode: value.mode, accent: validHex(value.accent) ? value.accent : '#326b4c', background: validHex(value.background) ? value.background : '#f4f6f1'} : {mode: 'system', accent: '#326b4c', background: '#f4f6f1'}; }
export function setupThemes() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = validTheme(JSON.parse(localStorage.getItem('worldmusichub.theme'))); } catch { preference = validTheme(null); }
  const mode = document.getElementById('theme-mode'); const accent = document.getElementById('theme-accent'); const background = document.getElementById('theme-background');
  function apply() {
    const dark = preference.mode === 'dark' || (preference.mode === 'system' && media.matches) || (preference.mode === 'custom' && isDark(preference.background));
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = preference.mode;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--green', preference.mode === 'custom' ? preference.accent : dark ? '#a3c889' : '#326b4c');
    document.documentElement.style.setProperty('--accent-ink', !isDark(preference.mode === 'custom' ? preference.accent : dark ? '#a3c889' : '#326b4c') ? '#17261d' : '#fffefb');
    if (preference.mode === 'custom') document.documentElement.style.setProperty('--page-background', preference.background); else document.documentElement.style.removeProperty('--page-background');
    mode.value = preference.mode; accent.value = preference.accent; background.value = preference.background;
    document.getElementById('custom-theme-controls').hidden = preference.mode !== 'custom';
  }
  function save() { preference = {mode: mode.value, accent: accent.value, background: background.value}; apply(); try { localStorage.setItem('worldmusichub.theme', JSON.stringify(preference)); } catch { /* Private browsing can disable persistence; theme still works. */ } }
  mode.addEventListener('change', save); accent.addEventListener('input', save); background.addEventListener('input', save);
  media.addEventListener('change', () => { if (preference.mode === 'system') apply(); });
  apply();
}
