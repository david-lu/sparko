import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFalProvider } from '../../server/features/video-insertion/provider';
import { ApiError, ValidationError } from '@fal-ai/client';
const calls = vi.hoisted(() => ({ status: vi.fn(), result: vi.fn(), cancel: vi.fn(), submit: vi.fn(), upload: vi.fn() }));
vi.mock('@fal-ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@fal-ai/client')>(),
  createFalClient: () => ({ queue: calls, storage: { upload: calls.upload } }) }));
beforeEach(() => vi.resetAllMocks());
describe('fal interstitial result boundaries', () => {
  it('returns the generated section boundaries alongside the progressive video URL', async () => {
    calls.status.mockResolvedValue({ status: 'COMPLETED' });
    calls.result.mockResolvedValue({ data: { video: { url: 'https://fal.media/result.mp4' }, start_time: 2, injected_duration: 5, duration: 8.96 } });
    expect(await createFalProvider({}).falStatus('job-12345')).toEqual({ requestId: 'job-12345', status: 'COMPLETED', videoUrl: 'https://fal.media/result.mp4', insertion: { start: 2, duration: 5, totalDuration: 8.96 } });
  });
  it('rejects results without usable boundaries rather than inserting duplicated reference footage', async () => {
    calls.status.mockResolvedValue({ status: 'COMPLETED' });
    for (const data of [{ video: { url: 'https://fal.media/result.mp4' } }, { video: { url: 'https://fal.media/result.mp4' }, start_time: 2, injected_duration: 20, duration: 9 }]) {
      calls.result.mockResolvedValue({ data });
      await expect(createFalProvider({}).falStatus('job-12345')).rejects.toThrow();
    }
  });
  it('exposes the actual fal validation message without disclosing request inputs or credentials', async () => {
    const credential = 'test-key-id:test-secret-value';
    calls.status.mockResolvedValue({ status: 'COMPLETED' });
    calls.result.mockRejectedValue(new ValidationError({ message: 'Unprocessable Entity', status: 422, requestId: 'failed-job-1234', body: {
      detail: [{ loc: ['body', 'resume_time'], msg: 'Value error, resume_time must follow start_time on the 24 fps timeline', input: { authorization: credential }, ctx: { token: 'private-context' } }],
      headers: { authorization: credential },
    } }));
    await expect(createFalProvider({ FAL_KEY: credential }).falStatus('failed-job-1234')).rejects.toMatchObject({
      status: 422, message: 'fal.ai rejected the request: Value error, resume_time must follow start_time on the 24 fps timeline Request: failed-job-1234.',
    });
  });
  it('sanitizes string validation messages and handles uploads as well as generation', async () => {
    calls.upload.mockRejectedValue(new ApiError({ message: 'private-sdk-message', status: 400, body: {
      detail: 'Cannot read https://fal.media/clip.mp4?token=private-token with test-key-id:test-secret-value or Bearer private-token',
    } }));
    await expect(createFalProvider({ FAL_KEY: 'test-key-id:test-secret-value' }).falUpload(new Blob())).rejects.toMatchObject({
      status: 422, message: 'fal.ai rejected the request: Cannot read [URL] with [redacted] or [redacted]',
    });
  });
  it('allows a rejected, completed job to return to draft without cancelling it again', async () => {
    calls.status.mockResolvedValue({ status: 'COMPLETED' });
    await createFalProvider({}).falCancel('failed-job-1234');
    expect(calls.cancel).not.toHaveBeenCalled();
    calls.status.mockResolvedValue({ status: 'IN_QUEUE' });
    await createFalProvider({}).falCancel('queued-job-1234');
    expect(calls.cancel).toHaveBeenCalledOnce();
  });
});
