import { referenceClips } from '../../../shared/reference-clips';
import { videoAssets } from '../../../shared/video-references';
import type { ProjectLora } from '../../../shared/loras';
import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { Interstitial } from '../../../shared/interstitials';
import type { CallResponseFlow } from '../call-response/model';
import type { StoryGraph } from '../story-flow/model';
import type { AssetGeneration } from '../../../shared/asset-generation';

export type Asset = { id: string; name: string; blob: Blob };
export type LibraryAsset = { assetId: string; originalAssetId?: string; normalizedFps?: number; name: string; kind: 'video' | 'generated' | 'image' | 'audio'; folderId?: string; generationId?: string; width?: number; height?: number; duration?: number; inFrame?: number; outFrame?: number; volume?: number };
export type LibraryFolder = { id: string; name: string; parentId?: string };
export type AnalysisState = { slice: Slice; provider: Provider; instructions: string; result: CaptionResult | null };
export type Project = {
  id: string; name: string; updatedAt: number; saved?: boolean;
  source: { name: string; assetId?: string; originalAssetId?: string; url?: string };
  crossfadeFrames?: number;
  interstitials: Interstitial[];
  callResponse?: CallResponseFlow;
  callResponses?: CallResponseFlow[];
  storyFlow?: StoryGraph;
  library?: LibraryAsset[];
  libraryFolders?: LibraryFolder[];
  assetGenerations?: AssetGeneration[];
  /** Original asset IDs mapped to this project's local IDs, for portable video references. */
  assetAliases?: Record<string, string>;
  loras?: ProjectLora[];
  subtitle: { name: string; assetId: string } | null;
  analysis: AnalysisState;
};
export const emptyAnalysis = (): AnalysisState => ({ slice: { start: 0, end: 10 }, provider: 'openai', instructions: '', result: null });
export const projectFlows = (project?: Pick<Project, 'callResponse' | 'callResponses'> | null) => project?.callResponses ?? (project?.callResponse ? [project.callResponse] : []);
export const activeFlows = (project?: Project | null) => projectFlows(project).filter(flow => project?.interstitials.find(item => item.id === flow.interstitial.id)?.kind !== 'regular');
export const withFlows = (project: Project, callResponses: CallResponseFlow[]): Project => ({ ...project, callResponses, callResponse: callResponses[0] });
export const assetIds = (project: Project) => [...new Set([project.source.assetId, project.source.originalAssetId, project.subtitle?.assetId,
  ...(project.assetGenerations ?? []).flatMap(g => [g.selectedAssetId, ...g.versions.flatMap(v => [v.assetId, ...v.settings.references.map(r => r.assetId)]), ...g.settings.references.map(r => r.assetId), ...(g.submitted?.references.map(r => r.assetId) ?? [])]),
  ...project.storyFlow?.templates.flatMap(template => Object.values(template.settings).flatMap(settings => [...videoAssets(settings, 'start').map(r => r.assetId), ...videoAssets(settings, 'end').map(r => r.assetId), ...settings.imageReferences?.map(image => image.assetId) ?? []])) ?? [],
  ...(project.library ?? []).flatMap(item => [item.assetId, item.originalAssetId]),
  ...project.storyFlow?.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : []) ?? [],
  ...project.storyFlow?.templates.flatMap(t => t.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : [])) ?? [],
  ...projectFlows(project).flatMap(flow => flow.scenes.map(scene => scene.clip.assetId)),
  ...project.interstitials.flatMap(item => [item.result?.assetId, item.result?.fullAssetId, item.previousResult?.assetId, item.previousResult?.fullAssetId,
    ...[item, item.generationSettings].flatMap(settings => [...videoAssets(settings ?? {}, 'start').map(r => r.assetId), ...videoAssets(settings ?? {}, 'end').map(r => r.assetId), ...settings?.imageReferences?.map(image => image.assetId) ?? []]),
    ...[item.result?.reference, item.previousResult?.reference, item.requestReference].flatMap(input => [...referenceClips(input, 'before'), ...referenceClips(input, 'after')].map(r => r.assetId))])].filter((id): id is string => !!id))];
