import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ASSET_MODELS, audioModelSettings, interruptedGeneration, newAssetGeneration, validateAssetSettings, type AssetSettings } from '../../shared/asset-generation';
import { castDialogueVoices, dialogueInputs, parseDialogueScript } from '../../shared/dialogue-script';
import { projectCharactersSchema, type ProjectCharacter } from '../../shared/characters';
import { createElevenLabsClient, elevenLabsError, elevenLabsRequest } from '../../server/features/asset-generation/elevenlabs';
import { addElevenLabsRoutes } from '../../server/features/asset-generation/elevenlabs-routes';
import { errorHandler, protectRequests } from '../../server/shared/http';

const mara: ProjectCharacter = { id: crypto.randomUUID(), name: 'Mara', voiceDescription: 'Low, husky and wry.', voice: { id: 'VoiceMara0001', name: 'Mara (designed)' } };
const theo: ProjectCharacter = { id: crypto.randomUUID(), name: 'Theo', voice: { id: 'VoiceTheo0001', name: 'Theo' } };
const audio = (model: string, patch: Partial<AssetSettings> = {}): AssetSettings => ({ ...newAssetGeneration('audio').settings, model, ...patch });
const script = 'Mara: [whispers] Did you hear that?\nTheo: It’s just the wind…\nright?';

describe('dialogue scripts', () => {
  it('parses one turn per line, joins continuation lines and keeps colons in the spoken text', () => {
    expect(parseDialogueScript(`${script}\n\nmara: It's 10:30 already.`)).toEqual({ turns: [
      { speaker: 'Mara', text: '[whispers] Did you hear that?' }, { speaker: 'Theo', text: 'It’s just the wind… right?' }, { speaker: 'mara', text: "It's 10:30 already." },
    ] });
    expect(parseDialogueScript('[whispers] Hello there').error).toContain('Start each line with a speaker name');
    expect(parseDialogueScript('  \n').error).toContain('Write at least one line');
    expect(parseDialogueScript('Mara:').error).toBe('Add a line for Mara or remove the empty turn.');
  });
  it('resolves speakers to character voices case-insensitively and explains missing characters or voices', () => {
    expect(castDialogueVoices(`${script}\nMARA: Again.`, [mara, theo])).toEqual({ voices: [
      { speaker: 'Mara', voiceId: 'VoiceMara0001', voiceName: 'Mara (designed)' }, { speaker: 'Theo', voiceId: 'VoiceTheo0001', voiceName: 'Theo' },
    ] });
    expect(castDialogueVoices('Iris: Hi.', [mara]).error).toContain('No character is named “Iris”');
    expect(castDialogueVoices('Theo: Hi.', [{ ...theo, voice: undefined }]).error).toContain('Theo has no voice yet');
    const { voices } = castDialogueVoices(script, [mara, theo]);
    expect(dialogueInputs(script, voices).inputs).toEqual([{ text: '[whispers] Did you hear that?', voice_id: 'VoiceMara0001' }, { text: 'It’s just the wind… right?', voice_id: 'VoiceTheo0001' }]);
    expect(dialogueInputs(script, voices?.slice(0, 1)).error).toBe('Choose a voice for Theo.');
  });
  it('keeps character names usable as script speakers and unique', () => {
    expect(projectCharactersSchema.safeParse([{ ...mara, name: 'Dr: Who' }]).success).toBe(false);
    expect(projectCharactersSchema.safeParse([mara, { ...theo, name: ' mara ' }]).success).toBe(false);
    expect(projectCharactersSchema.safeParse([mara, theo]).success).toBe(true);
  });
});

describe('ElevenLabs requests', () => {
  it('builds dialogue requests with the submitted voices and delivery settings', () => {
    const { voices } = castDialogueVoices(script, [mara, theo]);
    expect(elevenLabsRequest(audio('elevenlabs-dialogue', { prompt: script, dialogueVoices: voices, stability: 0, languageCode: 'en', seed: 42 }))).toEqual({ path: 'v1/text-to-dialogue', body: {
      inputs: [{ text: '[whispers] Did you hear that?', voice_id: 'VoiceMara0001' }, { text: 'It’s just the wind… right?', voice_id: 'VoiceTheo0001' }],
      model_id: 'eleven_v4', settings: { stability: 0 }, language_code: 'en', seed: 42 } });
    expect(() => elevenLabsRequest(audio('elevenlabs-dialogue', { prompt: script }))).toThrow('Choose a voice for Mara.');
  });
  it('builds music and sound effect requests, omitting fixed lengths in Auto mode', () => {
    expect(elevenLabsRequest(audio('elevenlabs-music', { prompt: 'Lo-fi, 80 BPM', autoDuration: false, duration: 45, instrumental: true }))).toEqual({ path: 'v1/music',
      body: { prompt: 'Lo-fi, 80 BPM', model_id: 'music_v2_5', force_instrumental: true, music_length_ms: 45000 } });
    expect(elevenLabsRequest(audio('elevenlabs-music', { prompt: 'Lo-fi', autoDuration: true })).body).not.toHaveProperty('music_length_ms');
    expect(elevenLabsRequest(audio('elevenlabs-sound-effects', { prompt: 'Rain', autoDuration: false, duration: 12.5, promptInfluence: .7, loop: true }))).toEqual({ path: 'v1/sound-generation',
      body: { text: 'Rain', model_id: 'eleven_text_to_sound_v3', duration_seconds: 12.5, prompt_influence: .7, loop: true } });
    expect(elevenLabsRequest(audio('elevenlabs-sound-effects', { prompt: 'Rain' })).body).toMatchObject({ duration_seconds: null, prompt_influence: .3, loop: false });
  });
  it('validates each audio type’s documented limits and the selected prompt version', () => {
    expect(validateAssetSettings(audio('elevenlabs-music', { prompt: 'Jazz', autoDuration: false, duration: 2 }))).toContain('from 3 to 300 seconds');
    expect(validateAssetSettings(audio('elevenlabs-music', { prompt: 'Jazz', autoDuration: true, duration: 2 }))).toBeUndefined();
    expect(validateAssetSettings(audio('elevenlabs-sound-effects', { prompt: 'Boom', autoDuration: false, duration: 31 }))).toContain('from 0.5 to 30 seconds');
    expect(validateAssetSettings(audio('elevenlabs-sound-effects', { prompt: 'x'.repeat(451) }))).toContain('up to 450 characters');
    expect(validateAssetSettings(audio('elevenlabs-dialogue', { prompt: Array.from({ length: 11 }, (_, i) => `Speaker ${i}: Hi.`).join('\n') }))).toContain('up to 10 different voices');
    expect(validateAssetSettings(audio('elevenlabs-dialogue', { prompt: `Mara: ${'a'.repeat(2001)}` }))).toContain('2,000 characters');
    expect(validateAssetSettings(audio('elevenlabs-dialogue', { prompt: 'No speaker', enhancedPrompt: 'Mara: Hello.', useEnhancedPrompt: true }))).toBeUndefined();
  });
  it('clamps durations when switching audio models and settles interrupted direct requests', () => {
    expect(audioModelSettings(audio('elevenlabs-music', { duration: 120 }), 'elevenlabs-sound-effects')).toMatchObject({ model: 'elevenlabs-sound-effects', duration: 30 });
    expect(audioModelSettings(audio('elevenlabs-sound-effects', { duration: 1 }), 'elevenlabs-music').duration).toBe(3);
    expect(newAssetGeneration('audio').settings).toMatchObject({ model: 'elevenlabs-dialogue', autoDuration: true, stability: .5 });
    expect(ASSET_MODELS.filter(m => m.kind === 'audio').map(m => m.audioType)).toEqual(['dialogue', 'music', 'sound-effects']);
    expect(interruptedGeneration({ phase: 'rendering' })).toBe(true);
    expect(interruptedGeneration({ phase: 'rendering', requestId: 'request_123' })).toBe(false);
    expect(interruptedGeneration({ phase: 'ready' })).toBe(false);
  });
});

describe('ElevenLabs errors and client', () => {
  it('maps provider failures to fixed messages without forwarding diagnostics', async () => {
    const error = (status: number, detail: unknown) => elevenLabsError(Response.json({ detail }, { status }));
    const prompt = await error(400, { code: 'bad_prompt', message: 'secret details', data: { prompt_suggestion: 'Upbeat 90s Britpop with jangly guitars' } });
    expect(prompt).toMatchObject({ status: 422, message: expect.stringContaining('Suggested prompt: Upbeat 90s Britpop with jangly guitars') });
    expect(prompt.message).not.toContain('secret');
    expect(await error(401, { status: 'invalid_api_key', message: 'key sk_live' })).toMatchObject({ status: 502, message: expect.stringContaining('ELEVENLABS_API_KEY') });
    expect(await error(401, { status: 'quota_exceeded' })).toMatchObject({ status: 402, message: expect.stringContaining('enough credits') });
    expect(await error(402, { status: 'limited_access', code: 'paid_plan_required', message: 'Music API is not available for free users.' })).toMatchObject({ status: 402, message: expect.stringContaining('Music API needs a paid plan') });
    expect(await error(401, { status: 'missing_permissions', code: 'unauthorized', type: 'authentication_error' })).toMatchObject({ status: 403, message: expect.stringContaining('Voices (read and write)') });
    expect((await error(404, { code: 'voice_not_found' })).message).toContain('Choose another voice');
    expect((await error(429, { code: 'concurrent_limit_exceeded' })).message).toContain('Too many ElevenLabs requests');
    expect(await error(422, [{ loc: ['body', 'text'], msg: 'my private prompt', type: 'value_error' }])).toMatchObject({ status: 422, message: expect.not.stringContaining('private') });
    expect((await elevenLabsError(new Response('<html>oops</html>', { status: 500 }))).status).toBe(502);
  });
  it('authenticates with the server key, filters voice data and returns designed previews as data URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/v2/voices') return Response.json({ has_more: true, next_page_token: 'page2', voices: [
        { voice_id: 'VoiceTheo0001', name: 'Theo', category: 'premade', labels: { accent: 'british', age: 'middle_aged', gender: 'male', 'bad key': 'x' }, preview_url: 'https://storage.example/theo.mp3' },
        { voice_id: 'bad id!', name: 'Broken' }, { voice_id: 'VoiceIris0001', name: 'Iris', preview_url: 'http://insecure.example/iris.mp3' },
      ] });
      if (path === '/v1/text-to-voice/design') return Response.json({ text: 'Sample', previews: [{ generated_voice_id: 'gen_abc12345', audio_base_64: 'YXVkaW8=', media_type: 'audio/mpeg', duration_secs: 4.2 }, { generated_voice_id: 'x', audio_base_64: 'YQ==' }] });
      if (path === '/v1/text-to-voice') return Response.json({ voice_id: 'VoiceNew00001', name: 'Mara' });
      return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } });
    });
    const client = createElevenLabsClient('xi-test-key', fetcher);
    expect(await client.voices({ search: 'theo' })).toEqual({ nextPageToken: 'page2', voices: [
      { id: 'VoiceTheo0001', name: 'Theo', category: 'premade', labels: { accent: 'british', age: 'middle_aged', gender: 'male' }, previewUrl: 'https://storage.example/theo.mp3' },
      { id: 'VoiceIris0001', name: 'Iris', labels: {} },
    ] });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://api.elevenlabs.io/v2/voices?page_size=30&include_total_count=false&search=theo');
    expect(init).toMatchObject({ headers: { 'xi-api-key': 'xi-test-key' }, redirect: 'error' });
    expect(await client.designVoice('A warm, low voice with a London accent.')).toEqual({ text: 'Sample', previews: [{ generatedVoiceId: 'gen_abc12345', audio: 'data:audio/mpeg;base64,YXVkaW8=', duration: 4.2 }] });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ voice_description: 'A warm, low voice with a London accent.', model_id: 'eleven_ttv_v3', auto_generate_text: true });
    expect(await client.createVoice({ name: 'Mara', description: 'A warm, low voice with a London accent.', generatedVoiceId: 'gen_abc12345' })).toEqual({ id: 'VoiceNew00001', name: 'Mara' });
    const response = await client.generate(audio('elevenlabs-sound-effects', { prompt: 'Rain' }));
    expect(await response.text()).toBe('audio');
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe('https://api.elevenlabs.io/v1/sound-generation');
  });
});

describe('ElevenLabs routes', () => {
  const app = (client?: ReturnType<typeof createElevenLabsClient>) => { const server = express(); server.use(protectRequests, express.json()); addElevenLabsRoutes(server, client); server.use(errorHandler); return server; };
  it('requires the key and the app request header, then streams generated audio', async () => {
    await request(app()).get('/api/elevenlabs/voices').expect(503, { error: 'ELEVENLABS_API_KEY is missing. Add it to .env and restart the server.' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('mp3-bytes', { headers: { 'content-type': 'audio/mpeg' } }));
    const server = app(createElevenLabsClient('key', fetcher)), settings = audio('elevenlabs-music', { prompt: 'Ambient pads' });
    await request(server).post('/api/elevenlabs/audio').send({ settings }).expect(403);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await request(server).post('/api/elevenlabs/audio').set('x-sparko-request', '1').send({ settings }).expect(200).expect('Content-Type', /audio\/mpeg/);
    expect(response.body.toString()).toBe('mp3-bytes');
    await request(server).post('/api/elevenlabs/audio').set('x-sparko-request', '1').send({ settings: { ...settings, model: 'nano-banana-2' } }).expect(400);
    await request(server).post('/api/elevenlabs/audio').set('x-sparko-request', '1').send({ settings: { ...settings, model: 'elevenlabs-dialogue', prompt: 'Mara: Hi.' } }).expect(400);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('returns sanitized provider errors and validates voice design input', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: { code: 'invalid_api_key', message: 'sk_secret' } }, { status: 401 }));
    const server = app(createElevenLabsClient('key', fetcher));
    const failed = await request(server).post('/api/elevenlabs/audio').set('x-sparko-request', '1').send({ settings: audio('elevenlabs-sound-effects', { prompt: 'Rain' }) }).expect(502);
    expect(JSON.stringify(failed.body)).not.toContain('sk_secret');
    await request(server).post('/api/elevenlabs/voices/design').set('x-sparko-request', '1').send({ description: 'Too short' }).expect(400);
    await request(server).post('/api/elevenlabs/voices').set('x-sparko-request', '1').send({ name: 'Bad: name', description: 'A warm, low voice with a London accent.', generatedVoiceId: 'gen_abc12345' }).expect(400);
    await request(server).get('/api/elevenlabs/voices?page=bad%20token').expect(400);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
