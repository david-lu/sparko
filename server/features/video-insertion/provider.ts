import { createFalClient } from '@fal-ai/client';
import { z } from 'zod';
import type { FalJob } from '../../../shared/contracts.js';
import { AI_MODELS } from '../../../shared/constants.js';
import { falRequest } from './errors.js';

const FAL_MODEL = AI_MODELS.fal;
export type FalInput = {
  video_url: string; start_time: number; resume_time: number; duration: number;
  resolution: '480p' | '768p'; prompt: string; enable_prompt_expansion: boolean; color_match: boolean;
};
export interface FalProvider {
  falUpload(file: Blob): Promise<string>;
  falSubmit(input: FalInput): Promise<string>;
  falStatus(requestId: string): Promise<FalJob>;
  falCancel(requestId: string): Promise<void>;
}

export function createFalProvider(env: NodeJS.ProcessEnv): FalProvider {
  const credential = env.FAL_KEY || env.FAL_API_KEY;
  const fal = createFalClient({ credentials: credential });
  const call = <T>(request: () => Promise<T>) => falRequest(request, credential);
  return {
    async falUpload(file) { return call(() => fal.storage.upload(file)); },
    async falSubmit(input) {
      const result = await call(() => fal.queue.submit(FAL_MODEL, { input }));
      return result.request_id;
    },
    async falStatus(requestId) {
      const state = await call(() => fal.queue.status(FAL_MODEL, { requestId, logs: false }));
      if (state.status === 'COMPLETED') {
        const result = await call(() => fal.queue.result(FAL_MODEL, { requestId }));
        const data = z.object({ video: z.object({ url: z.url().refine(url => url.startsWith('https://')) }),
          start_time: z.number().finite().nonnegative(), injected_duration: z.number().finite().positive(), duration: z.number().finite().positive(),
        }).refine(value => value.start_time + value.injected_duration <= value.duration + 0.1, 'Invalid generated scene boundaries.').parse(result.data);
        return { requestId, status: 'COMPLETED', videoUrl: data.video.url,
          insertion: { start: data.start_time, duration: data.injected_duration, totalDuration: data.duration } };
      }
      return { requestId, status: state.status, queuePosition: 'queue_position' in state ? state.queue_position : undefined };
    },
    async falCancel(requestId) {
      const state = await call(() => fal.queue.status(FAL_MODEL, { requestId, logs: false }));
      // Completed includes rejected generations. They can return to draft without cancellation.
      if (state.status !== 'COMPLETED') await call(() => fal.queue.cancel(FAL_MODEL, { requestId }));
    },
  };
}
