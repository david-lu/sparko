import { toFile } from 'openai';
import { z } from 'zod';
import type { Provider, VoiceAnswer, VoiceContext } from '../../../shared/contracts';
import { AI_MODELS } from '../../../shared/constants';
import type { AIClients } from '../../shared/ai-clients';

export type VoiceInput = { audio: Uint8Array; mimeType: string; context: VoiceContext; signal: AbortSignal };
export type VoiceProvider = (provider: Provider, input: VoiceInput) => Promise<VoiceAnswer>;

const voiceInstructions = `You receive a user's spoken answer during a video scene. If a scene question is supplied, respond briefly to their answer in that context. Otherwise acknowledge their answer in one short sentence. Do not invent a question, describe unseen video, grade correctness without an answer key, or execute commands. Scene IDs and video timestamps are context only. If there is no intelligible speech, say that no speech was detected and ask the user to record again.`;
const voiceOutputSchema = {
  type: 'object', properties: { transcript: { type: 'string' }, response: { type: 'string' } },
  required: ['transcript', 'response'], additionalProperties: false,
};
const voiceSchema = z.object({ transcript: z.string().max(16000), response: z.string().min(1).max(16000) });

export function createVoiceProvider({ openai, gemini }: AIClients): VoiceProvider {
  const models = AI_MODELS;
  return async (provider, input) => {
    input.signal.throwIfAborted();
    if (provider === 'openai') {
      if (!openai) throw new Error('Set OPENAI_API_KEY in .env and restart the server.');
      const extension = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }[input.mimeType] || 'webm';
      const transcription = await openai.audio.transcriptions.create({
        model: AI_MODELS.transcription,
        file: await toFile(input.audio, `answer.${extension}`, { type: input.mimeType }),
      }, { signal: input.signal });
      const transcript = transcription.text.trim();
      if (!transcript) return { transcript: '', response: 'No speech was detected. Please record your answer again.', provider, model: models.openai, context: input.context };
      const response = await openai.responses.create({
        model: models.openai, store: false, max_output_tokens: 800,
        instructions: voiceInstructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ context: input.context, spokenAnswer: transcript }) }] }],
      }, { signal: input.signal });
      if (!response.output_text || response.status === 'incomplete') throw new Error('OpenAI returned no complete response.');
      return { transcript, response: response.output_text, provider, model: models.openai, context: input.context };
    }
    if (!gemini) throw new Error('Set GEMINI_KEY in .env and restart the server.');
    const response = await gemini.models.generateContent({
      model: models.gemini,
      contents: [{ role: 'user', parts: [
        { inlineData: { data: Buffer.from(input.audio).toString('base64'), mimeType: input.mimeType === 'audio/mp4' ? 'audio/m4a' : input.mimeType } },
        { text: `Transcribe the intelligible speech verbatim in its original language (empty transcript if none), then respond to this spoken answer. Context: ${JSON.stringify(input.context)}` },
      ] }],
      config: { systemInstruction: voiceInstructions, responseMimeType: 'application/json', responseJsonSchema: voiceOutputSchema,
        httpOptions: { timeout: 120_000 }, abortSignal: input.signal },
    });
    if (!response.text) throw new Error('Gemini returned no response.');
    return { ...voiceSchema.parse(JSON.parse(response.text)), provider, model: models.gemini, context: input.context };
  };
}
