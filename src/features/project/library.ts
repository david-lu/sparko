import { TIMELINE_FPS } from '../../../shared/constants';
import type { LibraryAsset, Project } from './types';

/** The library owns media independently of its instances on the timeline. */
export function collectLibrary(project: Project, sourceDuration?: number): LibraryAsset[] {
  // Older working copies may still contain subtitles in the library.
  const entries = new Map((project.library ?? []).filter(item => ['video', 'generated', 'image', 'audio'].includes(item.kind)).map(item => [item.assetId, item]));
  const add = (item: LibraryAsset) => {
    const existing = entries.get(item.assetId);
    entries.set(item.assetId, existing ? { ...item, ...existing, duration: existing.duration ?? item.duration } : item);
  };
  if (project.source.assetId) add({ ...project.source, assetId: project.source.assetId, kind: 'video', duration: sourceDuration });
  for (const node of project.storyFlow?.nodes ?? []) {
    if (node.source) add({ assetId: node.source.assetId, originalAssetId: node.source.originalAssetId, name: node.name, kind: 'video', duration: node.source.duration });
  }
  for (const item of project.interstitials) {
    for (const result of [item.previousResult, item.result]) {
      if (!result?.assetId) continue;
      add({ assetId: result.assetId, name: item.label, kind: 'generated', duration: result.totalDuration,
        inFrame: Math.round(result.start * TIMELINE_FPS), outFrame: Math.round((result.start + result.duration) * TIMELINE_FPS) });
    }
  }
  for (const generation of project.assetGenerations ?? []) for (const version of generation.versions) add({ assetId: version.assetId, name: version.name, kind: generation.kind === 'video' ? 'generated' : generation.kind, generationId: generation.id, folderId: generation.folderId });
  for (const item of project.interstitials) for (const ref of item.imageReferences ?? []) add({ assetId: ref.assetId, name: ref.name, kind: 'image' });
  return [...entries.values()];
}
