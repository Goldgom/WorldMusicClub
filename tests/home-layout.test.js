import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {assertHomeLayout, assertHomeTargetVisible, homeModeIds} from './home-layout.js';

test('home intro reserves its content height while the existing home container owns scrolling', async () => {
  const css = await readFile(new URL('../web/rhythm-shell.css', import.meta.url), 'utf8');
  const {document} = parseHTML(`<style>${css}</style>`);
  const rules = [...document.querySelector('style').sheet.cssRules];
  const intro = rules.find(rule => rule.selectorText === '.rhythm-shell .rhythm-home-intro');
  const home = rules.find(rule => rule.selectorText === '.rhythm-shell .game-home');
  assert.equal(intro.style.flex, '1 0 auto', 'A fixed minimum cannot substitute for the grid content height');
  assert.equal(home.style.overflow, 'auto');
  assert.equal(home.style['min-height'], '0');
  assert.equal(rules.find(rule => rule.selectorText === '.rhythm-shell .game-mode-copy').style['overflow-wrap'], 'anywhere');
});

const rect = (left, top, width, height) => ({left, top, right:left+width, bottom:top+height, width, height});
function geometry() {
  return {screen:'home', viewport:{width:1024,height:689}, documentWidth:1024, home:{clientWidth:1024,scrollWidth:1024},
    intro:rect(48,97,928,500), free:rect(150,621,724,106),
    cards:homeModeIds.map((id,index) => {
      const left = index === 2 || index === 4 ? 771 : 544, top = 97 + Math.ceil(index/2)*124;
      return {id, disabled:[2,3].includes(index), ...rect(left,top,index === 0 ? 440 : 213,104),
        text:[rect(left+15,top+40,60,20),rect(left+15,top+68,100,18)],
        badge:[2,3].includes(index) ? rect(left+145,top+10,55,18) : null};
    })};
}

test('geometry evidence rejects the original overflowing Settings card and hidden or overlapping routes', () => {
  const row = geometry(); assertHomeLayout(row);
  for (const mutate of [
    value => { value.intro.bottom = 547; value.free.top = 547; },
    value => { value.free.top = 570; },
    value => { value.cards[5].bottom = 630; },
    value => { value.cards[5].width = 0; },
    value => { value.cards[5].text = [rect(970,490,40,20)]; },
    value => { value.cards[2].text = [rect(800,230,70,20)]; value.cards[2].badge = rect(820,230,50,20); },
    value => { value.home.scrollWidth = 1200; },
    value => { value.cards.pop(); },
  ]) {
    const changed = structuredClone(row); mutate(changed); assert.throws(() => assertHomeLayout(changed));
  }
});

test('reachability evidence rejects offscreen targets and a footer covering a target corner', () => {
  const target = {id:'home-settings', ...rect(544,200,213,104), clip:rect(0,61,1024,628), hits:[true,true,true,true,true]};
  assertHomeTargetVisible(target);
  assert.throws(() => assertHomeTargetVisible({...target, bottom:710}));
  assert.throws(() => assertHomeTargetVisible({...target, hits:[true,true,false,true,true]}));
  assert.throws(() => assertHomeTargetVisible({...target, hits:[]}));
  assert.throws(() => assertHomeTargetVisible({...target, hits:[true,true,true,true]}));
  assert.throws(() => assertHomeTargetVisible({...target, hits:[true,true,true,true,true,true]}));
});
