import { imagePreview } from '../../media/imagePreview';
import type { VideoPlayerController } from './VideoPlayerController';

export type PromptFramePlayer = Pick<VideoPlayerController, 'captureFrame' | 'getSnapshot'>;

/** Snapshot the displayed composition before awaiting any other reference reads. */
export async function capturePromptFrame(player: PromptFramePlayer | undefined, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  if (!player || !player.getSnapshot().duration) return undefined;
  const frame = await player.captureFrame({ pause: false });
  signal.throwIfAborted();
  return imagePreview(frame, signal);
}
