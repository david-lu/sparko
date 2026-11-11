import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ASSET_MODELS, newAssetGeneration, type AssetSettings } from '../../shared/asset-generation';
import { AUDIO_PROMPT_GUIDES, VOICE_DESIGN_GUIDE } from '../../shared/audio-prompt-guides';
import { createProviders } from '../../server/providers';
import { addAudioPromptEnhancementRoutes } from '../../server/features/asset-generation/audio-prompt-enhancement';
import { errorHandler, protectRequests } from '../../server/shared/http';

const respond = vi.hoisted(() => vi.fn());
vi.mock('openai', async original => ({ ...await original<typeof import('openai')>(), default: class { responses = { create: respond }; } }));
const characters = [{ name: 'Mara', voiceDescription: 'Low, husky and wry; never shouts.', voiceName: 'Mara (designed)' }, { name: 'Grom', voiceDescription: 'A huge cave troll with a booming, gravelly voice.' }];
const input = (model: string, patch: Partial<AssetSettings> = {}) => ({ settings: { ...newAssetGeneration('audio').settings, model, prompt: 'Did you hear that?', ...patch }, signal: new AbortController().signal });
const enhance = () => createProviders({ OPENAI_API_KEY: 'test' }).enhanceAudioPrompt;
const sent = () => { const args = respond.mock.calls.at(-1)![0]; return { args, data: JSON.parse(args.input[0].content[0].text) }; };
beforeEach(() => { vi.resetAllMocks(); respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: '[whispers] Did you hear that?' }) }); });

describe('ElevenLabs audio prompt enhancement', () => {
  it.each(ASSET_MODELS.filter(m => m.kind === 'audio'))('uses ElevenLabs’ guide for $name', async model => {
    const result = await enhance()(input(model.id));
    expect(result).toMatchObject({ model: model.id, guideUrl: AUDIO_PROMPT_GUIDES[model.id].url });
    const { args } = sent();
    expect(args.instructions).toContain(AUDIO_PROMPT_GUIDES[model.id].rules);
    expect(args.instructions).toContain(model.name); expect(args.store).toBe(false);
    expect(AUDIO_PROMPT_GUIDES[model.id].url).toMatch(/^https:\/\/elevenlabs\.io\/docs\//);
  });
  it('writes one speaker’s words with tags that suit their voice, keeping names they say', async () => {
    await enhance()({ ...input('elevenlabs-dialogue', { languageCode: 'es' }), characters: characters.slice(0, 1) });
    const { args, data } = sent();
    expect(data).toMatchObject({ draft: 'Did you hear that?', context: { kind: 'audio', audioType: 'dialogue', speaker: characters[0], language: 'es' } });
    expect(data.context).not.toHaveProperty('characters'); expect(data.context).not.toHaveProperty('durationSeconds');
    expect(args.instructions).toContain('Return only the words one speaker says');
    expect(args.instructions).toContain('keep every word and their order');
    expect(args.instructions).toContain('Choose audio tags that suit their voice');
    expect(args.instructions).toContain('Keep every name spoken in the lines exactly as written');
    expect(args.instructions).not.toContain('instead of by name');
    expect(args.instructions).toContain('Write the spoken text in Spanish.');
    expect(args.text.format.schema.properties.prompt.maxLength).toBe(2600);
  });
  it('passes music and sound effect settings that change the prompt', async () => {
    await enhance()({ ...input('elevenlabs-music', { prompt: 'Battle theme for Grom', instrumental: true, autoDuration: false, duration: 90 }), characters });
    let { args, data } = sent();
    expect(data.context).toMatchObject({ audioType: 'music', instrumental: true, durationSeconds: 90, characters });
    expect(args.instructions).toContain('include "instrumental only"');
    expect(args.instructions).toContain('describe the vocal from their voiceDescription');
    expect(args.instructions).toContain('instead of by name');
    await enhance()({ ...input('elevenlabs-sound-effects', { prompt: 'Grom laughs in the cave', loop: true }), characters });
    ({ args, data } = sent());
    expect(data.context).toMatchObject({ audioType: 'sound-effects', loop: true, duration: 'auto' });
    expect(args.instructions).toContain('continuous, seamless bed');
    expect(args.instructions).toContain('Describe the sounds a character makes from these descriptions');
    expect(args.instructions).toContain('Keep a name only for a widely known existing character');
    expect(args.text.format.schema.properties.prompt.maxLength).toBe(450);
  });
  it('applies format rules, the cast and project instructions to targeted edits', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'Grom laughs.', enhancedPrompt: 'A booming, gravelly laugh echoes in a cave.' }) });
    const result = await enhance()({ ...input('elevenlabs-sound-effects', { prompt: 'Grom roars', enhancedPrompt: 'A booming, gravelly roar.' }), characters, editInstructions: 'Make it a laugh', projectInstructions: 'Keep it short.' });
    expect(result).toMatchObject({ prompt: 'Grom laughs.', enhancedPrompt: 'A booming, gravelly laugh echoes in a cave.' });
    const { args, data } = sent();
    expect(args.instructions).toContain('This is a targeted edit');
    expect(args.instructions).toContain('apply this naming rule to enhancedPrompt only and keep the names the user wrote in the original prompt');
    expect(args.instructions).toContain("context.projectInstructions holds the user's standing instructions");
    expect(data).toMatchObject({ editInstructions: 'Make it a laugh', context: { characters, projectInstructions: 'Keep it short.' } });
  });
  it('omits cast guidance without characters and rejects image models or empty drafts', async () => {
    await enhance()(input('elevenlabs-sound-effects', { prompt: 'Thunder' }));
    expect(sent().args.instructions).not.toContain('context.characters lists');
    expect(sent().args.instructions).not.toContain('instead of by name');
    respond.mockClear();
    await expect(enhance()(input('nano-banana-2'))).rejects.toThrow();
    await expect(enhance()(input('elevenlabs-music', { prompt: ' ' }))).rejects.toThrow();
    expect(respond).not.toHaveBeenCalled();
  });
  it('rewrites voice descriptions with ElevenLabs’ voice design guide', async () => {
    respond.mockResolvedValue({ status: 'completed', output_text: JSON.stringify({ prompt: 'Native English, London. Female, early 30s. Perfect audio quality.' }) });
    const result = await createProviders({ OPENAI_API_KEY: 'test' }).enhanceVoiceDescription({ name: 'Mara', voiceDescription: 'husky londoner', projectInstructions: 'Dialogue is in English.', signal: new AbortController().signal });
    expect(result).toEqual({ voiceDescription: 'Native English, London. Female, early 30s. Perfect audio quality.', guideUrl: VOICE_DESIGN_GUIDE.url });
    const { args, data } = sent();
    expect(args.instructions).toContain(VOICE_DESIGN_GUIDE.rules);
    expect(args.instructions).toContain('Preserve every trait the draft states');
    expect(data).toEqual({ draft: 'husky londoner', context: { character: 'Mara', projectInstructions: 'Dialogue is in English.' } });
    expect(args.text.format.schema.properties.prompt.maxLength).toBe(1000);
  });
  it('protects the routes and requires OpenAI', async () => {
    const server = (key?: string) => { const app = express(); app.use(protectRequests, express.json()); addAudioPromptEnhancementRoutes(app, createProviders(key ? { OPENAI_API_KEY: key } : {})); app.use(errorHandler); return app; };
    await request(server()).post('/api/audio-prompts/enhance').set('x-sparko-request', '1').send(input('elevenlabs-music')).expect(503);
    await request(server('test')).post('/api/audio-prompts/enhance').send(input('elevenlabs-music')).expect(403);
    const response = await request(server('test')).post('/api/audio-prompts/enhance').set('x-sparko-request', '1').send({ ...input('elevenlabs-dialogue'), characters }).expect(200);
    expect(response.body).toMatchObject({ prompt: '[whispers] Did you hear that?', model: 'elevenlabs-dialogue' });
    await request(server('test')).post('/api/audio-prompts/voice-description').set('x-sparko-request', '1').send({ name: 'Mara', voiceDescription: '' }).expect(400);
  });
});
