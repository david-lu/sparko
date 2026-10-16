import type { CaptionResult, Provider, Slice } from '../../../shared/contracts';
import type { MediaEngine } from '../../media/MediaEngine';
import { sendForm } from '../../shared/api';

export async function analyzeVideo(engine: MediaEngine, slice: Slice, provider: Provider, instructions: string,
  signal: AbortSignal, onStatus: (status: string) => void): Promise<CaptionResult> {
  const body = new FormData();
  body.set('start', String(slice.start)); body.set('end', String(slice.end)); body.set('instructions', instructions);
  if (provider === 'openai') {
    onStatus('Reading frames…');
    const frames = await engine.frames(slice, Math.min(24, Math.max(4, Math.ceil((slice.end - slice.start) / 2))), 768, signal);
    body.set('frames', JSON.stringify(frames.map(frame => ({ time: frame.time, dataUrl: frame.url }))));
    onStatus('Preparing audio…');
    const audio = await engine.audio(slice, signal);
    if (audio) body.set('media', audio, 'segment.wav');
  } else {
    onStatus('Preparing video…');
    const clip = await engine.exportMp4(slice, { signal, maxHeight: 720, onProgress: value => onStatus(`Preparing video… ${Math.round(value * 100)}%`) });
    if (clip.size > 100 * 1024 * 1024) throw new Error('This segment exceeds 100 MB. Select a shorter range.');
    body.set('media', clip, 'segment.mp4');
  }
  signal.throwIfAborted();
  onStatus(provider === 'openai' ? 'ChatGPT is describing the segment…' : 'Gemini is processing the segment…');
  return sendForm<CaptionResult>(`/api/analyze/${provider}`, body, signal);
}
