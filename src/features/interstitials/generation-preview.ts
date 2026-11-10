import type { InterstitialSettings } from '../../../shared/interstitials';
import type { GenerationSegment } from './generation-timeline';

export type PreviewMode = 'input' | 'generated' | 'upscaled';
/** `volume` is the input's audio level, as the model receives it. */
export type InputPreview = { assetId: string; kind?: 'image' | 'audio'; sourceFrame: number; label: string; held?: boolean; volume?: number };
type GeneratedPreview = { url: string; frames: number; estimate: number };
export type GenerationPreviewState = {
  mode: PreviewMode; frame: number; playing: boolean; inputFrames: number; generated?: GeneratedPreview;
  /** The optional 2K video of the same complete render, on the same frame clock. */
  upscaled?: GeneratedPreview;
};
export type GenerationPreviewAction =
  | { type: 'configure'; inputFrames: number; generatedUrl?: string; generatedFrames?: number; upscaledUrl?: string; upscaledFrames?: number }
  | { type: 'metadata'; url: string; frames: number }
  | { type: 'seek' | 'inspect-input' | 'tick'; frame: number }
  | { type: 'mode'; mode: PreviewMode }
  | { type: 'toggle' | 'pause' };

const frameCount = (value: number | undefined, fallback = 1) => Number.isFinite(value) ? Math.max(1, Math.round(value!)) : fallback;
/** The rendered video shown by the Generated or Upscaled tab. */
export const previewOutput = (state: GenerationPreviewState) => state.mode === 'input' ? undefined : state[state.mode];
export const previewFrames = (state: GenerationPreviewState) => previewOutput(state)?.frames ?? state.inputFrames;
export const clampPreviewFrame = (frame: number, frames: number) => Math.max(0, Math.min(frameCount(frames) - 1, Number.isFinite(frame) ? Math.round(frame) : 0));

export function createGenerationPreview(inputFrames: number, frame = 0, generatedUrl?: string, generatedFrames?: number, upscaledUrl?: string, upscaledFrames?: number): GenerationPreviewState {
  const frames = frameCount(inputFrames), output = (url?: string, count?: number) => url ? { url, frames: frameCount(count, frames), estimate: frameCount(count, frames) } : undefined;
  return { mode: 'input', frame: clampPreviewFrame(frame, frames), playing: false, inputFrames: frames,
    generated: output(generatedUrl, generatedFrames), upscaled: output(upscaledUrl, upscaledFrames) };
}
/** Keeps loaded metadata for an unchanged video; a new URL or estimate starts from its estimate. */
function configuredOutput(current: GeneratedPreview | undefined, url: string | undefined, frames: number | undefined, inputFrames: number) {
  const estimate = frameCount(frames, url === current?.url ? current?.estimate ?? inputFrames : inputFrames);
  const same = url === current?.url && (!url || estimate === current?.estimate);
  return { same, value: !url ? undefined : same ? current : { url, frames: estimate, estimate } };
}

/** Seeking never changes the preview source. Inspecting an input and switching modes are explicit actions. */
export function generationPreviewReducer(state: GenerationPreviewState, action: GenerationPreviewAction): GenerationPreviewState {
  switch (action.type) {
    case 'configure': {
      const inputFrames = frameCount(action.inputFrames);
      const generated = configuredOutput(state.generated, action.generatedUrl, action.generatedFrames, inputFrames);
      const upscaled = configuredOutput(state.upscaled, action.upscaledUrl, action.upscaledFrames, inputFrames);
      if (inputFrames === state.inputFrames && generated.same && upscaled.same) return state;
      const next = { ...state, inputFrames, generated: generated.value, upscaled: upscaled.value, playing: false };
      // A tab whose video is gone falls back to the input timeline.
      const mode = next.mode !== 'input' && !next[next.mode] ? 'input' as const : next.mode;
      return { ...next, mode, frame: clampPreviewFrame(state.frame, previewFrames({ ...next, mode })) };
    }
    case 'metadata': {
      const key = state.generated?.url === action.url ? 'generated' : state.upscaled?.url === action.url ? 'upscaled' : undefined;
      if (!key || !Number.isFinite(action.frames) || action.frames < 1) return state;
      const current = state[key]!, frames = frameCount(action.frames);
      if (frames === current.frames) return state;
      const next = { ...state, [key]: { ...current, frames } }, frame = clampPreviewFrame(state.frame, previewFrames(next));
      return { ...next, frame, playing: state.playing && frame === state.frame };
    }
    case 'seek': return { ...state, frame: clampPreviewFrame(action.frame, previewFrames(state)), playing: false };
    case 'inspect-input': return { ...state, mode: 'input', frame: clampPreviewFrame(action.frame, state.inputFrames), playing: false };
    case 'mode': {
      if (action.mode !== 'input' && !state[action.mode]) return state;
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
  if (video && video.video) return { assetId: video.video.assetId, sourceFrame: video.video.inFrame + middleFrame - video.frame, label: video.video.name, volume: video.volume };
  const segment = segments.find(s => frame >= s.startFrame && frame < s.endFrame);
  if (segment?.clip) return { assetId: segment.clip.assetId, kind: segment.clip.kind, sourceFrame: segment.clip.inFrame + (segment.held || segment.clip.kind === 'image' ? 0 : frame - segment.startFrame),
    label: nameFor(segment.clip.assetId) ?? 'Reference', held: segment.held, volume: segment.side === 'start' ? item.startReferenceVolume : item.endReferenceVolume };
}
