// All provider model IDs live here. Credentials belong in server environment variables.
export const AI_MODELS = {
  openai: 'gpt-4.1-mini',
  promptEnhancement: 'gpt-6.1-sol',
  transcription: 'gpt-4o-mini-transcribe',
  gemini: 'gemini-3.8-flash',
  voiceActivity: 'v5', // Silero, evaluated locally in the browser.
} as const;

export const MAX_ANALYSIS_SECONDS = 120;
// Project playback, editing and composed exports share this frame clock.
export const TIMELINE_FPS = 24;
// Closest whole-frame dissolve to 0.6 seconds on the 24 fps edit grid.
export const INTERSTITIAL_CROSSFADE_FRAMES = 14;
export const LOOP_CROSSFADE_SECONDS = .25;
// MiniMax's published H3 prompt limit, including every field and appended direction.
// https://github.com/MiniMax-AI/cli/blob/main/skill/h3-video/SKILL.md
export const H3_PROMPT_MAX_LENGTH = 7000;
export const PROMPT_EDIT_MAX_LENGTH = 2000;
export const COMFY_MODELS = {
  diffusion: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  turboLora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  regeneration: 'MiniMax H3', // Official MiniMax-H3 API model through Comfy's partner node.
} as const;
export const COMFY = {
  baseUrl: 'https://cloud.comfy.org', maxDimension: 1344, maxShortEdge: 768, minRegenerationFrames: 107, minContextFrames: 39,
  maxFrames: 362, frameGroup: 17, firstFrames: 5, steps: 20,
  sampler: 'res_multistep', shiftVideo: 12, shiftAudio: 3,
  // LightX2V Ref2VA Turbo: Euler/simple, 4 steps, the same 12/3 shifts.
  turboSteps: 4, turboSampler: 'euler',
  audioLatentsPerSecond: 40,
} as const;
export const MASK_TRANSITION = { defaultMs: 500, maxMs: 4000 } as const;
// Cap newly converted working videos; the untouched original remains in the project.
// Set maxHeight to 0 to keep the original resolution during preparation.
export const VIDEO_PREPARATION = { maxHeight: 1344 } as const;
export const MAX_VOICE_SECONDS = 60;
// Keeps microphone requests below Vercel's function body limit, without public Blob uploads.
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
// Spoken answers for voice conditionals, judged by Hume's Audio Decisions API.
// https://dev.hume.ai/audio-decisions/docs/limits: WAV or MP3, 1 s to 5 min, 2-20 choice options.
export const VOICE_CHOICE = {
  endpoint: 'https://api.cloud.hume.ai/v0/decisions/file',
  // Short answers ("yes") are padded with trailing silence to Hume's 1 second minimum.
  minSeconds: 1.25, maxSeconds: 12,
  // One option is reserved for "no clear answer", which takes the default condition.
  maxConditions: 19,
  // The winning option's share of simulated raters. Lower than a strict majority to give children the benefit of the doubt.
  minProbability: 0.4,
} as const;
export const VOICE_DETECTION = {
  positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35,
  minSpeechMs: 250, preSpeechPadMs: 400, redemptionMs: 1600,
} as const;

export const INTERSTITIAL = {
  defaultRange: 2, maxRange: 4, minStartRange: 1.625, minEndRange: 0.1,
  defaultDuration: 6, minDuration: 5, maxDuration: 13,
  enablePromptExpansion: false, // Retained for older saved project metadata.
  maxReferenceBytes: 50 * 1024 * 1024,
  referenceFps: TIMELINE_FPS,
  pollMilliseconds: 2500,
} as const;
