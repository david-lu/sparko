import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { describe, expect, it } from 'vitest';
import { newAssetGeneration } from '../../shared/asset-generation';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { migrateClipMedia } from '../../src/features/project/migrateClipMedia';
import { collectLibrary } from '../../src/features/project/library';
import { runtimeFlow, type StoryNode } from '../../src/features/story-flow/model';
import { captureTemplate, instantiateTemplate } from '../../src/features/story-flow/templates';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { ClipGenerationController } from '../../src/features/project/ClipGenerationController';
import type { ProjectController } from '../../src/features/project/ProjectController';
const id=()=>crypto.randomUUID();
const base=():Project=>({id:'test',name:'Media ownership',updatedAt:0,source:{name:'Empty'},interstitials:[],subtitle:null,analysis:emptyAnalysis(),storyFlow:{version:1,entryId:'',nodes:[],edges:[],templates:[]}});
const node=(assetId:string):StoryNode=>({id:id(),name:'A clip',kind:'source',x:0,y:0,loopCount:0,source:{assetId,inFrame:0,outFrame:96}});
describe('clip-owned media',()=>{
  it('migrates volume to every existing placement and removes it from reusable assets',()=>{
    const p=base(),assetId=id();p.library=[{assetId,name:'Movie',kind:'video',volume:.35}];
    const a=node(assetId),b={...node(assetId),volume:.8};p.storyFlow={...p.storyFlow!,entryId:a.id,nodes:[a,b]};
    const migrated=migrateClipMedia(p);
    expect(migrated.storyFlow!.nodes.map(n=>n.volume)).toEqual([.35,.8]);expect(migrated.library![0]).not.toHaveProperty('volume');
    expect(migrateClipMedia(migrated)).toBe(migrated);
    const flow=runtimeFlow(migrated.storyFlow!,[],assetId,4);expect(flow.scenes.map(s=>s.volume)).toEqual([.35,.8]);
  });
  it('moves orphan drafts to timeline while completed unplaced outputs stay as assets with provenance',()=>{
    const p=base(),draft=newAssetGeneration('image'),done=newAssetGeneration('image');done.phase='ready';done.selectedAssetId=id();done.versions=[{assetId:done.selectedAssetId,name:'Rendered',createdAt:123,settings:{...done.settings,prompt:'Saved prompt'}}];
    p.assetGenerations=[draft,done];const next=migrateClipMedia(p);
    expect(next.assetGenerations).toBeUndefined();expect(next.clipGenerations?.map(g=>g.id)).toEqual([draft.id]);
    expect(next.storyFlow!.nodes).toHaveLength(1);expect(next.storyFlow!.nodes[0].generationId).toBe(draft.id);
    expect(next.library!.find(a=>a.assetId===done.selectedAssetId)?.generation).toMatchObject({provider:'fal',settings:{prompt:'Saved prompt'}});
  });
  it('gives legacy placements independent recipes without repinning their saved version',()=>{
    const p=base(),g=newAssetGeneration('image'),one=id(),two=id();g.phase='ready';g.selectedAssetId=two;g.versions=[one,two].map(assetId=>({assetId,name:'Version',createdAt:1,settings:g.settings}));
    p.assetGenerations=[g];const a=node(one),b=node(two);p.storyFlow={...p.storyFlow!,entryId:a.id,nodes:[a,b]};
    const next=migrateClipMedia(p);expect(next.clipGenerations).toHaveLength(2);
    expect(new Set(next.storyFlow!.nodes.map(n=>n.generationId)).size).toBe(2);
    expect(next.storyFlow!.nodes.map(n=>n.source?.assetId)).toEqual([one,two]);
  });
  it('version selection updates just its owning clip and preserves its playback controls',()=>{
    let p=base();const g=newAssetGeneration('image'),one=id(),two=id(),a={...node(one),generationId:g.id,mediaKind:'image' as const,duration:7,volume:.2,source:{...node(one).source!,outFrame:168}},b=node(one);
    g.versions=[one,two].map(assetId=>({assetId,name:'Version',createdAt:1,settings:g.settings}));p={...p,clipGenerations:[g],library:[one,two].map(assetId=>({assetId,name:'Image',kind:'image'})),storyFlow:{...p.storyFlow!,entryId:a.id,nodes:[a,b]}};
    const controller=new ClipGenerationController({getSnapshot:()=>({project:p}),editAssets:(change:(p:Project)=>Project)=>{p=change(p);}} as ProjectController);
    controller.selectVersion(g.id,two);expect(p.storyFlow!.nodes[0]).toMatchObject({volume:.2,source:{assetId:two,outFrame:168}});expect(p.storyFlow!.nodes[1]).toEqual(b);
  });
  it('keeps video render provenance when its producing clip is deleted',()=>{
    const p=base(),assetId=id();p.interstitials=[{id:id(),label:'Generated',phase:'ready',time:0,start_range:0,end_range:0,duration:4,prompt:'Next prompt',enable_prompt_expansion:false,result:{assetId,url:'asset:'+assetId,start:0,duration:4,totalDuration:4,prompt:'Actual rendered prompt'}}];
    p.library=collectLibrary(p);p.interstitials=[];expect(collectLibrary(p)[0].generation).toMatchObject({provider:'comfy',result:{prompt:'Actual rendered prompt'}});
  });
  it('copies generation recipes independently when saving and instantiating templates',()=>{
    const p=base(),g=newAssetGeneration('image'),a={...node(id()),generationId:g.id};p.storyFlow={...p.storyFlow!,entryId:a.id,nodes:[a]};
    const template=captureTemplate(p.storyFlow,[a.id],[],'Image sequence',[g])!;
    const added=instantiateTemplate(p.storyFlow,template,[]);expect(added.generations[0].id).not.toBe(g.id);
    expect(added.graph.nodes.at(-1)?.generationId).toBe(added.generations[0].id);expect(added.graph.nodes.at(-1)?.source?.assetId).toBe(a.source?.assetId);
    added.generations[0].settings.prompt='Changed';expect(g.settings.prompt).toBe('');
  });
  it('retains a completed render when undo returns to settings edited before it finished',()=>{
    const p=base(),g=newAssetGeneration('image'),assetId=id(),clip={...node(assetId),source:undefined,generationId:g.id,duration:6};
    p.clipGenerations=[g];p.storyFlow={...p.storyFlow!,entryId:clip.id,nodes:[clip]};
    const history=new ProjectHistory();history.record(p,{...p,clipGenerations:[{...g,settings:{...g.settings,prompt:'Next prompt'}}]});
    history.retainGeneratedMedia([{assetId,name:'Rendered',kind:'image',generationId:g.id,generation:{provider:'fal',createdAt:1,settings:{...g.settings,prompt:'Rendered prompt'}}}]);
    expect(history.target('undo')?.clipGenerations?.[0].settings.prompt).toBe('');
    expect(history.target('undo')?.storyFlow?.nodes[0].source).toMatchObject({assetId,outFrame:144});
    expect(history.target('undo')?.library?.[0].generation).toMatchObject({settings:{prompt:'Rendered prompt'}});
  });
  it('round-trips clip volume, recipes and immutable render info through the archive',async()=>{
    const p=base(),g=newAssetGeneration('image'),assetId=id(),a={...node(assetId),generationId:g.id,volume:.4,source:{...node(assetId).source!,kind:'image' as const}};g.selectedAssetId=assetId;g.phase='ready';g.versions=[{assetId,name:'Image',createdAt:1,settings:{...g.settings,prompt:'Submitted'}}];
    p.mediaModelVersion=1;p.clipGenerations=[g];p.library=collectLibrary(p);p.storyFlow={...p.storyFlow!,entryId:a.id,nodes:[a]};
    const signal=new AbortController().signal,blob=await packProject(p,[{id:assetId,name:'Image.png',blob:new Blob(['test'],{type:'image/png'})}],signal,()=>{});
    const reopened=(await unpackProject(blob,signal,()=>{})).project;
    expect(reopened.storyFlow!.nodes[0].volume).toBe(.4);expect(reopened.storyFlow!.nodes[0].source?.assetId).not.toBe(assetId);
    expect(reopened.library![0].generation).toMatchObject({provider:'fal',settings:{prompt:'Submitted'}});expect(reopened.clipGenerations![0].settings.prompt).toBe('');
  });
});
