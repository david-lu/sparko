import { generationPrompt } from '../../../shared/prompt-versions.js';
import { assetModel, validateAssetSettings, type AssetSettings } from '../../../shared/asset-generation.js';
import { elevenLabsVoiceIdSchema } from '../../../shared/characters.js';
import { dialogueInputs } from '../../../shared/dialogue-script.js';
import { HttpError } from '../../shared/http.js';

const API_ROOT = 'https://api.elevenlabs.io/';
/** Designs voices for Eleven v3/v4 speech. */
export const VOICE_DESIGN_MODEL = 'eleven_ttv_v3';
export type ElevenLabsVoice = { id: string; name: string; category?: string; description?: string; labels: Record<string, string>; previewUrl?: string };
export type VoicePreview = { generatedVoiceId: string; audio: string; duration?: number };
export const generatedVoiceIdPattern = /^[A-Za-z0-9_-]{8,128}$/;

/** Each audio type's endpoint and body. Formats use ElevenLabs' defaults, which every plan can download. */
export function elevenLabsRequest(settings: AssetSettings): { path: string; body: Record<string, unknown> } {
  const error = validateAssetSettings(settings); if (error) throw new HttpError(400, error);
  const model = assetModel(settings.model)!;
  if (model.provider !== 'elevenlabs' || !model.providerModel) throw new HttpError(400, `${model.name} is not generated with ElevenLabs.`);
  const prompt = generationPrompt(settings), path = model.endpoint;
  if (model.audioType === 'dialogue') {
    const result = dialogueInputs(prompt, settings.dialogueVoices);
    if (!result.inputs) throw new HttpError(400, result.error ?? 'Choose a voice for every speaker.');
    return { path, body: { inputs: result.inputs, model_id: model.providerModel, settings: { stability: settings.stability ?? .5 },
      ...(settings.languageCode ? { language_code: settings.languageCode } : {}), ...(settings.seed !== undefined ? { seed: settings.seed } : {}) } };
  }
  if (model.audioType === 'music') return { path, body: { prompt, model_id: model.providerModel, force_instrumental: !!settings.instrumental,
    ...(settings.autoDuration ? {} : { music_length_ms: Math.round(settings.duration * 1000) }) } };
  return { path, body: { text: prompt, model_id: model.providerModel, duration_seconds: settings.autoDuration ? null : settings.duration,
    prompt_influence: settings.promptInfluence ?? .3, loop: !!settings.loop } };
}

/** Map provider failures to fixed messages. Raw diagnostics are never forwarded. */
export async function elevenLabsError(response: Response): Promise<HttpError> {
  const body = await response.json().catch(() => undefined) as { detail?: unknown } | undefined;
  const detail = body?.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail as Record<string, unknown> : undefined;
  // Current errors carry `code`; older ones and some current ones carry the specific reason in `status`.
  const codes = [detail?.code, detail?.status].filter((value): value is string => typeof value === 'string'), is = (...names: string[]) => names.some(name => codes.includes(name));
  if (is('bad_prompt', 'bad_composition_plan')) {
    const data = detail?.data as Record<string, unknown> | undefined, suggestion = typeof data?.prompt_suggestion === 'string' ? data.prompt_suggestion.trim().slice(0, 1000) : '';
    return new HttpError(422, `ElevenLabs declined this prompt. It may name an artist or song or quote copyrighted lyrics; describe the style instead.${suggestion ? ` Suggested prompt: ${suggestion}` : ''}`);
  }
  if (is('missing_permissions', 'insufficient_permissions')) return new HttpError(403, 'The ElevenLabs API key is missing a permission this feature needs. In ElevenLabs, edit the key to allow Text to Speech, Sound Effects, Music, Voices (read and write) and Voice Generation, then retry.');
  if (is('paid_plan_required', 'limited_access', 'subscription_required')) return new HttpError(402, 'Your ElevenLabs plan does not include this feature. For example, the Music API needs a paid plan. Upgrade the plan in ElevenLabs or choose another audio type.');
  if (is('quota_exceeded', 'insufficient_credits')) return new HttpError(402, 'Your ElevenLabs account does not have enough credits for this request.');
  if (response.status === 402) return new HttpError(402, 'ElevenLabs needs a plan upgrade or more credits for this request.');
  // 401 is reserved for the app password, so a rejected provider key is a gateway error.
  if (response.status === 401) return new HttpError(502, 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY and restart the server.');
  if (response.status === 403) return new HttpError(403, 'Your ElevenLabs plan or API key permissions do not include this feature.');
  if (is('voice_not_found')) return new HttpError(404, 'A character’s ElevenLabs voice no longer exists. Choose another voice under Characters.');
  if (response.status === 404) return new HttpError(404, 'ElevenLabs could not find the requested model or voice.');
  if (response.status === 409) return new HttpError(409, 'ElevenLabs is still working on a previous request. Try again shortly.');
  if (is('concurrent_limit_exceeded')) return new HttpError(429, 'Too many ElevenLabs requests are running. Wait for one to finish, then retry.');
  if (response.status === 429) return new HttpError(429, 'ElevenLabs rate limit reached. Try again later.');
  if (is('text_too_long')) return new HttpError(422, 'The text is too long for ElevenLabs. Shorten it or split it into separate clips.');
  if (response.status === 400 || response.status === 422) return new HttpError(422, 'ElevenLabs could not use these settings. Check the prompt and options, then retry.');
  return new HttpError(502, 'ElevenLabs is unavailable right now. Try again.');
}

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
function voiceSummary(value: unknown): ElevenLabsVoice | undefined {
  const voice = value as Record<string, unknown> | null, id = elevenLabsVoiceIdSchema.safeParse(voice?.voice_id);
  const name = text(voice?.name, 200); if (!id.success || !name) return;
  const labels = Object.fromEntries(Object.entries(voice?.labels && typeof voice.labels === 'object' ? voice.labels as Record<string, unknown> : {})
    .flatMap(([key, label]) => /^[a-z_]{1,40}$/.test(key) && text(label, 60) ? [[key, text(label, 60)!]] : []).slice(0, 8));
  const preview = text(voice?.preview_url, 2000), previewUrl = preview && URL.canParse(preview) && new URL(preview).protocol === 'https:' ? preview : undefined;
  return { id: id.data, name, labels, ...(text(voice?.category, 40) ? { category: text(voice?.category, 40) } : {}),
    ...(text(voice?.description, 500) ? { description: text(voice?.description, 500) } : {}), ...(previewUrl ? { previewUrl } : {}) };
}

export function createElevenLabsClient(key: string, fetcher: typeof fetch = fetch) {
  async function send(path: string, { method = 'GET', body, query, signal, timeout }: { method?: string; body?: unknown; query?: Record<string, string>; signal?: AbortSignal; timeout: number }) {
    const url = new URL(path, API_ROOT);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    const response = await fetcher(url, { method, headers: { 'xi-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), redirect: 'error' });
    if (!response.ok) throw await elevenLabsError(response);
    return response;
  }
  async function json(response: Response) {
    try { return await response.json() as Record<string, unknown>; } catch { throw new HttpError(502, 'ElevenLabs returned an unreadable response.'); }
  }
  return {
    /** Resolves with the audio stream once ElevenLabs starts sending it. */
    async generate(settings: AssetSettings, signal?: AbortSignal) {
      const { path, body } = elevenLabsRequest(settings);
      const response = await send(path, { method: 'POST', body, signal, timeout: 280_000 });
      if (!response.body) throw new HttpError(502, 'ElevenLabs returned no audio.');
      return response;
    },
    async voices({ search, pageToken }: { search?: string; pageToken?: string }, signal?: AbortSignal) {
      const result = await json(await send('v2/voices', { signal, timeout: 20_000, query: { page_size: '30', include_total_count: 'false',
        ...(search ? { search } : {}), ...(pageToken ? { next_page_token: pageToken } : {}) } }));
      const voices = (Array.isArray(result.voices) ? result.voices : []).flatMap(voice => voiceSummary(voice) ?? []);
      const next = result.has_more ? text(result.next_page_token, 500) : undefined;
      return { voices, ...(next ? { nextPageToken: next } : {}) };
    },
    async designVoice(description: string, signal?: AbortSignal) {
      const result = await json(await send('v1/text-to-voice/design', { method: 'POST', signal, timeout: 120_000,
        body: { voice_description: description, model_id: VOICE_DESIGN_MODEL, auto_generate_text: true } }));
      const previews: VoicePreview[] = (Array.isArray(result.previews) ? result.previews : []).flatMap(value => {
        const preview = value as Record<string, unknown>, id = typeof preview?.generated_voice_id === 'string' && generatedVoiceIdPattern.test(preview.generated_voice_id) ? preview.generated_voice_id : undefined;
        const audio = typeof preview?.audio_base_64 === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(preview.audio_base_64) ? preview.audio_base_64 : undefined;
        const mime = typeof preview?.media_type === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(preview.media_type) ? preview.media_type : 'audio/mpeg';
        return id && audio ? [{ generatedVoiceId: id, audio: `data:${mime};base64,${audio}`, ...(typeof preview.duration_secs === 'number' ? { duration: preview.duration_secs } : {}) }] : [];
      }).slice(0, 5);
      if (!previews.length) throw new HttpError(502, 'ElevenLabs returned no voice previews. Try a more detailed description.');
      return { previews, ...(text(result.text, 1000) ? { text: text(result.text, 1000) } : {}) };
    },
    async createVoice({ name, description, generatedVoiceId }: { name: string; description: string; generatedVoiceId: string }, signal?: AbortSignal) {
      const result = await json(await send('v1/text-to-voice', { method: 'POST', signal, timeout: 60_000,
        body: { voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId } }));
      const id = elevenLabsVoiceIdSchema.safeParse(result.voice_id);
      if (!id.success) throw new HttpError(502, 'ElevenLabs did not return the new voice.');
      return { id: id.data, name: text(result.name, 200) ?? name };
    },
  };
}
export type ElevenLabsClient = ReturnType<typeof createElevenLabsClient>;
