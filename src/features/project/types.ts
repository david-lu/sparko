import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { Interstitial } from '../../../shared/interstitials';
import type { CallResponseFlow } from '../call-response/model';
import type { StoryGraph } from '../story-flow/model';

export type Asset = { id: string; name: string; blob: Blob };
export type LibraryAsset = { assetId: string; originalAssetId?: string; name: string; kind: 'video' | 'generated' | 'subtitle'; duration?: number; inFrame?: number; outFrame?: number };
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
  subtitle: { name: string; assetId: string } | null;
  analysis: AnalysisState;
};
export const emptyAnalysis = (): AnalysisState => ({ slice: { start: 0, end: 10 }, provider: 'openai', instructions: '', result: null });
export const projectFlows = (project?: Pick<Project, 'callResponse' | 'callResponses'> | null) => project?.callResponses ?? (project?.callResponse ? [project.callResponse] : []);
export const activeFlows = (project?: Project | null) => projectFlows(project).filter(flow => project?.interstitials.find(item => item.id === flow.interstitial.id)?.kind !== 'regular');
export const withFlows = (project: Project, callResponses: CallResponseFlow[]): Project => ({ ...project, callResponses, callResponse: callResponses[0] });
export const assetIds = (project: Project) => [...new Set([project.source.assetId, project.source.originalAssetId, project.subtitle?.assetId,
  ...(project.library ?? []).flatMap(item => [item.assetId, item.originalAssetId]),
  ...project.storyFlow?.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : []) ?? [],
  ...project.storyFlow?.templates.flatMap(t => t.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : [])) ?? [],
  ...projectFlows(project).flatMap(flow => flow.scenes.map(scene => scene.clip.assetId)),
  ...project.interstitials.flatMap(item => [item.result?.assetId, item.result?.fullAssetId, item.previousResult?.assetId, item.previousResult?.fullAssetId,
    ...[item.result?.reference, item.previousResult?.reference, item.requestReference].flatMap(input => [input?.before?.assetId, input?.after?.assetId])])].filter((id): id is string => !!id))];
