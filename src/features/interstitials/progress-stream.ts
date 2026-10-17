import type { GenerationEvent } from '../../../shared/contracts';
import { readServerEvents } from '../../../shared/server-events';
import { appHeaders } from '../../shared/api';

const pause = (signal: AbortSignal, milliseconds: number) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, milliseconds);
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});

/** Optional live updates. Status polling remains authoritative if SSE is unavailable. */
export async function watchComfyJob(id: string, signal: AbortSignal, onEvent: (event: GenerationEvent) => void) {
  while (!signal.aborted) {
    let retry = 5_000;
    try {
      const connection = AbortSignal.any([signal, AbortSignal.timeout(270_000)]);
      const response = await fetch(`/api/comfy/jobs/${encodeURIComponent(id)}/events`, {
        signal: connection, headers: { ...appHeaders(), Accept: 'text/event-stream' }, cache: 'no-store',
      });
      if (response.status === 401) {
        await response.body?.cancel(); window.dispatchEvent(new Event('sparko:auth-required')); return;
      }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        retry = Math.max(30_000, Math.min(300_000, (Number(response.headers.get('retry-after')) || 0) * 1000));
      } else {
        for await (const event of readServerEvents(response.body, connection)) {
          if (signal.aborted) return;
          if (event.event === 'refresh') return; // The next status read retrieves the final result/error.
          if (event.event === 'fallback') { retry = 30_000; break; }
          if (event.event === 'status' || event.event === 'progress') onEvent(JSON.parse(event.data) as GenerationEvent);
        }
      }
    } catch {
      // Disconnects must not turn a still-running paid job into a failed draft.
    }
    await pause(signal, retry);
  }
}
