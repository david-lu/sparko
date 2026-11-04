import { sceneFrames, type TimelineScene } from '../call-response/model';
import type { PlayheadTimeMode } from '../../shared/preferences';

export function playheadTime(scene: TimelineScene, frame: number, fps: number, mode: PlayheadTimeMode = 'internal') {
  const start = mode === 'elapsed' ? 0 : scene.draft ? (scene.storyNode?.trim?.inFrame ?? 0) / fps : sceneMediaRange(scene, fps).start;
  return start + frame / fps;
}

/** The same saved-file coordinates are used by playback and the inspector. */
export function sceneMediaRange(scene: TimelineScene, fps: number) {
  const result = scene.generated, full = result?.fullAssetId && result.fullRange;
  const start = full ? full.start + scene.clip.inFrame / fps - result!.start : scene.clip.inFrame / fps;
  return { assetId: full ? result!.fullAssetId! : scene.clip.assetId, start,
    end: start + sceneFrames(scene) / fps,
    total: full ? full.totalDuration : result?.totalDuration ?? scene.storyNode?.source?.duration };
}
