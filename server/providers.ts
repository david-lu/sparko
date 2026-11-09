import type { AppStatus } from '../shared/contracts.js';
import { AI_MODELS } from '../shared/constants.js';
import { createAIClients } from './shared/ai-clients.js';
import { createAnalysisProviders, type AnalysisProviders } from './features/video-analysis/providers.js';
import { createVoiceProvider, type VoiceProvider } from './features/voice-input/provider.js';
import { createVoiceChoiceProvider, type VoiceChoiceProvider } from './features/voice-input/choice.js';
import { createComfyProvider, type ComfyProvider } from './features/comfy/provider.js';
import { createPromptEnhancer, type PromptEnhancementProvider } from './features/interstitials/prompt-enhancement.js';
import { createImagePromptEnhancer, type ImagePromptEnhancementProvider } from './features/asset-generation/prompt-enhancement.js';

export interface Providers extends AnalysisProviders {
  configured: AppStatus['providers'];
  models: AppStatus['models'];
  voice: VoiceProvider;
  voiceChoice: VoiceChoiceProvider;
  comfy?: ComfyProvider;
  enhancePrompt: PromptEnhancementProvider;
  enhanceImagePrompt: ImagePromptEnhancementProvider;
}

export function createProviders(env: NodeJS.ProcessEnv): Providers {
  const clients = createAIClients(env);
  return {
    configured: { openai: !!clients.openai, gemini: !!clients.gemini, comfy: env.SPARKO_TEST_MODE !== '1' && !!(env.COMFY_CLOUD_API_KEY || env.COMFY_API_KEY), hume: !!env.HUME_API_KEY },
    models: { openai: AI_MODELS.openai, gemini: AI_MODELS.gemini },
    ...createAnalysisProviders(clients),
    voice: createVoiceProvider(clients),
    voiceChoice: createVoiceChoiceProvider(env.HUME_API_KEY),
    comfy: createComfyProvider(env),
    enhancePrompt: createPromptEnhancer(clients),
    enhanceImagePrompt: createImagePromptEnhancer(clients),
  };
}
