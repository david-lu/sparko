import type { LibraryMoveSelection } from '../story-flow/libraryDrag';
import type { Project } from './types';
import { assetUsage } from './assetUsage';

/** Compute warnings against the surviving document, including saved generation versions. */
export function planAssetDeletion(project: Project, selection: readonly LibraryMoveSelection[]) {
  const seen = new Set<string>();
  const targets = selection.flatMap(item => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const name = item.type === 'asset' ? project.library?.find(asset => asset.assetId === item.id)?.name
      : project.clipGenerations?.find(generation => generation.id === item.id)?.name;
    return name === undefined ? [] : [{ ...item, name }];
  });
  const generationIds = new Set(targets.filter(item => item.type === 'generation').map(item => item.id));
  const assetIds = new Set([
    ...targets.filter(item => item.type === 'asset').map(item => item.id),
    ...project.clipGenerations?.filter(g => generationIds.has(g.id)).flatMap(g => g.versions.map(version => version.assetId)) ?? [],
    ...project.library?.filter(asset => asset.generationId && generationIds.has(asset.generationId)).map(asset => asset.assetId) ?? [],
  ]);
  const plan = { projectId: project.id, targets, generationIds, assetIds };
  return { ...plan, usages: assetUsage(applyAssetDeletion(project, plan), [...assetIds]) };
}

export function applyAssetDeletion(project: Project, plan: { assetIds: Set<string>; generationIds: Set<string> }): Project {
  const { assetIds, generationIds } = plan;
  return { ...project,
    deletedAssetIds: [...new Set([...project.deletedAssetIds ?? [], ...assetIds])],
    library: project.library?.filter(asset => !assetIds.has(asset.assetId)),
    clipGenerations: project.clipGenerations?.filter(g => !generationIds.has(g.id)).map(g => ({ ...g,
      versions: g.versions.filter(version => !assetIds.has(version.assetId)),
      selectedAssetId: assetIds.has(g.selectedAssetId ?? '') ? undefined : g.selectedAssetId,
    })).filter(g => project.storyFlow?.nodes.some(node => node.generationId === g.id) || g.versions.length || !project.storyFlow),
    storyFlow: project.storyFlow && { ...project.storyFlow, nodes: project.storyFlow.nodes.map(node =>
      generationIds.has(node.generationId ?? '') ? { ...node, generationId: undefined } : node) },
  };
}
