// All provider model IDs live here. Credentials belong in server environment variables.
export const AI_MODELS = {
  openai: 'gpt-4.1-mini',
  transcription: 'gpt-4o-mini-transcribe',
  gemini: 'gemini-3.8-flash',
  fal: 'minimax/h3-max/insert-video',
} as const;

export const MAX_ANALYSIS_SECONDS = 120;
