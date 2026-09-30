const THEMES = new Set(['light', 'dark', 'system', 'custom']);
export function validHex(value) { return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value); }
export function isDark(hex) { return readableText(hex) === '#ffffff'; }
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
    const palette = THEME_PALETTES[dark ? 'dark' : 'light'];
    const page = preference.mode === 'custom' ? preference.background : palette.background;
    const accentColor = preference.mode === 'custom' ? preference.accent : palette.accent;
    const tokens = {'--green':accentColor,'--accent-ink':readableText(accentColor),'--page-background':page,'--page-ink':safeText(palette.text,page),'--page-muted':safeText(palette.muted,page),'--paper':palette.paper,'--surface':palette.surface,'--ink':palette.text,'--muted':palette.muted,'--border':palette.border,'--link':safeText(accentColor,palette.paper)};
    for (const [name,value] of Object.entries(tokens)) document.documentElement.style.setProperty(name,value);
    mode.value = preference.mode; accent.value = preference.accent; background.value = preference.background;
    document.getElementById('custom-theme-controls').hidden = preference.mode !== 'custom';
  }
  function save() { preference = {mode: mode.value, accent: accent.value, background: background.value}; apply(); try { localStorage.setItem('worldmusichub.theme', JSON.stringify(preference)); } catch { /* Private browsing can disable persistence; theme still works. */ } }
  mode.addEventListener('change', save); accent.addEventListener('input', save); background.addEventListener('input', save);
  media.addEventListener('change', () => { if (preference.mode === 'system') apply(); });
  apply();
}

export const THEME_PALETTES = Object.freeze({
  light: Object.freeze({background:'#f4f6f1',paper:'#fffefb',surface:'#edf1e9',text:'#24372d',muted:'#526650',border:'#d3ddce',accent:'#326b4c'}),
  dark: Object.freeze({background:'#1b211e',paper:'#242e27',surface:'#29352b',text:'#e5ece1',muted:'#b6c3b0',border:'#4c5e45',accent:'#a3c889'})
});
export function luminance(hex) {
  if (!validHex(hex)) throw new Error('Expected a six-digit hex color.');
  const values=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
}
export function contrastRatio(a,b) {const x=luminance(a),y=luminance(b);return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
export function readableText(background) { return contrastRatio(background,'#000000')>=contrastRatio(background,'#ffffff')?'#000000':'#ffffff'; }
export function safeText(preferred,background) {return contrastRatio(preferred,background)>=4.5?preferred:readableText(background);}
