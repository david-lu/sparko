import { replaceImageFrame, timelineAudio, timelineVideoMask } from './timeline-input.js';
import { validateInputRanges, type TimelineInputRange } from '../../../shared/generation-inputs.js';
import { COMFY, COMFY_MODELS, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants.js';
import { normalizeH3Prompt, validateH3PromptLength } from '../../../shared/h3-prompt.js';
import { comfyBridgePlan, validateComfyResolution, type ComfyMode } from '../../../shared/comfy.js';
import { validateMaskTransitionMs, type MaskInjection, type GenerationResolution } from '../../../shared/interstitials.js';
import { audioCurveSpans, videoCurvePoints, videoTransitionPoints } from './mask-transition.js';
import { maskCurveSchema, type MaskCurve } from '../../../shared/mask-curves.js';
import { isLoraFilename, loraStrengthSchema, LORA_STRENGTH } from '../../../shared/loras.js';
import { IMAGE_REFERENCE } from '../../../shared/image-references.js';
import { CLIP_METADATA_TAG, serializeClipMetadata, type ClipOrigin } from '../../../shared/clip-metadata.js';
import { MAX_VIDEO_KEYFRAMES, validateVideoKeyframeInputs, type VideoKeyframeInput } from '../../../shared/video-keyframes.js';

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>;
export type BridgeInput = { fullInput?: boolean; timelineInputs?: TimelineInputRange[]; keyframes?: VideoKeyframeInput[]; seed?: number; clipOrigin?: ClipOrigin; lora?: string | null; loraStrength?: number; turbo?: boolean; before: number; after: number; duration: number; prompt: string; width: number; height: number; hasAudio: boolean; mode?: ComfyMode; maskInjection?: MaskInjection; audioMaskTransitionMs?: number; videoMaskTransitionMs?: number; audioMaskCurve?: MaskCurve; videoMaskCurve?: MaskCurve; interpolateMiddle?: boolean; resolution?: GenerationResolution; startImageIndex?: number; endImageIndex?: number; loopImageGuide?: boolean };

/** Native H3 AV masking, assembled from nodes available on managed Comfy Cloud.
 * Separately encoded references stay frozen outside their soft transitions.
 * The original source footage is kept by Sparko's compositor, outside this render.
 */
export function bridgeWorkflow(assetId: string | undefined, input: BridgeInput, seed: number, _legacyMaskAssetId?: string, imageAssetIds: string[] = [], keyframeImageIds: string[] = []): Workflow {
  validateH3PromptLength(input.prompt);
  input = { ...input, prompt: normalizeH3Prompt(input.prompt) };
  if (imageAssetIds.length > IMAGE_REFERENCE.maxCount) throw new Error('H3 supports up to 9 image references.');
  const plan = comfyBridgePlan(input.before, input.after, input.duration, input.mode);
  validateComfyResolution(plan,input.resolution);
  const { prefixFrames, suffixFrames, totalFrames, insertion } = plan;
  validateInputRanges(input.timelineInputs ?? [], plan.middleFrames);
  if ((input.timelineInputs?.length || input.keyframes?.some(k => k.method === 'frame')) && !input.fullInput) throw new Error('Prepare the complete timeline input before generating.');
  if (input.fullInput && !assetId) throw new Error('Timeline input video is missing.');
  const imageLoop = input.mode === 'loop' && !prefixFrames && !suffixFrames;
  const startImageIndex = input.startImageIndex ?? (imageLoop ? input.endImageIndex ?? (input.loopImageGuide !== false && imageAssetIds.length ? 0 : undefined) : undefined);
  const endImageIndex = imageLoop ? startImageIndex : input.endImageIndex;
  if (keyframeImageIds.length > MAX_VIDEO_KEYFRAMES) throw new Error('Use up to 9 image keyframes.');
  validateVideoKeyframeInputs(input.keyframes ?? [], plan.middleFrames, keyframeImageIds.length, startImageIndex !== undefined && !prefixFrames, endImageIndex !== undefined && !suffixFrames);
  if (input.loopImageGuide && !imageAssetIds.length) throw new Error('Choose an image as the shared loop reference.');
  for (const [index, footage] of [[startImageIndex, prefixFrames], [endImageIndex, suffixFrames]]) {
    if (index !== undefined && (!Number.isInteger(index) || !imageAssetIds[index] || footage)) throw new Error('Choose an uploaded image or video footage for each endpoint.');
  }
  if (imageLoop && input.endImageIndex !== undefined && input.endImageIndex !== startImageIndex) throw new Error('A loop uses the same image at both ends.');
  const audioTransitionMs = input.audioMaskTransitionMs ?? MASK_TRANSITION.defaultMs;
  const videoTransitionMs = input.videoMaskTransitionMs ?? MASK_TRANSITION.defaultMs;
  validateMaskTransitionMs(audioTransitionMs, 'Audio mask transition');
  validateMaskTransitionMs(videoTransitionMs, 'Video mask transition');
  for (const curve of [input.audioMaskCurve, input.videoMaskCurve]) if (curve) maskCurveSchema.parse(curve);
  if ((prefixFrames || suffixFrames) && !assetId) throw new Error('Reference footage is missing.');
  const graph: Workflow = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => { graph[id] = { class_type, inputs }; return [id, 0]; };
  const asset = { __type: 'core/ASSET', info: { id: assetId } };
  // FFmpeg preserves reference colors better than the OpenCV loader. The upload
  // concatenates the two windows at TIMELINE_FPS; seek in seconds without rounding.
  const loader = (skip: number, frames: number) => ({ video: asset, force_rate: TIMELINE_FPS, custom_width: input.width, custom_height: input.height,
    frame_load_cap: frames, start_time: skip / TIMELINE_FPS, format: 'None' });
  const before = prefixFrames ? add('before', 'VHS_LoadVideoFFmpeg', loader(0, prefixFrames)) : undefined;
  const after = suffixFrames ? add('after', 'VHS_LoadVideoFFmpeg', loader(prefixFrames, suffixFrames)) : undefined;
  let model = add('model', 'UNETLoader', { unet_name: COMFY_MODELS.diffusion, weight_dtype: 'default' });
  if (input.turbo) model = add('turbo_lora', 'LoraLoaderModelOnly', { model, lora_name: COMFY_MODELS.turboLora, strength_model: 1 });
  if (input.lora) {
    if (!isLoraFilename(input.lora)) throw new Error('Resolve the Comfy LoRA to an imported model filename before generating.');
    model = add('lora', 'LoraLoaderModelOnly', { model, lora_name: input.lora, strength_model: loraStrengthSchema.parse(input.loraStrength ?? LORA_STRENGTH.default) });
  }
  const clip = add('text_encoder', 'CLIPLoader', { clip_name: COMFY_MODELS.textEncoder, type: 'minimax', device: 'default' });
  const vae = add('video_vae', 'VAELoader', { vae_name: COMFY_MODELS.videoVae });
  const audioVae = add('audio_vae', 'VAELoader', { vae_name: COMFY_MODELS.audioVae });
  const shifted = add('shift', 'MiniMaxH3SigmaShift', { model, shift_video: COMFY.shiftVideo, shift_audio: COMFY.shiftAudio });
  const referenceImages = Object.fromEntries(imageAssetIds.map((id, index) => [`ref_images.ref_image_${index}`,
    add(`reference_image_${index}`, 'LoadImage', { image: { __type: 'core/ASSET', info: { id } } })]));
  let positive = add('conditioning', imageAssetIds.length ? 'MiniMaxH3ReferenceToVideo' : 'MiniMaxH3ImageToVideo', {
    clip, vae, prompt: input.prompt, width: input.width, height: input.height, length: totalFrames,
    ...(imageAssetIds.length ? { ref_image_size: 'match', ...referenceImages } : {}),
  });
  if (startImageIndex !== undefined) positive = add(imageLoop ? 'loop_start' : 'guide_start', 'MiniMaxH3AddGuide', { positive, latent: ['conditioning', 1], vae, image: [`reference_image_${startImageIndex}`, 0], frame_idx: 0 });
  if (endImageIndex !== undefined) positive = add(imageLoop ? 'loop_end' : 'guide_end', 'MiniMaxH3AddGuide', { positive, latent: ['conditioning', 1], vae, image: [`reference_image_${endImageIndex}`, 0], frame_idx: -1 });
  const preservedImages: { frame: number; image: (string | number)[] }[] = [];
  for (const [index, keyframe] of [...input.keyframes ?? []].sort((a, b) => a.frame - b.frame).entries()) {
    const image = add(`keyframe_image_${index}`, 'LoadImage', { image: { __type: 'core/ASSET', info: { id: keyframeImageIds[keyframe.imageIndex] } } });
    if (keyframe.method === 'frame') {
      const resized = add(`keyframe_resize_${index}`, 'ImageScale', { image, upscale_method: 'lanczos', width: input.width, height: input.height, crop: 'center' });
      preservedImages.push({ frame: prefixFrames + keyframe.frame, image: resized });
      continue;
    }
    positive = add(`keyframe_guide_${index}`, 'MiniMaxH3AddGuide', { positive, latent: ['conditioning', 1], vae, image, frame_idx: prefixFrames + keyframe.frame });
  }
  const empty = add('empty_streams', 'LTXVSeparateAVLatent', { av_latent: ['conditioning', 1] });
  const target = empty;
  const startLatent = before ? add('encode_before', 'VAEEncode', { pixels: before, vae }) : undefined;
  const endLatent = after ? add('encode_after', 'VAEEncode', { pixels: after, vae }) : undefined;
  const prefix = startLatent ? add('place_before', 'ReplaceVideoLatentFrames', { destination: target, source: startLatent, index: 0 }) : target;
  let endpoints = endLatent ? add('place_after', 'ReplaceVideoLatentFrames', { destination: prefix, source: endLatent, index: -(2 + (suffixFrames - 5) / 17 * 5) }) : prefix;
  const fullInput = input.fullInput ? add('timeline_input', 'VHS_LoadVideoFFmpeg', loader(0, totalFrames)) : undefined;
  if (fullInput) {
    let pixels = fullInput;
    for (const [index, preserved] of preservedImages.entries()) pixels = replaceImageFrame(graph, `inject_frame_${index}`, pixels, preserved.image, preserved.frame, totalFrames);
    endpoints = add('encode_timeline', 'VAEEncode', { pixels, vae });
  }
  // Spatially uniform masks need only one model token (32px), not a full-size video batch.
  const mask = input.fullInput ? add('middle_mask', 'CreateFadeMaskAdvanced', { width: 32, height: 32, frames: totalFrames, invert: false, interpolation: 'linear', points_string: timelineVideoMask(input, plan) }) : (input.videoMaskCurve || videoTransitionMs > 0) && (before || after)
    ? add('middle_mask', 'CreateFadeMaskAdvanced', { width: 32, height: 32, frames: totalFrames, invert: false, interpolation: 'linear',
      points_string: input.videoMaskCurve ? videoCurvePoints(input.videoMaskCurve, prefixFrames, suffixFrames, totalFrames)
        : videoTransitionPoints(prefixFrames, suffixFrames, totalFrames, videoTransitionMs) })
    : add('middle_mask', 'MVEx_FrameRangeMask', { width: 32, height: 32, frames: totalFrames, ranges: `${prefixFrames}:${totalFrames - suffixFrames}` });
  const latentMask = add('latent_mask', 'MVEx_MaskToLatentSpace', { masks: mask, compression: 'auto', vae,
    spatial_method: 'max', temporal_method: preservedImages.length ? 'min' : 'max', grow_spatial: 0, grow_temporal: 0 });
  const frozenVideo = add('freeze_video', 'SetLatentNoiseMask', { samples: endpoints, mask: latentMask });
  let joint = add('joint', 'LTXVConcatAVLatent', { video_latent: frozenVideo, audio_latent: ['empty_streams', 1] });
  if (input.hasAudio && fullInput) joint = timelineAudio(graph, input, plan, frozenVideo, ['timeline_input', 2], audioVae);
  else if (input.hasAudio && (before || after)) {
    const silence = add('gap_audio', 'EmptyAudio', { duration: insertion.duration, sample_rate: 32000, channels: 2 });
    const a = before ? add('audio_prefix', 'AudioConcat', { audio1: ['before', 2], audio2: silence, direction: 'after' }) : silence;
    const audio = after ? add('audio_full', 'AudioConcat', { audio1: a, audio2: ['after', 2], direction: 'after' }) : a;
    const encoded = add('encode_audio', 'VAEEncodeAudio', { audio, vae: audioVae });
    const fitted = add('fit_audio', 'LTXVConcatAVLatent', { video_latent: joint, audio_latent: encoded });
    // H3 audio has 40 latent frames/second. Keep both feather ramps entirely
    // inside the reference audio: a partial mask in the silent gap preserves
    // some of that silence instead of fully generating the transition audio.
    const fade = Math.round(audioTransitionMs / 1000 * COMFY.audioLatentsPerSecond);
    const fadeBefore = Math.min(fade, Math.floor(insertion.start * COMFY.audioLatentsPerSecond));
    const fadeAfter = Math.min(fade, Math.floor(suffixFrames / TIMELINE_FPS * COMFY.audioLatentsPerSecond));
    // Round outward so every latent frame overlapping the blank gap is white.
    const start = before ? Math.floor(insertion.start * COMFY.audioLatentsPerSecond) - fadeBefore : 0;
    const end = Math.ceil((insertion.start + insertion.duration) * COMFY.audioLatentsPerSecond) + fadeAfter;
    // Match the fitted latent exactly so MVEx won't stretch the timeline mask.
    const audioLength = add('audio_mask_size', 'GetAudioLatentSize', { latent: fitted });
    const preserved = add('audio_mask_base', 'SolidMask', { value: 0, width: audioLength, height: 1 });
    // Without an ending reference the white region extends through any padding.
    let audioMask = preserved;
    if (input.audioMaskCurve) {
      // Reference spans are at most 320 audio columns. Constant regions share
      // nodes; the blank body is one white span regardless of clip duration.
      audioCurveSpans(input.audioMaskCurve, prefixFrames, suffixFrames, totalFrames).forEach((span, index) => {
        const column = add(`audio_curve_value_${index}`, 'SolidMask', { value: span.strength, width: span.length ?? audioLength, height: 1 });
        audioMask = add(`audio_curve_${index}`, 'MaskComposite', { destination: audioMask, source: column, x: span.start, y: 0, operation: 'add' });
      });
    } else {
      const generated = add('audio_mask_middle', 'SolidMask', { value: 1, width: after ? end - start : audioLength, height: 1 });
      const feathered = add('audio_mask_feather', 'FeatherMask', { mask: generated, left: fadeBefore, top: 0, right: fadeAfter, bottom: 0 });
      audioMask = add('audio_mask', 'MaskComposite', { destination: preserved, source: feathered, x: start, y: 0, operation: 'add' });
    }
    joint = add('freeze_audio', 'MVEx_AudioMaskToLatent', { latent: fitted, timing: 'auto', vae: audioVae,
      mask: audioMask, start_time: insertion.start, end_time: insertion.start + insertion.duration, existing_mask: 'replace' });
  }
  const noise = add('noise', 'RandomNoise', { noise_seed: seed });
  const guider = add('guider', 'BasicGuider', { model: shifted, conditioning: positive });
  const sampler = add('sampler', 'KSamplerSelect', { sampler_name: input.turbo ? COMFY.turboSampler : COMFY.sampler });
  const sigmas = add('schedule', 'BasicScheduler', { model: shifted, scheduler: 'simple', steps: input.turbo ? COMFY.turboSteps : COMFY.steps, denoise: 1 });
  const sample = add('sample', 'SamplerCustomAdvanced', { noise, guider, sampler, sigmas, latent_image: joint });
  const streams = add('streams', 'LTXVSeparateAVLatent', { av_latent: sample });
  let images = add('decode_video', 'VAEDecode', { samples: streams, vae });
  for (const [index, preserved] of preservedImages.entries()) images = replaceImageFrame(graph, `restore_frame_${index}`, images, preserved.image, preserved.frame, totalFrames);
  const audio = add('decode_audio', 'VAEDecodeAudio', { samples: ['streams', 1], vae: audioVae });
  if (input.resolution === '2k') {
    // The official partner node sends this untrimmed H3 video and its exact
    // prompt to MiniMax's /v2/video_regeneration API, with resolution="2K".
    const base = add('base_video', 'CreateVideo', { images, audio, fps: TIMELINE_FPS });
    const regenerated = add('regenerate_2k', 'MinimaxHailuo03RegenerateNode', {
      video: base, model: COMFY_MODELS.regeneration, 'model.prompt': input.prompt, 'model.resolution': '2K', watermark: false,
    });
    let finalVideo = regenerated;
    if (preservedImages.length) {
      let pixels = add('regenerated_components', 'GetVideoComponents', { video: regenerated });
      const size = add('regenerated_size', 'GetImageSize', { image: pixels });
      for (const [index, preserved] of preservedImages.entries()) {
        const image = add(`preserved_2k_${index}`, 'ImageScale', { image: preserved.image, upscale_method: 'lanczos', width: size, height: ['regenerated_size', 1], crop: 'center' });
        pixels = replaceImageFrame(graph, `restore_2k_${index}`, pixels, image, preserved.frame, totalFrames);
      }
      finalVideo = add('preserved_2k_video', 'CreateVideo', { images: pixels, audio: ['regenerated_components', 1], fps: ['regenerated_components', 2] });
    }
    // SaveVideo embeds the prompt graph by default while preserving the provider's
    // encoded result (unless the Comfy deployment disables metadata globally).
    add('output', 'SaveVideo', { video: finalVideo, filename_prefix: 'sparko/interstitial', format: 'mp4', 'format.codec': 'auto' });
  } else {
    // VHS embeds Comfy's prompt graph: the exact prompt, seed, models and settings.
    add('output', 'VHS_VideoCombine', { images, audio, frame_rate: TIMELINE_FPS, loop_count: 0, filename_prefix: 'sparko/interstitial',
      format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 18, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true });
  }
  if (input.clipOrigin) {
    // Cloud ignores extra_pnginfo for API callers. Both save nodes embed the
    // API prompt graph, so keep portable clip data on the output node itself.
    graph.output._meta = { [CLIP_METADATA_TAG]: JSON.parse(serializeClipMetadata({ ...input.clipOrigin, prompt: input.prompt, media: insertion, seed })) };
  }
  return graph;
}
