// Android WebView must deliver the worklet acknowledgement before the first
// sample. Reserve time for its UI thread without changing source musical time.
// This acknowledgement bound is separate from the rendition's 100 ms voice
// allocation lookahead. Desktop startup continues to request a 50 ms anchor.
export const MAX_AUDIO_START_LEAD_SECONDS = 0.5;
export function audioStartLeadSeconds(host = globalThis.WorldMusicClubAndroid) {
  return typeof host?.request === 'function' ? 0.25 : 0.05;
}
