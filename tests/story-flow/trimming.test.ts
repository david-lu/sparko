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
  it('extends an image left past frame zero while keeping its right edge and media coordinates valid',()=>{
    const image:StoryNode={...source,source:{assetId:'image',kind:'image',inFrame:0,outFrame:1}};
    const extended=trimClip(image,[],'start',-24.2);
    expect(extended.source).toEqual({assetId:'image',kind:'image',inFrame:0,outFrame:25});
    expect(extended.duration).toBe(25/24);expect(extended.x).toBe(image.x-32);
    expect(extended.x+extended.duration!*32).toBeCloseTo(image.x+32/24);
    const shortened=trimClip(extended,[],'start',12);
    expect(shortened.source).toMatchObject({inFrame:0,outFrame:13});expect(shortened.x).toBe(image.x-16);
    const minimum=trimClip(shortened,[],'start',999);
    expect(minimum.source).toEqual(image.source);expect(minimum.x).toBe(image.x);
    expect(trimClip(minimum,[],'start',999)).toBe(minimum);
    const scene=runtimeFlow(graph(extended),[],'',0).scenes[0];
    expect(trimPreviewScene(runtimeFlow(graph(image),[],'',0).scenes[0],extended,[]).clip).toEqual(scene.clip);
    expect(image.source!.outFrame).toBe(1);
  });
  it('extends previously split images and ungenerated image clips from either edge',()=>{
    const image:StoryNode={...source,source:{...source.source!,kind:'image'}};
    const extended=trimClip(image,[],'start',-24);
    expect(extended.source).toMatchObject({inFrame:48,outFrame:264});expect(extended.x).toBe(4);
    expect(extended.x+extended.duration!*32).toBe(image.x+6*32);
    const draft:StoryNode={...image,source:undefined,generationId:'draft',mediaKind:'image',duration:1/24};
    const held=trimClip(draft,[],'start',-24);
    expect(held).toMatchObject({duration:25/24,x:draft.x-32});expect(held.source).toBeUndefined();
    expect(runtimeFlow(graph(held),[],'',0).scenes[0].plannedFrames).toBe(25);
    const longer=trimClip(held,[],'end',49);
    expect(longer).toMatchObject({duration:49/24,x:held.x});
    expect(trimClip(longer,[],'start',999)).toMatchObject({duration:1/24,x:draft.x+32});
  });
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
