import { z } from 'zod';
import type { GenerationProgress } from '../../../shared/contracts.js';
import { comfyStage } from '../../../shared/comfy-progress.js';

const count = z.number().int().nonnegative().nullish();
export const progressSchema = z.object({
  value: z.number().min(0).max(1), nodes_done: count, nodes_total: count,
  current_node: z.string().nullish(), current_node_class: z.string().nullish(), step: count, steps: count,
});

export function generationProgress(data: z.infer<typeof progressSchema>) {
  const progressDetails: GenerationProgress = {
    stage: comfyStage(data.current_node, data.current_node_class),
    nodesDone: data.nodes_done ?? undefined, nodesTotal: data.nodes_total ?? undefined,
  };
  if (data.step != null && data.steps != null && data.steps > 0) {
    progressDetails.step = Math.min(data.step, data.steps); progressDetails.steps = data.steps;
  }
  // Use our stage labels, never arbitrary provider messages, prompts or model paths.
  return { progress: data.value, progressDetails };
}
