import { COMFY, COMFY_MODELS, MASK_TRANSITION, TIMELINE_FPS } from '../../../shared/constants.js';
import { comfyBridgePlan, validateComfyResolution, type ComfyMode } from '../../../shared/comfy.js';
import { normalizeMaskInjection, validateMaskTransitionMs, type MaskInjection, type GenerationResolution } from '../../../shared/interstitials.js';
import { videoTransitionPoints } from './mask-transition.js';

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type BridgeInput = { before: number; after: number; duration: number; prompt: string; width: number; height: number; hasAudio: boolean; mode?: ComfyMode; maskInjection?: MaskInjection; audioMaskTransitionMs?: number; videoMaskTransitionMs?: number; interpolateMiddle?: boolean; resolution?: GenerationResolution };

/** Native H3 AV masking, assembled from nodes available on managed Comfy Cloud.
 * Optional FILM targets use a uniform 0.97 mask or a gradual 1.00–0.95 vignette.
 * Separately encoded references stay frozen outside their soft transitions.
 * The original source footage is kept by Sparko's compositor, outside this render.
 */
export function bridgeWorkflow(assetId: string | undefined, input: BridgeInput, seed: number, vignetteAssetId?: string): Workflow {
  const plan = comfyBridgePlan(input.before, input.after, input.duration, input.mode);
  validateComfyResolution(plan,input.resolution);
  const { prefixFrames, suffixFrames, middleFrames, totalFrames, insertion } = plan;
  const audioTransitionMs = input.audioMaskTransitionMs ?? MASK_TRANSITION.defaultMs;
  const videoTransitionMs = input.videoMaskTransitionMs ?? MASK_TRANSITION.defaultMs;
  validateMaskTransitionMs(audioTransitionMs, 'Audio mask transition');
  validateMaskTransitionMs(videoTransitionMs, 'Video mask transition');
  const maskInjection = prefixFrames && suffixFrames ? normalizeMaskInjection(input.maskInjection, input.interpolateMiddle) : 'standard';
  if ((prefixFrames || suffixFrames) && !assetId) throw new Error('Reference footage is missing.');
  if (maskInjection === 'vignette' && !vignetteAssetId) throw new Error('Vignette generation requires the uploaded gradient mask.');
  const graph: Workflow = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => { graph[id] = { class_type, inputs }; return [id, 0]; };
  const asset = { __type: 'core/ASSET', info: { id: assetId } };
  // FFmpeg preserves reference colors better than the OpenCV loader. The upload
  // concatenates the two windows at TIMELINE_FPS; seek in seconds without rounding.
  const loader = (skip: number, frames: number) => ({ video: asset, force_rate: TIMELINE_FPS, custom_width: input.width, custom_height: input.height,
    frame_load_cap: frames, start_time: skip / TIMELINE_FPS, format: 'None' });
  const before = prefixFrames ? add('before', 'VHS_LoadVideoFFmpeg', loader(0, prefixFrames)) : undefined;
  const after = suffixFrames ? add('after', 'VHS_LoadVideoFFmpeg', loader(prefixFrames, suffixFrames)) : undefined;
  const model = add('model', 'UNETLoader', { unet_name: COMFY_MODELS.diffusion, weight_dtype: 'default' });
  const clip = add('text_encoder', 'CLIPLoader', { clip_name: COMFY_MODELS.textEncoder, type: 'minimax', device: 'default' });
  const vae = add('video_vae', 'VAELoader', { vae_name: COMFY_MODELS.videoVae });
  const audioVae = add('audio_vae', 'VAELoader', { vae_name: COMFY_MODELS.audioVae });
  const shifted = add('shift', 'MiniMaxH3SigmaShift', { model, shift_video: COMFY.shiftVideo, shift_audio: COMFY.shiftAudio });
  const positive = add('conditioning', 'MiniMaxH3ImageToVideo', { clip, vae, prompt: input.prompt, width: input.width, height: input.height, length: totalFrames });
  const empty = add('empty_streams', 'LTXVSeparateAVLatent', { av_latent: ['conditioning', 1] });
  let target = empty;
  if (before && after && maskInjection !== 'standard') {
    const lastBefore = add('last_before', 'ImageFromBatch', { image: before, batch_index: prefixFrames - 1, length: 1 });
    const firstAfter = add('first_after', 'ImageFromBatch', { image: after, batch_index: 0, length: 1 });
    let motion = add('boundary_frames', 'ImageBatch', { image1: lastBefore, image2: firstAfter });
    const interpolationModel = add('interpolation_model', 'FrameInterpolationModelLoader', { model_name: COMFY_MODELS.frameInterpolation });
    // Native interpolation accepts at most 16x per pass and returns (N-1)*factor+1
    // frames. Produce enough intervals, then sample only the interior frames.
    let intervals = 1, pass = 0;
    while (intervals < middleFrames + 1) {
      const multiplier = Math.min(16, Math.ceil((middleFrames + 1) / intervals));
      motion = add(`motion_pass_${++pass}`, 'FrameInterpolate', { interp_model: interpolationModel, images: motion, multiplier });
      intervals *= multiplier;
    }
    const indexes = Array.from({ length: middleFrames }, (_, i) => Math.round((i + 1) * intervals / (middleFrames + 1)));
    const middle = add('interpolate_middle', 'VHS_SelectImages', { image: motion, indexes: indexes.join(','), err_if_missing: true, err_if_empty: true });
    const start = add('target_prefix', 'ImageBatch', { image1: before, image2: middle });
    const fullTarget = add('interpolated_target', 'ImageBatch', { image1: start, image2: after });
    // Encode the full H3-aligned frame count. Encoding only the middle would use
    // the wrong temporal VAE frame grouping. Keep both reference windows intact.
    target = add('encode_target', 'VAEEncode', { pixels: fullTarget, vae });
  }
  const startLatent = before ? add('encode_before', 'VAEEncode', { pixels: before, vae }) : undefined;
  const endLatent = after ? add('encode_after', 'VAEEncode', { pixels: after, vae }) : undefined;
  const prefix = startLatent ? add('place_before', 'ReplaceVideoLatentFrames', { destination: target, source: startLatent, index: 0 }) : target;
  const endpoints = endLatent ? add('place_after', 'ReplaceVideoLatentFrames', { destination: prefix, source: endLatent, index: -(2 + (suffixFrames - 5) / 17 * 5) }) : prefix;
  // Spatially uniform masks need only one model token (32px), not a full-size video batch.
  let mask = videoTransitionMs > 0 && (before || after)
    ? add('middle_mask', 'CreateFadeMaskAdvanced', { width: 32, height: 32, frames: totalFrames, invert: false, interpolation: 'linear',
      points_string: videoTransitionPoints(prefixFrames, suffixFrames, totalFrames, videoTransitionMs) })
    : add('middle_mask', 'MVEx_FrameRangeMask', { width: 32, height: 32, frames: totalFrames, ranges: `${prefixFrames}:${totalFrames - suffixFrames}` });
  if (maskInjection === 'uniform') {
    const strength = add('middle_strength', 'SolidMask', { value: 0.97, width: 32, height: 32 });
    mask = add('scale_middle_mask', 'MaskComposite', { destination: mask, source: strength, x: 0, y: 0, operation: 'multiply' });
  } else if (maskInjection === 'vignette') {
    // Use the same normalized PNG and float scaling as the cloud experiment.
    // Scaling after loading retains 256 steps within 0.95–1, rather than 13.
    const image = add('vignette_image', 'LoadImage', { image: { __type: 'core/ASSET', info: { id: vignetteAssetId } } });
    const gradient = add('vignette_gradient', 'ImageToMask', { image, channel: 'red' });
    const amplitude = add('vignette_amplitude', 'SolidMask', { value: 0.05, width: input.width, height: input.height });
    const scaled = add('vignette_scaled', 'MaskComposite', { destination: gradient, source: amplitude, x: 0, y: 0, operation: 'multiply' });
    const floor = add('vignette_floor', 'SolidMask', { value: 0.95, width: input.width, height: input.height });
    const spatial = add('vignette_mask', 'MaskComposite', { destination: scaled, source: floor, x: 0, y: 0, operation: 'add' });
    graph.middle_mask.inputs.width = input.width; graph.middle_mask.inputs.height = input.height;
    mask = add('scale_middle_mask', 'MaskComposite', { destination: mask, source: spatial, x: 0, y: 0, operation: 'multiply' });
  }
  const latentMask = add('latent_mask', 'MVEx_MaskToLatentSpace', { masks: mask, compression: 'auto', vae,
    spatial_method: 'max', temporal_method: 'max', grow_spatial: 0, grow_temporal: 0 });
  const frozenVideo = add('freeze_video', 'SetLatentNoiseMask', { samples: endpoints, mask: latentMask });
  let joint = add('joint', 'LTXVConcatAVLatent', { video_latent: frozenVideo, audio_latent: ['empty_streams', 1] });
  if (input.hasAudio && (before || after)) {
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
    const generated = add('audio_mask_middle', 'SolidMask', { value: 1, width: after ? end - start : audioLength, height: 1 });
    const feathered = add('audio_mask_feather', 'FeatherMask', { mask: generated, left: fadeBefore, top: 0, right: fadeAfter, bottom: 0 });
    const audioMask = add('audio_mask', 'MaskComposite', { destination: preserved, source: feathered, x: start, y: 0, operation: 'add' });
    joint = add('freeze_audio', 'MVEx_AudioMaskToLatent', { latent: fitted, timing: 'auto', vae: audioVae,
      mask: audioMask, start_time: insertion.start, end_time: insertion.start + insertion.duration, existing_mask: 'replace' });
  }
  const noise = add('noise', 'RandomNoise', { noise_seed: seed });
  const guider = add('guider', 'BasicGuider', { model: shifted, conditioning: positive });
  const sampler = add('sampler', 'KSamplerSelect', { sampler_name: COMFY.sampler });
  const sigmas = add('schedule', 'BasicScheduler', { model: shifted, scheduler: 'simple', steps: COMFY.steps, denoise: 1 });
  const sample = add('sample', 'SamplerCustomAdvanced', { noise, guider, sampler, sigmas, latent_image: joint });
  const streams = add('streams', 'LTXVSeparateAVLatent', { av_latent: sample });
  const images = add('decode_video', 'VAEDecode', { samples: streams, vae });
  const audio = add('decode_audio', 'VAEDecodeAudio', { samples: ['streams', 1], vae: audioVae });
  if (input.resolution === '2k') {
    // The official partner node sends this untrimmed H3 video and its exact
    // prompt to MiniMax's /v2/video_regeneration API, with resolution="2K".
    const base = add('base_video', 'CreateVideo', { images, audio, fps: TIMELINE_FPS });
    const regenerated = add('regenerate_2k', 'MinimaxHailuo03RegenerateNode', {
      video: base, model: COMFY_MODELS.regeneration, 'model.prompt': input.prompt, 'model.resolution': '2K', watermark: false,
    });
    // SaveVideo embeds the prompt graph by default while preserving the provider's
    // encoded result (unless the Comfy deployment disables metadata globally).
    add('output', 'SaveVideo', { video: regenerated, filename_prefix: 'sparko/interstitial', format: 'mp4', 'format.codec': 'auto' });
  } else {
    // VHS embeds Comfy's prompt graph: the exact prompt, seed, models and settings.
    add('output', 'VHS_VideoCombine', { images, audio, frame_rate: TIMELINE_FPS, loop_count: 0, filename_prefix: 'sparko/interstitial',
      format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 18, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true });
  }
  return graph;
}
