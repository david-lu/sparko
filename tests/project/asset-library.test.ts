import { describe, expect, it } from 'vitest';
import { newAssetGeneration } from '../../shared/asset-generation';
import { assetUsage } from '../../src/features/project/assetUsage';
import { assetIds, emptyAnalysis, type Project } from '../../src/features/project/types';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { createNode } from '../../src/features/story-flow/model';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { interstitialSettings } from '../../shared/interstitials';
import { assetVolume, volumeAssetId } from '../../src/features/project/assetVolume';

function fixture() {
  const image = crypto.randomUUID(), video = crypto.randomUUID(), output = crypto.randomUUID();
  const { node, item } = createNode('simple'); node.name = 'Opening shot';
  Object.assign(item, { imageReferences: [{ assetId: image, name: 'Character.png' }], useStartVideoAsset: true, useEndVideoAsset: true,
    startReferenceType: 'video', endReferenceType: 'video', startVideoAsset: { assetId: video, name: 'Motion.mp4', inFrame: 24, outFrame: 72 }, endVideoAsset: { assetId: video, name: 'Motion.mp4', inFrame: 96, outFrame: 144 } });
  const generation = newAssetGeneration('image'); generation.name = 'Poster';
  generation.settings.references = [{ assetId: image, name: 'Character.png', kind: 'image' }];
  const project: Project = { id: 'project', name: 'Assets', updatedAt: 0, source: { name: 'Empty' }, subtitle: null, analysis: emptyAnalysis(),
    interstitials: [item], clipGenerations: [generation], storyFlow: { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [] },
    library: [{ assetId: image, name: 'Character.png', kind: 'image' }, { assetId: video, name: 'Motion.mp4', kind: 'video', duration: 10 }] };
  return { project, image, video, output, node, item, generation };
}

describe('universal asset references', () => {
  it('shares volume between an original video and its prepared timeline copy', () => {
    const { project, video } = fixture(), copy = crypto.randomUUID();
    project.library!.find(asset => asset.assetId === video)!.volume = .35;
    project.library!.push({ assetId: copy, originalAssetId: video, name: 'Prepared.mp4', kind: 'video' });
    expect(volumeAssetId(project.library, copy)).toBe(video);
    expect(assetVolume(project.library, copy)).toBe(.35);
    project.library!.find(asset => asset.assetId === video)!.volume = 0;
    expect(assetVolume(project.library, copy)).toBe(0);
    expect(assetVolume(project.library, 'missing')).toBe(1);
  });
  it('warns about timeline image inputs and both arbitrary video inputs even without footage clips', () => {
    const { project, image, video } = fixture();
    expect(assetUsage(project, [image])).toEqual(expect.arrayContaining([{ owner: 'Opening shot', role: 'image input' }, { owner: 'Poster', role: 'image generation input' }]));
    expect(assetUsage(project, [video])).toEqual([{ owner: 'Opening shot', role: 'start video input' }, { owner: 'Opening shot', role: 'end video input' }]);
    expect(assetUsage(project, [crypto.randomUUID()])).toEqual([]);
  });
  it('retains dependencies used only by a submitted job or saved version', () => {
    const { project, generation, item, image } = fixture();
    generation.submitted = structuredClone(generation.settings);
    generation.versions = [{ assetId: crypto.randomUUID(), name: 'v1', createdAt: 1, settings: structuredClone(generation.settings) }];
    item.generationSettings = interstitialSettings(item);
    item.imageReferences = []; generation.settings.references = [];
    expect(assetUsage(project, [image]).map(u => u.role)).toEqual(['Submitted image input', 'Submitted generation input', 'Saved version input']);
  });
  it('resolves Start and End independently and preserves submitted ranges', () => {
    const { project, item, video } = fixture();
    const dependency = () => storyDependency(project.storyFlow!, [item], '', 0, item.id);
    expect(dependency()).toMatchObject({ blocked: undefined, label: 'Motion.mp4', reference: { before: { assetId: video, inFrame: 24, outFrame: 72 }, after: { assetId: video, inFrame: 96, outFrame: 144 } } });
    item.result = { assetId: crypto.randomUUID(), url: '', start: 1, duration: 4, totalDuration: 6, reference: dependency().reference }; item.phase = 'ready';
    expect(dependency().stale).toBe(false);
    item.useEndVideoAsset = false;
    expect(dependency().blocked).toContain('following'); expect(dependency().reference?.before?.assetId).toBe(video);
    expect(item.result.reference?.after?.inFrame).toBe(96);
    item.useEndVideoAsset = true; item.endVideoAsset = undefined;
    expect(dependency().blocked).toBe('Choose videos or images for the end reference.');
  });
  it('round-trips folders, versions, and reference-only assets with remapped identities', async () => {
    const { project, item, image, video, output, generation } = fixture();
    project.library!.find(asset => asset.assetId === video)!.volume = .35;
    const folder = crypto.randomUUID(); project.libraryFolders = [{ id: folder, name: 'References' }, { id: crypto.randomUUID(), name: 'Nested', parentId: folder }];
    generation.folderId = folder; generation.selectedAssetId = output; generation.phase = 'ready'; generation.submitted = structuredClone(generation.settings);
    generation.versions = [{ assetId: output, name: 'Poster v1', createdAt: 1, settings: structuredClone(generation.settings) }];
    item.generationSettings = interstitialSettings(item);
    const signal = new AbortController().signal, progress = () => {};
    const media = [image, video, output].map(id => ({ id, name: id, blob: new Blob(['fixture'], { type: id === video ? 'video/mp4' : 'image/png' }) }));
    const result = await unpackProject(await packProject(project, media, signal, progress), signal, progress);
    const ids = assetIds(result.project);
    expect(ids).toHaveLength(3); expect(ids.some(id => ([image, video, output] as string[]).includes(id))).toBe(false);
    expect(result.project.libraryFolders).toEqual(project.libraryFolders);
    expect(result.project.library?.find(asset => asset.name === 'Motion.mp4')?.volume).toBe(.35);
    const restored = result.project.clipGenerations![0];
    expect(restored.settings.references[0].assetId).toBe(result.project.interstitials[0].imageReferences![0].assetId);
    expect(restored.versions[0].assetId).toBe(restored.selectedAssetId);
    expect(restored.submitted?.references).toEqual(restored.versions[0].settings.references);
    expect(result.project.interstitials[0].startVideoAsset?.assetId).toBe(result.project.interstitials[0].generationSettings?.endVideoAsset?.assetId);
  });
  it('restores deleted library metadata and folders through undo', () => {
    const { project } = fixture(), history = new ProjectHistory();
    history.record(project, { ...project, library: [] });
    expect(history.target('undo')?.library).toEqual(project.library);
    history.commit('undo'); expect(history.target('redo')?.library).toEqual([]);
  });
  it('groups a volume drag into one undo step and keeps mute as a separate edit', () => {
    const { project, video } = fixture(), history = new ProjectHistory();
    project.storyFlow={version:1,entryId:'clip',nodes:[{id:'clip',name:'Clip',kind:'source',x:0,y:0,loopCount:0,source:{assetId:video,inFrame:0,outFrame:24}}],edges:[],templates:[]};
    const volume = (value: number) => ({ ...project, storyFlow:{...project.storyFlow!,nodes:project.storyFlow!.nodes.map(n=>({...n,volume:value}))} });
    history.record(project, volume(.7), 100); history.record(volume(.7), volume(.35), 200);
    expect(history.undoLabel).toBe('Edit clip');
    expect(history.target('undo')?.storyFlow).toEqual(project.storyFlow);
    history.endGroup(); history.record(volume(.35), volume(0), 300);
    expect(history.target('undo')?.storyFlow?.nodes[0].volume).toBe(.35);
    history.commit('undo'); expect(history.target('undo')?.storyFlow).toEqual(project.storyFlow);
  });
});
