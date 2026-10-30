import { TIMELINE_FPS } from '../../../shared/constants';
import type { LibraryAsset, Project } from './types';

/** The library owns media independently of its instances on the timeline. */
export function collectLibrary(project: Project, sourceDuration?: number): LibraryAsset[] {
  const entries = new Map((project.library ?? []).map(item => [item.assetId, item]));
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
  if (project.subtitle) add({ ...project.subtitle, kind: 'subtitle' });
  return [...entries.values()];
}
