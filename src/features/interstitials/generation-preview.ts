import type { InterstitialSettings } from '../../../shared/interstitials';
import type { GenerationSegment } from './generation-timeline';

export type PreviewMode = 'input' | 'generated';
export type InputPreview = { assetId: string; kind?: 'image' | 'audio'; sourceFrame: number; label: string; held?: boolean };
type GeneratedPreview = { url: string; frames: number; estimate: number };
export type GenerationPreviewState = {
  mode: PreviewMode; frame: number; playing: boolean; inputFrames: number; generated?: GeneratedPreview;
};
export type GenerationPreviewAction =
  | { type: 'configure'; inputFrames: number; generatedUrl?: string; generatedFrames?: number }
  | { type: 'metadata'; url: string; frames: number }
  | { type: 'seek' | 'inspect-input' | 'tick'; frame: number }
  | { type: 'mode'; mode: PreviewMode }
  | { type: 'toggle' | 'pause' };

const frameCount = (value: number | undefined, fallback = 1) => Number.isFinite(value) ? Math.max(1, Math.round(value!)) : fallback;
export const previewFrames = (state: GenerationPreviewState) => state.mode === 'generated' && state.generated ? state.generated.frames : state.inputFrames;
export const clampPreviewFrame = (frame: number, frames: number) => Math.max(0, Math.min(frameCount(frames) - 1, Number.isFinite(frame) ? Math.round(frame) : 0));

export function createGenerationPreview(inputFrames: number, frame = 0, generatedUrl?: string, generatedFrames?: number): GenerationPreviewState {
  const frames = frameCount(inputFrames), estimate = frameCount(generatedFrames, frames);
  return { mode: 'input', frame: clampPreviewFrame(frame, frames), playing: false, inputFrames: frames,
    generated: generatedUrl ? { url: generatedUrl, frames: estimate, estimate } : undefined };
}

/** Seeking never changes the preview source. Inspecting an input and switching modes are explicit actions. */
export function generationPreviewReducer(state: GenerationPreviewState, action: GenerationPreviewAction): GenerationPreviewState {
  switch (action.type) {
    case 'configure': {
      const inputFrames = frameCount(action.inputFrames), estimate = frameCount(action.generatedFrames, action.generatedUrl === state.generated?.url ? state.generated?.estimate ?? inputFrames : inputFrames);
      const sameResult = action.generatedUrl === state.generated?.url && (!action.generatedUrl || estimate === state.generated?.estimate);
      if (inputFrames === state.inputFrames && sameResult) return state;
      const generated = !action.generatedUrl ? undefined : sameResult ? state.generated : { url: action.generatedUrl, frames: estimate, estimate };
      const next = { ...state, inputFrames, generated, playing: false, mode: generated ? state.mode : 'input' as const };
      return { ...next, frame: clampPreviewFrame(state.frame, previewFrames(next)) };
    }
    case 'metadata': {
      if (!state.generated || action.url !== state.generated.url || !Number.isFinite(action.frames) || action.frames < 1) return state;
      const frames = frameCount(action.frames);
      if (frames === state.generated.frames) return state;
      const next = { ...state, generated: { ...state.generated, frames } }, frame = clampPreviewFrame(state.frame, previewFrames(next));
      return { ...next, frame, playing: state.playing && frame === state.frame };
    }
    case 'seek': return { ...state, frame: clampPreviewFrame(action.frame, previewFrames(state)), playing: false };
    case 'inspect-input': return { ...state, mode: 'input', frame: clampPreviewFrame(action.frame, state.inputFrames), playing: false };
    case 'mode': {
      if (action.mode === 'generated' && !state.generated) return state;
      const next = { ...state, mode: action.mode, playing: false };
      return { ...next, frame: clampPreviewFrame(state.frame, previewFrames(next)) };
    }
    case 'toggle': return state.playing ? { ...state, playing: false }
      : { ...state, playing: true, frame: state.frame >= previewFrames(state) - 1 ? 0 : state.frame };
    case 'pause': return state.playing ? { ...state, playing: false } : state;
    case 'tick': {
      // Ignore a queued animation callback after a seek/pause, or an obsolete clock moving backwards.
      if (!state.playing || !Number.isFinite(action.frame) || action.frame < state.frame) return state;
      return { ...state, frame: clampPreviewFrame(action.frame, previewFrames(state)), playing: action.frame < previewFrames(state) - 1 };
    }
  }
}

export function previewFrameAtPoint(clientX: number, left: number, width: number, frames: number, fallback = 0) {
  return clampPreviewFrame(Number.isFinite(clientX) && Number.isFinite(left) && Number.isFinite(width) && width > 0
    ? (clientX - left) / width * frames : fallback, frames);
}
export function previewKeyboardFrame(key: string, shift: boolean, frame: number, frames: number) {
  const next = key === 'Home' ? 0 : key === 'End' ? frames - 1 : key === 'ArrowRight' ? frame + (shift ? 10 : 1) : key === 'ArrowLeft' ? frame - (shift ? 10 : 1) : undefined;
  return next === undefined ? undefined : clampPreviewFrame(next, frames);
}

export function generationEndpointImages(item: InterstitialSettings, frames: number) {
  return (['start', 'end'] as const).flatMap(side => {
    const index = side === 'start' ? item.startImageIndex : item.endImageIndex;
    const usesVideo = side === 'start' ? item.useInputReference !== false : item.useOutputReference !== false;
    const image = !usesVideo && index !== undefined ? item.imageReferences?.[index] : undefined;
    return image && image.enabled !== false ? [{ side, image, frame: side === 'start' ? 0 : frames - 1 }] : [];
  });
}

/** Exact, half-open frame intervals: missing inputs and gaps resolve to black, never to a saved result. */
export function generationInputAtFrame(item: InterstitialSettings, segments: GenerationSegment[], frame: number, prefixFrames: number, middleFrames: number, inputFrames: number,
  nameFor: (assetId: string) => string | undefined = () => undefined): InputPreview | undefined {
  if (!Number.isInteger(frame) || frame < 0 || frame >= inputFrames) return undefined;
  const middleFrame = frame - prefixFrames;
  const inMiddle = middleFrame >= 0 && middleFrame < middleFrames;
  const keyframe = inMiddle && item.keyframes?.find(k => k.enabled && k.image && k.frame === middleFrame);
  const endpoint = generationEndpointImages(item, inputFrames).find(k => k.frame === frame);
  if (keyframe && keyframe.image || endpoint) {
    const image = keyframe && keyframe.image || endpoint!.image;
    return { assetId: image.assetId, kind: 'image', sourceFrame: 0, label: image.name };
  }
  const video = inMiddle && item.timelineVideos?.find(v => v.enabled && v.video && middleFrame >= v.frame && middleFrame < v.frame + v.video.outFrame - v.video.inFrame);
  if (video && video.video) return { assetId: video.video.assetId, sourceFrame: video.video.inFrame + middleFrame - video.frame, label: video.video.name };
  const segment = segments.find(s => frame >= s.startFrame && frame < s.endFrame);
  if (segment?.clip) return { assetId: segment.clip.assetId, kind: segment.clip.kind, sourceFrame: segment.clip.inFrame + (segment.held || segment.clip.kind === 'image' ? 0 : frame - segment.startFrame),
    label: nameFor(segment.clip.assetId) ?? 'Reference', held: segment.held };
}
