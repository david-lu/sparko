import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { Interstitial } from '../../../shared/interstitials';

export type Asset = { id: string; name: string; blob: Blob };
export type AnalysisState = { slice: Slice; provider: Provider; instructions: string; result: CaptionResult | null };
export type Project = {
  id: string; name: string; updatedAt: number;
  source: { name: string; assetId?: string; originalAssetId?: string; url?: string };
  interstitials: Interstitial[];
  subtitle: { name: string; assetId: string } | null;
  analysis: AnalysisState;
};
export const emptyAnalysis = (): AnalysisState => ({ slice: { start: 0, end: 10 }, provider: 'openai', instructions: '', result: null });
export const assetIds = (project: Project) => [...new Set([project.source.assetId, project.source.originalAssetId, project.subtitle?.assetId,
  ...project.interstitials.flatMap(item => [item.result?.assetId, item.previousResult?.assetId])].filter((id): id is string => !!id))];
