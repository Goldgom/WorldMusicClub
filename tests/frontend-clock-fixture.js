/** Freeze only the app's named animation loop; browser/Playwright RAF polling stays live. */
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
