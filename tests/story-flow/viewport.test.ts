import { expect, it } from 'vitest';
import { fitCamera, toScreen, toWorld, zoomAt } from '../../src/features/story-flow/viewport';
import { CLIP_HEIGHT } from '../../src/features/story-flow/model';

it('fits negative coordinates and distant rows inside the viewport with fixed clip height',()=>{
  const bounds={left:-3000,right:5000,top:-1400,bottom:2300},camera=fitCamera(bounds,800,300);
  const first=toScreen({x:bounds.left,y:bounds.top},camera),last=toScreen({x:bounds.right,y:bounds.bottom},camera);
  expect(first.x).toBeGreaterThanOrEqual(32);expect(first.y).toBeGreaterThanOrEqual(24);
  expect(last.x).toBeLessThanOrEqual(768);expect(last.y+CLIP_HEIGHT).toBeLessThanOrEqual(276);
});
it('keeps pointer anchoring and world coordinates stable when zoomed and panned far from zero',()=>{
  const camera={x:50000,y:-40000,zoom:.3,rowScale:.7},anchor={x:320,y:160},world=toWorld(anchor,camera);
  const changed=zoomAt(camera,2.4,anchor);
  expect(toScreen(world,changed).x).toBeCloseTo(anchor.x);expect(toScreen(world,changed).y).toBeCloseTo(anchor.y);
  expect(changed.rowScale).toBe(camera.rowScale);
});
