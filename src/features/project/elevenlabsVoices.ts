import { request } from '../../shared/api';
import type { CharacterVoice } from '../../../shared/characters';

export type VoiceOption = { id: string; name: string; category?: string; description?: string; labels: Record<string, string>; previewUrl?: string };
export type VoicePreview = { generatedVoiceId: string; audio: string; duration?: number };
const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function searchVoices(search: string, page: string | undefined, signal?: AbortSignal) {
  const query = new URLSearchParams({ ...(search.trim() ? { search: search.trim() } : {}), ...(page ? { page } : {}) });
  return request<{ voices: VoiceOption[]; nextPageToken?: string }>(`/api/elevenlabs/voices?${query}`, { signal });
}
export const designVoices = (description: string, signal?: AbortSignal) =>
  request<{ previews: VoicePreview[]; text?: string }>('/api/elevenlabs/voices/design', json({ description }, signal));
/** Saves a designed preview to the ElevenLabs account, named after the character. */
export const saveDesignedVoice = (name: string, description: string, generatedVoiceId: string, signal?: AbortSignal) =>
  request<CharacterVoice>('/api/elevenlabs/voices', json({ name, description, generatedVoiceId }, signal));
export const enhanceVoiceDescription = (name: string, voiceDescription: string, projectInstructions: string | undefined, signal?: AbortSignal) =>
  request<{ voiceDescription: string; guideUrl: string }>('/api/audio-prompts/voice-description', json({ name, voiceDescription, projectInstructions }, signal));
/** A short summary such as "British · middle aged · male". */
export const voiceLabels = (voice: Pick<VoiceOption, 'labels' | 'category'>) =>
  [voice.labels.accent, voice.labels.age?.replace(/_/g, ' '), voice.labels.gender, voice.labels.descriptive ?? voice.labels.description].filter(Boolean).join(' · ') || voice.category || '';
