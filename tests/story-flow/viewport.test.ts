import { expect, it } from 'vitest';
import { fitCamera, minimumRowScale, toScreen, toWorld, zoomAt } from '../../src/features/story-flow/viewport';
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
it('restores readable rows after a compressed view is reused for a new layout',()=>{
  const previous=fitCamera({left:0,right:600,top:0,bottom:4000},800,180);
  const clips=[{left:0,right:200,top:90},{left:0,right:200,top:235}];
  expect(145*previous.rowScale).toBeLessThan(CLIP_HEIGHT);
  const scale=Math.max(previous.rowScale,minimumRowScale(clips,previous.zoom));
  expect(145*scale).toBeGreaterThanOrEqual(CLIP_HEIGHT+24);
});
it('keeps fixed-size conditional labels apart, including labels that reach another column when zoomed out',()=>{
  const clips=[{left:0,right:100,top:0,topOffset:-39,bottomOffset:135,rightOverflow:110},
    {left:300,right:400,top:200,topOffset:-39,bottomOffset:135,rightOverflow:110}];
  expect(minimumRowScale(clips,1)).toBe(0);
  const scale=minimumRowScale(clips,.25);
  expect(200*scale-39-135).toBeGreaterThanOrEqual(24);
  const camera=fitCamera({left:0,right:400,top:0,bottom:200},196,180,2,false,clips);
  expect(camera.rowScale).toBeGreaterThanOrEqual(scale);
});
