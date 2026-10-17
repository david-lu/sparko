import { describe, expect, it, vi } from 'vitest';
import { ComfyClient } from '../../server/features/comfy/client';

describe('Comfy transport failures', () => {
  it('identifies a broken status connection without exposing error details or credentials', async () => {
    const cause = Object.assign(new Error('secret-key https://private.example/output?token=private'), { code: 'ECONNRESET' });
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed', { cause }));
    const result = new ComfyClient({ COMFY_CLOUD_API_KEY: 'secret-key' }, transport).call('/api/v2/jobs/comfy-job-123');
    await expect(result).rejects.toMatchObject({ status: 502, message: expect.stringContaining('checking the generation job (ECONNRESET)') });
    await expect(result).rejects.toThrow('Check this existing job again');
    await expect(result).rejects.not.toThrow(/secret-key|private\.example|token=private/);
    expect(transport).toHaveBeenCalledOnce();
  });
  it('reports an upload timeout with its actual operation', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('private detail', 'TimeoutError'));
    await expect(new ComfyClient({ COMFY_CLOUD_API_KEY: 'secret' }, transport).call('/api/v2/assets', { method: 'POST' }))
      .rejects.toMatchObject({ status: 504, message: expect.stringContaining('timed out while uploading the reference video') });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('reports an ambiguous submission response without retrying a paid job', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":'));
    const result = new ComfyClient({ COMFY_CLOUD_API_KEY: 'secret' }, transport).call('/api/v2/jobs', { method: 'POST' });
    await expect(result).rejects.toMatchObject({ status: 502, message: expect.stringContaining('returned invalid JSON while submitting the generation') });
    await expect(result).rejects.toThrow('The job may have been accepted');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('handles a response body that disconnects after headers arrive', async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new ComfyClient({ COMFY_CLOUD_API_KEY: 'secret' }, transport).call('/api/v2/assets/comfy-asset-123'))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('loading generated video metadata') });
  });
});
