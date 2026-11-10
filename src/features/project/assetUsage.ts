import { videoAssets } from '../../../shared/video-references';
import { referenceClips } from '../../../shared/reference-clips';
import { audioTrackAssetIds } from '../../../shared/audio-tracks';
import type { Project } from './types';

export type AssetUse = { owner: string; role: string };
/** Include editable inputs and submitted render provenance, not just timeline footage. */
export function assetUsage(project: Project, ids: string[]): AssetUse[] {
  const wanted = new Set(ids), uses: AssetUse[] = [];
  const add = (id: string | undefined, owner: string, role: string) => { if (id && wanted.has(id) && !uses.some(u => u.owner === owner && u.role === role)) uses.push({ owner, role }); };
  for (const node of project.storyFlow?.nodes ?? []) { add(node.source?.assetId, node.name, 'Timeline footage'); add(node.source?.originalAssetId, node.name, 'Original timeline footage'); }
  for (const item of project.interstitials) {
    const node = project.storyFlow?.nodes.find(n => n.interstitialId === item.id), owner = node?.name ?? item.label;
    for (const [settings, prefix] of [[item, ''], [item.generationSettings, 'Submitted ']] as const) {
      for (const clip of settings?.timelineVideos ?? []) add(clip.video?.assetId, owner, `${prefix}timeline video`);
      for (const keyframe of settings?.keyframes ?? []) add(keyframe.image?.assetId, owner, `${prefix}keyframe image`);
      for (const track of settings?.inputAudioTracks ?? []) for (const clip of track.clips) add(clip.assetId, owner, `${prefix}input sound`);
      for (const track of settings?.generatedAudioTracks ?? []) for (const clip of track.clips) add(clip.assetId, owner, `${prefix}sound over generated video`);
      for (const ref of settings?.imageReferences ?? []) add(ref.assetId, owner, `${prefix}image input`);
      for (const side of ['start', 'end'] as const) for (const ref of videoAssets(settings ?? {}, side)) add(ref.assetId, owner, `${prefix}${side} video input`);
    }
    for (const result of [item.result, item.previousResult]) {
      add(result?.assetId, owner, node ? 'Timeline generated footage' : 'Generated output');
      add(result?.fullAssetId, owner, 'Full generated output');
      add(result?.upscaled?.assetId, owner, '2K upscaled output');
      for (const side of ['before', 'after'] as const) for (const ref of referenceClips(result?.reference, side)) add(ref.assetId, owner, `Rendered ${side === 'before' ? 'start' : 'end'} reference`);
    }
    for (const side of ['before', 'after'] as const) for (const ref of referenceClips(item.requestReference, side)) add(ref.assetId, owner, `Submitted ${side === 'before' ? 'start' : 'end'} reference`);
  }
  for (const g of project.clipGenerations ?? []) {
    if (project.storyFlow && !project.storyFlow.nodes.some(n => n.generationId === g.id) && !g.versions.length) continue;
    for (const ref of g.settings.references) add(ref.assetId, g.name, `${g.kind} generation input`);
    for (const ref of g.submitted?.references ?? []) add(ref.assetId, g.name, 'Submitted generation input');
    for (const version of g.versions) for (const ref of version.settings.references) add(ref.assetId, g.name, 'Saved version input');
  }
  const recordedOutputs = new Set([
    ...project.clipGenerations?.flatMap(g => g.versions.map(v => v.assetId)) ?? [],
    ...project.interstitials.flatMap(item => [item.result?.assetId, item.result?.fullAssetId, item.result?.upscaled?.assetId, item.previousResult?.assetId, item.previousResult?.fullAssetId, item.previousResult?.upscaled?.assetId]),
  ]);
  for (const asset of project.library ?? []) {
    if (!asset.generation || recordedOutputs.has(asset.assetId)) continue;
    if (asset.generation.provider === 'fal') {
      for (const ref of asset.generation.settings.references) add(ref.assetId, asset.name, 'Saved version input');
    } else {
      for (const video of asset.generation.settings?.timelineVideos ?? []) add(video.video?.assetId, asset.name, 'Saved timeline video');
      for (const keyframe of asset.generation.settings?.keyframes ?? []) add(keyframe.image?.assetId, asset.name, 'Saved keyframe image');
      for (const id of audioTrackAssetIds(asset.generation.settings?.inputAudioTracks)) add(id, asset.name, 'Saved input sound');
      for (const ref of asset.generation.settings?.imageReferences ?? []) add(ref.assetId, asset.name, 'Saved image input');
      for (const side of ['start', 'end'] as const) for (const ref of videoAssets(asset.generation.settings ?? {}, side)) add(ref.assetId, asset.name, `Saved ${side} video input`);
      for (const side of ['before', 'after'] as const) for (const ref of referenceClips(asset.generation.result.reference, side)) add(ref.assetId, asset.name, 'Saved video reference');
    }
  }
  for (const template of project.storyFlow?.templates ?? []) {
    for(const generation of template.generations??[]){for(const ref of generation.settings.references)add(ref.assetId,template.name,'Template generation input');for(const version of generation.versions){add(version.assetId,template.name,'Template generation version');for(const ref of version.settings.references)add(ref.assetId,template.name,'Template version input');}}
    for (const node of template.nodes) add(node.source?.assetId, template.name, 'Template footage');
    for (const settings of Object.values(template.settings)) {
      for (const video of settings.timelineVideos ?? []) add(video.video?.assetId, template.name, 'Template timeline video');
      for (const keyframe of settings.keyframes ?? []) add(keyframe.image?.assetId, template.name, 'Template keyframe image');
      for (const id of [...audioTrackAssetIds(settings.inputAudioTracks), ...audioTrackAssetIds(settings.generatedAudioTracks)]) add(id, template.name, 'Template sound');
      for (const ref of settings.imageReferences ?? []) add(ref.assetId, template.name, 'Template image input');
      for (const side of ['start', 'end'] as const) for (const ref of videoAssets(settings, side)) add(ref.assetId, template.name, `Template ${side} input`);
    }
  }
  for (const flow of project.callResponses ?? (project.callResponse ? [project.callResponse] : [])) for (const scene of flow.scenes) add(scene.clip.assetId, scene.label, 'Timeline footage');
  add(project.subtitle?.assetId, 'Project subtitles', 'Subtitle track');
  add(project.source.originalAssetId, 'Project source', 'Original playback source');
  if (!uses.length) add(project.source.assetId, 'Project source', 'Playback source');
  return uses;
}
