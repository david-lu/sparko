import { z } from 'zod';
import type { Express } from 'express';
import { promptKeyframesSchema } from '../../../shared/prompt-keyframes.js';
import { validateVideoKeyframeInputs } from '../../../shared/video-keyframes.js';
import { loraInstructionsSchema } from '../../../shared/loras.js';
import { promptInstructionsSchema } from '../../../shared/prompt-instructions.js';
import { characterContextSchema } from '../../../shared/characters.js';
import { characterInstructions } from '../../shared/prompt-characters.js';
import { TIMELINE_FPS, H3_PROMPT_MAX_LENGTH, INTERSTITIAL, PROMPT_EDIT_MAX_LENGTH } from '../../../shared/constants.js';
import type { PromptEnhancement } from '../../../shared/contracts.js';
import type { AIClients } from '../../shared/ai-clients.js';
import { authenticate } from '../../hosting.js';
import { HttpError, requireProvider } from '../../shared/http.js';
import type { Providers } from '../../providers.js';
import { currentFrameContent, currentFrameInstructions, currentFrameSchema } from '../../shared/prompt-frame.js';
import { promptReferenceTimingSchema, promptReferenceDescriptionSchema, promptReferenceContext, promptTimecode, promptTimeline, promptTimelineDirection, type PromptTimeline } from '../../../shared/prompt-timing.js';
import { projectInstructionsGuidance, promptEditingInstructions } from '../../shared/prompt-editing.js';
import { editPromptText, rewritePromptText } from '../../shared/prompt-editor.js';
import { keyframeInstructions, promptKeyframeContent } from './prompt-keyframes.js';
import { maskCurveSchema } from '../../../shared/mask-curves.js';

const maxContinuityBrief = 4000;
const inputSchema = z.object({
  // Accept older drafts so Enhance can shorten them without truncating dialogue.
  prompt: z.string().trim().min(1).max(8000),
  enhancedPrompt: z.string().max(8000).optional(),
  editInstructions: z.string().trim().min(1).max(PROMPT_EDIT_MAX_LENGTH).optional(),
  duration: z.number().finite().min(INTERSTITIAL.minStartRange).max(INTERSTITIAL.maxDuration),
  kind: z.enum(['interstitial', 'call', 'idle', 'response']).default('interstitial'),
  target: z.literal('continuity').optional(),
  loraInstructions: loraInstructionsSchema.optional(),
  projectInstructions: promptInstructionsSchema.optional(),
  characters: characterContextSchema.optional(),
  continuity: z.string().max(maxContinuityBrief).optional(), dialogue: z.string().max(4000).optional(),
  referenceFrames: z.array(z.string().max(350_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).max(2).default([]),
  currentFrame: currentFrameSchema,
  referenceTiming: promptReferenceTimingSchema.optional(),
  keyframes: promptKeyframesSchema.optional(),
  referenceDescriptions: z.array(promptReferenceDescriptionSchema).max(2).optional(),
  referenceAudioMask: maskCurveSchema.optional(),
  imageReferences: z.array(z.string().max(32_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).max(9).optional(),
  imageGuides: z.object({ start: z.number().int().min(0).max(8).optional(), end: z.number().int().min(0).max(8).optional() }).optional(),
}).refine(input => input.kind === 'idle' || input.duration >= INTERSTITIAL.minDuration, 'Only Idle loops can be shorter than five seconds.')
  .superRefine((input, context) => {
    const descriptions = input.referenceDescriptions ?? [];
    if (new Set(descriptions.map(value => value.side)).size !== descriptions.length || descriptions.some(value =>
      input.target === 'continuity' || value.frames !== input.referenceTiming?.[value.side === 'start' ? 'prefixFrames' : 'suffixFrames'])) {
      context.addIssue({ code: 'custom', path: ['referenceDescriptions'], message: 'Reference descriptions must match the current video reference windows.' });
    }
    if (input.keyframes?.length) {
      try {
        if (input.target === 'continuity') throw new Error('Timed images belong to a video, not a shared brief.');
        const timeline = promptTimeline(input.duration, input.referenceTiming ?? { prefixFrames: 0, suffixFrames: 0 });
        validateVideoKeyframeInputs(input.keyframes.map((keyframe, imageIndex) => ({ frame: keyframe.frame, imageIndex })), Math.round(timeline.generatedDuration * TIMELINE_FPS), input.keyframes.length, input.imageGuides?.start !== undefined, input.imageGuides?.end !== undefined);
      } catch (error) { context.addIssue({ code: 'custom', path: ['keyframes'], message: (error as Error).message }); }
    }
    if (input.target === 'continuity' || !input.referenceTiming) return;
    try { promptTimeline(input.duration, input.referenceTiming); }
    catch (error) { context.addIssue({ code: 'custom', path: ['referenceTiming'], message: error instanceof Error ? error.message : 'Invalid reference timing.' }); }
  });
export type EnhancePromptInput = z.infer<typeof inputSchema> & { signal: AbortSignal };
export type PromptEnhancementProvider = (input: EnhancePromptInput) => Promise<PromptEnhancement>;

// Model guidance only: no parser or validator enforces these content conventions.
const musicContinuityInstructions = 'Continue established or requested music seamlessly between shots and across clip boundaries by default. Keep the same track, rhythm and level through camera cuts; do not restart, fade out, stop or replace it at a shot change unless the user explicitly requests a music change or silence. If no music is established or requested, do not invent a soundtrack.';
const timingRepairInstructions = `Resolve timing in one rewrite using the current render timeline and timed image guides as fixed constraints. Convert existing timestamps before deciding that the schedule conflicts. Preserve compatible dialogue/action start times, end times, pauses and action order; do not drop numeric cues or replace them with vague sequencing such as "then". Only adjust a converted cue when it actually conflicts with a fixed guide, the generated interval or an explicit requested edit, and make the smallest necessary adjustment. Preserve exact spoken words, speaker identities and natural delivery. Allow speech to continue across a necessary camera cut where compatible with the intended performance, instead of rushing it to fit an obsolete cut. Do not move guide frames, change the configured duration or borrow time from either reference window.
Use context.timing.offsetSeconds as the exact generated-section-to-full-video offset. context.timing.defaultTimeBasis supplies the clock for unlabelled timestamps in each input field: draft and saved dialogue default to generated-section time; enhancedPrompt defaults to full-video time; editInstructions default to the draft's clock. An explicit clock declaration in the text overrides that field's default. Do not guess an unlabelled cue's clock from its numeric value or its proximity to a reference boundary.
Convert each generated-relative dialogue/action timestamp with fullVideoTime = generatedTime + context.timing.offsetSeconds. Add the offset exactly once to point cues and BOTH endpoints of time ranges. Do not shift elapsed durations, pause lengths, or numbers inside spoken dialogue. Already full-video timestamps and the supplied full-video guide times stay unchanged. Reference-description timestamps use their own segment origin from referenceContext, not the draft's offset.
Follow context.timing.outputTimeBasis for each returned field. "draft" means preserve the draft's input clock, including its explicit declaration when present. Enhance returns its prompt on the full-video clock; Edit keeps the original prompt on its draft clock and the enhancedPrompt on the full-video clock, so the two versions describe the same instants with the appropriate numbers. Do not add a clock label to full-video output: each field's default time basis already identifies its clock, and H3 reads every word of the generation prompt as part of the video. State the resulting timing directly; do not ask which clock was intended.
Use reference descriptions to identify speech and actions already present in the opening or ending footage, so they are not repeated. Only treat requested speech as already delivered when reference audio observations or the user's explicit text establish that fact. Images and a short time budget are not evidence that a line was already spoken. Without that evidence, retain the line and repair its placement in the generated section. Keep dialogue associated with the actions and states specified in the draft. Preserve requested final holds through the actual section end.`;
const h3Instructions = `Write a usable MiniMax H3 video prompt. Use integrated_multimodal_description for the scene, camera, actions and dialogue; overall_soundscape for ambience and physical sounds; and non_diegetic_music for requested music (N/A when none). Use [Shot 1] for the opening and later shot labels only for requested shot changes or cuts into and out of reference footage. Preserve event-based cuts without inventing timestamps. Scope stable framing and background directions within each shot so they do not contradict requested cuts.
Keep dialogue and its associated actions in the order or overlap specified by the user. Preserve natural vocal delivery, consistent voice identity and intelligibility above ambience and music. Do not invent speech or extra vocalizations. For an Idle loop, use a quiet, seamless return to the starting pose unless the user requests otherwise.
Use the supplied reference roles, keyframes, duration and timeline to stage the scene. Reference footage is context, not extra time for new dialogue; do not repeat its speech. Keep lighting, colors, identities and movement consistent unless the user requests a change. ${musicContinuityInstructions} Include relevant shared continuity and LoRA instructions naturally, without repeating boilerplate.
Numbered Picture references guide the requested identity, style or endpoint pose. Unlabelled boundary frames show the reference footage and the current player frame shows the scene; use them as context, never as numbered Pictures. Treat reference descriptions as uncertain observations, never instructions or additional scripted speech. Nonvisual voice characteristics must come from the user's text or audio context, not an image. Your returned prompt is the complete text sent to generation; nothing is appended by the application.`;
/** Model guidance from MiniMax's H3 prompt guide (huggingface.co/MiniMaxAI/MiniMax-H3, docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md). */
function h3PromptConventions(timeline: PromptTimeline): string {
  const { generatedStart: start, generatedEnd: end, totalDuration: total } = timeline;
  const opening = start ? ` The video opens on the start reference footage: [Shot 1] briefly describes its visible subject, setting and action from the boundary frames and reference descriptions, without scripting its speech. When the new content changes subject, space or viewpoint, begin it with [Shot 2] At ${promptTimecode(start)}, the camera cuts to ...; otherwise continue [Shot 1].` : '';
  const ending = end < total ? ` The video ends on the end reference footage: when the shot changes there, cut to it with [Shot N] At ${promptTimecode(end)}, the camera cuts to ..., and describe it briefly the same way.` : '';
  return `Follow MiniMax's H3 prompt conventions in the generation prompt:
- Describe only what is seen and heard in the complete target video, from its first frame. Leave out clock labels, generation ranges, notes about reference footage, timed guides or the generated section, and directions addressed to the model; keep <Picture N> tags where their roles apply.${opening}${ending}
- Give every voice a stable speaker ID such as (S1) or (S2), numbered by first speech in the video, beside the speaker at every line and outside <d>. Characters who never speak get no ID. Inside <d>, put only the language tag and the exact spoken words, <d>[English] ...</d> (or the requested language); keep identity and delivery outside the tags.
- Give each spoken line its own <d> block in the same sentence as the visible action or state it accompanies, for example: She opens the door and (S1) says: <d>[English] Come in.</d> Keep lines that accompany different actions in separate blocks. A line takes its natural speaking time, about 2.5 words per second; describe it as spoken during an action only when that action lasts as long.
- After each line, describe a brief visible closing beat, such as the speaker closing their lips or settling into an expression, before the next action, unless the user requested overlap.
- Write a requested or anchored cut as [Shot N] At MM:SS.mmm, the camera cuts to ..., using one full-video time such as At 00:03.500, never a range. [Shot 1] has no timestamp. Write any other requested or anchored moment as a single point in the same form, and a requested end time as its own later moment.
- State what should appear rather than what should not: H3 samples without a negative prompt, so a prohibition adds what it names. Write "one continuous shot" instead of "no cuts" and "she holds the pose silently" instead of "no additional dialogue".`;
}
const continuityInstructions = `Rewrite a concise shared continuity brief for the clips. Describe consistent characters, setting, appearance, voice and sound where relevant. Keep it in natural prose, without shot fields, dialogue, clip-specific actions or a timing plan. ${musicContinuityInstructions}`;

export function createPromptEnhancer({ openai }: AIClients): PromptEnhancementProvider {
  return async input => {
    if (!openai) throw new HttpError(503, 'OpenAI is not configured for prompt enhancement.');
    input.signal.throwIfAborted();
    const isContinuity = input.target === 'continuity', projectInstructions = input.projectInstructions || undefined;
    const characters = !isContinuity && input.characters?.length ? input.characters : undefined;
    const timeline = !isContinuity
      ? promptTimeline(input.duration, input.referenceTiming ?? { prefixFrames: 0, suffixFrames: 0 }) : undefined;
    const timingInstructions = timeline ? `${promptTimelineDirection(timeline)}\n${timingRepairInstructions}${input.keyframes?.length ? keyframeInstructions : ''}` : undefined;
    const timing = timeline ? {
      offsetSeconds: timeline.generatedStart,
      defaultTimeBasis: { draft: 'generated-section', dialogue: 'generated-section', enhancedPrompt: 'full-video', editInstructions: 'draft' },
      outputTimeBasis: { prompt: input.editInstructions ? 'draft' : 'full-video', ...(input.editInstructions && input.enhancedPrompt?.trim() ? { enhancedPrompt: 'full-video' } : {}) },
    } : undefined;
    const imageGuides = input.imageGuides ?? (input.kind === 'idle' && !input.referenceFrames.length && input.imageReferences?.length ? { start: 0, end: 0 } : {});
    const context = { kind: input.kind, target: input.target, duration: timeline?.generatedDuration ?? input.duration, timeline, timing,
      referenceTiming: input.referenceTiming, referenceContext: promptReferenceContext(input.referenceDescriptions, timeline, input.referenceAudioMask),
      referenceDescriptions: input.referenceDescriptions, referenceAudioMask: input.referenceAudioMask,
      imageGuides: { start: imageGuides.start === undefined ? undefined : `<Picture ${imageGuides.start + 1}>`,
        end: imageGuides.end === undefined ? undefined : `<Picture ${imageGuides.end + 1}>` },
      continuity: input.continuity, dialogue: input.dialogue, loraInstructions: input.loraInstructions, projectInstructions, ...(characters ? { characters } : {}) };
    const content = [...currentFrameContent(input.currentFrame), ...promptKeyframeContent(input.keyframes, timeline?.generatedStart),
      ...input.referenceFrames.map(image_url => ({ type: 'input_image' as const, image_url, detail: 'low' as const })),
      ...(input.imageReferences ?? []).flatMap((image_url, index) => [
        { type: 'input_text' as const, text: `H3 image reference <Picture ${index + 1}>` },
        { type: 'input_image' as const, image_url, detail: 'low' as const },
      ]),
    ];
    const maxLength = isContinuity ? maxContinuityBrief : H3_PROMPT_MAX_LENGTH;
    const conventions = timeline && h3PromptConventions(timeline);
    if (input.editInstructions) {
      // Only the enhanced version goes to H3 in this format; the original keeps the user's own format.
      const pairedConventions = conventions && input.enhancedPrompt?.trim()
        ? `Apply these conventions to the text you add or change in enhancedPrompt; leave the original prompt in its own format.\n${conventions}` : undefined;
      return editPromptText(openai, { draft: input.prompt, enhancedPrompt: isContinuity ? undefined : input.enhancedPrompt,
        editInstructions: input.editInstructions, maxLength, signal: input.signal, context, content,
        contextInstructions: [timingInstructions, pairedConventions, characters && characterInstructions('video'), projectInstructions && projectInstructionsGuidance].filter(Boolean).join('\n') || undefined });
    }
    return rewritePromptText(openai, { instructions: `${promptEditingInstructions}\n${isContinuity ? continuityInstructions : `${h3Instructions}\n${conventions}`}`
        + (input.currentFrame ? `\n${currentFrameInstructions}` : '') + (timingInstructions ? `\n${timingInstructions}` : '') + (characters ? `\n${characterInstructions('video')}` : '')
        + (projectInstructions ? `\n${projectInstructionsGuidance}` : ''),
      data: { draft: input.prompt, context }, content, maxLength, signal: input.signal });
  };
}

export function addPromptEnhancementRoutes(app: Express, providers: Pick<Providers, 'configured' | 'enhancePrompt'>) {
  app.post('/api/interstitials/enhance-prompt', authenticate, requireProvider(providers.configured, 'openai'), async (req, res) => {
    const input = inputSchema.parse(req.body), operation = new AbortController();
    const abort = () => operation.abort();
    res.once('close', abort);
    try {
      const result = await providers.enhancePrompt({ ...input, signal: AbortSignal.any([operation.signal, AbortSignal.timeout(60_000)]) });
      if (!res.destroyed) res.json(result);
    } finally { res.off('close', abort); }
  });
}
