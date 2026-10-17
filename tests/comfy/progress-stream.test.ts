import { afterEach, describe, expect, it, vi } from 'vitest';
import { readServerEvents } from '../../shared/server-events';
import { watchComfyJob } from '../../src/features/interstitials/progress-stream';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
const progress = 'event: progress\ndata: {"type":"progress","progress":0.4,"progressDetails":{"stage":"Generating video and audio","step":8,"steps":20}}\n\n';
const auth = () => vi.stubGlobal('sessionStorage', { getItem: () => 'workspace-password' });
const collect = async <T>(stream: AsyncIterable<T>) => { const items: T[] = []; for await (const item of stream) items.push(item); return items; };

describe('incremental progress streams', () => {
  it.each(['\n', '\r\n', '\r'])('handles split UTF-8, multiline data and heartbeats with %j line endings', async ending => {
    const bytes = new TextEncoder().encode([': heartbeat', 'event: progress', 'data: {"message":"café",', 'data: "step":8}', '', ''].join(ending));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect(await collect(readServerEvents(stream, new AbortController().signal))).toEqual([
      { event: 'progress', data: '{"message":"café",\n"step":8}' },
    ]);
  });
  it('cancels a pending reader immediately when the draft is cancelled or unloaded', async () => {
    const cancel = vi.fn(), operation = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const read = collect(readServerEvents(stream, operation.signal));
    operation.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('uses application authentication and stops reconnecting after a terminal event', async () => {
    auth(); const update = vi.fn();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(progress + 'event: refresh\ndata: {"type":"refresh"}\n\n'));
    vi.stubGlobal('fetch', transport);
    await watchComfyJob('test-job', new AbortController().signal, update);
    expect(update).toHaveBeenCalledWith({ type: 'progress', progress: .4, progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } });
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ 'x-sparko-password': 'workspace-password', Accept: 'text/event-stream' });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('reconnects after EOF and backs off when streaming is unavailable, without failing the render', async () => {
    vi.useFakeTimers(); auth(); const operation = new AbortController(), update = vi.fn();
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(response(progress)).mockResolvedValueOnce(response('event: fallback\ndata: {}\n\n'));
    vi.stubGlobal('fetch', transport);
    const watching = watchComfyJob('test-job', operation.signal, update);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(transport).toHaveBeenCalledTimes(2);
    operation.abort(); await watching;
    expect(update).toHaveBeenCalledOnce();
  });
});
