import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { MediaEngine } from '../../media/MediaEngine';
import { sendForm } from '../../shared/api';

export async function analyzeVideo(engine: MediaEngine, slice: Slice, provider: Provider, instructions: string,
  signal: AbortSignal, onStatus: (status: string) => void): Promise<CaptionResult> {
  if (provider === 'gemini') return analyzeGeminiVideo(engine, slice, instructions, signal, onStatus);
  const body = new FormData();
  body.set('start', String(slice.start)); body.set('end', String(slice.end)); body.set('instructions', instructions);
  onStatus('Reading frames…');
  const frames = await engine.frames(slice, Math.min(24, Math.max(4, Math.ceil((slice.end - slice.start) / 2))), 768, signal);
  body.set('frames', JSON.stringify(frames.map(frame => ({ time: frame.time, dataUrl: frame.url }))));
  onStatus('Preparing audio…');
  const audio = await engine.audio(slice, signal);
  if (audio) body.set('media', audio, 'segment.wav');
  signal.throwIfAborted();
  onStatus('ChatGPT is describing the segment…');
  return sendForm<CaptionResult>(`/api/analyze/${provider}`, body, signal);
}

export async function analyzeGeminiVideo(engine: Pick<MediaEngine, 'exportMp4'>, slice: Slice, instructions: string,
  signal: AbortSignal, onStatus: (status: string) => void, purpose?: 'reference-timing'): Promise<CaptionResult> {
  onStatus('Preparing video…');
  const clip = await engine.exportMp4(slice, { signal, maxHeight: 720, onProgress: value => onStatus(`Preparing video… ${Math.round(value * 100)}%`) });
  signal.throwIfAborted();
  if (clip.size > 100 * 1024 * 1024) throw new Error('This segment exceeds 100 MB. Select a shorter range.');
  const body = new FormData();
  body.set('start', String(slice.start)); body.set('end', String(slice.end)); body.set('instructions', instructions);
  if (purpose) body.set('purpose', purpose);
  body.set('media', clip, 'segment.mp4');
  onStatus('Gemini is processing the segment…');
  return sendForm<CaptionResult>('/api/analyze/gemini', body, signal);
}
