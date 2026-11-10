import { TIMELINE_FPS as FPS } from '../../../shared/constants';
import { audioClipFrames, soundLevel, type AudioTrack } from '../../../shared/audio-tracks';
import { playableResult, type Interstitial } from '../../../shared/interstitials';
import { assets } from '../project/assets';
import type { PlaybackAudioLayer, PlaybackLayer } from './CanvasMediaDecks';

/** Sound layered over a generated video, keyed by each saved file of its render.
 * `body` is where the generated section starts in that file, in seconds. */
export type ClipAudio = Record<string, { body: number; tracks: AudioTrack[] }>;

export function generatedClipAudio(items: Interstitial[]): ClipAudio {
  const clipAudio: ClipAudio = {};
  for (const item of items) {
    const tracks = item.generatedAudioTracks?.filter(track => track.clips.some(clip => soundLevel(track, clip) > 0));
    const result = playableResult(item);
    if (!tracks?.length || !result?.assetId) continue;
    // The complete render and its 2K pass share one clock. A finished loop starts at its body.
    const body = result.fullRange?.start ?? result.start;
    clipAudio[result.fullAssetId ?? result.assetId] = { body, tracks };
    if (result.fullAssetId) clipAudio[result.assetId] = { body: result.start, tracks };
    if (result.upscaled) clipAudio[result.upscaled.assetId] = { body, tracks };
  }
  return clipAudio;
}

/** Sounds follow their video's position, visits, fades and mute state, on its own decoder keys. */
export function clipAudioLayers(layers: PlaybackLayer[], clipAudio: ClipAudio | undefined): PlaybackAudioLayer[] {
  if (!clipAudio) return [];
  return layers.flatMap(layer => {
    const source = layer.audio?.source ?? layer.source, entry = source.assetId ? clipAudio[source.assetId] : undefined;
    if (!entry || layer.still || layer.muted) return [];
    const key = layer.audio?.key ?? layer.key, frame = ((layer.audio?.time ?? layer.time) - entry.body) * FPS;
    return entry.tracks.flatMap(track => track.clips.flatMap(clip => {
      const url = assets.url(clip.assetId), volume = soundLevel(track, clip);
      if (!url || volume <= 0 || frame < clip.frame || frame >= clip.frame + audioClipFrames(clip)) return [];
      return [{ key: `${key}:sound:${clip.id}:${clip.frame}:${clip.inFrame}:${clip.outFrame}`,
        time: (clip.inFrame + frame - clip.frame) / FPS, end: clip.outFrame / FPS, gain: layer.gain, gainRate: layer.gainRate ?? 0,
        source: { id: clip.assetId, assetId: clip.assetId, name: clip.name, url, kind: 'audio' as const, volume } }];
    }));
  });
}
