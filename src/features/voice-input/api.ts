import type { Provider, VoiceAnswer, VoiceContext } from '../../../shared/contracts';
import { MAX_VOICE_BYTES } from '../../../shared/constants';
import { request } from '../../shared/api';

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
