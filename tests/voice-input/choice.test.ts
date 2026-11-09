import { describe, expect, it, vi } from 'vitest';
import { VOICE_CHOICE } from '../../shared/constants';
import { choiceCriteria, choiceRequest, createVoiceChoiceProvider, padWav, UNCLEAR_OPTION } from '../../server/features/voice-input/choice';
import { wavFixture } from '../fixtures/audio';

const context = { question: 'Which door should we open?', options: [
  { id: 'edge-red', label: 'Red door', values: ['red', ' the red one '] },
  { id: 'edge-blue', label: 'Blue door', values: [] },
] };
const reply = (choice: string, probabilities: Record<string, number>, status = 200) => vi.fn<typeof fetch>(async () => new Response(
  JSON.stringify({ run_id: 'run', answers: { answer: { type: 'choice', choice, confidence: 0.5, probabilities } }, received: { input_tokens: 200 } }),
  { status, headers: { 'content-type': 'application/json' } }));
const input = (audio: Uint8Array = wavFixture(0.4)) => ({ audio, context, signal: new AbortController().signal });

describe('Hume voice choice request', () => {
  it('names options by condition label, describes alternatives and adds an unclear option', () => {
    expect(choiceCriteria(context)).toEqual([
      { id: 'edge-red', name: 'Red door', description: 'Also: red, the red one' },
      { id: 'edge-blue', name: 'Blue door' },
      { id: null, name: UNCLEAR_OPTION, description: expect.any(String) },
    ]);
  });
  it('keeps option names unique and within Hume limits', () => {
    const long = 'A very long condition label that keeps going well past fifty characters';
    const criteria = choiceCriteria({ options: [
      { id: 'a', label: long, values: [] }, { id: 'b', label: long, values: ['x'.repeat(200)] },
      { id: 'c', label: '  ', values: [] }, { id: 'd', label: 'no clear answer', values: [] },
    ] });
    const names = criteria.map(c => c.name);
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
    expect(names.every(n => n.length >= 1 && n.length <= 50)).toBe(true);
    expect(criteria.every(c => !c.description || c.description.length <= 100)).toBe(true);
    // A truncated label keeps its full text in the description.
    expect(criteria[0].description).toBe(long);
    expect(names[2]).toBe('Option 3');
  });
  it('asks about the question within the instruction limit', () => {
    const request = choiceRequest(context);
    expect(request.questions.answer.instructions).toContain('Which door should we open?');
    expect(request.questions.answer.criteria.map(c => c.name)).toEqual(['Red door', 'Blue door', UNCLEAR_OPTION]);
    expect(choiceRequest({ ...context, question: 'q'.repeat(2000) }).questions.answer.instructions.length).toBeLessThanOrEqual(500);
  });
});

describe('WAV padding', () => {
  it('pads short PCM recordings with trailing silence and keeps longer ones whole', () => {
    const short = wavFixture(0.4), padded = padWav(short, VOICE_CHOICE.minSeconds), view = Buffer.from(padded);
    expect(view.readUInt32LE(40)).toBe(VOICE_CHOICE.minSeconds * 16000 * 2);
    expect(view.readUInt32LE(4)).toBe(padded.byteLength - 8);
    expect(view.subarray(44, 44 + short.length - 44)).toEqual(short.subarray(44));
    expect(view.subarray(short.length).every(byte => byte === 0)).toBe(true);
    const long = wavFixture(2);
    expect(Buffer.from(padWav(long, VOICE_CHOICE.minSeconds))).toEqual(long);
  });
  it('rejects audio that is not PCM WAV', () => {
    expect(() => padWav(new Uint8Array([1, 2, 3]), 1)).toThrow(/WAV/);
    const compressed = wavFixture(1); compressed.writeUInt16LE(2, 20);
    expect(() => padWav(compressed, 1)).toThrow(/PCM/);
  });
});

describe('Hume voice choice provider', () => {
  it('posts the padded WAV with the API key and maps the chosen option back to its answer ID', async () => {
    const fetcher = reply('Blue door', { 'Red door': 0.05, 'Blue door': 0.9, [UNCLEAR_OPTION]: 0.05 });
    expect(await createVoiceChoiceProvider('key', fetcher)(input())).toEqual({ answerId: 'edge-blue', probability: 0.9, model: 'hume-audio-decisions' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(VOICE_CHOICE.endpoint);
    expect(init?.headers).toEqual({ 'X-Hume-Api-Key': 'key' });
    const body = init?.body as FormData, file = body.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(44 + VOICE_CHOICE.minSeconds * 16000 * 2);
    expect(JSON.parse(await (body.get('request') as File).text())).toEqual(choiceRequest(context));
  });
  it('returns no answer for an unclear reply or a weak match', async () => {
    const unclear = reply(UNCLEAR_OPTION, { 'Red door': 0.1, 'Blue door': 0.1, [UNCLEAR_OPTION]: 0.8 });
    expect((await createVoiceChoiceProvider('key', unclear)(input())).answerId).toBeNull();
    const weak = reply('Red door', { 'Red door': VOICE_CHOICE.minProbability - 0.01, 'Blue door': 0.33, [UNCLEAR_OPTION]: 0.28 });
    expect((await createVoiceChoiceProvider('key', weak)(input())).answerId).toBeNull();
  });
  it('reports missing keys, Hume failures and unexpected replies without forwarding Hume\'s body', async () => {
    await expect(createVoiceChoiceProvider(undefined, reply('Red door', {}))(input())).rejects.toMatchObject({ status: 503 });
    for (const [status, expected] of [[401, 502], [402, 502], [429, 429], [503, 429], [400, 422], [500, 502]]) {
      const failing = vi.fn<typeof fetch>(async () => new Response('{"message":"secret detail"}', { status }));
      const error = await createVoiceChoiceProvider('key', failing)(input()).catch(e => e);
      expect(error.status).toBe(expected); expect(error.message).not.toContain('secret');
    }
    const odd = vi.fn<typeof fetch>(async () => new Response('{"answers":{}}'));
    await expect(createVoiceChoiceProvider('key', odd)(input())).rejects.toMatchObject({ status: 502 });
  });
});
