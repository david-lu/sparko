import { generationBusy } from '../../../shared/asset-generation';
import { TIMELINE_FPS } from '../../../shared/constants';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import { assetUsage } from './assetUsage';
import type { LibraryAsset, Project } from './types';

/** Common video entity. Media and optional generation state are separate capabilities,
 * so a draft keeps its identity when it renders or is placed on the timeline.
 * Existing project stores are adapted here without duplicating their saved state. */
export interface Video {
  id: string;
  name: string;
  folderId?: string;
  media?: LibraryAsset;
  versions?: LibraryAsset[];
  generation?: Interstitial;
  /** Only retained to finish jobs submitted before videos moved to Comfy. */
  legacyGeneration?: NonNullable<Project['assetGenerations']>[number];
}

export function videoAssetIds(project: Project, id: string): string[] {
  const item = project.interstitials.find(item => item.id === id);
  const legacy = project.assetGenerations?.find(g => g.kind === 'video' && g.id === id);
  return [...new Set([item?.result?.assetId, item?.result?.fullAssetId, item?.previousResult?.assetId,
    item?.previousResult?.fullAssetId, ...legacy?.versions.map(v => v.assetId) ?? [],
    ...project.library?.filter(a => a.videoId === id).map(a => a.assetId) ?? []].filter((id): id is string => !!id))];
}

export function projectVideos(project: Project): Video[] {
  const owned = new Set(project.interstitials.flatMap(item => videoAssetIds(project, item.id)));
  for (const g of project.assetGenerations ?? []) if (g.kind === 'video') for (const v of g.versions) owned.add(v.assetId);
  const media = (id?: string) => project.library?.find(a => a.assetId === id);
  return [
    ...project.library?.filter(a => ['video', 'generated'].includes(a.kind) && !owned.has(a.assetId))
      .map(a => ({ id: a.assetId, name: a.name, folderId: a.folderId, media: a })) ?? [],
    ...project.interstitials.map(item => ({ id: item.id, name: item.label, folderId: item.folderId,
      media: media(playableResult(item)?.assetId), generation: item,
      versions: project.library?.filter(a => a.videoId === item.id || a.generationId === item.id) })),
    ...project.assetGenerations?.filter(g => g.kind === 'video' && !project.interstitials.some(i => i.id === g.id))
      .map(g => ({ id: g.id, name: g.name, folderId: g.folderId, media: media(g.selectedAssetId), legacyGeneration: g })) ?? [],
  ];
}

export function videoUsage(project: Project, video: Video) {
  if (!video.generation && !video.legacyGeneration) return assetUsage(project, video.media ? [video.media.assetId] : []);
  return [
    ...project.storyFlow?.nodes.filter(n => n.interstitialId === video.id).map(n => ({ owner: n.name, role: 'Timeline video' })) ?? [],
    ...assetUsage({ ...project, interstitials: project.interstitials.filter(i => i.id !== video.id),
      assetGenerations: project.assetGenerations?.filter(g => g.id !== video.id) }, videoAssetIds(project, video.id)),
  ];
}

/** Keep old renders and their provenance; all subsequent video edits use Comfy.
 * Already-submitted fal jobs finish through their original controller first. */
export function migrateVideoGenerations(project: Project): Project {
  const added: Interstitial[] = (project.assetGenerations ?? []).filter(g => g.kind === 'video' && !generationBusy(g)
    && !(g.phase === 'error' && g.requestId)
    && !project.interstitials.some(i => i.id === g.id)).map(g => {
    const version = g.versions.find(v => v.assetId === g.selectedAssetId);
    const asset = project.library?.find(a => a.assetId === g.selectedAssetId) ?? (version ? { assetId: version.assetId, duration: g.settings.duration } : undefined);
    const duration = asset?.duration ?? g.settings.duration;
    const images = g.settings.references.filter(r => r.kind === 'image').map(({ assetId, name }) => ({ assetId, name }));
    return { id: g.id, label: g.name, folderId: g.folderId, time: 0, kind: 'regular',
      phase: asset ? 'ready' : 'draft', method: 'comfy-extend', resolution: 'native',
      prompt: g.settings.prompt, duration: g.settings.duration, start_range: 2, end_range: 2, enable_prompt_expansion: false,
      imageReferences: images, startReferenceType: images.length ? 'image' : 'none', endReferenceType: 'none',
      startImageIndex: images.length ? 0 : undefined, useInputReference: false, useOutputReference: false,
      result: asset ? { assetId: asset.assetId, url: '', start: 0, duration, totalDuration: duration, prompt: version?.settings.prompt } : undefined };
  });
  if (!added.length) return project;
  const storyFlow = project.storyFlow && { ...project.storyFlow, nodes: project.storyFlow.nodes.map(node => {
    // Older library videos were inserted as a snapshot of the selected output.
    // Reconnect a single placement without changing its trim or routing.
    const video = added.find(item => item.result?.assetId && item.result.assetId === node.source?.assetId);
    if (!video || !node.source || project.storyFlow!.nodes.filter(n => n.source?.assetId === node.source!.assetId).length !== 1) return node;
    const start = Math.round(video.result!.start * TIMELINE_FPS);
    return { ...node, kind: 'simple' as const, source: undefined, interstitialId: video.id,
      trim: { inFrame: node.source.inFrame - start, outFrame: node.source.outFrame - start } };
  }) };
  return { ...project, storyFlow, interstitials: [...project.interstitials, ...added] };
}
