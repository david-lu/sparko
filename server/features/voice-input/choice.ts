import { z } from 'zod';
import type { VoiceChoice, VoiceChoiceContext } from '../../../shared/contracts.js';
import { VOICE_CHOICE } from '../../../shared/constants.js';
import { HttpError } from '../../shared/http.js';

export type VoiceChoiceInput = { audio: Uint8Array; context: VoiceChoiceContext; signal: AbortSignal };
export type VoiceChoiceProvider = (input: VoiceChoiceInput) => Promise<VoiceChoice>;

export const VOICE_CHOICE_MODEL = 'hume-audio-decisions';
const CONTEXT = 'A young child answers out loud while an interactive video waits for their answer. Sound from the video may be faintly audible; judge only the child.';
const ASK = 'Listen to the child\'s answer. Does this condition describe it? Condition: ';
// Explicit outcomes separated matching and unrelated answers best in testing against Hume.
const CRITERIA = {
  true: 'The condition describes the child\'s answer, allowing for a young child\'s wording and pronunciation.',
  false: 'The condition does not describe the answer, or the child is silent or unclear.',
};

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const questionId = (index: number) => `condition-${index}`;

/** One Hume yes/no (`noul`) question per condition, so each condition is decided from the audio independently. */
export function decisionRequest(context: VoiceChoiceContext) {
  const question = context.question?.trim();
  return {
    questions: Object.fromEntries(context.conditions.map((condition, index) => [questionId(index),
      { type: 'noul', instructions: ASK + clip(condition.description.trim(), 500 - ASK.length), criteria: CRITERIA }])),
    context: clip(question ? `${CONTEXT} The child was asked: "${question}"` : CONTEXT, 1000),
  };
}

/** Rewrites a PCM WAV with trailing silence so it meets a minimum duration. Throws for other formats. */
export function padWav(audio: Uint8Array, minSeconds: number): Uint8Array {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const tag = (offset: number) => String.fromCharCode(...audio.subarray(offset, offset + 4));
  if (audio.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new HttpError(400, 'Upload a WAV recording.');
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined, data: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= audio.byteLength;) {
    const size = view.getUint32(offset + 4, true), body = offset + 8;
    if (tag(offset) === 'fmt ' && size >= 16) format = { audioFormat: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    if (tag(offset) === 'data') { data = audio.subarray(body, Math.min(audio.byteLength, body + size)); break; }
    offset = body + size + (size % 2);
  }
  if (!format || !data || ![1, 3].includes(format.audioFormat) || !format.channels || !format.sampleRate || ![8, 16, 24, 32].includes(format.bits)) {
    throw new HttpError(400, 'Upload an uncompressed PCM WAV recording.');
  }
  const blockAlign = format.channels * format.bits / 8;
  const frames = Math.max(Math.floor(data.byteLength / blockAlign), Math.ceil(minSeconds * format.sampleRate));
  const output = new Uint8Array(44 + frames * blockAlign);
  // Unsigned 8-bit PCM is silent at 128; every other supported format is silent at zero.
  if (format.bits === 8 && format.audioFormat === 1) output.fill(128, 44);
  output.set(data.subarray(0, Math.floor(data.byteLength / blockAlign) * blockAlign), 44);
  const header = new DataView(output.buffer);
  [...'RIFF'].forEach((c, i) => header.setUint8(i, c.charCodeAt(0)));
  header.setUint32(4, output.byteLength - 8, true);
  [...'WAVEfmt '].forEach((c, i) => header.setUint8(8 + i, c.charCodeAt(0)));
  header.setUint32(16, 16, true); header.setUint16(20, format.audioFormat, true); header.setUint16(22, format.channels, true);
  header.setUint32(24, format.sampleRate, true); header.setUint32(28, format.sampleRate * blockAlign, true);
  header.setUint16(32, blockAlign, true); header.setUint16(34, format.bits, true);
  [...'data'].forEach((c, i) => header.setUint8(36 + i, c.charCodeAt(0)));
  header.setUint32(40, frames * blockAlign, true);
  return output;
}

const answerSchema = z.object({ answers: z.record(z.string(), z.object({ type: z.literal('noul'), noul: z.number() })) });

/** Hume error bodies are not forwarded; each status maps to a fixed message. */
function humeError(status: number) {
  if (status === 401 || status === 403) return new HttpError(502, 'Hume rejected HUME_API_KEY. Check the key in .env and restart the server.');
  if (status === 402) return new HttpError(502, 'The Hume account needs credits for Audio Decisions.');
  if (status === 429 || status === 503) return new HttpError(429, 'Hume is busy. Wait a moment and try again.');
  if (status === 400 || status === 413 || status === 415) return new HttpError(422, 'Hume could not use this recording. Please answer again.');
  return new HttpError(502, 'Hume could not judge the answer. Please try again.');
}

export function createVoiceChoiceProvider(apiKey: string | undefined, fetcher: typeof fetch = fetch): VoiceChoiceProvider {
  return async ({ audio, context, signal }) => {
    if (!apiKey) throw new HttpError(503, 'HUME_API_KEY is missing. Add it to .env and restart the server.');
    if (!context.conditions.length || context.conditions.length > VOICE_CHOICE.maxConditions) {
      throw new HttpError(400, `Voice answers need 1 to ${VOICE_CHOICE.maxConditions} conditions besides the default.`);
    }
    const body = new FormData();
    body.set('request', new Blob([JSON.stringify(decisionRequest(context))], { type: 'application/json' }), 'request.json');
    body.set('file', new Blob([Uint8Array.from(padWav(audio, VOICE_CHOICE.minSeconds))], { type: 'audio/wav' }), 'answer.wav');
    const response = await fetcher(VOICE_CHOICE.endpoint, { method: 'POST', headers: { 'X-Hume-Api-Key': apiKey }, body, signal });
    if (!response.ok) throw humeError(response.status);
    const parsed = answerSchema.safeParse(await response.json().catch(() => null));
    const scores = parsed.success ? context.conditions.map((_, index) => parsed.data.answers[questionId(index)]?.noul) : [];
    if (!scores.length || scores.some(score => score === undefined)) throw new HttpError(502, 'Hume returned an unexpected answer. Please try again.');
    // The strongest yes wins; the first condition breaks ties.
    const best = scores.reduce((top, score, index) => score! > scores[top]! ? index : top, 0), probability = scores[best]!;
    return { answerId: probability >= VOICE_CHOICE.minProbability ? context.conditions[best].id : null, probability, model: VOICE_CHOICE_MODEL };
  };
}
