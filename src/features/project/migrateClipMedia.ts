import { generationBusy, type AssetGeneration } from '../../../shared/asset-generation';
import { playableResult } from '../../../shared/interstitials';
import { TIMELINE_FPS } from '../../../shared/constants';
import { DEFAULT_IMAGE_DURATION } from '../../media/stillImage';
import type { StoryNode } from '../story-flow/model';
import { assetVolume } from './assetVolume';
import { collectLibrary } from './library';
import type { LibraryAsset, Project } from './types';

export function assetPlacement(asset: LibraryAsset, duration?: number): NonNullable<StoryNode['source']> {
  const image = asset.kind === 'image';
  return { assetId: asset.assetId, originalAssetId: asset.originalAssetId,
    kind: image ? 'image' : asset.kind === 'audio' ? 'audio' : undefined,
    duration: image ? undefined : asset.duration,
    inFrame: image ? 0 : asset.inFrame ?? 0,
    outFrame: image ? Math.max(1, Math.round((duration ?? DEFAULT_IMAGE_DURATION) * TIMELINE_FPS)) : asset.outFrame ?? Math.max(1, Math.round((asset.duration ?? duration ?? 4) * TIMELINE_FPS)) };
}

/** Upgrade ownership once; loading older projects never changes the audio they already play. */
export function migrateClipMedia(project: Project): Project {
  if (project.mediaModelVersion === 1) return project;
  const legacy = project.assetGenerations ?? [], library = collectLibrary(project);
  let graph = project.storyFlow;
  if (!graph && project.source.assetId) return project; // Legacy linear projects migrate after their graph is built.
  graph ??= { version: 1, entryId: '', nodes: [], edges: [], templates: [] };
  const migrateNode = (node: StoryNode) => {
    const item = project.interstitials.find(item => item.id === node.interstitialId);
    const assetId = node.source?.assetId ?? (item && playableResult(item)?.assetId);
    return { ...node, volume: node.volume ?? assetVolume(library, assetId) };
  };
  let nodes: StoryNode[] = graph.nodes.map(migrateNode);
  const recipes: AssetGeneration[] = [...project.clipGenerations ?? []];
  for (const generation of legacy) {
    const outputIds = new Set(generation.versions.map(version => version.assetId));
    const instances = nodes.filter(node => node.generationId === generation.id || node.source && outputIds.has(node.source.assetId));
    if (!instances.length && (generation.phase !== 'ready' || generationBusy(generation))) {
      const asset = library.find(asset => asset.assetId === generation.selectedAssetId);
      const node: StoryNode = { id: crypto.randomUUID(), name: generation.name, kind: 'source', generationId: generation.id,
        mediaKind: generation.kind, duration: generation.kind === 'image' ? DEFAULT_IMAGE_DURATION : generation.settings.duration,
        x: 40, y: Math.max(-55, ...nodes.map(node => node.y)) + 145, loopCount: 0, volume: assetVolume(library, asset?.assetId),
        source: asset ? assetPlacement(asset) : undefined };
      nodes.push(node); instances.push(node);
    }
    instances.forEach((node, index) => {
      const id = index === 0 ? generation.id : crypto.randomUUID();
      // Additional placements share the saved media, while their next-render settings are independent.
      const copy = index === 0 ? generation : { ...generation, id, phase: node.source ? 'ready' as const : 'draft' as const, requestId: undefined, submitted: undefined, error: undefined };
      if (!recipes.some(recipe => recipe.id === id)) recipes.push({ ...copy, settings: { ...copy.settings, count: 1 }, selectedAssetId: node.source?.assetId ?? copy.selectedAssetId });
      nodes = nodes.map(n => n.id === node.id ? { ...n, generationId: id, mediaKind: generation.kind } : n);
    });
  }
  const migratedLibrary = library.map(({ volume: _volume, ...asset }) => asset);
  return { ...project, mediaModelVersion: 1, assetGenerations: undefined, clipGenerations: recipes,
    library: migratedLibrary, storyFlow: { ...graph, entryId: graph.entryId || nodes[0]?.id || '', nodes,
      templates: graph.templates.map(template => ({ ...template, nodes: template.nodes.map(migrateNode) })) } };
}
