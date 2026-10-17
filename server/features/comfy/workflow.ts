import { COMFY, COMFY_MODELS, TIMELINE_FPS } from '../../../shared/constants.js';
import { comfyBridgePlan, type ComfyMode } from '../../../shared/comfy.js';

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type BridgeInput = { before: number; after: number; duration: number; prompt: string; width: number; height: number; hasAudio: boolean; mode?: ComfyMode };

/** Native H3 AV masking, assembled from nodes available on managed Comfy Cloud.
 * Video windows are encoded separately, placed in the empty target, and frozen.
 * The original source footage is kept by Sparko's compositor, outside this render.
 */
export function bridgeWorkflow(assetId: string, input: BridgeInput, seed: number): Workflow {
  const plan = comfyBridgePlan(input.before, input.after, input.duration, input.mode);
  const { prefixFrames, suffixFrames, totalFrames, insertion } = plan;
  const graph: Workflow = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => { graph[id] = { class_type, inputs }; return [id, 0]; };
  const asset = { __type: 'core/ASSET', info: { id: assetId } };
  const loader = (skip: number, frames: number) => ({ video: asset, force_rate: TIMELINE_FPS, custom_width: input.width, custom_height: input.height,
    frame_load_cap: frames, skip_first_frames: skip, select_every_nth: 1, format: 'None' });
  const before = add('before', 'VHS_LoadVideo', loader(0, prefixFrames));
  const after = suffixFrames ? add('after', 'VHS_LoadVideo', loader(prefixFrames, suffixFrames)) : undefined;
  const model = add('model', 'UNETLoader', { unet_name: COMFY_MODELS.diffusion, weight_dtype: 'default' });
  const clip = add('text_encoder', 'CLIPLoader', { clip_name: COMFY_MODELS.textEncoder, type: 'minimax', device: 'default' });
  const vae = add('video_vae', 'VAELoader', { vae_name: COMFY_MODELS.videoVae });
  const audioVae = add('audio_vae', 'VAELoader', { vae_name: COMFY_MODELS.audioVae });
  const shifted = add('shift', 'MiniMaxH3SigmaShift', { model, shift_video: COMFY.shiftVideo, shift_audio: COMFY.shiftAudio });
  const positive = add('conditioning', 'MiniMaxH3ImageToVideo', { clip, vae, prompt: input.prompt, width: input.width, height: input.height, length: totalFrames });
  const empty = add('empty_streams', 'LTXVSeparateAVLatent', { av_latent: ['conditioning', 1] });
  const startLatent = add('encode_before', 'VAEEncode', { pixels: before, vae });
  const endLatent = after ? add('encode_after', 'VAEEncode', { pixels: after, vae }) : undefined;
  const prefix = add('place_before', 'ReplaceVideoLatentFrames', { destination: empty, source: startLatent, index: 0 });
  const endpoints = endLatent ? add('place_after', 'ReplaceVideoLatentFrames', { destination: prefix, source: endLatent, index: -(2 + (suffixFrames - 5) / 17 * 5) }) : prefix;
  // Spatially uniform masks need only one model token (32px), not a full-size video batch.
  const mask = add('middle_mask', 'MVEx_FrameRangeMask', { width: 32, height: 32, frames: totalFrames, ranges: `${prefixFrames}:${totalFrames - suffixFrames}` });
  const latentMask = add('latent_mask', 'MVEx_MaskToLatentSpace', { masks: mask, compression: 'auto', vae,
    spatial_method: 'max', temporal_method: 'max', grow_spatial: 0, grow_temporal: 0 });
  const frozenVideo = add('freeze_video', 'SetLatentNoiseMask', { samples: endpoints, mask: latentMask });
  let joint = add('joint', 'LTXVConcatAVLatent', { video_latent: frozenVideo, audio_latent: ['empty_streams', 1] });
  if (input.hasAudio) {
    const silence = add('gap_audio', 'EmptyAudio', { duration: insertion.duration, sample_rate: 32000, channels: 2 });
    const a = add('audio_prefix', 'AudioConcat', { audio1: ['before', 2], audio2: silence, direction: 'after' });
    const audio = after ? add('audio_full', 'AudioConcat', { audio1: a, audio2: ['after', 2], direction: 'after' }) : a;
    const encoded = add('encode_audio', 'VAEEncodeAudio', { audio, vae: audioVae });
    const fitted = add('fit_audio', 'LTXVConcatAVLatent', { video_latent: joint, audio_latent: encoded });
    joint = add('freeze_audio', 'MVEx_AudioMaskToLatent', { latent: fitted, timing: 'auto', vae: audioVae,
      start_time: insertion.start, end_time: insertion.start + insertion.duration, existing_mask: 'replace' });
  }
  const noise = add('noise', 'RandomNoise', { noise_seed: seed });
  const guider = add('guider', 'BasicGuider', { model: shifted, conditioning: positive });
  const sampler = add('sampler', 'KSamplerSelect', { sampler_name: COMFY.sampler });
  const sigmas = add('schedule', 'BasicScheduler', { model: shifted, scheduler: 'simple', steps: COMFY.steps, denoise: 1 });
  const sample = add('sample', 'SamplerCustomAdvanced', { noise, guider, sampler, sigmas, latent_image: joint });
  const streams = add('streams', 'LTXVSeparateAVLatent', { av_latent: sample });
  const images = add('decode_video', 'VAEDecode', { samples: streams, vae });
  const audio = add('decode_audio', 'VAEDecodeAudio', { samples: ['streams', 1], vae: audioVae });
  add('output', 'VHS_VideoCombine', { images, audio, frame_rate: TIMELINE_FPS, loop_count: 0, filename_prefix: 'sparko/interstitial',
    format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 18, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true });
  return graph;
}
