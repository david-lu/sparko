import type { AppStatus, CaptionResult, FalJob, Provider, Slice, VoiceAnswer, VoiceContext } from '../../shared/contracts';
import { MAX_VOICE_BYTES } from '../../shared/constants';
import type { MediaSource } from './media';
import type { MediaEngine } from './MediaEngine';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { ...appHeaders(), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('sparko:auth-required'));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}
export function appHeaders() {
  return { 'x-sparko-request': '1', 'x-sparko-password': sessionStorage.getItem('sparko:password') || '' };
}
let appStatus: AppStatus | undefined;
export const getStatus = async () => appStatus = await request<AppStatus>('/api/status');

/** Scene code can supply its question and sceneId when requesting a spoken answer. */
export async function sendVoiceAnswer(audio: Blob, provider: Provider, context: VoiceContext, signal?: AbortSignal): Promise<VoiceAnswer> {
  if (!audio.size || audio.size > MAX_VOICE_BYTES) throw new Error('Record an answer smaller than 2 MB.');
  const mime = audio.type.split(';')[0];
  const extension = mime === 'audio/mp4' ? 'mp4' : mime === 'audio/ogg' ? 'ogg' : mime === 'audio/wav' ? 'wav' : 'webm';
  const body = new FormData();
  body.set('audio', audio, `answer.${extension}`);
  body.set('context', JSON.stringify(context));
  // Bounded microphone audio goes directly to the authenticated API, including on Vercel.
  return request<VoiceAnswer>(`/api/voice/${provider}`, { method: 'POST', body, signal });
}

async function sendForm<T>(path: string, body: FormData, signal?: AbortSignal): Promise<T> {
  const status = appStatus || await getStatus();
  if (status.uploadMode === 'local') return request<T>(path, { method: 'POST', body, signal });
  const { upload } = await import('@vercel/blob/client');
  const urls: string[] = [];
  try {
    const payload: { fields: Record<string, string>; file?: { url: string; name: string; mime: string; field: string } } = { fields: {} };
    for (const [field, value] of body.entries()) {
      if (typeof value === 'string') payload.fields[field] = value;
      else {
        const extension = value.type.includes('wav') ? 'wav' : value.type.includes('webm') ? 'webm' : value.type.includes('quicktime') ? 'mov' : value.type.includes('matroska') ? 'mkv' : 'mp4';
        const blob = await upload(`transient/${crypto.randomUUID()}.${extension}`, value, {
          access: 'public', handleUploadUrl: '/api/uploads', contentType: value.type,
          headers: appHeaders(), multipart: value.size > 5 * 1024 * 1024, abortSignal: signal,
        });
        urls.push(blob.url); payload.file = { url: blob.url, name: value.name, mime: value.type, field };
      }
    }
    const blob = await upload(`transient/${crypto.randomUUID()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }), {
      access: 'public', handleUploadUrl: '/api/uploads', contentType: 'application/json', headers: appHeaders(), abortSignal: signal,
    });
    urls.push(blob.url);
    return await request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payloadUrl: blob.url }), signal });
  } finally {
    if (urls.length) await request('/api/uploads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) }).catch(() => undefined);
  }
}

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

export async function submitFal(source: MediaSource, values: { start: number; resume: number; duration: number; prompt: string; resolution: string }): Promise<FalJob> {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, String(value));
  body.set('source', source.file ? 'upload' : 'default');
  if (source.file) {
    if (source.file.size > 256 * 1024 * 1024) throw new Error('fal uploads are limited to 256 MB in this app.');
    body.set('video', source.file);
  }
  return sendForm<FalJob>('/api/fal/jobs', body);
}
