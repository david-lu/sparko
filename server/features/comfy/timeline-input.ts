import { TIMELINE_FPS } from '../../../shared/constants.js';
import { audioMaskColumns, inputMaskCurve, inputMaskStrength, referenceContent } from '../../../shared/generation-inputs.js';
import type { BridgeInput, Workflow } from './workflow.js';
import type { comfyBridgePlan } from '../../../shared/comfy.js';

type Link = (string | number)[];
/** Splice in pixel space: a single-frame input must not shift any following frames. */
export function replaceImageFrame(graph: Workflow, id: string, images: Link, image: Link, frame: number, frames: number): Link {
  const add = (name: string, class_type: string, inputs: Record<string, unknown>): Link => { graph[name] = { class_type, inputs }; return [name, 0]; };
  let result = image;
  if (frame > 0) {
    const before = add(`${id}_before`, 'ImageFromBatch', { image: images, batch_index: 0, length: frame });
    result = add(`${id}_head`, 'ImageBatch', { image1: before, image2: result });
  }
  if (frame + 1 < frames) {
    const after = add(`${id}_after`, 'ImageFromBatch', { image: images, batch_index: frame + 1, length: frames - frame - 1 });
    result = add(`${id}_tail`, 'ImageBatch', { image1: result, image2: after });
  }
  return result;
}

export function timelineVideoMask(input: BridgeInput, plan: ReturnType<typeof comfyBridgePlan>) {
  const { prefixFrames: prefix, middleFrames: middle, suffixFrames: suffix, totalFrames: frames } = plan;
  // Reference picture and timeline videos are input; the rest of the generated section always regenerates.
  const content = referenceContent(prefix, middle, suffix, input.timelineInputs ?? []);
  const curve = inputMaskCurve(input.videoMaskCurve, prefix / TIMELINE_FPS, suffix / TIMELINE_FPS, input.videoMaskTransitionMs ?? 0);
  const preserved = input.keyframes?.filter(k => k.method === 'frame').map(k => k.frame) ?? [];
  return Array.from({ length: frames }, (_, frame) => `${frame}:(${inputMaskStrength(curve, frame + .5, prefix, middle, suffix, content, preserved).toFixed(6)})`).join(',');
}

export function timelineAudio(graph: Workflow, input: BridgeInput, plan: ReturnType<typeof comfyBridgePlan>, video: Link, source: Link, vae: Link): Link {
  const add = (id: string, class_type: string, inputs: Record<string, unknown>): Link => { graph[id] = { class_type, inputs }; return [id, 0]; };
  const encoded = add('encode_audio', 'VAEEncodeAudio', { audio: source, vae });
  const fitted = add('fit_audio', 'LTXVConcatAVLatent', { video_latent: video, audio_latent: encoded });
  const length = add('audio_mask_size', 'GetAudioLatentSize', { latent: fitted });
  let mask = add('audio_mask_base', 'SolidMask', { value: 1, width: length, height: 1 });
  const { prefixFrames: prefix, middleFrames: middle, suffixFrames: suffix, totalFrames: total } = plan;
  // Only spans with input sound keep audio. Added sound never freezes picture.
  const content = input.audioContent ?? referenceContent(prefix, middle, suffix, [...input.timelineInputs ?? [], ...input.timelineAudioInputs ?? []]);
  const curve = inputMaskCurve(input.audioMaskCurve, prefix / TIMELINE_FPS, suffix / TIMELINE_FPS, input.audioMaskTransitionMs ?? 0);
  const spans: { start: number; length: number; strength: number }[] = [];
  for (const [i, strength] of audioMaskColumns(curve, prefix, middle, suffix, content).entries()) {
    const previous = spans.at(-1);
    if (previous?.strength === strength) previous.length++;
    else spans.push({ start: i, length: 1, strength });
  }
  spans.filter(span => span.strength < 1).forEach((span, index) => {
    const value = add(`audio_timeline_value_${index}`, 'SolidMask', { value: span.strength, width: span.length, height: 1 });
    mask = add(`audio_timeline_mask_${index}`, 'MaskComposite', { destination: mask, source: value, x: span.start, y: 0, operation: 'multiply' });
  });
  return add('freeze_audio', 'MVEx_AudioMaskToLatent', { latent: fitted, timing: 'auto', vae, mask, start_time: 0, end_time: total / TIMELINE_FPS, existing_mask: 'replace' });
}
