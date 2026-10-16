import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

export type AIClients = { openai: OpenAI | null; gemini: GoogleGenAI | null };

export function createAIClients(env: NodeJS.ProcessEnv): AIClients {
  const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 120_000, maxRetries: 0 }) : null;
  const geminiKey = env.GEMINI_API_KEY || env.GEMINI_KEY;
  const gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey, httpOptions: { timeout: 120_000 } }) : null;
  return { openai, gemini };
}
