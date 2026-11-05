import { z } from 'zod';
import type { GenerationEvent } from '../../../shared/contracts.js';
import { generationProgress } from './progress.js';
import type { ComfySocket } from './client.js';

const count = z.number().int().nonnegative();
const nodeState = z.object({
  state: z.string(), value: count.nullish(), max: count.nullish(), class_type: z.string().nullish(),
});
const envelope = z.object({ type: z.string(), data: z.object({ prompt_id: z.string() }).passthrough() });
const stepData = z.object({ node: z.string(), value: count, max: count });
const executingData = z.object({ node: z.string().nullable() });
const stateData = z.object({ nodes: z.record(z.string(), nodeState) });

/** Cloud broadcasts all account jobs. Only normalized fields for this job leave the server. */
export class ComfyNodeProgress {
  private node?: string;
  private nodeClass?: string;
  constructor(private requestId: string) {}

  read(raw: unknown): GenerationEvent | undefined {
    if (typeof raw !== 'string') return; // Binary frames contain image previews.
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return; }
    const parsed = envelope.safeParse(json);
    if (!parsed.success || parsed.data.data.prompt_id !== this.requestId) return;
    const { type, data } = parsed.data;
    if (['execution_success', 'execution_error', 'execution_interrupted'].includes(type)) return { type: 'refresh' };
    if (type === 'progress') {
      const step = stepData.safeParse(data);
      if (!step.success) return;
      return this.progress(step.data.node, undefined, step.data.value, step.data.max);
    }
    if (type === 'executing') {
      const executing = executingData.safeParse(data);
      if (!executing.success) return;
      return executing.data.node === null ? { type: 'refresh' } : this.progress(executing.data.node);
    }
    if (type === 'progress_state') {
      const states = stateData.safeParse(data);
      if (!states.success) return;
      const running = Object.entries(states.data.nodes).filter(([, node]) => node.state === 'running');
      // Keep the selected node while parallel branches run; don't combine their percentages.
      const current = running.find(([id]) => id === this.node) ?? running[0];
      return current ? this.progress(current[0], current[1].class_type, current[1].value, current[1].max)
        : this.progress(undefined);
    }
    if (type === 'execution_start' || (type === 'executed' && data.node === this.node)) return this.progress(undefined);
  }

  private progress(node?: string, nodeClass?: string | null, step?: number | null, steps?: number | null): GenerationEvent {
    if (node !== this.node) this.nodeClass = undefined;
    this.node = node; this.nodeClass = nodeClass ?? this.nodeClass;
    const { progressDetails } = generationProgress({ value: 0, current_node: node, current_node_class: this.nodeClass, step, steps });
    // These are stage steps; the socket does not supply a workflow aggregate.
    return { type: 'progress', source: 'comfy-websocket', progressDetails };
  }
}

/** One bounded, coalesced update slot, so slow browser consumers cannot accumulate previews or steps. */
export async function* readComfyNodeEvents(socket: ComfySocket, requestId: string, signal: AbortSignal): AsyncGenerator<GenerationEvent> {
  const progress = new ComfyNodeProgress(requestId);
  let pending: GenerationEvent | undefined, ended = false, failed = false;
  let wake = () => {};
  const stop = () => { ended = true; wake(); };
  const fail = () => { if (!ended) { failed = true; stop(); } };
  const opened = () => clearTimeout(timeout);
  const message = (event: MessageEvent) => {
    if (ended) return;
    const update = progress.read(event.data);
    if (!update) return;
    pending = update;
    if (update.type === 'refresh') ended = true;
    wake();
  };
  const timeout = setTimeout(fail, 15_000);
  socket.addEventListener('open', opened);
  socket.addEventListener('message', message);
  socket.addEventListener('error', fail);
  socket.addEventListener('close', fail);
  signal.addEventListener('abort', stop, { once: true });
  if (socket.readyState === 1) opened();
  if (signal.aborted) stop();
  try {
    while (!signal.aborted) {
      if (pending) { const update = pending; pending = undefined; yield update; continue; }
      if (ended) break;
      await new Promise<void>(resolve => { wake = resolve; });
    }
    signal.throwIfAborted();
    // Never expose socket errors: their URL can contain the server-side API key.
    if (failed) throw new Error('Comfy node progress disconnected.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    socket.removeEventListener('open', opened);
    socket.removeEventListener('message', message);
    socket.removeEventListener('error', fail);
    socket.removeEventListener('close', fail);
    socket.close();
  }
}
