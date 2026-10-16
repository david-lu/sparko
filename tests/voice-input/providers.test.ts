import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MODELS } from '../../shared/constants';
import { createProviders } from '../../server/providers';
import type { VoiceInput } from '../../server/features/voice-input/provider';

const calls = vi.hoisted(() => ({ transcribe: vi.fn(), respond: vi.fn(), gemini: vi.fn() }));
vi.mock('openai', async importOriginal => ({
  ...await importOriginal<typeof import('openai')>(),
  default: class {
    audio = { transcriptions: { create: calls.transcribe } };
    responses = { create: calls.respond };
  },
}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: calls.gemini }; } }));
const input: VoiceInput = {
  audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav',
  context: { sourceId: 'episode', videoTime: 12, sceneId: 'scene-1', question: 'What happened?' }, signal: new AbortController().signal,
};
beforeEach(() => vi.resetAllMocks());
describe('voice provider adapters', () => {
  it('transcribes recorded speech then passes the answer and question to OpenAI', async () => {
    calls.transcribe.mockResolvedValue({ text: 'She opened the door.' });
    calls.respond.mockResolvedValue({ output_text: 'Answer received.', status: 'completed' });
    const providers = createProviders({ OPENAI_API_KEY: 'test-key' });
    const result = await providers.voice('openai', input);
    const file = calls.transcribe.mock.calls[0][0].file as File;
    expect(file.name).toBe('answer.wav'); expect(file.type).toBe('audio/wav');
    expect(calls.transcribe).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODELS.transcription }), { signal: input.signal });
    expect(calls.respond).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODELS.openai, store: false }), { signal: input.signal });
    expect(JSON.parse(calls.respond.mock.calls[0][0].input[0].content[0].text)).toEqual({ context: input.context, spokenAnswer: 'She opened the door.' });
    expect(result).toMatchObject({ transcript: 'She opened the door.', response: 'Answer received.', context: input.context, provider: 'openai' });
  });
  it('does not generate an answer when OpenAI detects no speech', async () => {
    calls.transcribe.mockResolvedValue({ text: '  ' });
    const result = await createProviders({ OPENAI_API_KEY: 'test-key' }).voice('openai', input);
    expect(result.transcript).toBe(''); expect(calls.respond).not.toHaveBeenCalled();
  });
  it('passes audio directly to Gemini with structured output and cancellation', async () => {
    calls.gemini.mockResolvedValue({ text: JSON.stringify({ transcript: 'She opened the door.', response: 'Answer received.' }) });
    const result = await createProviders({ GEMINI_KEY: 'test-key' }).voice('gemini', input);
    const options = calls.gemini.mock.calls[0][0];
    expect(options.model).toBe(AI_MODELS.gemini);
    expect(options.contents[0].parts[0]).toEqual({ inlineData: { data: 'AQID', mimeType: 'audio/wav' } });
    expect(options.contents[0].parts[1].text).toContain('What happened?');
    expect(options.config.abortSignal).toBe(input.signal);
    expect(result).toMatchObject({ provider: 'gemini', context: input.context, transcript: 'She opened the door.' });
  });
});
