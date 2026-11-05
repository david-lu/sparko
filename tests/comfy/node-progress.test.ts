import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyClient, type ComfySocket } from '../../server/features/comfy/client';
import { ComfyNodeProgress, readComfyNodeEvents } from '../../server/features/comfy/node-progress';
import { createComfyProvider } from '../../server/features/comfy/provider';
import { comfyStepProgress } from '../../shared/comfy-progress';

const job = 'comfy-job-123';
const message = (type: string, data: object = {}) => JSON.stringify({ type, data: { prompt_id: job, ...data } });
class FakeSocket extends EventTarget {
  readyState = 0;
  close = vi.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(type: string, data: object = {}) { this.dispatchEvent(new MessageEvent('message', { data: message(type, data) })); }
  fail() { this.dispatchEvent(new Event('error')); }
  get socket() { return this as unknown as ComfySocket; }
}
const sse = (data = { value: .98, nodes_done: 23, nodes_total: 24 }) => new Response(
  `event: progress\ndata: ${JSON.stringify(data)}\n\nevent: status\ndata: {"status":"succeeded"}\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } });
const collect = async <T>(stream: AsyncIterable<T>) => { const events: T[] = []; for await (const event of stream) events.push(event); return events; };
afterEach(() => vi.useRealTimers());

describe('native Comfy node progress', () => {
  it('reports the observed sample 19/20 as 95% of stage without inventing an overall percentage', () => {
    const parser = new ComfyNodeProgress(job);
    const event = parser.read(message('progress', { node: 'sample', value: 19, max: 20 }));
    expect(event).toEqual({ type: 'progress', source: 'comfy-websocket', progressDetails: { stage: 'Generating video and audio', step: 19, steps: 20 } });
    if (event?.type !== 'progress') throw new Error('Missing progress');
    expect(comfyStepProgress(event.progressDetails)).toBe(.95);
    expect(event.progress).toBeUndefined();
    expect(parser.read(message('executing', { node: 'decode_video' }))).toMatchObject({ progressDetails: { stage: 'Decoding video' } });
    expect(parser.read(message('progress', { node: 'decode_video', value: 0, max: 4 }))).toMatchObject({ progressDetails: { step: 0, steps: 4 } });
  });
  it('handles node maps, class labels, parallel nodes and completed stages without stale steps', () => {
    const parser = new ComfyNodeProgress(job);
    const states = (patch = {}) => message('progress_state', { nodes: {
      '12': { state: 'running', value: 8, max: 20, class_type: 'SamplerCustomAdvanced' },
      '13': { state: 'running', value: 1, max: 4, class_type: 'VAEDecode' }, ...patch,
    } });
    expect(parser.read(states())).toMatchObject({ progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } });
    expect(parser.read(message('progress', { node: '12', value: 9, max: 20 }))).toMatchObject({ progressDetails: { stage: 'Generating video and audio', step: 9 } });
    expect(parser.read(states({ '12': { state: 'finished', value: 20, max: 20 } }))).toMatchObject({ progressDetails: { stage: 'Decoding video', step: 1, steps: 4 } });
    const done = parser.read(message('executed', { node: '13', output: { private: 'not forwarded' } }));
    expect(done).toEqual({ type: 'progress', source: 'comfy-websocket', progressDetails: { stage: 'Generating scene' } });
    expect(parser.read(message('progress_state', { nodes: {} }))).toEqual(done);
  });
  it('ignores other jobs, previews, malformed frames and invalid steps without forwarding arbitrary text', () => {
    const parser = new ComfyNodeProgress(job);
    for (const raw of [new Blob(['preview']), '{', 'null', message('notification', { value: 'secret' }),
      message('progress', { prompt_id: 'another-job', node: 'sample', value: 20, max: 20 }),
      message('progress', { node: 'sample', value: -1, max: 20 }), message('progress', { node: 'sample', value: 1.5, max: 20 }),
      message('progress', { node: 'sample', value: 1 }), message('progress_state', { nodes: null })]) expect(parser.read(raw)).toBeUndefined();
    expect(parser.read(message('progress', { node: 'secret https://private.test', value: 1, max: 0, message: 'secret' })))
      .toEqual({ type: 'progress', source: 'comfy-websocket', progressDetails: { stage: 'Generating scene' } });
    for (const type of ['execution_success', 'execution_error', 'execution_interrupted']) {
      expect(parser.read(message(type, { exception_message: 'secret', traceback: ['private'] }))).toEqual({ type: 'refresh' });
    }
  });
});

describe('Comfy progress connection', () => {
  it('keeps the API key on the server, scopes the socket to Cloud and blocks live test-mode connections', () => {
    const socket = new FakeSocket(), connect = vi.fn((_url: URL) => socket.socket);
    new ComfyClient({ COMFY_API_KEY: 'private key&value' }).progressSocket(connect);
    const url = connect.mock.calls[0][0];
    expect(url.origin).toBe('wss://cloud.comfy.org'); expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('token')).toBe('private key&value'); expect(url.searchParams.get('clientId')).toBeTruthy();
    expect(new ComfyClient({ COMFY_CLOUD_API_KEY: 'key', COMFY_BASE_URL: 'https://deployment.example' }).progressSocket(connect)).toBeUndefined();
    expect(() => new ComfyClient({ SPARKO_TEST_MODE: '1', COMFY_CLOUD_API_KEY: 'key' }).progressSocket(connect)).toThrow('disabled in the test server');
    expect(() => new ComfyClient({ COMFY_CLOUD_API_KEY: 'key', COMFY_BASE_URL: 'http://cloud.comfy.org' }).progressSocket(connect)).toThrow('HTTPS');
    expect(connect).toHaveBeenCalledOnce();
    expect(new ComfyClient({ COMFY_API_KEY: 'private key&value' }).message(String(url))).toBe('[URL]');
  });
  it('coalesces updates during backpressure, then closes on terminal status without cancelling the job', async () => {
    const socket = new FakeSocket(), transport = vi.fn<typeof fetch>();
    const provider = createComfyProvider({ COMFY_API_KEY: 'key' }, transport, () => socket.socket);
    const events = provider.events(job, new AbortController().signal)[Symbol.asyncIterator]();
    const first = events.next(); socket.open(); socket.receive('progress', { node: 'sample', value: 1, max: 20 });
    expect((await first).value).toMatchObject({ progressDetails: { step: 1 } });
    for (let value = 2; value <= 19; value++) socket.receive('progress', { node: 'sample', value, max: 20 });
    expect((await events.next()).value).toMatchObject({ progressDetails: { step: 19 } });
    const terminal = events.next(); socket.receive('execution_success');
    expect((await terminal).value).toEqual({ type: 'refresh' });
    expect((await events.next()).done).toBe(true);
    expect(socket.close).toHaveBeenCalledOnce(); expect(transport).not.toHaveBeenCalled();
  });
  it('clears stale native steps and falls back to v2 SSE when the socket disconnects', async () => {
    const socket = new FakeSocket(), transport = vi.fn<typeof fetch>().mockResolvedValue(sse());
    const events = createComfyProvider({ COMFY_API_KEY: 'key' }, transport, () => socket.socket).events(job, new AbortController().signal)[Symbol.asyncIterator]();
    const first = events.next(); socket.open(); socket.receive('progress', { node: 'sample', value: 8, max: 20 }); await first;
    const next = events.next(); socket.fail();
    expect((await next).value).toEqual({ type: 'progress', progressDetails: { stage: 'Generating scene' } });
    expect((await events.next()).value).toMatchObject({ type: 'progress', progress: .98, progressDetails: { nodesDone: 23 } });
    expect((await events.next()).value).toEqual({ type: 'refresh' });
    expect((await events.next()).done).toBe(true);
    expect(transport.mock.calls[0][0]).toBe(`https://cloud.comfy.org/api/v2/jobs/${job}/events`);
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('falls back when a socket never opens, and keeps custom v2 endpoints on SSE', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket(), connect = vi.fn(() => socket.socket), transport = vi.fn<typeof fetch>().mockImplementation(async () => sse());
    const result = collect(createComfyProvider({ COMFY_API_KEY: 'key' }, transport, connect).events(job, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toHaveLength(2); expect(socket.close).toHaveBeenCalledOnce();
    await collect(createComfyProvider({ COMFY_API_KEY: 'key', COMFY_BASE_URL: 'https://deployment.example' }, transport, connect).events(job, new AbortController().signal));
    expect(connect).toHaveBeenCalledOnce();
    expect(transport.mock.calls[1][0]).toBe(`https://deployment.example/api/v2/jobs/${job}/events`);
  });
  it('closes on abort and consumer return, and never falls back or submits a request after abort', async () => {
    const socket = new FakeSocket(), operation = new AbortController(), transport = vi.fn<typeof fetch>();
    const result = collect(createComfyProvider({ COMFY_API_KEY: 'key' }, transport, () => socket.socket).events(job, operation.signal));
    operation.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket.close).toHaveBeenCalledOnce(); expect(transport).not.toHaveBeenCalled();
    const other = new FakeSocket(), events = readComfyNodeEvents(other.socket, job, new AbortController().signal);
    const first = events.next(); other.open(); other.receive('progress', { node: 'sample', value: 1, max: 20 }); await first;
    await events.return(undefined); expect(other.close).toHaveBeenCalledOnce();
  });
});
