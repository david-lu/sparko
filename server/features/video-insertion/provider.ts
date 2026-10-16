import { createFalClient } from '@fal-ai/client';
import { z } from 'zod';
import type { FalJob } from '../../../shared/contracts';
import { AI_MODELS } from '../../../shared/constants';

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
  const fal = createFalClient({ credentials: env.FAL_KEY || env.FAL_API_KEY });
  return {
    async falUpload(file) { return fal.storage.upload(file); },
    async falSubmit(input) {
      const result = await fal.queue.submit(FAL_MODEL, { input });
      return result.request_id;
    },
    async falStatus(requestId) {
      const state = await fal.queue.status(FAL_MODEL, { requestId, logs: false });
      if (state.status === 'COMPLETED') {
        const result = await fal.queue.result(FAL_MODEL, { requestId });
        const data = z.object({ video: z.object({ url: z.url().refine(url => url.startsWith('https://')) }) }).parse(result.data);
        return { requestId, status: 'COMPLETED', videoUrl: data.video.url };
      }
      return { requestId, status: state.status, queuePosition: 'queue_position' in state ? state.queue_position : undefined };
    },
    async falCancel(requestId) { await fal.queue.cancel(FAL_MODEL, { requestId }); },
  };
}
