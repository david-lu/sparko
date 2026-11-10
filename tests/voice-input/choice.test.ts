import { describe, expect, it, vi } from 'vitest';
import { VOICE_CHOICE } from '../../shared/constants';
import { createVoiceChoiceProvider, decisionRequest, padWav } from '../../server/features/voice-input/choice';
import { wavFixture } from '../fixtures/audio';

const context = { question: 'What do trees give us?', conditions: [
  { id: 'edge-air', description: ' The viewer says something similar to "trees breathe air" ' },
  { id: 'edge-excited', description: 'The viewer sounds excited' },
] };
const reply = (scores: Record<string, number>, status = 200) => vi.fn<typeof fetch>(async () => new Response(
  JSON.stringify({ run_id: 'run', answers: Object.fromEntries(Object.entries(scores).map(([id, noul]) => [id, { type: 'noul', noul }])), received: { input_tokens: 200 } }),
  { status, headers: { 'content-type': 'application/json' } }));
const input = (audio: Uint8Array = wavFixture(0.4)) => ({ audio, context, signal: new AbortController().signal });

describe('Hume voice decision request', () => {
  it('asks one yes/no question per described condition, with the scene question as context', () => {
    const request = decisionRequest(context);
    expect(Object.keys(request.questions)).toEqual(['condition-0', 'condition-1']);
    expect(request.questions['condition-0']).toMatchObject({ type: 'noul', criteria: { true: expect.any(String), false: expect.any(String) } });
    expect(request.questions['condition-0'].instructions).toMatch(/Condition: The viewer says something similar to "trees breathe air"$/);
    expect(request.context).toContain('The child was asked: "What do trees give us?"');
    expect(decisionRequest({ conditions: context.conditions }).context).not.toContain('asked');
  });
  it('keeps every field within Hume limits', () => {
    const request = decisionRequest({ question: 'q'.repeat(2000), conditions: [{ id: 'a', description: 'd'.repeat(600) }] });
    expect(request.questions['condition-0'].instructions.length).toBeLessThanOrEqual(500);
    expect(request.context.length).toBeLessThanOrEqual(1000);
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
  it('posts the padded WAV with the API key and picks the strongest yes', async () => {
    const fetcher = reply({ 'condition-0': 0.65, 'condition-1': 0.55 });
    expect(await createVoiceChoiceProvider('key', fetcher)(input())).toEqual({ answerId: 'edge-air', probability: 0.65, model: 'hume-audio-decisions' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(VOICE_CHOICE.endpoint);
    expect(init?.headers).toEqual({ 'X-Hume-Api-Key': 'key' });
    const body = init?.body as FormData, file = body.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(44 + VOICE_CHOICE.minSeconds * 16000 * 2);
    expect(JSON.parse(await (body.get('request') as File).text())).toEqual(decisionRequest(context));
    expect((await createVoiceChoiceProvider('key', reply({ 'condition-0': 0.2, 'condition-1': 0.87 }))(input())).answerId).toBe('edge-excited');
  });
  it('returns no answer, so the default plays, when no condition reaches a yes', async () => {
    const result = await createVoiceChoiceProvider('key', reply({ 'condition-0': VOICE_CHOICE.minProbability - 0.01, 'condition-1': 0.1 }))(input());
    expect(result).toMatchObject({ answerId: null, probability: VOICE_CHOICE.minProbability - 0.01 });
  });
  it('reports missing keys, Hume failures and unexpected replies without forwarding Hume\'s body', async () => {
    await expect(createVoiceChoiceProvider(undefined, reply({}))(input())).rejects.toMatchObject({ status: 503 });
    await expect(createVoiceChoiceProvider('key', reply({}))({ ...input(), context: { conditions: [] } })).rejects.toMatchObject({ status: 400 });
    for (const [status, expected] of [[401, 502], [402, 502], [429, 429], [503, 429], [400, 422], [500, 502]]) {
      const failing = vi.fn<typeof fetch>(async () => new Response('{"message":"secret detail"}', { status }));
      const error = await createVoiceChoiceProvider('key', failing)(input()).catch(e => e);
      expect(error.status).toBe(expected); expect(error.message).not.toContain('secret');
    }
    // A reply missing any condition's score is rejected rather than read as "no".
    await expect(createVoiceChoiceProvider('key', reply({ 'condition-0': 0.9 }))(input())).rejects.toMatchObject({ status: 502 });
    await expect(createVoiceChoiceProvider('key', vi.fn<typeof fetch>(async () => new Response('not json')))(input())).rejects.toMatchObject({ status: 502 });
  });
});
