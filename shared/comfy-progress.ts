import type { GenerationProgress } from './contracts.js';

const stages: Record<string, string> = {
  before: 'Reading reference clips', after: 'Reading reference clips',
  model: 'Loading H3', text_encoder: 'Loading text encoder',
  shift: 'Preparing H3', empty_streams: 'Preparing reference context',
  loop_start: 'Anchoring the loop start', loop_end: 'Matching the loop ending to its start',
  place_before: 'Preparing reference context', place_after: 'Preparing reference context', joint: 'Preparing video and audio',
  video_vae: 'Loading video decoder', audio_vae: 'Loading audio decoder',
  base_video: 'Preparing H3 video for regeneration', regenerate_2k: 'Regenerating with H3 2K',
  conditioning: 'Encoding prompt', encode_before: 'Encoding reference clips', encode_after: 'Encoding reference clips',
  interpolation_model: 'Loading motion interpolator', interpolate_middle: 'Preparing interpolated frames', encode_target: 'Encoding interpolated video',
  last_before: 'Preparing reference frames', first_after: 'Preparing reference frames', boundary_frames: 'Preparing reference frames',
  target_prefix: 'Preparing interpolated video', interpolated_target: 'Preparing interpolated video',
  middle_mask: 'Preparing video mask', latent_mask: 'Preparing video mask', freeze_video: 'Preparing video mask',
  middle_strength: 'Preparing video mask', scale_middle_mask: 'Preparing video mask',
  vignette_image: 'Preparing vignette mask', vignette_gradient: 'Preparing vignette mask', vignette_amplitude: 'Preparing vignette mask',
  vignette_scaled: 'Preparing vignette mask', vignette_floor: 'Preparing vignette mask', vignette_mask: 'Preparing vignette mask',
  gap_audio: 'Preparing audio context', audio_prefix: 'Preparing audio context', audio_full: 'Preparing audio context',
  encode_audio: 'Encoding reference audio', fit_audio: 'Preparing audio context', freeze_audio: 'Preparing audio mask',
  audio_mask_size: 'Preparing audio mask', audio_mask_base: 'Preparing audio mask', audio_mask_middle: 'Preparing audio mask',
  audio_mask_feather: 'Preparing audio mask', audio_mask: 'Preparing audio mask',
  sample: 'Generating video and audio', decode_video: 'Decoding video', decode_audio: 'Decoding audio', output: 'Encoding MP4',
  noise: 'Preparing generation', guider: 'Preparing generation', sampler: 'Preparing generation', schedule: 'Preparing generation',
  streams: 'Preparing video and audio for decoding',
};
const classes: Record<string, string> = {
  VHS_LoadVideo: 'Reading reference clips', VHS_LoadVideoFFmpeg: 'Reading reference clips',
  UNETLoader: 'Loading H3', CLIPLoader: 'Loading text encoder',
  VAELoader: 'Loading decoder', VAEEncode: 'Encoding reference clips', VAEEncodeAudio: 'Encoding reference audio',
  SamplerCustomAdvanced: stages.sample, VAEDecode: stages.decode_video, VAEDecodeAudio: stages.decode_audio,
  CreateVideo: stages.base_video, MinimaxHailuo03RegenerateNode: stages.regenerate_2k,
  VHS_VideoCombine: stages.output, SaveVideo: stages.output,
  FrameInterpolate: 'Interpolating reference motion',
};
export const comfyStage = (node?: string | null, nodeClass?: string | null) => node?.startsWith('reference_image_') ? 'Reading image references'
  : node?.startsWith('audio_curve_') ? 'Preparing audio mask'
  : nodeClass === 'MiniMaxH3ReferenceToVideo' ? 'Encoding prompt and image references' : stages[node ?? ''] || classes[nodeClass ?? ''] || 'Generating scene';

/** Progress within the current stage, not completion of the whole render.
 * The aggregate workflow value weights nodes, regardless of their runtime.
 * Without step counts there is no reliable render percentage to display.
 */
export function comfyStepProgress(details?: GenerationProgress): number | undefined {
  if (!details) return;
  const { step, steps } = details;
  if (step !== undefined && steps !== undefined && Number.isInteger(step) && Number.isInteger(steps) && step >= 0 && steps > 0) return Math.min(1, step / steps);
}
