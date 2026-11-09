import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../server/app';
import { errorHandler } from '../../server/shared/http';
import type { Providers } from '../../server/providers';
import { defaultMaskCurve } from '../../shared/mask-curves';
import { clipOriginSchema, MAX_CLIP_METADATA_BYTES } from '../../shared/clip-metadata';
import { clipMetadata } from '../fixtures/clip-metadata';

let mediaDuration = 3.25;
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], BlobSource: class {}, Input: class {
  getPrimaryVideoTrack() { return Promise.resolve({ displayWidth: 1280, displayHeight: 720, computeDuration: async () => mediaDuration, computePacketStats: async () => ({ averagePacketRate: 24 }) }); }
  getPrimaryAudioTrack() { return Promise.resolve({}); }
  computeDuration() { return Promise.resolve(mediaDuration); }
  dispose() {}
} }));
const comfy = { resolveLora: vi.fn(), check: vi.fn(), submit: vi.fn(), status: vi.fn(), events: vi.fn(), cancel: vi.fn(), assetUrl: vi.fn() };
const providers: Providers = { configured: { openai: false, gemini: false, comfy: true }, models: { openai: 'test', gemini: 'test' },
  openai: vi.fn(), gemini: vi.fn(), voice: vi.fn(), enhancePrompt: vi.fn(), enhanceImagePrompt: vi.fn(), comfy };
let app: Express;
beforeAll(async () => { app = await createApp({ providers }); app.use(errorHandler); });
beforeEach(() => {
  vi.resetAllMocks(); providers.configured.comfy = true; mediaDuration = 3.25;
  comfy.submit.mockResolvedValue({ requestId: 'comfy-job-123', status: 'IN_QUEUE', insertion: { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const submit = (before = '1.625', after = '1.625', prompt = 'Bridge this scene', fields: Record<string, string> = {}) => request(app).post('/api/comfy/interstitials').set('x-sparko-request', '1')
  .field('before', before).field('after', after).field('duration', '6').field('prompt', prompt).field(fields).attach('video', Buffer.from('validated by the media-reader fixture'), { filename: 'reference.mp4', contentType: 'video/mp4' });

describe('Comfy API boundaries', () => {
  it('accepts a complete input timeline and checks ranges and duration before submission', async () => {
    mediaDuration = 226 / 24;
    const fields = { fullInput: 'true', timelineInputs: JSON.stringify([{ frame: 24, frames: 48 }]), keyframes: JSON.stringify([{ frame: 80, imageIndex: 0, method: 'frame' }]), keyframeImages: JSON.stringify(['data:image/jpeg;base64,/9j/2Q==']) };
    await submit('1.625', '1.625', 'Combined inputs', fields).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ fullInput: true, timelineInputs: [{ frame: 24, frames: 48 }], keyframes: [{ frame: 80, method: 'frame' }] });
    await submit('1.625', '1.625', 'Combined inputs', { ...fields, fullInput: 'false' }).expect(400);
    await submit('1.625', '1.625', 'Combined inputs', { ...fields, timelineInputs: JSON.stringify([{ frame: 140, frames: 48 }]) }).expect(400);
    mediaDuration = 3.25;
    await submit('1.625', '1.625', 'Combined inputs', fields).expect(400);
    expect(comfy.submit).toHaveBeenCalledOnce();
  });
  it('accepts timed images separately and rejects malformed or unresolvable guides before submission', async () => {
    const keyframeImages = JSON.stringify(['data:image/jpeg;base64,/9j/2Q==']);
    await submit('1.625', '1.625', 'Timed pose', { keyframes: JSON.stringify([{ frame: 24, imageIndex: 0 }]), keyframeImages }).expect(202);
    expect(comfy.submit.mock.calls[0][1].keyframes).toEqual([{ frame: 24, imageIndex: 0 }]);
    expect(comfy.submit.mock.calls[0][2]).toEqual([]);
    expect(comfy.submit.mock.calls[0][3][0]).toBeInstanceOf(Blob);
    for (const keyframes of ['{', JSON.stringify([{ frame: 24, imageIndex: 1 }]), JSON.stringify([{ frame: 24, imageIndex: 0 }, { frame: 24, imageIndex: 0 }]), JSON.stringify([{ frame: 148, imageIndex: 0 }])]) {
      await submit('1.625', '1.625', 'Bad guide', { keyframes, keyframeImages }).expect(400);
    }
    await submit('1.625', '1.625', 'Missing image', { keyframes: JSON.stringify([{ frame: 24, imageIndex: 0 }]) }).expect(400);
    expect(comfy.submit).toHaveBeenCalledOnce();
  });
  it('accepts 7,000 prompt characters after line-ending normalization and rejects 7,001 without submitting', async () => {
    const prompt = `${'A'.repeat(6997)}\nB\n`;
    await submit('1.625', '1.625', prompt.replaceAll('\n', '\r\n')).expect(202);
    expect(comfy.submit.mock.calls[0][1].prompt).toBe(prompt);
    const response = await submit('1.625', '1.625', `${prompt}C`).expect(400);
    expect(response.body.error).toContain('7,000 characters or fewer');
    expect(comfy.submit).toHaveBeenCalledOnce();
  });
  it.each(['0', '123456789', '9007199254740991'])('forwards fixed seed %s exactly', async seed => {
    await submit('1.625', '1.625', 'Seeded scene', { seed }).expect(202);
    expect(comfy.submit.mock.calls[0][1].seed).toBe(Number(seed));
  });
  it.each(['', ' ', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', 'random'])('rejects invalid seed %s before submission', async seed => {
    await submit('1.625', '1.625', 'Seeded scene', { seed }).expect(400);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('validates Turbo at preflight and submission, including explicit false', async () => {
    comfy.check.mockResolvedValue({ ready: true });
    await request(app).get('/api/comfy/status?turbo=true&imageGuides=true').expect(200);
    expect(comfy.check).toHaveBeenCalledWith('standard', undefined, true, true, false, true);
    await request(app).get('/api/comfy/status?turbo=invalid').expect(400);
    for (const turbo of ['true', 'false']) {
      await submit('1.625', '1.625', 'Turbo scene', { turbo }).expect(202);
      expect(comfy.submit.mock.calls.at(-1)![1].turbo).toBe(turbo === 'true');
    }
    for (const turbo of ['', '1', 'yes']) await submit('1.625', '1.625', 'Invalid Turbo', { turbo }).expect(400);
    expect(comfy.submit).toHaveBeenCalledTimes(2);
  });
  it('passes validated clip provenance with all generation fields and rejects invalid metadata before submitting', async () => {
    const clipOrigin = clipOriginSchema.parse(clipMetadata);
    await submit('1.625', '1.625', 'Exact prompt', { clipOrigin: JSON.stringify(clipOrigin), mode: 'custom', resolution: 'native',
      lora: 'h3.safetensors', loraStrength: '0.7', maskInjection: 'standard', audioMaskTransitionMs: '250', videoMaskTransitionMs: '750',
      audioMaskCurve: JSON.stringify(defaultMaskCurve(1.625, 1.625, 250)), videoMaskCurve: JSON.stringify(defaultMaskCurve(1.625, 1.625, 750)) }).expect(202);
    expect(comfy.submit.mock.calls[0][1].clipOrigin).toEqual(clipOrigin);
    for (const value of ['{', JSON.stringify({ ...clipOrigin, version: 2 }), ' '.repeat(MAX_CLIP_METADATA_BYTES + 1)]) {
      await submit('1.625', '1.625', 'Invalid origin', { clipOrigin: value }).expect(400);
    }
    expect(comfy.submit).toHaveBeenCalledOnce();
  });
  it('checks LoRA addresses behind authentication and passes selections into generation', async () => {
    const address = 'iris-animation__h3.safetensors';
    comfy.resolveLora.mockResolvedValue(address);
    await request(app).post('/api/comfy/loras/resolve').send({ model: 'h3', address }).expect(403);
    const resolve = (model: string, value: string) => request(app).post('/api/comfy/loras/resolve').set('x-sparko-request', '1').send({ model, address: value });
    await resolve('h3', address).expect(200, { model: 'h3', address, name: address });
    await resolve('nano-banana-2', address).expect(400);
    await resolve('h3', 'https://example.com/secret.safetensors').expect(400);
    expect(comfy.resolveLora).toHaveBeenCalledTimes(1);
    await submit('1.625', '1.625', 'With LoRA', { lora: address }).expect(202);
    expect(comfy.submit.mock.calls[0][1].lora).toBe(address);
    await submit('1.625', '1.625', 'Invalid LoRA', { lora: '../secret.safetensors' }).expect(400);
    expect(comfy.submit).toHaveBeenCalledTimes(1);
    vi.stubEnv('APP_PASSWORD', 'workspace-secret');
    await resolve('h3', address).expect(401);
    expect(comfy.resolveLora).toHaveBeenCalledTimes(1);
  });
  it.each(['0', '0.65', '1.4', '-0.5'])('parses multipart LoRA strength %s', async loraStrength => {
    await submit('1.625', '1.625', 'With LoRA', { lora: 'h3.safetensors', loraStrength }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ lora: 'h3.safetensors', loraStrength: Number(loraStrength) });
  });
  it.each(['', ' ', 'bad', 'NaN', 'Infinity', '-101', '101'])('rejects invalid multipart strength %s before generation', async loraStrength => {
    await submit('1.625', '1.625', 'With LoRA', { lora: 'h3.safetensors', loraStrength }).expect(400);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('validates separate pin curves before submitting a job',async()=>{
    const video=defaultMaskCurve(1.625,1.625,500),audio={...video,interpolation:'smooth'};
    await submit('1.625','1.625','With curves',{videoMaskCurve:JSON.stringify(video),audioMaskCurve:JSON.stringify(audio)}).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({videoMaskCurve:video,audioMaskCurve:audio});
    for(const videoMaskCurve of ['{broken',JSON.stringify({...video,start:[]}),JSON.stringify({...video,end:[]}),JSON.stringify({...video,start:[{position:0,strength:0},{position:1,strength:.5}]}),JSON.stringify({...video,interpolation:'unknown'})]){
      await submit('1.625','1.625','Bad curve',{videoMaskCurve}).expect(400);
    }
    expect(comfy.submit).toHaveBeenCalledTimes(1);
  });
  it('accepts prompt-only loops and validates independent image endpoints before submission', async () => {
    const send = (fields: Record<string, string>) => request(app).post('/api/comfy/interstitials').set('x-sparko-request', '1')
      .field({ before: '0', after: '0', duration: '6', mode: 'custom', prompt: 'A new scene', width: '960', height: '544', ...fields });
    await send({ mode: 'loop', loopImageGuide: 'false' }).expect(202);
    expect(comfy.submit.mock.calls[0][0]).toBeUndefined();
    const image = 'data:image/jpeg;base64,/9j/4AH/2Q==';
    await send({ imageReferences: JSON.stringify([image, image]), startImageIndex: '1', endImageIndex: '0' }).expect(202);
    expect(comfy.submit.mock.calls[1][1]).toMatchObject({ startImageIndex: 1, endImageIndex: 0 });
    await send({ startImageIndex: '0' }).expect(400);
    await send({ imageReferences: JSON.stringify([image]), endImageIndex: '1' }).expect(400);
    await send({ imageReferences: JSON.stringify([image, image]), startImageIndex: '1', endImageIndex: '0', mode: 'loop' }).expect(400);
    expect(comfy.submit).toHaveBeenCalledTimes(2);
    comfy.check.mockResolvedValue({ ready: true });
    await request(app).get('/api/comfy/status?imageGuides=true').expect(200);
    expect(comfy.check).toHaveBeenCalledWith('standard', undefined, true, true);
  });
  it('passes ordered images alongside footage and requests image-reference preflight', async () => {
    const image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 1, 255, 217]).toString('base64')}`;
    comfy.check.mockResolvedValue({ ready: true });
    await request(app).get('/api/comfy/status?imageReferences=true').expect(200);
    expect(comfy.check).toHaveBeenCalledWith('standard', undefined, true);
    await submit('1.625', '1.625', 'Use <Picture 1>', { imageReferences: JSON.stringify([image]) }).expect(202);
    expect(comfy.submit.mock.calls[0][2]).toHaveLength(1);
    expect(comfy.submit.mock.calls[0][2][0].type).toBe('image/jpeg');
    expect([...new Uint8Array(await comfy.submit.mock.calls[0][2][0].arrayBuffer())]).toEqual([255, 216, 255, 224, 1, 255, 217]);
  });
  it.each(['invalid json', JSON.stringify(['https://example.com/image.jpg']), JSON.stringify(['data:image/jpeg;base64,YmFk']), JSON.stringify(Array(10).fill('data:image/jpeg;base64,/9j/2Q=='))])('rejects malformed or excessive image references before submission: %s', async imageReferences => {
    await submit('1.625', '1.625', 'Image reference', { imageReferences }).expect(400);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('validates resolution and requests the selected 2K capabilities and native sampling canvas',async()=>{
    comfy.check.mockResolvedValue({ready:true});await request(app).get('/api/comfy/status?resolution=2k').expect(200);expect(comfy.check).toHaveBeenCalledWith('standard','2k');
    await request(app).get('/api/comfy/status?resolution=4k').expect(400);
    await submit('1.625','1.625','Large scene',{resolution:'2k'}).expect(202);expect(comfy.submit.mock.calls[0][1]).toMatchObject({resolution:'2k',width:1344,height:768});
    await request(app).post('/api/comfy/interstitials').set('x-sparko-request','1').field({before:'0',after:'0',duration:'6',mode:'custom',prompt:'A new scene',width:'320',height:'180',resolution:'2k'}).expect(202);
    expect(comfy.submit.mock.calls[1][1]).toMatchObject({resolution:'2k',width:1344,height:768});
    await submit('1.625','1.625','Invalid',{resolution:'4k'}).expect(400);expect(comfy.submit).toHaveBeenCalledTimes(2);
    await request(app).post('/api/comfy/interstitials').set('x-sparko-request','1').field({before:'0',after:'0',duration:'2',mode:'custom',prompt:'Too short',width:'960',height:'544',resolution:'2k'}).expect(400);expect(comfy.submit).toHaveBeenCalledTimes(2);
  });
  it.each([['0', '1.625'], ['1.625', '0']])('accepts one connected reference (%s / %s)', async (before, after) => {
    mediaDuration = 1.625;
    await submit(before, after, 'One reference', { mode: 'custom' }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ before: Number(before), after: Number(after), mode: 'custom' });
  });
  it('submits without any reference upload when both switches are off', async () => {
    await request(app).post('/api/comfy/interstitials').set('x-sparko-request', '1').field({ before: '0', after: '0', duration: '6', mode: 'custom', prompt: 'A new scene', width: '960', height: '544' }).expect(202);
    expect(comfy.submit).toHaveBeenCalledWith(undefined, expect.objectContaining({ before: 0, after: 0, width: 960, height: 544, hasAudio: false }));
  });
  it('validates the reference and dispatches to Comfy', async () => {
    await submit().expect(202);
    expect(comfy.submit).toHaveBeenCalledWith(expect.any(Blob), { mode: 'bridge', maskInjection: 'standard', audioMaskTransitionMs: 500, videoMaskTransitionMs: 500, before: 1.625, after: 1.625, duration: 6, prompt: 'Bridge this scene', width: 1280, height: 736, hasAudio: true });
  });
  it.each([[0, 500], [500, 0], [250, 1000], [4000, 200]])('passes independent audio %i / video %i ms transitions', async (audioMaskTransitionMs, videoMaskTransitionMs) => {
    await submit('1.625', '1.625', 'Soft reference joins', { audioMaskTransitionMs: String(audioMaskTransitionMs), videoMaskTransitionMs: String(videoMaskTransitionMs) }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ audioMaskTransitionMs, videoMaskTransitionMs });
    expect(comfy.submit.mock.calls[0][1]).not.toHaveProperty('maskTransitionMs');
  });
  for (const field of ['audioMaskTransitionMs', 'videoMaskTransitionMs']) {
    it(`defaults the other duration independently when only ${field} is supplied`, async () => {
      await submit('1.625', '1.625', 'One transition off', { [field]: '0' }).expect(202);
      expect(comfy.submit.mock.calls[0][1]).toMatchObject({ audioMaskTransitionMs: 500, videoMaskTransitionMs: 500, [field]: 0 });
    });
    it.each(['-1', '4001', 'NaN', 'Infinity', '1.5'])(`rejects invalid ${field} before generation: %s`, async value => {
      await submit('1.625', '1.625', 'Invalid transition', { [field]: value }).expect(400);
      expect(comfy.submit).not.toHaveBeenCalled();
    });
  }
  it('migrates the shared duration while preserving an explicit independent zero', async () => {
    await submit('1.625', '1.625', 'Legacy transition', { maskTransitionMs: '750', audioMaskTransitionMs: '0' }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ audioMaskTransitionMs: 0, videoMaskTransitionMs: 750 });
    expect(comfy.submit.mock.calls[0][1]).not.toHaveProperty('maskTransitionMs');
  });
  it.each(['true', 'false'])('migrates the legacy interpolation switch: %s', async interpolateMiddle => {
    await submit('1.625', '1.625', 'Exact prompt', { interpolateMiddle }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ maskInjection: 'standard', prompt: 'Exact prompt' });
  });
  it.each(['standard', 'uniform', 'vignette'])('normalizes retired masks to native generation: %s', async maskInjection => {
    await submit('1.625', '1.625', 'Exact prompt', { maskInjection }).expect(202);
    expect(comfy.submit.mock.calls[0][1]).toMatchObject({ maskInjection: 'standard', prompt: 'Exact prompt' });
  });
  it('rejects malformed legacy mask settings', async () => {
    await submit('1.625', '1.625', 'Exact', { interpolateMiddle: 'yes' }).expect(400);
    await submit('1.625', '1.625', 'Exact', { maskInjection: 'unknown' }).expect(400);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('normalizes transport line endings without rewriting the entered prompt', async () => {
    await submit('1.625', '1.625', 'First direction.\r\n\r\nSecond direction.').expect(202);
    expect(comfy.submit.mock.calls[0][1].prompt).toBe('First direction.\n\nSecond direction.');
  });
  it('rejects off-grid windows, missing context, and unavailable providers before submission', async () => {
    await submit('2', '2').expect(400);
    await submit('1', '1.625').expect(400);
    providers.configured.comfy = false; await submit().expect(503);
    expect(comfy.submit).not.toHaveBeenCalled();
  });
  it('requires same-origin mutation headers and workspace authentication', async () => {
    await request(app).post('/api/comfy/interstitials').expect(403);
    vi.stubEnv('APP_PASSWORD', 'workspace-secret');
    await request(app).get('/api/comfy/jobs/comfy-job-123').expect(401);
    await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(401);
    await request(app).get('/api/comfy/assets/comfy-asset-123/content').expect(401);
    expect(comfy.status).not.toHaveBeenCalled(); expect(comfy.assetUrl).not.toHaveBeenCalled();
    expect(comfy.events).not.toHaveBeenCalled();
  });
  it('delivers live events without caching and closes the cloud subscription when done', async () => {
    comfy.events.mockImplementation(async function* () {
      yield { type: 'progress', progress: .4, progressDetails: { stage: 'Generating video and audio', step: 8, steps: 20 } };
      yield { type: 'refresh' };
    });
    const response = await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-transform');
    expect(response.text).toContain('event: progress\n');
    expect(response.text).toContain('"step":8,"steps":20');
    expect(response.text).toContain('event: refresh\n');
    expect(comfy.events.mock.calls[0][1].aborted).toBe(true);
    expect(comfy.cancel).not.toHaveBeenCalled();
  });
  it('falls back to polling on an upstream stream failure without exposing provider details', async () => {
    comfy.events.mockImplementation(async function* () { throw new Error('private-key'); });
    const response = await request(app).get('/api/comfy/jobs/comfy-job-123/events').expect(200);
    expect(response.text).toBe('event: fallback\ndata: {}\n\n');
    expect(comfy.cancel).not.toHaveBeenCalled();
    await request(app).get('/api/comfy/jobs/invalid/events').expect(400);
  });
  it('streams private output bytes with range support without forwarding application credentials', async () => {
    comfy.assetUrl.mockResolvedValue('https://storage.example/video.mp4?signed=fresh');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 0-2/10', 'Content-Length': '3' } }));
    vi.stubGlobal('fetch', transport);
    const response = await request(app).get('/api/comfy/assets/comfy-asset-123/content').set('Range', 'bytes=0-2').expect(206);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-range']).toBe('bytes 0-2/10');
    expect(response.body).toEqual(Buffer.from([1, 2, 3]));
    expect(transport.mock.calls[0][1]?.headers).toEqual({ Range: 'bytes=0-2' });
  });
  it('reports failed media connections as recoverable downloads instead of generic server errors', async () => {
    comfy.assetUrl.mockResolvedValue('https://storage.example/video.mp4?signed=private');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const response = await request(app).get('/api/comfy/assets/comfy-asset-123/content').expect(502);
    expect(response.body.error).toContain('downloading the generated video');
    expect(response.body.error).toContain('no new generation is needed');
    expect(response.text).not.toContain('signed=private');
    expect(comfy.submit).not.toHaveBeenCalled();
  });
});
