// Test-only approximation of Blink's fractional range serialization. The exact
// pair below was observed in the 367 hosted VSQ report; Linkedom otherwise just
// stores .value as a string and cannot reveal this browser behavior. This is not
// a substitute for the same-source real browser/native acceptance run.
export const OBSERVED_RANGE_ENDPOINT=Object.freeze({source:4083.3371666666667,raw:'4083.33716666667'});

export function installRangeSerializationFixture(window) {
  const prototype=window.HTMLInputElement.prototype,original=Object.getOwnPropertyDescriptor(prototype,'value');
  Object.defineProperty(prototype,'value',{...original,set(value){
    if(this.type!=='range'){original.set.call(this,value);return;}
    const minimum=Number(this.min??this.getAttribute('min')??0),maximum=Math.max(minimum,Number(this.max??this.getAttribute('max')??100));
    const number=Number(value),bounded=Math.min(maximum,Math.max(minimum,Number.isFinite(number)?number:(minimum+maximum)/2));
    original.set.call(this,String(Number(bounded.toPrecision(15))));
  }});
  return ()=>Object.defineProperty(prototype,'value',original);
}
