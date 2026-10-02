import {getAppI18n} from './app-locale.js';

const THEMES = new Set(['light', 'dark', 'system', 'custom']);
export function validHex(value) { return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value); }
export function isDark(hex) { return readableText(hex) === '#ffffff'; }
export function validTheme(value) { return value && THEMES.has(value.mode) ? {mode: value.mode, accent: validHex(value.accent) ? value.accent : '#326b4c', background: validHex(value.background) ? value.background : '#f4f6f1'} : {mode: 'system', accent: '#326b4c', background: '#f4f6f1'}; }
export function setupThemes({document = globalThis.document, i18n = getAppI18n(document), storage = () => globalThis.localStorage, matchMedia = query => globalThis.matchMedia(query)} = {}) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const getStorage = () => typeof storage === 'function' ? storage() : storage;
  let preference=validTheme(null), stored=null, storageMessage=null;
  const message = (key, params = {}) => ({key, params});
  try { stored=getStorage().getItem('worldmusichub.theme'); } catch { storageMessage=message('preferences.theme.storageUnavailable'); }
  if(stored!==null){
    try{
      const parsed=JSON.parse(stored);preference=validTheme(parsed);
      if(!parsed||!THEMES.has(parsed.mode))storageMessage=message('preferences.theme.invalid');
      else if(parsed.mode==='custom'){
        const accentInvalid=!validHex(parsed.accent),backgroundInvalid=!validHex(parsed.background);
        if(accentInvalid&&backgroundInvalid)storageMessage=message('preferences.theme.colorsInvalid',{accent:preference.accent,background:preference.background});
        else if(accentInvalid)storageMessage=message('preferences.theme.accentInvalid',{accent:preference.accent});
        else if(backgroundInvalid)storageMessage=message('preferences.theme.backgroundInvalid',{background:preference.background});
      }
    }catch{storageMessage=message('preferences.theme.unreadable');}
  }
  const mode = document.getElementById('theme-mode'); const accent = document.getElementById('theme-accent'); const background = document.getElementById('theme-background');
  function redrawMessage(){const status=document.getElementById('theme-storage-status');status.textContent=storageMessage?i18n.t(storageMessage.key,storageMessage.params):'';status.hidden=!storageMessage;}
  function persistence(value){storageMessage=value;redrawMessage();}
  function apply() {
    const dark = preference.mode === 'dark' || (preference.mode === 'system' && media.matches) || (preference.mode === 'custom' && isDark(preference.background));
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = preference.mode;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    const palette = THEME_PALETTES[dark ? 'dark' : 'light'];
    const page = preference.mode === 'custom' ? preference.background : palette.background;
    const accentColor = preference.mode === 'custom' ? preference.accent : palette.accent;
    const focus=readableText(palette.paper);
    const tokens = {'--green':accentColor,'--accent-ink':readableText(accentColor),'--page-background':page,'--page-ink':safeText(palette.text,page),'--page-muted':safeText(palette.muted,page),'--paper':palette.paper,'--surface':palette.surface,'--ink':palette.text,'--muted':palette.muted,'--border':palette.border,'--link':safeText(accentColor,palette.paper),'--focus-ring':focus,'--focus-halo':focus==='#000000'?'#ffffff':'#000000'};
    for (const [name,value] of Object.entries(tokens)) document.documentElement.style.setProperty(name,value);
    mode.value = preference.mode; accent.value = preference.accent; background.value = preference.background;
    document.getElementById('custom-theme-controls').hidden = preference.mode !== 'custom';
  }
  function save() { preference = validTheme({mode: mode.value, accent: accent.value, background: background.value}); apply(); try { getStorage().setItem('worldmusichub.theme', JSON.stringify(preference));persistence(null); } catch { persistence(message('preferences.theme.unsaved')); } }
  mode.addEventListener('change', save); accent.addEventListener('input', save); background.addEventListener('input', save);
  const onMediaChange = () => { if (preference.mode === 'system') apply(); };
  media.addEventListener('change', onMediaChange);
  const unsubscribe = i18n.subscribe(redrawMessage);
  apply();redrawMessage();
  return {destroy(){unsubscribe();mode.removeEventListener('change',save);accent.removeEventListener('input',save);background.removeEventListener('input',save);media.removeEventListener?.('change',onMediaChange);}};
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
