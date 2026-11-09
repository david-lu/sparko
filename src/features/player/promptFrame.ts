import { imagePreview } from '../../media/imagePreview';
import type { VideoPlayerController } from './VideoPlayerController';

export type PromptFramePlayer = Pick<VideoPlayerController, 'captureFrame' | 'getSnapshot'> & Partial<Pick<VideoPlayerController, 'subscribe'>>;

function waitForFrame(player: PromptFramePlayer, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {}, polling: ReturnType<typeof setInterval> | undefined, settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; unsubscribe(); clearTimeout(timeout); clearInterval(polling); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const check = () => { const state = player.getSnapshot(); if (state.error) finish(new Error(state.error)); else if (!state.buffering) finish(); };
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('The video frame is still loading. Try enhancing again once it is ready.')), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    if (player.subscribe) unsubscribe = player.subscribe(check); else polling = setInterval(check, 50);
    if (settled) unsubscribe(); else if (signal.aborted) abort(); else check();
  });
}

/** Snapshot the displayed composition before awaiting any other reference reads. */
export async function capturePromptFrame(player: PromptFramePlayer | undefined, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  if (!player || !player.getSnapshot().duration) return undefined;
  // Reattaching the story view starts decoding its saved playhead. Enhancement
  // can be clicked immediately; wait for that frame instead of failing the action.
  if (player.getSnapshot().buffering) await waitForFrame(player, signal);
  signal.throwIfAborted();
  if (!player.getSnapshot().duration) return undefined;
  const frame = await player.captureFrame({ pause: false });
  signal.throwIfAborted();
  return imagePreview(frame, signal);
}
