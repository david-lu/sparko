import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appHeaders, request, requestResponse } from '../src/shared/api';
import { abortableDelay } from '../src/shared/abortableDelay';

const transport = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal('fetch', transport); transport.mockReset();
  vi.stubGlobal('sessionStorage', { getItem: () => 'password' });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([new Headers({ 'Content-Type': 'application/json' }), [['Content-Type', 'application/json']], { 'Content-Type': 'application/json' }] as HeadersInit[])(
  'merges application headers with every HeadersInit representation', async headers => {
    transport.mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(request('/api/test', { headers })).resolves.toEqual({ ok: true });
    const sent = new Headers(transport.mock.calls[0][1]!.headers);
    expect(sent.get('content-type')).toBe('application/json'); expect(sent.get('x-sparko-password')).toBe('password'); expect(sent.get('x-sparko-request')).toBe('1');
  });
it('continues making requests when session storage is unavailable', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new DOMException('Blocked', 'SecurityError'); } });
  expect(appHeaders()['x-sparko-password']).toBe('');
  transport.mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(request('/api/test')).resolves.toEqual({ ok: true });
});
it('rejects malformed successful JSON instead of publishing an empty success', async () => {
  transport.mockResolvedValueOnce(new Response('<html>Unavailable</html>'));
  await expect(request('/api/test')).rejects.toThrow('unreadable response');
});
it('accepts an intentionally empty response', async () => {
  transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(request('/api/test')).resolves.toBeUndefined();
});
it('signals authentication failures before attempting to read an invalid error body', async () => {
  transport.mockResolvedValueOnce(new Response('not JSON', { status: 401 }));
  await expect(requestResponse('/api/output')).rejects.toThrow('401');
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'sparko:auth-required' }));
});
it('keeps binary responses unread for download consumers', async () => {
  transport.mockResolvedValueOnce(new Response('image', { headers: { 'content-type': 'image/png' } }));
  const response = await requestResponse('/api/output'); expect(response.bodyUsed).toBe(false); expect(await response.text()).toBe('image');
});
it.each([null, [], { error: { private: 'detail' } }])('uses a stable error when an error response has the wrong shape', async body => {
  transport.mockResolvedValueOnce(Response.json(body, { status: 502 }));
  await expect(request('/api/test')).rejects.toThrow('Request failed (502)');
});
it('preserves abort reasons while reading a response', async () => {
  const controller = new AbortController();
  const response = Response.json({}); vi.spyOn(response, 'json').mockImplementation(async () => { controller.abort(); throw new SyntaxError('Interrupted'); });
  transport.mockResolvedValueOnce(response);
  await expect(request('/api/test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('does not leave polling timers behind on cancellation or on already-aborted signals', async () => {
  vi.useFakeTimers(); const controller = new AbortController();
  const wait = abortableDelay(2000, controller.signal), assertion = expect(wait).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await assertion;
  await expect(abortableDelay(2000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(vi.getTimerCount()).toBe(0);
});
