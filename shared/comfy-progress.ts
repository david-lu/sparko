import type { GenerationProgress } from './contracts.js';

const stages: Record<string, string> = {
  before: 'Reading reference clips', after: 'Reading reference clips',
  model: 'Loading H3', text_encoder: 'Loading text encoder',
  shift: 'Preparing H3', empty_streams: 'Preparing reference context',
  place_before: 'Preparing reference context', place_after: 'Preparing reference context', joint: 'Preparing video and audio',
  video_vae: 'Loading video decoder', audio_vae: 'Loading audio decoder',
  conditioning: 'Encoding prompt', encode_before: 'Encoding reference clips', encode_after: 'Encoding reference clips',
  middle_mask: 'Preparing video mask', latent_mask: 'Preparing video mask', freeze_video: 'Preparing video mask',
  gap_audio: 'Preparing audio context', audio_prefix: 'Preparing audio context', audio_full: 'Preparing audio context',
  encode_audio: 'Encoding reference audio', fit_audio: 'Preparing audio context', freeze_audio: 'Preparing audio mask',
  sample: 'Generating video and audio', decode_video: 'Decoding video', decode_audio: 'Decoding audio', output: 'Encoding MP4',
  noise: 'Preparing generation', guider: 'Preparing generation', sampler: 'Preparing generation', schedule: 'Preparing generation',
  streams: 'Preparing video and audio for decoding',
};
const classes: Record<string, string> = {
  VHS_LoadVideo: 'Reading reference clips', UNETLoader: 'Loading H3', CLIPLoader: 'Loading text encoder',
  VAELoader: 'Loading decoder', VAEEncode: 'Encoding reference clips', VAEEncodeAudio: 'Encoding reference audio',
  SamplerCustomAdvanced: stages.sample, VAEDecode: stages.decode_video, VAEDecodeAudio: stages.decode_audio,
  VHS_VideoCombine: stages.output,
};
export const comfyStage = (node?: string | null, nodeClass?: string | null) => stages[node ?? ''] || classes[nodeClass ?? ''] || 'Generating scene';

const preparationStages = new Set([...Object.values(stages), ...Object.values(classes)]);
const preparationWeight = .05, samplerWeight = .9;

/** Estimated render work: 5% setup, 90% sampling, 5% decoding/encoding.
 * Comfy's aggregate value is based on node counts, not expected duration.
 * Keep the estimate derived from the latest stage/steps, including restored jobs.
 */
export function estimateComfyProgress(details?: GenerationProgress): number | undefined {
  if (!details) return;
  const { stage, step, steps, nodesDone, nodesTotal } = details;
  const fraction = step !== undefined && steps !== undefined && Number.isFinite(step) && Number.isFinite(steps) && step >= 0 && steps > 0
    ? Math.min(1, step / steps) : undefined;
  if (stage === stages.sample) return fraction === undefined ? undefined : preparationWeight + samplerWeight * fraction;
  // Stage milestones fill the final 5%; only a completed job is finished.
  if (stage === stages.streams) return .95;
  if (stage === stages.decode_video) return .95 + .02 * (fraction ?? 0);
  if (stage === stages.decode_audio) return .97 + .01 * (fraction ?? 0);
  if (stage === stages.output) return Math.min(.99, .98 + .02 * (fraction ?? 0));
  if (preparationStages.has(stage) && nodesDone !== undefined && nodesTotal !== undefined
    && Number.isFinite(nodesDone) && Number.isFinite(nodesTotal) && nodesDone >= 0 && nodesTotal > 0) {
    return preparationWeight * Math.min(1, nodesDone / nodesTotal);
  }
  // Unknown stages or absent sampler steps cannot support a useful percentage.
}
