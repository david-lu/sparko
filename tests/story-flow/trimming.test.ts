import { describe, expect, it } from 'vitest';
import { clipTrimRange, trimClip, trimPreviewScene } from '../../src/features/story-flow/trimming';
import { runtimeFlow, type StoryNode, type StoryGraph } from '../../src/features/story-flow/model';
import { playheadTime } from '../../src/features/story-flow/mediaRange';
import type { Interstitial } from '../../shared/interstitials';

const source: StoryNode = { id:'source', name:'Source', kind:'source', x:100, y:90, loopCount:0,
  source:{assetId:'video',duration:10,inFrame:48,outFrame:192} };
const generated: StoryNode = { id:'generated', name:'Generated', kind:'simple', x:400, y:90, loopCount:0, interstitialId:'render' };
const item: Interstitial = { id:'render',label:'Generated',time:0,start_range:2,end_range:2,duration:6,prompt:'Continue',enable_prompt_expansion:false,phase:'ready',
  result:{assetId:'render-video',url:'',start:2,duration:6,totalDuration:10} };
const graph=(node:StoryNode):StoryGraph=>({version:1,entryId:node.id,nodes:[node],edges:[],templates:[]});

describe('clip trim handles',()=>{
  it('snaps to whole source frames, anchors the opposite edge, and leaves the original media intact',()=>{
    const next=trimClip(source,[],'start',72.4);
    expect(next.source).toEqual({...source.source,inFrame:72});expect(next.x).toBe(132);
    expect(next.x+(next.source!.outFrame-next.source!.inFrame)/24*32).toBe(source.x+6*32);
    const end=trimClip(next,[],'end',144);expect(end.x).toBe(next.x);expect(end.source!.outFrame).toBe(144);
    expect(source.source!.inFrame).toBe(48);expect(source.source!.outFrame).toBe(192);
  });
  it('clamps both ends to available media and retains at least one frame',()=>{
    expect(trimClip(source,[],'start',-100).source!.inFrame).toBe(0);
    expect(trimClip(source,[],'start',999).source!.inFrame).toBe(191);
    expect(trimClip(source,[],'end',0).source!.outFrame).toBe(49);
    expect(trimClip(source,[],'end',999).source!.outFrame).toBe(240);
    expect(trimClip(source,[],'start',NaN)).toBe(source);
    expect(trimClip(source,[],'end',192)).toBe(source);
    expect(clipTrimRange({...source,source:{...source.source!,duration:undefined}},[],12).totalFrames).toBe(288);
  });
  it('trims generated bodies, keeps their source offsets, and can restore the full range',()=>{
    const start=trimClip(generated,[item],'start',24),next=trimClip(start,[item],'end',120);
    expect(next.trim).toEqual({inFrame:24,outFrame:120});expect(next.x).toBe(432);
    const scene=runtimeFlow(graph(next),[item],'',0).scenes[0];
    expect(scene.clip).toMatchObject({assetId:'render-video',inFrame:72,outFrame:168});
    expect(playheadTime(scene,12,24)).toBe(3.5);expect(playheadTime(scene,12,24,'elapsed')).toBe(.5);
    const original=runtimeFlow(graph(generated),[item],'',0).scenes[0];
    expect(trimPreviewScene(original,next,[item]).clip).toEqual(scene.clip);
    const restored=trimClip(trimClip(next,[item],'start',0),[item],'end',999);
    expect(restored.trim).toBeUndefined();expect(restored.x).toBe(generated.x);
    expect(item.result).toMatchObject({start:2,duration:6,totalDuration:10});
  });
  it('uses the retained full render timeline for loops and the planned timeline for drafts',()=>{
    const loop={...item,result:{...item.result!,start:0,totalDuration:6,fullAssetId:'full-video',fullRange:{start:2,duration:6,totalDuration:10}}};
    const node=trimClip(generated,[loop],'start',24),scene=runtimeFlow(graph(node),[loop],'',0).scenes[0];
    expect(playheadTime(scene,12,24)).toBe(3.5);expect(playheadTime(scene,12,24,'elapsed')).toBe(.5);
    const draft={...item,result:undefined,phase:'draft' as const};
    const planned=runtimeFlow(graph(node),[draft],'source-video',10).scenes[0];
    expect(planned.plannedFrames).toBe(120);expect(playheadTime(planned,12,24)).toBe(1.5);
    expect(playheadTime(planned,12,24,'elapsed')).toBe(.5);
  });
});
