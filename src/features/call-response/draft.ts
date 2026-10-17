import { generationPrompt, type Interstitial } from '../../../shared/interstitials';
import { createTestFlow, groupCallResponse, type CallResponseFlow, type TimelineScene } from './model';

export const continuityBrief = 'Continue the same shot with the same character identity, voice, clothing, lighting, background and camera. Preserve screen positions and gaze. Use natural continuous movement with no cuts or new objects.';
export function scenePrompt(scene: TimelineScene) {
  if (scene.id === 'call') return 'Extend the preceding scene naturally. The character addresses the viewer and asks the question, then settles into a relaxed, attentive listening pose. End with the mouth closed and the camera still.';
  if (scene.id === 'wait') return 'A quiet seamless waiting loop. Begin and end in exactly the supplied listening pose. Use subtle breathing and a small blink, with minimal movement. No dialogue, no new action, no camera movement. Match the first and last frames.';
  return `Begin in the Idle loop’s ending pose. Deliver the ${scene.label} response naturally, then smoothly return to the action, position, gaze and camera of the supplied parent continuation. Finish ready for the original footage to resume without a cut.`;
}
export function draftClip(flow: CallResponseFlow, scene: TimelineScene): Interstitial {
  return { id: scene.interstitialId!, groupId: flow.interstitial.id, label: scene.label, time: flow.interstitial.time,
    phase: 'draft', method: scene.id === 'call' ? 'comfy-extend' : scene.id === 'wait' ? 'comfy-loop' : 'comfy',
    start_range: 2, end_range: 2, duration: scene.id === 'wait' ? 2 : 6, enable_prompt_expansion: false,
    continuity: flow.interstitial.brief ?? continuityBrief,
    prompt: generationPrompt({ prompt: scenePrompt(scene), dialogue: scene.dialogue }) };
}
export function createCallResponseDraft(pin: Interstitial, assetId: string, duration: number) {
  const template = createTestFlow(), total = Math.floor(duration * template.fps), split = Math.round(pin.time * template.fps);
  if (split < 39 || total - split < 39) throw new Error('Place the call-response pin at least 1.625 seconds from either end of the parent video.');
  const flow = groupCallResponse({ ...template,
    interstitial: { ...template.interstitial, id: pin.id, label: pin.label, time: pin.time, brief: pin.prompt.trim() || continuityBrief, linkResponseDurations: false },
    interaction: { ...template.interaction, question: 'What do you think?', answers: [
      { id: 'correct', sceneId: 'correct', label: 'A', values: [] },
      { id: 'incorrect', sceneId: 'incorrect', label: 'B', values: [] },
    ], fallbackAnswerId: null },
    scenes: template.scenes.map(scene => ({ ...scene,
      label: scene.id === 'intro' ? 'Source · before' : scene.id === 'continue' ? 'Source · after' : scene.id === 'call' ? 'Call' : scene.id === 'wait' ? 'Idle' : scene.id === 'correct' ? 'A' : 'B',
      dialogue: scene.id === 'call' ? 'What do you think?' : '',
      draft: scene.role !== 'source', plannedFrames: scene.id === 'wait' ? 48 : 144,
      interstitialId: scene.role === 'source' ? undefined : `${pin.id}:${scene.id}`,
      clip: { ...scene.clip, id: `${pin.id}:clip:${scene.id}`, assetId,
        inFrame: scene.id === 'intro' ? 0 : scene.id === 'continue' ? split : split - 1,
        outFrame: scene.id === 'continue' ? total : split },
    })),
  });
  return { flow, interstitials: flow.scenes.filter(scene => scene.interstitialId).map(scene => draftClip(flow, scene)) };
}
