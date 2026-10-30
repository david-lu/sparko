import { describe, it, expect } from 'vitest';
import { collectLibrary } from '../../src/features/project/library';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { createNode } from '../../src/features/story-flow/model';

const primary=crypto.randomUUID(),extra=crypto.randomUUID();
const project=():Project=>({id:'test',name:'Library',updatedAt:0,source:{name:'Source.mp4',assetId:primary},interstitials:[],subtitle:null,analysis:emptyAnalysis()});
describe('project library',()=>{
  it('retains unused footage and uses whole media bounds rather than the trim of one instance',()=>{
    const p=project();p.storyFlow={version:1,entryId:'one',templates:[],edges:[],nodes:[{id:'one',name:'Trimmed',kind:'source',x:0,y:0,crossfadeStart:0,crossfadeEnd:0,loopCount:0,source:{assetId:extra,duration:20,inFrame:48,outFrame:96}}]};
    p.library=collectLibrary(p,4);p.storyFlow.nodes=[];
    expect(collectLibrary(p,4).find(item=>item.assetId===extra)).toEqual({assetId:extra,originalAssetId:undefined,name:'Trimmed',kind:'video',duration:20});
    expect(assetIds(p)).toContain(extra);
  });
  it('retains generated bodies independently of deleted jobs and keeps their reusable media range',()=>{
    const p=project(),{item}=createNode('simple');item.phase='ready';item.result={assetId:extra,url:'blob:render',start:1,duration:2,totalDuration:4};p.interstitials=[item];
    p.library=collectLibrary(p,4);p.interstitials=[];
    expect(collectLibrary(p).find(item=>item.assetId===extra)).toMatchObject({kind:'generated',inFrame:24,outFrame:72,duration:4});
    expect(assetIds(p)).toContain(extra);
  });
  it('packages and remaps an unused library asset and its original',async()=>{
    const p=project(),original=crypto.randomUUID();p.library=[{assetId:extra,originalAssetId:original,name:'Unused.mp4',kind:'video',duration:12}];
    const signal=new AbortController().signal;
    const blob=await packProject(p,[primary,extra,original].map(id=>({id,name:'video.mp4',blob:new Blob(['media'],{type:'video/mp4'})})),signal,()=>{});
    const restored=await unpackProject(blob,signal,()=>{}),entry=restored.project.library![0];
    expect(entry.assetId).not.toBe(extra);expect(entry.originalAssetId).not.toBe(original);expect(entry.duration).toBe(12);expect(assetIds(restored.project)).toHaveLength(3);
    expect(restored.assets.some(asset=>asset.id===entry.assetId)).toBe(true);
  });
  it('undo and redo restore the imported library catalog with the document',()=>{
    const before=project();before.library=collectLibrary(before,4);const after={...before,library:[...before.library,{assetId:extra,name:'Extra.mp4',kind:'video' as const,duration:12}]};
    const history=new ProjectHistory();history.record(before,after);expect(history.target('undo')?.library).toHaveLength(1);history.commit('undo');expect(history.target('redo')?.library).toHaveLength(2);
  });
});
