/** Reserve real music/key/control space before choosing an above-key score band.
 * Short windows keep the existing side layout instead of clipping either view.
 * This is presentation geometry only; no musical time or score data enters it.
 */
export function notationBandHeight({width, availableHeight, instrumentHeight, controlsHeight, instrument = 'piano'}) {
  if (instrument !== 'piano' || ![width, availableHeight, instrumentHeight, controlsHeight].every(Number.isFinite)
    || width <= 0 || instrumentHeight < 0 || controlsHeight < 0) return null;
  const minimum = width <= 650 ? 300 : 240;
  const remaining = Math.floor(availableHeight - instrumentHeight - controlsHeight);
  if (remaining < minimum) return null;
  return Math.min(360, remaining, Math.max(minimum, Math.floor(availableHeight * .46)));
}

/** Observe the actual shell budget, including notices, guide labels and controls.
 * Never resize the shared falling-note / strike-line / key geometry separately.
 */
export function setupStageNotationLayout({document, getPanLabel = () => null, onChange = () => {}}) {
  const window = document.defaultView, stage = document.getElementById('workspace');
  const play = stage.querySelector('.play-panel'), hud = stage.querySelector('.stage-hud');
  const field = play.querySelector('.performance-field'), keyboard = document.getElementById('keyboard');
  let frame = null, disposed = false, last = null;
  const style = node => window.getComputedStyle(node);
  const number = value => parseFloat(value) || 0;
  const outerHeight = (node, includeHidden = false) => {
    const css = style(node);
    return css.display === 'none' || node.hidden && !includeHidden ? 0 : node.getBoundingClientRect().height + number(css.marginTop) + number(css.marginBottom);
  };
  function measureCandidate() {
    if (!stage.classList.contains('with-notation') || play.dataset.instrument !== 'piano') return null;
    const wasAbove = stage.classList.contains('notation-above'), previousHeight = stage.style.getPropertyValue('--notation-band-height');
    const panLabel = document.getElementById('keyboard-range-context'), previousLabel = panLabel?.textContent;
    // Probe only the proposed full-width layout. The portrait fallback hides
    // whole ancestors, and localized/open controls can exceed any fixed floor.
    // A synchronous probe is never painted or announced as a chosen layout.
    const scrolls = [stage,...stage.querySelectorAll('aside,section,div,details,ol')]
      .map(node=>({node,left:node.scrollLeft,top:node.scrollTop})).filter(item=>item.left||item.top);
    stage.classList.add('notation-above','notation-budget-probe');
    stage.style.setProperty('--notation-band-height',stage.clientWidth<=650?'300px':'240px');
    try {
      const css = style(stage), playStyle = style(play), keyStyle = style(keyboard);
      const width = stage.clientWidth - number(css.paddingLeft) - number(css.paddingRight);
      const availableHeight = stage.clientHeight - number(css.paddingTop) - number(css.paddingBottom) - outerHeight(hud) - 2 * number(css.rowGap);
      const surface = document.getElementById('piano-surface');
      const needsPan = number(style(surface).minWidth) > width - 2;
      // The current hidden/narrow layout may have chosen the short range copy.
      // Measure the exact localized copy that a visible candidate would use.
      const candidateLabel = needsPan ? getPanLabel() : null;
      if(panLabel&&typeof candidateLabel==='string')panLabel.textContent=candidateLabel;
      let controlsHeight = number(playStyle.borderTopWidth) + number(playStyle.borderBottomWidth);
      for (const node of play.children) {
        if (node === field || ['absolute','fixed'].includes(style(node).position)) continue;
        if (node.classList.contains('keyboard-pan')) {
          if(needsPan)controlsHeight += outerHeight(node,true);
        } else controlsHeight += outerHeight(node);
      }
      const guidance = document.getElementById('piano-fingering-guidance');
      const keyHeight = Math.max(number(keyStyle.height), number(keyStyle.minHeight), number(playStyle.getPropertyValue('--keybed-height')), 78);
      // A full 100px canvas, 4px strike line and scrollbar allowance survive
      // large octave guides, wide key ranges and native scrollbar metrics.
      const instrumentHeight = 100 + keyHeight + 4 + 16 + (guidance ? outerHeight(guidance) : 0);
      return notationBandHeight({width, availableHeight, instrumentHeight, controlsHeight, instrument:play.dataset.instrument});
    } finally {
      stage.classList.toggle('notation-above',wasAbove);
      stage.classList.remove('notation-budget-probe');
      if(previousHeight)stage.style.setProperty('--notation-band-height',previousHeight);
      else stage.style.removeProperty('--notation-band-height');
      if(panLabel&&panLabel.textContent!==previousLabel)panLabel.textContent=previousLabel;
      // A rejected probe can still clamp a scroll offset during forced reflow.
      // Restore against the original layout before making any final change.
      for(const {node,left,top}of scrolls){node.scrollLeft=left;node.scrollTop=top;}
    }
  }
  function refresh() {
    frame = null;
    // DOM-only tests and hidden screens have no layout to act on.
    if (disposed || !window.getComputedStyle || !stage.clientHeight || stage.hidden) return;
    const height = measureCandidate(),enabled = height !== null,signature = height;
    if (signature === last) return;
    last = signature;
    stage.classList.toggle('notation-above', enabled);
    if (enabled) stage.style.setProperty('--notation-band-height', `${height}px`);
    else stage.style.removeProperty('--notation-band-height');
    onChange(enabled);
  }
  function schedule() {
    if (!disposed && frame === null && window.requestAnimationFrame) frame = window.requestAnimationFrame(refresh);
  }
  const observer = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
  for (const node of [stage, hud, play, field, keyboard]) if (node) observer?.observe(node);
  // Layout-changing controls keep their original handlers. Resizing, locale
  // redraw and disclosure changes request one measurement, never an audio tick.
  window.addEventListener('resize', schedule);
  for (const type of ['click','change','toggle']) stage.addEventListener(type, schedule, true);
  schedule();
  return {refresh:schedule, destroy() {
    disposed = true; observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame?.(frame);
    window.removeEventListener('resize', schedule);
    for (const type of ['click','change','toggle']) stage.removeEventListener(type, schedule, true);
  }};
}
