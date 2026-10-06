/** Run with page.evaluate after guides, notices or other stage chrome change.
 * Playwright actions may finish before ResizeObserver delivers the changed size.
 * Wait for the actual viewport budget, never for acceptance geometry to pass.
 * Three frames cover observer delivery, its queued write and one dependent
 * chrome update; a missing observer/commit fails instead of polling indefinitely.
 * This function is self-contained so Playwright can serialize it directly. */
export function settlePianoViewportBudget({document=globalThis.document,window=globalThis.window}={}){
  const samples=[],root=document.getElementById('workspace'),lane=root.querySelector('.piano-lanes-shared'),transport=root.querySelector('.piano-transport');
  return new Promise((resolve,reject)=>{
    let frame=null,timeout=null;
    const finish=(error)=>{if(frame!==null)window.cancelAnimationFrame(frame);window.clearTimeout(timeout);error?reject(error):resolve(samples);};
    const fail=reason=>finish(new Error(`${reason}: ${JSON.stringify(samples)}`));
    const sample=()=>{
      const laneRect=lane.getBoundingClientRect(),transportRect=transport.getBoundingClientRect(),zoom=Math.round(laneRect.height/parseFloat(window.getComputedStyle(lane).height)*1000)/1000;
      const visual=window.visualViewport,viewportBottom=Math.min(window.innerHeight,visual?visual.offsetTop+visual.height:window.innerHeight),padding=parseFloat(window.getComputedStyle(root).paddingBottom)||0;
      const available=Math.floor(((viewportBottom-transportRect.bottom-(root.scrollTop||0)*zoom+laneRect.height)/zoom-padding)*100)/100;
      const expected=Math.max(100,available),committed=parseFloat(document.body.style.getPropertyValue('--piano-available-lane-height'));
      samples.push({frame:samples.length,committed,expected,available,laneHeight:laneRect.height,transportBottom:transportRect.bottom,viewportBottom,zoom});
      // The production budget writes hundredths of a CSS pixel. Only allow
      // layout's subpixel quantization, not a clipped-control tolerance.
      if(Number.isFinite(committed)&&Number.isFinite(expected)&&Math.abs(committed-expected)<=.02)return finish();
      if(samples.length===4)return fail('Piano viewport budget did not commit within three rendered frames');
      frame=window.requestAnimationFrame(sample);
    };
    timeout=window.setTimeout(()=>fail('No piano viewport budget frame within 2000ms'),2000);
    sample();
  });
}
