import { COMFY, TIMELINE_FPS } from './constants.js';
import { validateInterstitialDuration, type Interstitial } from './interstitials.js';

/** H3 encodes 5 + 17k frames. Keep both context windows on that same grid. */
export type ComfyMode = 'bridge' | 'extend' | 'loop' | 'custom';
export function comfyBridgePlan(before: number, after: number, duration: number, mode: ComfyMode = 'bridge') {
  validateInterstitialDuration(duration, (mode === 'loop' || mode === 'custom') ? 'comfy-loop' : 'comfy');
  if (!(mode === 'extend' ? [before] : [before, after]).every(value => Number.isFinite(value) && (mode === 'custom' && value === 0 || value >= COMFY.minContextFrames / TIMELINE_FPS && value <= 4 + 1e-6)) || mode === 'extend' && after !== 0) {
    throw new Error('Comfy needs at least 1.625 seconds of source footage on each side of the draft (up to 4 seconds).');
  }
  const contextFrames = (seconds: number) => COMFY.firstFrames + Math.floor((Math.floor(seconds * TIMELINE_FPS + 1e-6) - COMFY.firstFrames) / COMFY.frameGroup) * COMFY.frameGroup;
  const prefixFrames = before === 0 ? 0 : contextFrames(before), suffixFrames = mode === 'extend' || after === 0 ? 0 : contextFrames(after);
  const totalFrames = COMFY.firstFrames + Math.ceil((prefixFrames + duration * TIMELINE_FPS + suffixFrames - COMFY.firstFrames - 1e-6) / COMFY.frameGroup) * COMFY.frameGroup;
  if (totalFrames > COMFY.maxFrames) throw new Error('Comfy’s H3 bridge is limited to 362 frames including context. Shorten the duration or reference ranges.');
  const middleFrames = totalFrames - prefixFrames - suffixFrames;
  return { prefixFrames, suffixFrames, middleFrames, totalFrames,
    insertion: { start: prefixFrames / TIMELINE_FPS, duration: middleFrames / TIMELINE_FPS, totalDuration: totalFrames / TIMELINE_FPS } };
}

export function comfyReferenceRange(item: Pick<Interstitial, 'time' | 'start_range' | 'end_range' | 'duration' | 'method' | 'useInputReference' | 'useOutputReference'>, sourceDuration: number) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Wait for the video to finish loading.');
  if (![item.time, item.start_range, item.end_range].every(Number.isFinite) || item.start_range > 4 || item.end_range > 4) throw new Error('Enter valid reference ranges up to 4 seconds.');
  const anchorFrame = Math.max(0, Math.min(Math.floor(sourceDuration * TIMELINE_FPS + 1e-6), Math.round(item.time * TIMELINE_FPS)));
  const custom = item.useInputReference !== undefined || item.useOutputReference !== undefined;
  const before = custom && item.useInputReference === false ? 0 : Math.min(anchorFrame, Math.floor(item.start_range * TIMELINE_FPS + 1e-6)) / TIMELINE_FPS;
  const mode: ComfyMode = custom ? 'custom' : item.method === 'comfy-extend' ? 'extend' : item.method === 'comfy-loop' ? 'loop' : 'bridge';
  const after = mode === 'extend' || custom && !item.useOutputReference ? 0 : Math.min(Math.floor(sourceDuration * TIMELINE_FPS + 1e-6) - anchorFrame, Math.floor(item.end_range * TIMELINE_FPS + 1e-6)) / TIMELINE_FPS;
  const plan = comfyBridgePlan(before, after, item.duration, mode);
  // Upload exactly the windows used by the graph, with no removed source frame.
  return { start: (anchorFrame - plan.prefixFrames) / TIMELINE_FPS, end: (anchorFrame + plan.suffixFrames) / TIMELINE_FPS,
    insertAt: plan.prefixFrames / TIMELINE_FPS, after: plan.suffixFrames / TIMELINE_FPS, plan, mode };
}

export function comfyDimensions(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('The source video dimensions are invalid.');
  const scale = Math.min(1, COMFY.maxDimension / Math.max(width, height), COMFY.maxShortEdge / Math.min(width, height));
  return { width: Math.max(32, Math.round(width * scale / 32) * 32), height: Math.max(32, Math.round(height * scale / 32) * 32) };
}
