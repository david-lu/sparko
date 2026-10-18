import { z } from 'zod';
import { groupCallResponse } from './model';

const sceneId = z.string().min(1).max(200);
const answerId = sceneId.refine(id => !['ended', 'pending'].includes(id), 'Reserved answer ID.');
const frame = z.number().int().nonnegative();
const media = { id: z.string().min(1).max(200), assetId: z.uuid(), inFrame: frame, outFrame: frame.positive() };
const clip = z.discriminatedUnion('kind', [
  z.object({ ...media, kind: z.literal('video') }),
  z.object({ ...media, kind: z.literal('call') }),
  z.object({ ...media, kind: z.literal('idle'), repeat: z.literal('until-answer'), exitAt: z.literal('loop-boundary') }),
  z.object({ ...media, kind: z.literal('response'), outcome: answerId }),
]).refine(clip => clip.outFrame > clip.inFrame, 'Invalid scene clip boundaries.');
export const callResponseSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), fps: z.literal(24), entrySceneId: sceneId,
  interstitial: z.object({
    id: z.string().min(1).max(200), kind: z.literal('call-response'), label: z.string().min(1).max(1000),
    brief: z.string().max(4000).optional(), linkResponseDurations: z.boolean().optional(), time: z.number().finite().nonnegative(), clipIds: z.array(z.string().min(1).max(200)).max(1000),
  }).optional(),
  scenes: z.array(z.object({ id: sceneId, label: z.string().max(1000), role: z.enum(['source', 'call', 'wait', 'response']),
    dialogue: z.string().max(4000), draft: z.boolean().optional(), plannedFrames: frame.positive().optional(), clip, interstitialId: z.string().min(1).max(200).optional() })).min(5).max(104)
    .refine(scenes => new Set(scenes.map(scene => scene.id)).size === scenes.length
      && new Set(scenes.map(scene => scene.clip.id)).size === scenes.length, 'Duplicate scene or clip IDs.'),
  edges: z.array(z.object({ id: z.string().min(1).max(200), from: sceneId, to: sceneId,
    when: sceneId, label: z.string().max(200), transitionFrames: frame.max(24) })).max(12000)
    .refine(edges => new Set(edges.map(edge => edge.id)).size === edges.length
      && new Set(edges.map(edge => `${edge.from}:${edge.when}`)).size === edges.length, 'Ambiguous scene connections.'),
  interaction: z.object({ question: z.string().min(1).max(4000), waitSceneId: sceneId,
    acceptedAnswers: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
    answers: z.array(z.object({ id: answerId, label: z.string().trim().min(1).max(200), sceneId,
      color: z.object({ hue: z.number().int().min(0).max(360), saturation: z.number().int().min(0).max(100) }).optional(),
      values: z.array(z.string().trim().min(1).max(200)).max(100) })).min(1).max(100).optional(),
    fallbackAnswerId: answerId.nullable().optional(),
  }),
}).refine(flow => flow.version === 1 || !!flow.interaction.answers, 'Answer options are required.').refine(flow => {
  if (!flow.interstitial) return true;
  const members = flow.scenes.filter(scene => scene.clip.kind !== 'video').map(scene => scene.clip.id);
  return flow.interstitial.clipIds.length === members.length && new Set(flow.interstitial.clipIds).size === members.length
    && members.every(id => flow.interstitial!.clipIds.includes(id));
}, 'The Call Response Interstitial must own every non-video clip and no video clips.').transform(groupCallResponse).refine(flow => {
  const scenes = new Set(flow.scenes.map(scene => scene.id)), answers = new Set(flow.interaction.answers.map(answer => answer.id));
  const branchIds = flow.interaction.answers.map(answer => answer.sceneId);
  return ['intro', 'call', 'wait', 'continue', flow.entrySceneId, flow.interaction.waitSceneId].every(id => scenes.has(id))
    && answers.size === flow.interaction.answers.length && new Set(branchIds).size === branchIds.length
    && branchIds.every(id => scenes.has(id) && !['intro', 'call', 'wait', 'continue'].includes(id))
    && flow.scenes.every(scene => scene.clip.kind !== 'response' || answers.has(scene.clip.outcome))
    && (!flow.interaction.fallbackAnswerId || answers.has(flow.interaction.fallbackAnswerId))
    && flow.edges.every(edge => scenes.has(edge.from) && scenes.has(edge.to) && (['ended', 'pending'].includes(edge.when) || answers.has(edge.when)));
}, 'Invalid answer options or dangling scene connections.');
