// All provider model IDs live here. Credentials belong in server environment variables.
export const AI_MODELS = {
  openai: 'gpt-4.1-mini',
  transcription: 'gpt-4o-mini-transcribe',
  gemini: 'gemini-3.8-flash',
  fal: 'minimax/h3-max/insert-video',
  voiceActivity: 'v5', // Silero, evaluated locally in the browser.
} as const;

export const MAX_ANALYSIS_SECONDS = 120;
// Project playback, editing and composed exports share this frame clock.
export const TIMELINE_FPS = 24;
// Cap newly converted working videos; the untouched original remains in the project.
// Set maxHeight to 0 to keep the original resolution during preparation.
export const VIDEO_PREPARATION = { maxHeight: 1080 } as const;
export const MAX_VOICE_SECONDS = 60;
// Keeps microphone requests below Vercel's function body limit, without public Blob uploads.
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const VOICE_DETECTION = {
  positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35,
  minSpeechMs: 250, preSpeechPadMs: 400, redemptionMs: 1600,
} as const;

export const INTERSTITIAL = {
  defaultRange: 2, maxRange: 4, minStartRange: 1.625, minEndRange: 0.1,
  defaultDuration: 6, minDuration: 5, maxDuration: 13,
  enablePromptExpansion: false, // Default for new drafts; editable per interstitial.
  resolution: '768p', maxReferenceBytes: 50 * 1024 * 1024,
  referenceFps: TIMELINE_FPS, // H3 Max validates insertion times at 24 fps.
  pollMilliseconds: 2500,
} as const;
