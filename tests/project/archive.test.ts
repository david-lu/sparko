import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { assetIds, emptyAnalysis, type Asset, type Project } from '../../src/features/project/types';
import { hasUnsubmittedChanges, interstitialSettings } from '../../shared/interstitials';
import { defaultMaskCurve } from '../../shared/mask-curves';

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
  it('preserves reference analysis preferences without marking a render as changed', async () => {
    const snapshot = structuredClone(project), item = snapshot.interstitials[0];
    item.analyzeReferences = false; item.generationSettings = interstitialSettings(item); item.analyzeReferences = true;
    const restored = (await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress)).project.interstitials[0];
    expect(restored.analyzeReferences).toBe(true);
    expect(restored.generationSettings?.analyzeReferences).toBe(false);
    expect(hasUnsubmittedChanges(restored)).toBe(false);
  });
  it('retains intentionally missing references without packaging their deleted media', async () => {
    const snapshot = structuredClone(project);
    snapshot.deletedAssetIds = [sourceId, sceneId];
    snapshot.interstitials[0].imageReferences = [{ assetId: sourceId, name: 'Deleted reference' }];
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.assets).toHaveLength(1);
    expect(restored.assets[0].id).toBe(restored.project.subtitle!.assetId);
    expect(restored.project.deletedAssetIds).toContain(restored.project.source.assetId);
    expect(restored.project.deletedAssetIds).toContain(restored.project.interstitials[1].result!.assetId);
    expect(restored.project.interstitials[0].imageReferences![0]).toEqual({ assetId: restored.project.source.assetId, name: 'Deleted reference' });
    expect(restored.project.deletedAssetIds).not.toContain(sourceId);
    expect(assetIds(restored.project)).toEqual([restored.project.subtitle!.assetId]);
    await expect(packProject(restored.project, restored.assets, signal(), progress)).resolves.toBeInstanceOf(Blob);
  });
  it.each([undefined, 0, Number.MAX_SAFE_INTEGER])('preserves the seed setting (%s), submitted seed and template settings', async seed => {
    const snapshot = structuredClone(project), item = snapshot.interstitials[0];
    item.seed = seed; item.requestSeed = 42; item.generationSettings = interstitialSettings(item);
    const node = { id: 'seed-node', name: 'Seed clip', kind: 'simple' as const, interstitialId: item.id, x: 0, y: 0, loopCount: 0 };
    snapshot.storyFlow = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [{ id: 'seed-template', name: 'Seed', entryId: node.id, nodes: [node], edges: [], settings: { [node.id]: interstitialSettings(item) } }] };
    const restored = (await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress)).project;
    for (const settings of [restored.interstitials[0], restored.interstitials[0].generationSettings, restored.storyFlow!.templates[0].settings[node.id]]) expect(settings?.seed).toBe(seed);
    expect(restored.interstitials[0].requestSeed).toBe(42);
    expect(hasUnsubmittedChanges(restored.interstitials[0])).toBe(false);
  });
  it('opens legacy subtitle library entries while retaining the separate subtitle track', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const legacy = await rewrite(blob, value => { value.project.library = [
      { assetId: sourceId, name: 'source.mp4', kind: 'video' },
      { assetId: subtitleId, name: 'subtitles.vtt', kind: 'subtitle' },
    ]; });
    const restored = await unpackProject(legacy, signal(), progress);
    expect(restored.project.library).toEqual([{ assetId: restored.project.source.assetId, name: 'source.mp4', kind: 'video' }]);
    const track = restored.assets.find(asset => asset.id === restored.project.subtitle?.assetId)!;
    expect(track.name).toBe('subtitles.vtt'); expect(await track.blob.text()).toBe('WEBVTT\n');
  });
  it('retains mask pins and Bézier handles in drafts, submitted settings, and templates',async()=>{
    const snapshot=structuredClone(project),item=snapshot.interstitials[0];
    item.videoMaskCurve=defaultMaskCurve(2,2,500);item.videoMaskCurve.interpolation='bezier';
    item.videoMaskCurve.start[0].out={influence:.4,strength:.25};
    item.audioMaskCurve={...defaultMaskCurve(2,2,1000),interpolation:'smooth'};
    item.generationSettings=interstitialSettings(item);
    const node={id:'mask-node',name:'Mask clip',kind:'simple' as const,interstitialId:item.id,x:0,y:0,loopCount:0};
    snapshot.storyFlow={version:1,entryId:node.id,nodes:[node],edges:[],templates:[{id:'mask-template',name:'Masks',entryId:node.id,nodes:[node],edges:[],settings:{[node.id]:interstitialSettings(item)}}]};
    const restored=await unpackProject(await packProject(snapshot,media,signal(),progress),signal(),progress);
    for(const settings of [restored.project.interstitials[0],restored.project.interstitials[0].generationSettings,restored.project.storyFlow!.templates[0].settings[node.id]]){
      expect(settings?.videoMaskCurve).toEqual(item.videoMaskCurve);expect(settings?.audioMaskCurve).toEqual(item.audioMaskCurve);
    }
    expect(hasUnsubmittedChanges(restored.project.interstitials[0])).toBe(false);
  });
  it('retains images used only by submitted settings or templates and remaps their IDs on import', async () => {
    const images = ['character.jpg', 'style.jpg', 'template.jpg'].map(name => ({ id: crypto.randomUUID(), name, blob: new Blob([name], { type: 'image/jpeg' }) }));
    const refs = images.map(image => ({ assetId: image.id, name: image.name }));
    const snapshot = structuredClone(project), item = snapshot.interstitials[0];
    item.imageReferences = [refs[0]]; item.startReferenceType = 'image'; item.endReferenceType = 'none'; item.startImageIndex = 0;
    item.generationSettings = interstitialSettings(item);
    expect(hasUnsubmittedChanges(item)).toBe(false);
    item.imageReferences = [refs[1]];
    expect(hasUnsubmittedChanges(item)).toBe(true);
    const node = { id: 'node', name: 'Scene', kind: 'simple' as const, interstitialId: item.id, x: 0, y: 0, loopCount: 0 };
    snapshot.storyFlow = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [{ id: 'template', name: 'Saved images', entryId: node.id,
      nodes: [node], edges: [], settings: { [node.id]: { ...interstitialSettings(item), imageReferences: [refs[2]] } } }] };
    expect(assetIds(snapshot)).toEqual(expect.arrayContaining(images.map(image => image.id)));
    await expect(packProject(snapshot, media, signal(), progress)).rejects.toThrow('asset is missing');
    const restored = await unpackProject(await packProject(snapshot, [...media, ...images], signal(), progress), signal(), progress);
    const idFor = (name: string) => restored.assets.find(asset => asset.name === name)!.id;
    expect(restored.project.interstitials[0].imageReferences).toEqual([{ name: 'style.jpg', assetId: idFor('style.jpg') }]);
    expect(restored.project.interstitials[0].generationSettings!.imageReferences).toEqual([{ name: 'character.jpg', assetId: idFor('character.jpg') }]);
    expect(restored.project.storyFlow!.templates[0].settings.node.imageReferences).toEqual([{ name: 'template.jpg', assetId: idFor('template.jpg') }]);
    for (const settings of [restored.project.interstitials[0], restored.project.interstitials[0].generationSettings, restored.project.storyFlow!.templates[0].settings.node]) {
      expect(settings).toMatchObject({ startReferenceType: 'image', endReferenceType: 'none', startImageIndex: 0 });
    }
    expect(idFor('style.jpg')).not.toBe(images[1].id);
    expect(hasUnsubmittedChanges(restored.project.interstitials[0])).toBe(true);
  });
  it('preserves timed keyframes in draft, submitted settings and templates, remapping their image assets', async () => {
    const images = ['draft-pose.jpg', 'submitted-pose.jpg', 'template-pose.jpg'].map(name => ({ id: crypto.randomUUID(), name, blob: new Blob([name], { type: 'image/jpeg' }) }));
    const pose = (i: number) => ({ id: `pose-${i}`, frame: 24 * (i + 1), enabled: i !== 2, image: { assetId: images[i].id, name: images[i].name } });
    const snapshot = structuredClone(project), item = snapshot.interstitials[0];
    item.keyframes = [pose(1)]; item.generationSettings = interstitialSettings(item);
    item.keyframes = [pose(0)];
    const node = { id: 'node', name: 'Scene', kind: 'simple' as const, interstitialId: item.id, x: 0, y: 0, loopCount: 0 };
    snapshot.storyFlow = { version: 1, entryId: node.id, nodes: [node], edges: [], templates: [{ id: 'poses', name: 'Poses', entryId: node.id, nodes: [node], edges: [], settings: { node: { ...interstitialSettings(item), keyframes: [pose(2)] } } }] };
    expect(assetIds(snapshot)).toEqual(expect.arrayContaining(images.map(image => image.id)));
    const restored = await unpackProject(await packProject(snapshot, [...media, ...images], signal(), progress), signal(), progress);
    const settings = [restored.project.interstitials[0], restored.project.interstitials[0].generationSettings, restored.project.storyFlow!.templates[0].settings.node];
    settings.forEach((value, i) => expect(value?.keyframes).toEqual([{ ...pose(i), image: { ...pose(i).image, assetId: restored.assets.find(asset => asset.name === images[i].name)!.id } }]));
    expect(hasUnsubmittedChanges(restored.project.interstitials[0])).toBe(true);
  });
  it('saves and restores an empty project without a source asset',async()=>{
    const empty:Project={...project,source:{name:'Untitled project'},name:'Untitled project',interstitials:[],subtitle:null,library:[],storyFlow:{version:1,entryId:'',nodes:[],edges:[],templates:[]}};
    const restored=await unpackProject(await packProject(empty,[],signal(),progress),signal(),progress);
    expect(restored.assets).toEqual([]);expect(restored.project.source.assetId).toBeUndefined();expect(restored.project.storyFlow).toEqual(empty.storyFlow);
    await expect(packProject({...empty,storyFlow:undefined},[],signal(),progress)).rejects.toThrow(/missing its source video/);
  });
  it('stores the crossfade duration with the project', async () => {
    const snapshot = { ...project, crossfadeFrames: 14 };
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.project.crossfadeFrames).toBe(14);
  });
  it.each(['uniform', 'vignette'] as const)('opens archives with retired %s masks using native generation', async maskInjection => {
    const snapshot = structuredClone(project);
    const item = snapshot.interstitials[1];
    item.generationSettings = interstitialSettings(item);
    item.maskInjection = maskInjection;
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    const saved = restored.project.interstitials[1];
    expect(saved).toMatchObject({ maskInjection: 'standard', generationSettings: { maskInjection: 'standard' } });
    expect(hasUnsubmittedChanges(saved)).toBe(false);
    expect(interstitialSettings(restored.project.interstitials[0]).maskInjection).toBe('standard');
    saved.maskInjection = 'standard';
    expect(hasUnsubmittedChanges(saved)).toBe(false);
    delete saved.generationSettings!.maskInjection;
    expect(hasUnsubmittedChanges(saved)).toBe(false);
  });
  it.each([[0, 1000], [250, 0], [1000, 250], [4000, 500]])('preserves audio %i / video %i ms separately from submitted settings', async (audioMaskTransitionMs, videoMaskTransitionMs) => {
    const snapshot = structuredClone(project), item = snapshot.interstitials[1];
    item.generationSettings = interstitialSettings(item);
    Object.assign(item, { audioMaskTransitionMs, videoMaskTransitionMs });
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    const saved = restored.project.interstitials[1];
    expect(saved).toMatchObject({ audioMaskTransitionMs, videoMaskTransitionMs, generationSettings: { audioMaskTransitionMs: 500, videoMaskTransitionMs: 500 } });
    expect(hasUnsubmittedChanges(saved)).toBe(true);
    expect(restored.project.interstitials[0]).toMatchObject({ audioMaskTransitionMs: 500, videoMaskTransitionMs: 500 });
    saved.audioMaskTransitionMs = 500;
    expect(hasUnsubmittedChanges(saved)).toBe(videoMaskTransitionMs !== 500);
    saved.videoMaskTransitionMs = 500;
    expect(hasUnsubmittedChanges(saved)).toBe(false);
  });
  it.each([0, 750])('migrates a legacy shared %i ms duration in editable and submitted settings', async maskTransitionMs => {
    const blob = await packProject(project, media, signal(), progress);
    const legacy = await rewrite(blob, value => {
      const item = value.project.interstitials[1];
      delete item.audioMaskTransitionMs; delete item.videoMaskTransitionMs;
      item.maskTransitionMs = maskTransitionMs;
      item.generationSettings = { ...item };
    });
    const restored = await unpackProject(legacy, signal(), progress);
    const item = restored.project.interstitials[1];
    expect(item).toMatchObject({ audioMaskTransitionMs: maskTransitionMs, videoMaskTransitionMs: maskTransitionMs,
      generationSettings: { audioMaskTransitionMs: maskTransitionMs, videoMaskTransitionMs: maskTransitionMs } });
    expect(item.maskTransitionMs).toBeUndefined();
    expect(item.generationSettings!.maskTransitionMs).toBeUndefined();
    expect(hasUnsubmittedChanges(item)).toBe(false);
  });
  it('migrates the old interpolation toggle in editable and submitted archive settings', async () => {
    const blob = await packProject(project, media, signal(), progress);
    const legacy = await rewrite(blob, value => {
      const item = value.project.interstitials[1];
      delete item.maskInjection; item.interpolateMiddle = true;
      item.generationSettings = { ...interstitialSettings(item), maskInjection: undefined, interpolateMiddle: true };
    });
    const restored = await unpackProject(legacy, signal(), progress);
    const item = restored.project.interstitials[1];
    expect(item).toMatchObject({ maskInjection: 'standard', generationSettings: { maskInjection: 'standard' } });
    expect(hasUnsubmittedChanges(item)).toBe(false);
    expect(item.interpolateMiddle).toBeUndefined();
  });
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
    item.prompt = 'An updated scene'; item.duration = 8; item.enable_prompt_expansion = true; item.resolution='2k';
    const restored = await unpackProject(await packProject(snapshot, media, signal(), progress), signal(), progress);
    expect(restored.project.interstitials[1]).toMatchObject({ prompt: item.prompt, duration: 8, enable_prompt_expansion: true, resolution:'2k', generationSettings: {...item.generationSettings,resolution:'native'} });
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
