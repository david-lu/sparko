import type { GenerationReference, InterstitialSettings } from '../../../shared/interstitials';
import { audibleClips, audioLevel } from '../../../shared/audio-tracks';
import { mergeRanges, type TimelineInputRange } from '../../../shared/generation-inputs';
import { generationTimelineSegments } from './generation-timeline';

type Plan = { prefixFrames: number; middleFrames: number; suffixFrames: number };

/** Assets whose audio decides where the input movie has sound. */
export function inputAudioAssetIds(item: InterstitialSettings, reference: GenerationReference | undefined, plan: Plan) {
  return [...generationTimelineSegments(reference, plan.prefixFrames, plan.middleFrames, plan.suffixFrames).map(segment => segment.clip?.assetId),
    ...(item.timelineVideos ?? []).map(video => video.video?.assetId)].filter((id): id is string => !!id);
}

/** Spans of the full render clock where the input movie has audible sound. Everywhere else the
 * audio mask regenerates: held loop frames, stills, footage without an audio track, and muted sources.
 * `hasAudio` may not know an asset yet; unknown footage counts as sound so nothing is dropped early. */
export function inputAudioContent(item: InterstitialSettings, reference: GenerationReference | undefined, plan: Plan,
  hasAudio: (assetId: string) => boolean | undefined): TimelineInputRange[] {
  const { prefixFrames: prefix, middleFrames: middle, suffixFrames: suffix } = plan;
  const spans: TimelineInputRange[] = [];
  for (const segment of generationTimelineSegments(reference, prefix, middle, suffix)) {
    const level = audioLevel(segment.side === 'start' ? item.startReferenceVolume : item.endReferenceVolume);
    if (!level || segment.held || segment.clip?.kind === 'image' || segment.clip && hasAudio(segment.clip.assetId) === false) continue;
    spans.push({ frame: segment.startFrame, frames: segment.endFrame - segment.startFrame });
  }
  for (const video of item.timelineVideos ?? []) {
    if (!video.enabled || !video.video || !audioLevel(video.volume) || hasAudio(video.video.assetId) === false) continue;
    spans.push({ frame: prefix + video.frame, frames: Math.min(video.video.outFrame - video.video.inFrame, middle - video.frame) });
  }
  for (const sound of audibleClips(item.inputAudioTracks, prefix, prefix + middle + suffix)) spans.push({ frame: sound.startFrame, frames: sound.endFrame - sound.startFrame });
  return mergeRanges(spans);
}
