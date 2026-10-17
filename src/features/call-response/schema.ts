import { z } from 'zod';
import { groupCallResponse } from './model';

const sceneId = z.enum(['intro', 'call', 'wait', 'correct', 'incorrect', 'continue']);
const frame = z.number().int().nonnegative();
const media = { id: z.string().min(1).max(200), assetId: z.uuid(), inFrame: frame, outFrame: frame.positive() };
const clip = z.discriminatedUnion('kind', [
  z.object({ ...media, kind: z.literal('video') }),
  z.object({ ...media, kind: z.literal('call') }),
  z.object({ ...media, kind: z.literal('idle'), repeat: z.literal('until-answer'), exitAt: z.literal('loop-boundary') }),
  z.object({ ...media, kind: z.literal('response'), outcome: z.enum(['correct', 'incorrect']) }),
]).refine(clip => clip.outFrame > clip.inFrame, 'Invalid scene clip boundaries.');
export const callResponseSchema = z.object({
  version: z.literal(1), fps: z.literal(24), entrySceneId: sceneId,
  interstitial: z.object({
    id: z.string().min(1).max(200), kind: z.literal('call-response'), label: z.string().min(1).max(1000),
    time: z.number().finite().nonnegative(), clipIds: z.array(z.string().min(1).max(200)).max(1000),
  }).optional(),
  scenes: z.array(z.object({ id: sceneId, label: z.string().max(1000), role: z.enum(['source', 'call', 'wait', 'response']),
    dialogue: z.string().max(4000), clip, interstitialId: z.string().min(1).max(200).optional() })).length(6)
    .refine(scenes => new Set(scenes.map(scene => scene.id)).size === 6, 'Duplicate scene IDs.'),
  edges: z.array(z.object({ id: z.string().min(1).max(200), from: sceneId, to: sceneId,
    when: z.enum(['ended', 'pending', 'correct', 'incorrect']), label: z.string().max(200), transitionFrames: frame.max(24) })).max(24)
    .refine(edges => new Set(edges.map(edge => edge.id)).size === edges.length
      && new Set(edges.map(edge => `${edge.from}:${edge.when}`)).size === edges.length, 'Ambiguous scene connections.'),
  interaction: z.object({ question: z.string().min(1).max(4000), acceptedAnswers: z.array(z.string().min(1).max(200)).min(1).max(100), waitSceneId: sceneId }),
}).refine(flow => {
  if (!flow.interstitial) return true;
  const members = flow.scenes.filter(scene => scene.clip.kind !== 'video').map(scene => scene.clip.id);
  return flow.interstitial.clipIds.length === members.length && new Set(flow.interstitial.clipIds).size === members.length
    && members.every(id => flow.interstitial!.clipIds.includes(id));
}, 'The Call Response Interstitial must own every non-video clip and no video clips.').transform(groupCallResponse);
