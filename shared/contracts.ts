export type Slice = { start: number; end: number };
export type Provider = 'openai' | 'gemini';
export type PromptClipKind = 'interstitial' | 'call' | 'idle' | 'response';
export type PromptEnhancement = { prompt: string; model: string };
export type VoiceContext = {
  sourceId: string;
  videoTime: number;
  sceneId?: string;
  question?: string;
};
export type VoiceAnswer = {
  transcript: string;
  response: string;
  provider: Provider;
  model: string;
  context: VoiceContext;
};
export type CaptionResult = {
  caption: string;
  description: string;
  provider: Provider;
  model: string;
  start: number;
  end: number;
  basis: string;
};
export type AppStatus = {
  uploadMode: 'local' | 'blob';
  requiresPassword: boolean;
  providers: Record<Provider | 'comfy', boolean>;
  models: Record<Provider, string>;
  defaultVideo: { name: string; url: string; size: number };
  defaultProject?: { url: string } | null;
};
export type InsertionRange = { start: number; duration: number; totalDuration: number };
export type GenerationProgress = {
  stage: string;
  step?: number;
  steps?: number;
  nodesDone?: number;
  nodesTotal?: number;
};
export type GenerationEvent =
  | { type: 'progress'; progress: number; progressDetails: GenerationProgress }
  | { type: 'status'; status: 'IN_QUEUE' | 'IN_PROGRESS'; queuePosition?: number }
  | { type: 'refresh' };
export type GenerationJob = {
  requestId: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  queuePosition?: number;
  progress?: number;
  progressDetails?: GenerationProgress;
  videoUrl?: string;
  insertion?: InsertionRange;
};

export function validateSlice(slice: Slice, duration: number, maxDuration = Infinity): void {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video is not ready yet.');
  if (!Number.isFinite(slice.start) || !Number.isFinite(slice.end)) throw new Error('Enter valid start and end times.');
  if (slice.start < 0 || slice.end <= slice.start) throw new Error('End time must be after start time.');
  if (slice.end > duration + 0.001) throw new Error('The selected range extends beyond the video.');
  if (slice.end - slice.start > maxDuration) throw new Error(`Select a clip of ${maxDuration} seconds or less.`);
}

export function formatTime(seconds: number, precise = false): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const secs = Math.floor(value) % 60;
  const base = `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return precise ? `${base}.${String(Math.floor((value % 1) * 1000)).padStart(3, '0')}` : base;
}
