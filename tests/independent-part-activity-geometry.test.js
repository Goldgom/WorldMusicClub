import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
test('independent activity geometry source contract: room and laptop visible; narrow and short collapse',()=>{
 const css=readFileSync(new URL('../web/part-activity-view.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
 const host=rules.find(r=>r.selectorText==='.part-activity-host').style;assert.equal(host.position,'static');assert.equal(host.height,'56px');assert.equal(host.flex,'0 0 56px');
 const maxConditions=text=>text.split(',').map(part=>[...part.matchAll(/max-(width|height)\s*:\s*(\d+)px/g)].map(m=>[m[1],Number(m[2])]));
 const collapse=rules.filter(r=>r.media&&[...r.cssRules].some(x=>x.selectorText==='.part-activity-host'&&x.style.display==='none'));
 for(const [width,height,hidden]of [[1920,1080,false],[1280,720,false],[844,390,true],[390,844,true]])assert.equal(collapse.some(r=>maxConditions(r.media.mediaText).some(conditions=>conditions.length&&conditions.every(([dimension,max])=>({width,height})[dimension]<=max))),hidden,`${width}x${height} source CSS collapse contract`);
 const budget=readFileSync(new URL('../web/piano-viewport-budget.js',import.meta.url),'utf8');assert.match(budget,/Math\.max\(transportRect\.bottom,root\.querySelector\('\.part-activity-host:not\(\[hidden\]\)'\)/);
 const view=readFileSync(new URL('../web/performance-view.js',import.meta.url),'utf8');assert.match(view,/play\.append\(activityHost\)/);assert.doesNotMatch(view,/keyboard\.append\(activityHost\)/);
});
