import { z } from 'zod';
import type { GenerationProgress } from '../../../shared/contracts.js';

const count = z.number().int().nonnegative().nullish();
export const progressSchema = z.object({
  value: z.number().min(0).max(1), nodes_done: count, nodes_total: count,
  current_node: z.string().nullish(), current_node_class: z.string().nullish(), step: count, steps: count,
});

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
  SamplerCustomAdvanced: 'Generating video and audio', VAEDecode: 'Decoding video', VAEDecodeAudio: 'Decoding audio',
  VHS_VideoCombine: 'Encoding MP4',
};
export function generationProgress(data: z.infer<typeof progressSchema>) {
  const progressDetails: GenerationProgress = {
    stage: stages[data.current_node ?? ''] || classes[data.current_node_class ?? ''] || 'Generating scene',
    nodesDone: data.nodes_done ?? undefined, nodesTotal: data.nodes_total ?? undefined,
  };
  if (data.step != null && data.steps != null && data.steps > 0) {
    progressDetails.step = Math.min(data.step, data.steps); progressDetails.steps = data.steps;
  }
  // Use our stage labels, never arbitrary provider messages, prompts or model paths.
  return { progress: data.value, progressDetails };
}
