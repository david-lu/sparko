import { z } from 'zod';
import { loraInstructionsSchema } from '../../../shared/loras.js';
import { promptInstructionsSchema } from '../../../shared/prompt-instructions.js';
import { characterContextSchema } from '../../../shared/characters.js';
import { characterInstructions } from '../../shared/prompt-characters.js';
import type { Express } from 'express';
import { assetModel, assetSettingsSchema } from '../../../shared/asset-generation.js';
import { IMAGE_PROMPT_GUIDES } from '../../../shared/image-prompt-guides.js';
import { PROMPT_EDIT_MAX_LENGTH } from '../../../shared/constants.js';
import type { AIClients } from '../../shared/ai-clients.js';
import { HttpError, requireProvider } from '../../shared/http.js';
import { authenticate } from '../../hosting.js';
import type { Providers } from '../../providers.js';
import { currentFrameContent, currentFrameInstructions, currentFrameSchema } from '../../shared/prompt-frame.js';
import { projectInstructionsGuidance, promptEditingInstructions } from '../../shared/prompt-editing.js';
import { editPromptText, rewritePromptText } from '../../shared/prompt-editor.js';

const inputSchema = z.object({ settings: assetSettingsSchema, loraInstructions: loraInstructionsSchema.optional(), projectInstructions: promptInstructionsSchema.optional(), characters: characterContextSchema.optional(),
  editInstructions: z.string().trim().min(1).max(PROMPT_EDIT_MAX_LENGTH).optional(),
  currentFrame: currentFrameSchema,
  images: z.array(z.string().max(32_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).max(14),
}).superRefine((input, ctx) => {
  const model = assetModel(input.settings.model);
  if (model?.kind !== 'image' || !IMAGE_PROMPT_GUIDES[input.settings.model]) ctx.addIssue({ code: 'custom', message: 'Choose an image model with a prompt guide.' });
  if (!input.settings.prompt.trim()) ctx.addIssue({ code: 'custom', message: 'Enter a draft prompt to enhance.' });
  if (input.images.length !== input.settings.references.filter(r => r.kind === 'image').length) ctx.addIssue({ code: 'custom', message: 'Image previews do not match the references.' });
});
type Input = z.infer<typeof inputSchema> & { signal: AbortSignal };
export type ImagePromptEnhancementProvider = (input: Input) => Promise<{ prompt: string; enhancedPrompt?: string; model: string; guideUrl: string }>;

export function createImagePromptEnhancer({ openai }: AIClients): ImagePromptEnhancementProvider {
  return async input => {
    const { settings, images, loraInstructions, currentFrame, editInstructions, ...parsed } = inputSchema.parse(input), projectInstructions = parsed.projectInstructions || undefined;
    const characters = parsed.characters?.length ? parsed.characters : undefined;
    const model = assetModel(settings.model)!, guide = IMAGE_PROMPT_GUIDES[model.id];
    if (!openai) throw new HttpError(503, 'Connect OpenAI to enhance image prompts.');
    const context = { kind: 'image', model: model.name, loraInstructions, projectInstructions, characters, aspectRatio: settings.aspectRatio, resolution: settings.resolution,
      references: settings.references.map(({ name, kind }) => ({ name, kind })) };
    const content = [...currentFrameContent(currentFrame), ...images.flatMap((image_url, index) => [
      { type: 'input_text' as const, text: `Image ${index + 1}` }, { type: 'input_image' as const, image_url, detail: 'low' as const },
    ])];
    const result = editInstructions
      ? await editPromptText(openai, { draft: settings.prompt, enhancedPrompt: settings.enhancedPrompt, editInstructions, maxLength: 8000, signal: input.signal, context, content,
        contextInstructions: [characters && characterInstructions('image'), projectInstructions && projectInstructionsGuidance].filter(Boolean).join('\n') || undefined })
      : await rewritePromptText(openai, { maxLength: 8000, signal: input.signal, content, data: { draft: settings.prompt, context },
        instructions: `${promptEditingInstructions}\nRewrite for ${model.name}, following the supplied rules from ${guide.title} (${guide.url}): ${guide.rules}
Preserve exact visible text, identities, reference order and LoRA trigger words. Ground composition and appearance in the relevant references. Preserve established lighting and colors unless the user requests a change. Non-image references are context only; never invent their contents. Return an image prompt without video shots, audio fields, API parameters or commentary. Use the supplied guide rules without claiming to have read the guide online.`
          + (currentFrame ? `\n${currentFrameInstructions}` : '') + (characters ? `\n${characterInstructions('image')}` : '') + (projectInstructions ? `\n${projectInstructionsGuidance}` : ''),
      });
    return { ...result, model: model.id, guideUrl: guide.url };
  };
}
export function addImagePromptEnhancementRoutes(app: Express, providers: Pick<Providers, 'configured' | 'enhanceImagePrompt'>) {
  app.post('/api/image-prompts/enhance', authenticate, requireProvider(providers.configured, 'openai'), async (req, res) => {
    const input = inputSchema.parse(req.body), operation = new AbortController(), abort = () => operation.abort();
    res.once('close', abort);
    try {
      const result = await providers.enhanceImagePrompt({ ...input, signal: AbortSignal.any([operation.signal, AbortSignal.timeout(60_000)]) });
      if (!res.destroyed) res.json(result);
    } finally { res.off('close', abort); }
  });
}
