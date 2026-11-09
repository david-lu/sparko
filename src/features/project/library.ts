import { TIMELINE_FPS } from '../../../shared/constants';
import type { LibraryAsset, Project } from './types';

/** The library owns media independently of its instances on the timeline. */
export function collectLibrary(project: Project, sourceDuration?: number): LibraryAsset[] {
  // Older working copies may still contain subtitles in the library.
  const deleted = new Set(project.deletedAssetIds);
  const entries = new Map((project.library ?? []).filter(item => !deleted.has(item.assetId) && ['video', 'generated', 'image', 'audio'].includes(item.kind)).map(item => [item.assetId, item]));
  const add = (item: LibraryAsset) => {
    if (deleted.has(item.assetId)) return;
    const existing = entries.get(item.assetId);
    entries.set(item.assetId, existing ? { ...item, ...existing, duration: existing.duration ?? item.duration } : item);
  };
  if (project.source.assetId) {
    const image = entries.get(project.source.assetId)?.kind === 'image' || project.storyFlow?.nodes.some(n => n.source?.assetId === project.source.assetId && n.source?.kind === 'image');
    add({ ...project.source, assetId: project.source.assetId, kind: image ? 'image' : 'video', duration: image ? undefined : sourceDuration });
  }
  for (const node of project.storyFlow?.nodes ?? []) {
    if (node.source) add({ assetId: node.source.assetId, originalAssetId: node.source.originalAssetId, name: node.name, kind: node.source.kind ?? 'video', duration: node.source.duration });
  }
  for (const item of project.interstitials) {
    for (const result of [item.previousResult, item.result]) {
      if (!result?.assetId) continue;
      const generation = { provider: 'comfy' as const, result,
        settings: result.metadata?.settings ?? (result === item.result && item.phase === 'ready' ? item.generationSettings : undefined) };
      add({ assetId: result.assetId, name: item.label, kind: 'generated', duration: result.totalDuration, generation,
        inFrame: Math.round(result.start * TIMELINE_FPS), outFrame: Math.round((result.start + result.duration) * TIMELINE_FPS) });
      if (result.fullAssetId) add({ assetId: result.fullAssetId, name: `${item.label} · full render`, kind: 'generated', generation,
        duration: result.fullRange?.totalDuration, inFrame: Math.round((result.fullRange?.start ?? 0) * TIMELINE_FPS), outFrame: result.fullRange ? Math.round((result.fullRange.start + result.fullRange.duration) * TIMELINE_FPS) : undefined });
    }
  }
  for (const generation of [...project.clipGenerations ?? [], ...project.assetGenerations ?? []]) for (const version of generation.versions) add({ assetId: version.assetId, name: version.name, kind: generation.kind === 'video' ? 'generated' : generation.kind, generationId: generation.id, folderId: generation.folderId,
    generation: { provider: 'fal', settings: version.settings, createdAt: version.createdAt } });
  for (const item of project.interstitials) for (const clip of item.timelineVideos ?? []) if (clip.video) add({ assetId: clip.video.assetId, name: clip.video.name, kind: 'video' });
  for (const item of project.interstitials) for (const keyframe of item.keyframes ?? []) if (keyframe.image) add({ ...keyframe.image, kind: 'image' });
  for (const item of project.interstitials) for (const ref of item.imageReferences ?? []) add({ assetId: ref.assetId, name: ref.name, kind: 'image' });
  return [...entries.values()];
}
