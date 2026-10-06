import assert from 'node:assert/strict';

// Exact, observed product geometry. This does not change native click admission.
export function assertHomeHoverBoundary(row) {
  assert.equal(row.id,'home-single-player');assert.equal(row.screen,'home');
  assert.ok(['no-preference','reduce'].includes(row.reducedMotion));
  const base=row.baseline;
  assert.ok(base.target.width>=44&&base.target.height>=40);
  assert.equal(base.hovered,false);assert.equal(base.transform,'none');
  assert.deepEqual(row.pointer,{x:Math.floor(base.target.x+base.target.width/2),y:Math.ceil(base.target.y+base.target.height)-1});
  assert.equal(row.samples.length,5);
  for(const [index,sample]of row.samples.entries()){
    assert.equal(sample.frame,index);assert.deepEqual(sample.target,base.target,`Frame ${index}: the interactive boundary must not move`);
    assert.equal(sample.hovered,true);assert.equal(sample.hitOwned,true);assert.equal(sample.transform,'none');
    assert.equal(sample.copyY,base.copyY-(row.reducedMotion==='reduce'?0:2),'The content lift stays inside the hitbox and respects reduced motion');
    assert.equal(sample.screen,'home');assert.deepEqual(sample.viewport,row.viewport);
  }
  assert.equal(row.clicks.length,1);assert.equal(row.clicks[0].trusted,true);assert.equal(row.clicks[0].owned,true);
  assert.equal(row.clicks[0].x,row.pointer.x);assert.equal(row.clicks[0].y,row.pointer.y);
  assert.equal(row.destination,'library');assert.equal(row.returnedHome,true);
  assert.equal(row.keyboard.focusId,row.id);assert.equal(row.keyboard.focusVisible,true);assert.ok(row.keyboard.outlineWidth>=3);
  assert.deepEqual(row.keyboard.target,base.target);assert.equal(row.keyboard.destination,'library');
  assert.deepEqual(row.keyboard.clicks,[{trusted:true,owned:true}]);
}
