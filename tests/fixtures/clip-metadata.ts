import type { ClipMetadata } from '../../shared/clip-metadata';
export const clipMetadata: ClipMetadata = {
  format: 'sparko-clip', version: 1, fps: 24, id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-11-03T00:00:00.000Z',
  clip: { nodeId: 'original-scene', name: 'Across the doorway', time: 2, loop: false, conditional: false, loopCount: 0 },
  settings: { method: 'comfy', resolution: 'native', start_range: 2, end_range: 2, duration: 6,
    prompt: 'Walk through the doorway → 室内', enable_prompt_expansion: false, useInputReference: true, useOutputReference: true,
    maskInjection: 'vignette', audioMaskTransitionMs: 250, videoMaskTransitionMs: 750, continuity: 'Keep the same person', dialogue: 'Hello', loopAudio: true },
  references: { mode: 'custom',
    before: { sceneId: 'opening', assetId: '22222222-2222-4222-8222-222222222222', name: 'Opening video', inFrame: 0, outFrame: 96 },
    after: { sceneId: 'ending', assetId: '33333333-3333-4333-8333-333333333333', name: 'Ending video', inFrame: 24, outFrame: 120 } },
  media: { start: 1, duration: 2, totalDuration: 4 }, prompt: 'Walk through the doorway → 室内', jobId: 'original-job-1234',
};
