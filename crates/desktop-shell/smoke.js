/* Injected only when the process owner requests native CI evidence. */
(() => {
  const errors = [];
  addEventListener('error', event => errors.push(String(event.message || 'script error')));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const waitFor = async (condition, label) => {
    const deadline = performance.now() + 25000;
    while (!condition()) {
      if (performance.now() > deadline) throw Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const json = async (path, options) => {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw Error(`${path}: ${data.error || response.status}`);
    return data;
  };
  addEventListener('DOMContentLoaded', async () => {
    const report = {version: 1, ok: false, origin: location.origin, userAgent: navigator.userAgent};
    try {
      await waitFor(() => document.querySelectorAll('#catalog .catalog-item').length > 0, 'unchanged app catalog');
      await waitFor(() => document.querySelector('#start-listen') && !document.querySelector('#start-listen').disabled, 'app catalog preview');
      document.querySelector('#sound-button').click();
      if (document.querySelector('#sound-button').getAttribute('aria-pressed') !== 'true') throw Error('Silent smoke mode did not activate');
      document.querySelector('#start-listen').click();
      await waitFor(() => !document.querySelector('#export-button')?.disabled, 'app score activation');
      // The app intentionally starts with its notation dock closed. Exercise
      // the real display control before requiring the lazily rendered SVG.
      if (document.querySelector('#notation-toggle').getAttribute('aria-expanded') !== 'true') document.querySelector('#notation-toggle').click();
      await waitFor(() => document.querySelector('#notation-toggle').getAttribute('aria-expanded') === 'true', 'visible notation dock');
      await waitFor(() => document.querySelector('#engraved-staff svg'), 'offline notation SVG');
      document.querySelector('#reset-button').click();
      report.health = await json('/api/health');
      if (report.health.engine !== 'rust' || report.health.network !== 'native-protocol-no-listener') throw Error('Wrong engine transport');
      const index = await json('/api/catalog/index');
      report.catalogCount = document.querySelectorAll('#catalog .catalog-item').length;
      report.indexVersion = index.version;
      const scoreId = document.querySelector('#catalog .catalog-item').dataset.scoreId;
      const score = await json(`/api/catalog/score/${encodeURIComponent(scoreId)}`);
      const compiled = await json('/api/compile', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(score)});
      report.compiledNotes = compiled.timeline.notes.length;
      if (!report.compiledNotes) throw Error('No compiled Rust notes');
      const malformed = await fetch('/api/import/musicxml', {method:'POST',headers:{'Content-Type':'application/xml'},body:'invalid musicxml'});
      if (malformed.status !== 400 || !(await malformed.json()).error) throw Error('Raw import/error path failed');
      report.engraving = await json('/vendor/engraving-manifest.json');
      // Keep only small manifest evidence, never aggregate third-party notices.
      report.engraving = {version: report.engraving.version};
      if (report.engraving.version !== '2.1.3') throw Error('Wrong offline notation bundle');
      report.svgCount = document.querySelectorAll('#engraved-staff svg').length;
      report.canvas = [...document.querySelectorAll('canvas')].map(canvas => ({id:canvas.id,width:canvas.width,height:canvas.height}));
      report.scoreTitle = document.querySelector('#score-title').textContent;
      report.moduleLoaded = [...document.scripts].some(script => script.src.endsWith('/app.js'));
      report.errors = errors;
      if (errors.length) throw Error(errors.join('; '));
      report.ok = true;
    } catch (error) { report.error = String(error); report.errors = errors; }
    await fetch('/__desktop_smoke/report', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  }, {once:true});
})();
