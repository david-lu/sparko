import { expect, it } from 'vitest';
import { newAssetGeneration } from '../../shared/asset-generation';
import { migrateVideoGenerations, projectVideos, videoUsage } from '../../src/features/project/videos';
import { collectLibrary } from '../../src/features/project/library';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { createNode } from '../../src/features/story-flow/model';
import { storyDependency } from '../../src/features/story-flow/dependencies';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { packProject, unpackProject } from '../../src/features/project/archive';

function fixture() {
  const imported = { assetId: crypto.randomUUID(), name: 'Imported.mp4', kind: 'video' as const, duration: 8 };
  const { node, item } = createNode('simple');
  Object.assign(item, { startReferenceType: 'none', endReferenceType: 'none', useInputReference: false, useOutputReference: false });
  const project: Project = { id: 'project', name: 'Videos', updatedAt: 0, source: { name: 'Empty' }, subtitle: null, analysis: emptyAnalysis(),
    interstitials: [item], library: [imported], storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] } };
  return { project, imported, node, item };
}

it('imported media and generated drafts share the Video interface; rendering keeps one identity', () => {
  const { project, imported, item } = fixture();
  expect(projectVideos(project).map(v => [v.id, v.name])).toEqual([[imported.assetId, imported.name], [item.id, item.label]]);
  const resultId = crypto.randomUUID(), previousId = crypto.randomUUID();
  item.phase = 'ready'; item.result = { url: '', assetId: resultId, start: 0, duration: 4, totalDuration: 4 };
  item.previousResult = { ...item.result, assetId: previousId };
  project.library = collectLibrary(project);
  const videos = projectVideos(project);
  expect(videos).toHaveLength(2);
  expect(videos[1]).toMatchObject({ id: item.id, media: { assetId: resultId } });
  item.phase = 'rendering';
  expect(projectVideos(project)[1]).toMatchObject({ id: item.id, media: { assetId: previousId } });
  item.phase = 'ready'; item.previousResult = undefined;
  item.result = { ...item.result, assetId: crypto.randomUUID() };
  project.library = collectLibrary(project);
  expect(projectVideos(project)).toHaveLength(2);
  expect(projectVideos(project)[1].versions).toHaveLength(3);
});

it('draft placements and references protect a video from deletion without counting its own output', () => {
  const { project, node, item } = fixture();
  const video = projectVideos(project)[1];
  expect(videoUsage(project, video)).toEqual([]);
  project.storyFlow!.nodes.push(node);
  expect(videoUsage(project, video)).toEqual([{ owner: node.name, role: 'Timeline video' }]);
  project.storyFlow!.nodes = [];
  item.phase = 'ready'; item.result = { url: '', assetId: crypto.randomUUID(), start: 0, duration: 4, totalDuration: 4 };
  expect(videoUsage(project, video)).toEqual([]);
  const other = createNode('simple').item;
  other.startVideoAsset = { assetId: item.result.assetId!, name: item.label, inFrame: 0, outFrame: 96 };
  project.interstitials.push(other);
  expect(videoUsage(project, video)).toEqual([{ owner: other.label, role: 'start video input' }]);
});

it('standalone videos validate image and arbitrary video references with the same Comfy dependency resolver', () => {
  const { project, item, imported } = fixture();
  const dependency = () => storyDependency(project.storyFlow!, [item], '', 0, item.id);
  expect(dependency()).toMatchObject({ issues: [], reference: { mode: 'custom' } });
  item.startReferenceType = 'video'; item.useStartVideoAsset = true;
  expect(dependency().blocked).toContain('Choose a video');
  item.startVideoAsset = { assetId: imported.assetId, name: imported.name, inFrame: 24, outFrame: 72 };
  expect(dependency()).toMatchObject({ blocked: undefined, reference: { before: { assetId: imported.assetId, inFrame: 24, outFrame: 72 } } });
  item.endReferenceType = 'image';
  expect(dependency().blocked).toContain('Add an image');
  item.imageReferences = [{ assetId: crypto.randomUUID(), name: 'Last frame.png' }];
  expect(dependency().blocked).toBeUndefined();
});

it('migrates legacy video settings and selected output once while preserving versions and running jobs', async () => {
  const { project } = fixture(), folder = crypto.randomUUID(), legacy = newAssetGeneration('video', folder);
  legacy.name = 'Old video'; legacy.settings.prompt = 'Clouds'; legacy.phase = 'ready';
  legacy.selectedAssetId = crypto.randomUUID();
  legacy.versions = [{ assetId: legacy.selectedAssetId, name: 'Clouds v1', createdAt: 1, settings: structuredClone(legacy.settings) }];
  const running = { ...newAssetGeneration('video'), phase: 'rendering' as const, requestId: 'old-job-123' };
  project.assetGenerations = [legacy, running];
  project.library!.push({ assetId: legacy.selectedAssetId, name: 'Clouds v1', kind: 'generated', duration: 5 });
  project.storyFlow!.entryId = 'old-placement';
  project.storyFlow!.nodes = [{ id: 'old-placement', name: 'Old video', kind: 'source', x: 30, y: 80, loopCount: 0,
    source: { assetId: legacy.selectedAssetId, inFrame: 24, outFrame: 96, duration: 5 } }];
  const migrated = migrateVideoGenerations(project);
  expect(migrated.interstitials.at(-1)).toMatchObject({ id: legacy.id, folderId: folder, prompt: 'Clouds', method: 'comfy-extend', result: { assetId: legacy.selectedAssetId } });
  expect(migrated.assetGenerations).toEqual(project.assetGenerations);
  expect(migrateVideoGenerations(migrated)).toBe(migrated);
  expect(migrated.storyFlow?.nodes[0]).toMatchObject({ id: 'old-placement', source: undefined, interstitialId: legacy.id, trim: { inFrame: 24, outFrame: 96 }, x: 30, y: 80 });
  expect(projectVideos(migrated).filter(v => v.id === legacy.id)).toHaveLength(1);
  expect(projectVideos(migrated).at(-1)?.legacyGeneration).toBe(running);
  migrated.library = collectLibrary(migrated);
  const signal = new AbortController().signal;
  const media = migrated.library!.map(a => ({ id: a.assetId, name: a.name, blob: new Blob(['video'], { type: 'video/mp4' }) }));
  const restored = await unpackProject(await packProject(migrated, media, signal, () => {}), signal, () => {});
  const saved = restored.project.interstitials.find(i => i.id === legacy.id)!;
  expect(saved.folderId).toBe(folder);
  expect(saved.result?.assetId).toBe(restored.project.assetGenerations![0].selectedAssetId);
  expect(restored.project.library?.find(a => a.assetId === saved.result?.assetId)?.videoId).toBe(saved.id);
  expect(projectVideos(restored.project).filter(v => v.id === legacy.id)).toHaveLength(1);
});

it('undo records folders for generated videos', () => {
  const { project, item } = fixture(), history = new ProjectHistory();
  history.record(project, { ...project, interstitials: [{ ...item, folderId: 'folder' }] });
  expect(history.target('undo')?.interstitials[0].folderId).toBeUndefined();
  history.commit('undo'); expect(history.target('redo')?.interstitials[0].folderId).toBe('folder');
});
