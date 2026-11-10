import { referenceClips } from '../../../shared/reference-clips';
import { videoAssets } from '../../../shared/video-references';
import type { ProjectLora } from '../../../shared/loras';
import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { Interstitial, InterstitialSettings, InterstitialResult } from '../../../shared/interstitials';
import type { CallResponseFlow } from '../call-response/model';
import type { StoryGraph } from '../story-flow/model';
import type { AssetGeneration, AssetSettings } from '../../../shared/asset-generation';
import type { AudioLayer } from './audioLayers';

export type Asset = { id: string; name: string; blob: Blob };
export type MediaGeneration = { provider: 'comfy'; settings?: InterstitialSettings; result: InterstitialResult }
  | { provider: 'fal'; settings: AssetSettings; createdAt: number };
export type LibraryAsset = { assetId: string; originalAssetId?: string; normalizedFps?: number; name: string; kind: 'video' | 'generated' | 'image' | 'audio'; folderId?: string; generationId?: string; generation?: MediaGeneration; width?: number; height?: number; duration?: number; inFrame?: number; outFrame?: number;
  /** Read only when migrating projects created before clip-owned playback settings. */
  volume?: number };
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
  audioLayers?: AudioLayer[];
  library?: LibraryAsset[];
  /** Intentionally unavailable media. Keep IDs and references so undo and missing-input errors work. */
  deletedAssetIds?: string[];
  libraryFolders?: LibraryFolder[];
  clipGenerations?: AssetGeneration[];
  /** Legacy Library-only recipes, consumed by the project migration. */
  assetGenerations?: AssetGeneration[];
  mediaModelVersion?: 1;
  /** Original asset IDs mapped to this project's local IDs, for portable video references. */
  assetAliases?: Record<string, string>;
  loras?: ProjectLora[];
  /** Raw text as typed; applied to every prompt enhancement and AI edit in the project. */
  promptInstructions?: string;
  subtitle: { name: string; assetId: string } | null;
  analysis: AnalysisState;
};
export const emptyAnalysis = (): AnalysisState => ({ slice: { start: 0, end: 10 }, provider: 'openai', instructions: '', result: null });
export const projectFlows = (project?: Pick<Project, 'callResponse' | 'callResponses'> | null) => project?.callResponses ?? (project?.callResponse ? [project.callResponse] : []);
export const activeFlows = (project?: Project | null) => projectFlows(project).filter(flow => project?.interstitials.find(item => item.id === flow.interstitial.id)?.kind !== 'regular');
export const withFlows = (project: Project, callResponses: CallResponseFlow[]): Project => ({ ...project, callResponses, callResponse: callResponses[0] });
export const assetIds = (project: Project) => [...new Set([project.source.assetId, project.source.originalAssetId, project.subtitle?.assetId,
  ...project.audioLayers?.map(layer => layer.assetId) ?? [],
  ...[...project.clipGenerations??[],...project.assetGenerations??[],...project.storyFlow?.templates.flatMap(t=>t.generations??[])??[]].flatMap(g => [g.selectedAssetId, ...g.versions.flatMap(v => [v.assetId, ...v.settings.references.map(r => r.assetId)]), ...g.settings.references.map(r => r.assetId), ...(g.submitted?.references.map(r => r.assetId) ?? [])]),
  ...project.storyFlow?.templates.flatMap(template => Object.values(template.settings).flatMap(settings => [...(settings.timelineVideos ?? []).flatMap(v => v.video ? [v.video.assetId] : []), ...videoAssets(settings, 'start').map(r => r.assetId), ...videoAssets(settings, 'end').map(r => r.assetId), ...settings.imageReferences?.map(image => image.assetId) ?? [], ...settings.keyframes?.flatMap(keyframe => keyframe.image ? [keyframe.image.assetId] : []) ?? []])) ?? [],
  ...(project.library ?? []).flatMap(item => [item.assetId, item.originalAssetId]),
  ...project.storyFlow?.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : []) ?? [],
  ...project.storyFlow?.templates.flatMap(t => t.nodes.flatMap(node => node.source ? [node.source.assetId,node.source.originalAssetId] : [])) ?? [],
  ...projectFlows(project).flatMap(flow => flow.scenes.map(scene => scene.clip.assetId)),
  ...project.interstitials.flatMap(item => [item.result?.assetId, item.result?.fullAssetId, item.result?.upscaled?.assetId, item.previousResult?.assetId, item.previousResult?.fullAssetId, item.previousResult?.upscaled?.assetId,
    ...[item, item.generationSettings].flatMap(settings => [...(settings?.timelineVideos ?? []).flatMap(v => v.video ? [v.video.assetId] : []), ...videoAssets(settings ?? {}, 'start').map(r => r.assetId), ...videoAssets(settings ?? {}, 'end').map(r => r.assetId), ...settings?.imageReferences?.map(image => image.assetId) ?? [], ...settings?.keyframes?.flatMap(keyframe => keyframe.image ? [keyframe.image.assetId] : []) ?? []]),
    ...[item.result?.reference, item.previousResult?.reference, item.requestReference].flatMap(input => [...referenceClips(input, 'before'), ...referenceClips(input, 'after')].map(r => r.assetId))])].filter((id): id is string => !!id && !project.deletedAssetIds?.includes(id)))];
