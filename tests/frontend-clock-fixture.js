/** Freeze only performance.now and the app's named animation loop; ordinary
 * browser/Playwright RAF polling and the real AudioContext clock stay live.
 * Callers advancing this synthetic clock must explicitly select silent mode
 * when testing input ownership or display timing. Real audio has separate gates. */
export function installLoopClockFixture(target = window) {
  const requestFrame=target.requestAnimationFrame.bind(target);
  const cancelFrame=target.cancelAnimationFrame.bind(target);
  const controlledId=-1;
  target.loopTestClock=1000;
  Object.defineProperty(target.performance,'now',{configurable:true,value:()=>target.loopTestClock});
  target.requestAnimationFrame=callback=>{
    if(callback.name==='animate'){target.loopTestFrame=callback;return controlledId}
    return requestFrame(callback);
  };
  target.cancelAnimationFrame=id=>{
    if(id===controlledId){target.loopTestFrame=null;return}
    return cancelFrame(id);
  };
}
