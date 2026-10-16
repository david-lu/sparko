import type { AppStatus } from '../shared/contracts';
import { AI_MODELS } from '../shared/constants';
import { createAIClients } from './shared/ai-clients';
import { createAnalysisProviders, type AnalysisProviders } from './features/video-analysis/providers';
import { createVoiceProvider, type VoiceProvider } from './features/voice-input/provider';
import { createFalProvider, type FalProvider } from './features/video-insertion/provider';

export interface Providers extends AnalysisProviders, FalProvider {
  configured: AppStatus['providers'];
  models: AppStatus['models'];
  voice: VoiceProvider;
}

export function createProviders(env: NodeJS.ProcessEnv): Providers {
  const clients = createAIClients(env);
  return {
    configured: { openai: !!clients.openai, gemini: !!clients.gemini, fal: !!(env.FAL_KEY || env.FAL_API_KEY) },
    models: { openai: AI_MODELS.openai, gemini: AI_MODELS.gemini },
    ...createAnalysisProviders(clients),
    voice: createVoiceProvider(clients),
    ...createFalProvider(env),
  };
}
