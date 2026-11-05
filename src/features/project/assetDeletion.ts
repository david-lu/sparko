import type { LibraryMoveSelection } from '../story-flow/libraryDrag';
import type { Project } from './types';
import { assetUsage } from './assetUsage';

/** References inside generations being deleted together do not block the batch. */
export function planAssetDeletion(project: Project, selection: readonly LibraryMoveSelection[]) {
  const seen = new Set<string>();
  const targets = selection.flatMap(item => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const name = item.type === 'asset' ? project.library?.find(asset => asset.assetId === item.id)?.name
      : project.assetGenerations?.find(generation => generation.id === item.id)?.name;
    return name === undefined ? [] : [{ ...item, name }];
  });
  const generationIds = new Set(targets.filter(item => item.type === 'generation').map(item => item.id));
  const assetIds = new Set([
    ...targets.filter(item => item.type === 'asset').map(item => item.id),
    ...project.assetGenerations?.filter(g => generationIds.has(g.id)).flatMap(g => g.versions.map(version => version.assetId)) ?? [],
    ...project.library?.filter(asset => asset.generationId && generationIds.has(asset.generationId)).map(asset => asset.assetId) ?? [],
  ]);
  return { projectId: project.id, targets, generationIds, assetIds,
    usages: assetUsage({ ...project, assetGenerations: project.assetGenerations?.filter(g => !generationIds.has(g.id)) }, [...assetIds]) };
}
