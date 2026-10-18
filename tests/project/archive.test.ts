import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Asset, type Project } from '../../src/features/project/types';
import { hasUnsubmittedChanges, interstitialSettings } from '../../shared/interstitials';

const sourceId = crypto.randomUUID(), sceneId = crypto.randomUUID(), subtitleId = crypto.randomUUID();
const project: Project = { id: 'old-project', name: 'A project', updatedAt: 123, source: { name: 'source.mp4', assetId: sourceId, url: 'https://example.com/source.mp4' },
  subtitle: { name: 'subtitles.vtt', assetId: subtitleId }, analysis: { ...emptyAnalysis(), instructions: 'Describe the scene' },
  interstitials: [
    { id: 'draft', label: 'Opening', time: 4, start_range: 2, end_range: 3, duration: 7.5, enable_prompt_expansion: true, prompt: 'A new scene', phase: 'draft' },
    { id: 'ready', label: 'Finished', time: 8, start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false, prompt: 'A forest', phase: 'ready', result: { url: 'https://fal.media/private-url.mp4', assetId: sceneId, start: 2, duration: 5, totalDuration: 9 } },
  ],
};
const media: Asset[] = [
  { id: sourceId, name: 'source.mp4', blob: new Blob([new Uint8Array([1, 2, 0, 255])], { type: 'video/mp4' }) },
  { id: sceneId, name: 'scene.mp4', blob: new Blob([new Uint8Array([5, 6, 7, 8])], { type: 'video/mp4' }) },
  { id: subtitleId, name: 'subtitles.vtt', blob: new Blob(['WEBVTT\n'], { type: 'text/vtt' }) },
];
const signal = () => new AbortController().signal;
const progress = () => undefined;
async function rewrite(blob: Blob, modify: (manifest: any) => void, omit?: string) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
  for (const entry of await reader.getEntries()) {
    if (entry.directory || entry.filename === omit) continue;
    if (entry.filename === 'project.json') { const manifest = JSON.parse(await entry.getData(new TextWriter())); modify(manifest); await writer.add(entry.filename, new TextReader(JSON.stringify(manifest))); }
    else await writer.add(entry.filename, new BlobReader(await entry.getData(new BlobWriter())));
  }
  await reader.close(); return writer.close();
}
describe('portable project archives', () => {
  it.each([false, true])('keeps the full idle preview when the loop is retained as a previous result: %s', async previous => {
    const full = { id: crypto.randomUUID(), name: 'idle-full.mp4', blob: new Blob(['reference, idle, reference'], { type: 'video/mp4' }) };
    const snapshot = structuredClone(project);
    const item = snapshot.interstitials[1];
    item.result = { ...item.result!, fullAssetId: full.id, fullRange: { start: 2, duration: 5, totalDuration: 9 } };
    if (previous) { item.previousResult = item.result; item.result = undefined; item.phase = 'error'; }
    const restored = await unpackProject(await packProject(snapshot, [...media, full], signal(), progress), signal(), progress);
    const result = previous ? restored.project.interstitials[1].previousResult! : restored.project.interstitials[1].result!;
    expect(result.fullAssetId).toBeTruthy();
    expect(result.fullAssetId).not.toBe(full.id);
    expect(result.fullAssetId).not.toBe(result.assetId);
    expect(result.fullRange).toEqual({ start: 2, duration: 5, totalDuration: 9 });
    expect(await restored.assets.find(asset => asset.id === result.fullAssetId)!.blob.text()).toBe(await full.blob.text());
    await expect(packProject(snapshot, media, signal(), progress)).rejects.toThrow(/missing/);
  });
  it('preserves Comfy selection, submitted provider, and exact output boundaries', async () => {
    const snapshot = structuredClone(project);
    const item = snapshot.interstitials[0];
    item.method = 'comfy'; item.requestMethod = 'comfy';
    item.requestInsertion = { start: 39 / 24, duration: 148 / 24, totalDuration: 226 / 24 };
    item.generationSettings = interstitialSettings(item);
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.project.interstitials[0]).toMatchObject({ method: 'comfy', requestMethod: 'comfy', requestInsertion: item.requestInsertion, generationSettings: { method: 'comfy' } });
  });
  it('marks a pending legacy job as Fal when its old archive omitted the submitted provider', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const legacy = await rewrite(blob, value => {
      const item = value.project.interstitials[0];
      item.method = 'fal'; item.phase = 'queued'; item.requestId = 'legacy-job-1234';
      item.generationSettings = { method: 'fal', start_range: 2, end_range: 3, duration: 7.5, prompt: 'A new scene', enable_prompt_expansion: true };
      delete item.requestMethod;
    });
    const restored = await unpackProject(legacy, signal(), progress);
    expect(restored.project.interstitials[0]).toMatchObject({ method: 'comfy', requestMethod: 'fal', generationSettings: { method: 'comfy' } });
  });
  it('includes and remaps the retained original alongside the prepared working video', async () => {
    const original = { id: crypto.randomUUID(), name: 'original.mp4', blob: new Blob(['original bytes']) };
    const snapshot = { ...project, source: { ...project.source, originalAssetId: original.id } };
    const restored = await unpackProject(await packProject(snapshot, [...media, original], signal(), progress), signal(), progress);
    expect(restored.project.source.originalAssetId).toBeTruthy();
    expect(restored.project.source.originalAssetId).not.toBe(original.id);
    expect(restored.project.source.originalAssetId).not.toBe(restored.project.source.assetId);
    expect(await restored.assets.find(asset => asset.id === restored.project.source.originalAssetId)!.blob.text()).toBe('original bytes');
    await expect(packProject(snapshot, media, signal(), progress)).rejects.toThrow(/missing/);
  });
  it('round-trips binary assets, metadata and subtitles without remote or session URLs', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const reader = new ZipReader(new BlobReader(blob));
    const entry = (await reader.getEntries()).find(entry => entry.filename === 'project.json')!;
    const manifest = entry.directory ? '' : await entry.getData(new TextWriter()); await reader.close();
    expect(manifest).not.toMatch(/https:|blob:/);
    const restored = await unpackProject(blob, signal(), progress);
    expect(restored.project.id).not.toBe(project.id);
    expect(restored.project.interstitials[0]).toMatchObject({ ...project.interstitials[0], method: 'comfy' });
    expect(restored.project.interstitials.map(item => item.enable_prompt_expansion)).toEqual([true, false]);
    expect(restored.project.interstitials[1].result).toMatchObject({ start: 2, duration: 5, totalDuration: 9 });
    expect(restored.project.source.assetId).not.toBe(sourceId);
    expect(restored.assets.map(asset => asset.id)).toContain(restored.project.source.assetId);
    for (let i = 0; i < media.length; i++) expect(await restored.assets[i].blob.arrayBuffer()).toEqual(await media[i].blob.arrayBuffer());
  });
  it('rejects missing media, unsupported versions and invalid frame boundaries', async () => {
    const blob = await packProject(project, media, signal(), progress);
    await expect(unpackProject(await rewrite(blob, () => {}, `assets/${sceneId}`), signal(), progress)).rejects.toThrow(/missing|duplicate/i);
    await expect(unpackProject(await rewrite(blob, value => { value.version = 99; }), signal(), progress)).rejects.toThrow(/version/);
    await expect(unpackProject(await rewrite(blob, value => { value.project.interstitials[1].result.start = 100; }), signal(), progress)).rejects.toThrow(/boundaries/);
    await expect(unpackProject(await rewrite(blob, value => { value.project.interstitials[0].duration = 14; }), signal(), progress)).rejects.toThrow(/metadata/);
    await expect(unpackProject(await rewrite(blob, value => { value.project.interstitials[0].enable_prompt_expansion = 'false'; }), signal(), progress)).rejects.toThrow(/metadata/);
  });
  it('opens older archives with default duration and prompt expansion settings', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const legacy = await rewrite(blob, value => { for (const item of value.project.interstitials) { delete item.duration; delete item.enable_prompt_expansion; } });
    const restored = await unpackProject(legacy, signal(), progress);
    expect(restored.project.interstitials.map(item => item.duration)).toEqual([6, 6]);
    expect(restored.project.interstitials.map(item => item.enable_prompt_expansion)).toEqual([false, false]);
  });
  it('preserves submitted settings separately from edits made after generation', async () => {
    const snapshot = structuredClone(project);
    const item = snapshot.interstitials[1];
    item.generationSettings = interstitialSettings(item);
    item.prompt = 'An updated scene'; item.duration = 8; item.enable_prompt_expansion = true;
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.project.interstitials[1]).toMatchObject({ prompt: item.prompt, duration: 8, enable_prompt_expansion: true, generationSettings: item.generationSettings });
    expect(hasUnsubmittedChanges(restored.project.interstitials[1])).toBe(true);
  });
  it('rejects corrupt asset bytes instead of silently importing them', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const index = bytes.findIndex((value, i) => value === 1 && bytes[i + 1] === 2 && bytes[i + 2] === 0 && bytes[i + 3] === 255);
    expect(index).toBeGreaterThan(0); bytes[index] ^= 0xff;
    await expect(unpackProject(new Blob([bytes]), signal(), progress)).rejects.toThrow();
  });
  it('retains queued jobs and turns interrupted preparation back into a draft', async () => {
    const snapshot = structuredClone(project);
    snapshot.interstitials[0].phase = 'preparing';
    snapshot.interstitials.push({ ...project.interstitials[0], id: 'queued', phase: 'queued', requestId: 'pending-job-1234' });
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.project.interstitials[0].phase).toBe('draft');
    expect(restored.project.interstitials[2]).toMatchObject({ phase: 'queued', requestId: 'pending-job-1234' });
  });
  it.each(['queued', 'error', 'cancelled', 'preparing'] as const)('includes the playable video while its replacement is %s', async phase => {
    const snapshot = structuredClone(project);
    const item = snapshot.interstitials[1];
    item.previousResult = item.result; item.result = undefined; item.phase = phase; item.requestId = 'replacement-job-1234';
    const blob = await packProject(snapshot, media, signal(), progress);
    const restored = await unpackProject(blob, signal(), progress);
    const retained = restored.project.interstitials[1];
    expect(retained).toMatchObject({ phase: phase === 'preparing' ? 'draft' : phase, requestId: item.requestId, result: undefined });
    expect(retained.previousResult).toMatchObject({ start: 2, duration: 5, totalDuration: 9 });
    expect(retained.previousResult!.assetId).not.toBe(sceneId);
    expect(retained.previousResult!.url).toBe(`asset:${retained.previousResult!.assetId}`);
    expect(await restored.assets.find(asset => asset.id === retained.previousResult!.assetId)!.blob.arrayBuffer()).toEqual(await media[1].blob.arrayBuffer());
    await expect(packProject(snapshot, media.filter(asset => asset.id !== sceneId), signal(), progress)).rejects.toThrow(/missing/);
  });
  it('supports cancelling export and import', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(packProject(project, media, abort.signal, progress)).rejects.toThrow();
    await expect(unpackProject(new Blob(), abort.signal, progress)).rejects.toThrow();
  });
});
