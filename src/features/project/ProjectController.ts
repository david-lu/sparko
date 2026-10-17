import type { MediaSource } from '../../media/media';
import { MediaEngine } from '../../media/MediaEngine';
import { prepareVideo } from '../../media/prepareVideo';
import type { InterstitialController } from '../interstitials/InterstitialController';
import { loadInterstitials } from '../interstitials/storage';
import { assets } from './assets';
import { readActiveProject, readAsset, readProject, storageError, writeProject } from './database';
import { assetIds, emptyAnalysis, type AnalysisState, type Asset, type Project } from './types';
import { TIMELINE_FPS } from '../../../shared/constants';
import { createTimelineExample, groupCallResponse, responseInterstitialIds, type CallResponseFlow } from '../call-response/model';

type State = { project: Project | null; source: MediaSource | null; subtitle: { name: string; url: string } | null;
  busy: boolean; message: string; progress: number | null; error: string | null };

/** Owns project persistence and portable snapshots; media and job controllers stay independent. */
export class ProjectController {
  private state: State = { project: null, source: null, subtitle: null, busy: false, message: '', progress: null, error: null };
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private switching = false;
  private writes: Promise<void> = Promise.resolve();
  private operation: AbortController | null = null;
  constructor(private interstitials: InterstitialController) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  clearError() { this.update({ error: null }); }
  private save(project: Project) {
    this.update({ project });
    this.writes = this.writes.catch(() => undefined).then(() => writeProject(project));
    void this.writes.catch(error => this.update({ error: storageError(error) }));
  }
  async init(defaultSource: MediaSource, exampleUrl?: string) {
    this.unsubscribe ??= this.interstitials.subscribe(() => {
      const project = this.state.project;
      if (!project || this.switching || project.interstitials === this.interstitials.getSnapshot().items) return;
      this.save({ ...project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() });
    });
    await this.task('Opening saved project', async signal => {
      const saved = await readActiveProject() || await readProject(defaultSource.id);
      if (saved) await this.activate(saved, signal);
      else if (exampleUrl) await this.loadExample(exampleUrl, signal);
      else await this.activate(this.create(defaultSource), signal);
    });
  }
  private async activate(project: Project, signal: AbortSignal, pendingAssets: Asset[] = []) {
    signal.throwIfAborted();
    if (project.callResponse) {
      const existing = project.callResponse.interstitial;
      const grouped = groupCallResponse(project.callResponse);
      if (!existing) grouped.interstitial.time = project.interstitials.find(item => grouped.scenes.some(scene => scene.interstitialId === item.id))?.time ?? grouped.interstitial.time;
      project = { ...project, callResponse: grouped };
    }
    ({ project, pendingAssets } = await this.prepareSource(project, pendingAssets, signal));
    project = { ...project, interstitials: project.interstitials.map(item => ['preparing', 'uploading'].includes(item.phase) ? { ...item, phase: 'draft' } : item) };
    this.update({ message: 'Saving prepared project', progress: null });
    await this.writes;
    await writeProject(project, pendingAssets, true, signal);
    const { asset, url } = await assets.open(project.source.assetId!);
    const source: MediaSource = { id: project.id, name: project.source.name, url, assetId: asset.id, file: new File([asset.blob], project.source.name, { type: asset.blob.type }) };
    const subtitle = project.subtitle ? { name: project.subtitle.name, url: (await assets.open(project.subtitle.assetId)).url } : null;
    // Restore retained renders before publishing the timeline, including failed/cancelled retries.
    await Promise.all([...new Set([...project.interstitials.flatMap(item => [item.previousResult?.assetId, ...(project.callResponse ? [item.result?.assetId] : [])]), ...(project.callResponse?.scenes.map(scene => scene.clip.assetId) ?? [])]
      .filter((id): id is string => !!id))].map(id => assets.open(id)));
    signal.throwIfAborted();
    this.switching = true;
    this.update({ project, source, subtitle, error: null });
    this.interstitials.load(project.id, project.interstitials, project.callResponse ? responseInterstitialIds(project.callResponse) : [], project.callResponse);
    assets.releaseExcept(new Set(assetIds(project)));
    this.switching = false;
    this.save({ ...project, interstitials: this.interstitials.getSnapshot().items });
  }
  private async prepareSource(project: Project, pendingAssets: Asset[], signal: AbortSignal) {
    let original = pendingAssets.find(asset => asset.id === project.source.assetId);
    if (!original && project.source.assetId) {
      original = await readAsset(project.source.assetId);
      if (!original) throw new Error('The source video is missing from local storage.');
    }
    if (!original) {
      if (!project.source.url) throw new Error('The source video cannot be located.');
      this.update({ message: 'Downloading source video', progress: null });
      original = await assets.fetch(project.source.url, project.source.name, signal, (received, total) => {
        if (!signal.aborted) this.update({ progress: total ? received / total : null });
      });
      pendingAssets = [...pendingAssets, original];
    }
    this.update({ message: 'Checking video frame rate', progress: null });
    const blob = await prepareVideo(original.blob, signal, progress => {
      if (!signal.aborted) this.update({ message: 'Preparing 24 fps video', progress });
    });
    signal.throwIfAborted();
    let working = original;
    if (blob !== original.blob) {
      working = { id: crypto.randomUUID(), name: `${project.source.name.replace(/\.[^.]+$/, '')}.24fps.mp4`, blob };
      pendingAssets = [...pendingAssets, working];
    }
    return { project: { ...project, source: { ...project.source, assetId: working.id,
      originalAssetId: project.source.originalAssetId ?? (working !== original ? original.id : undefined) }, updatedAt: Date.now() }, pendingAssets };
  }
  private create(source: MediaSource): Project {
    return { id: source.id, name: source.name.replace(/\.[^.]+$/, ''), source: { name: source.name, url: source.url },
      updatedAt: Date.now(), interstitials: loadInterstitials(source.id), subtitle: null, analysis: emptyAnalysis() };
  }
  async openDefault(source: MediaSource) {
    await this.task('Opening default video', async signal => {
      const project = await readProject(source.id) || this.create(source);
      signal.throwIfAborted(); await this.activate(project, signal);
    });
  }
  async openExample(url: string) {
    await this.task('Downloading example project', signal => this.loadExample(url, signal));
  }
  async openTestCallResponse(duration: number) {
    await this.task('Opening call-response timeline', async signal => {
      const current = this.state.project;
      if (!current?.source.assetId) throw new Error('Open a video first.');
      const example = createTimelineExample(current.source.assetId, duration);
      const project: Project = { ...current, id: `project:${crypto.randomUUID()}`, name: 'Test call response',
        updatedAt: Date.now(), interstitials: example.interstitials, callResponse: example.flow, subtitle: null };
      await this.activate(project, signal);
      this.interstitials.select(example.flow.interstitial.id);
    });
  }
  updateCallResponse(callResponse: CallResponseFlow) {
    callResponse = groupCallResponse({ ...callResponse, scenes: callResponse.scenes.map(scene => scene.clip.kind !== 'video' && !scene.interstitialId
      ? { ...scene, interstitialId: `call-response-${scene.id}` } : scene) });
    this.interstitials.setCallResponse(callResponse);
    if (this.state.project) this.save({ ...this.state.project, callResponse: groupCallResponse(callResponse), updatedAt: Date.now() });
  }
  private async loadExample(url: string, signal: AbortSignal) {
    this.update({ message: 'Downloading example project', progress: null });
    const archive = await assets.fetch(url, 'example.sparko', signal, (received, total) => {
      if (!signal.aborted) this.update({ progress: total ? received / total : null });
    });
    await this.restoreArchive(archive.blob, signal);
  }
  private async task<T>(message: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.operation) return;
    const operation = new AbortController(); this.operation = operation;
    this.update({ busy: true, message, progress: null, error: null });
    try { return await work(operation.signal); }
    catch (error) { if (!operation.signal.aborted) this.update({ error: storageError(error) }); }
    finally { this.operation = null; this.update({ busy: false, message: '', progress: null }); }
  }
  cancel() { this.operation?.abort(); }
  async openVideo(file: File) {
    await this.task('Saving video locally', async signal => {
      if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) throw new Error('Choose a video file.');
      const id = `file:${file.name}:${file.size}:${file.lastModified}`;
      const previous = await readProject(id);
      if (previous?.source.assetId) { signal.throwIfAborted(); await this.activate(previous, signal); return; }
      const asset = { id: crypto.randomUUID(), name: file.name, blob: file };
      const project = { ...this.create({ id, name: file.name, url: '' }), source: { name: file.name, assetId: asset.id } };
      await this.activate(project, signal, [asset]);
    });
  }
  updateAnalysis(analysis: AnalysisState) {
    if (this.state.project) this.save({ ...this.state.project, analysis, updatedAt: Date.now() });
  }
  async setSubtitle(file: File) {
    const projectId = this.state.project?.id; if (!projectId) return;
    try {
      if (file.size > 8 * 1024 ** 2 || !(await file.text()).replace(/^\uFEFF/, '').startsWith('WEBVTT')) throw new Error('Use a valid WebVTT (.vtt) subtitle file up to 8 MB.');
      const asset = await assets.save(new Blob([file], { type: 'text/vtt' }), file.name);
      const opened = await assets.open(asset.id);
      if (this.state.project?.id !== projectId) return;
      this.update({ subtitle: { name: file.name, url: opened.url } });
      this.save({ ...this.state.project, subtitle: { name: file.name, assetId: asset.id }, updatedAt: Date.now() });
    } catch (error) { this.update({ error: storageError(error) }); }
  }
  async exportProject(): Promise<{ blob: Blob; name: string } | undefined> {
    return this.task('Collecting project assets', async signal => {
      if (!this.state.project) throw new Error('Open a video first.');
      const snapshot = structuredClone(this.state.project);
      signal.throwIfAborted();
      if (!snapshot.source.assetId) throw new Error('Wait for the source video to finish preparing.');
      if (snapshot.interstitials.some(item => item.result && (!item.result.assetId || item.phase !== 'ready'))) throw new Error('An interstitial result has not finished loading. Finish loading or retry the interstitial before exporting.');
      const stored: Asset[] = [];
      for (const id of assetIds(snapshot)) {
        const asset = await readAsset(id); signal.throwIfAborted();
        if (!asset) throw new Error('An asset is missing. Export was cancelled to avoid an incomplete project.'); stored.push(asset);
      }
      const { packProject } = await import('./archive');
      const blob = await packProject(snapshot, stored, signal, (message, progress) => this.update({ message, progress }));
      signal.throwIfAborted();
      return { blob, name: `${snapshot.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'project'}.sparko` };
    });
  }
  private async validateVideo(blob: Blob, signal: AbortSignal) {
    const url = URL.createObjectURL(blob), engine = new MediaEngine({ id: 'validate', name: 'Project video', url, file: new File([blob], 'video.mp4') });
    try { signal.throwIfAborted(); const info = await engine.inspect(); signal.throwIfAborted(); return info; }
    finally { engine.dispose(); URL.revokeObjectURL(url); }
  }
  async importProject(file: File) {
    await this.task('Reading project', signal => this.restoreArchive(file, signal));
  }
  private async restoreArchive(file: Blob, signal: AbortSignal) {
    const { unpackProject } = await import('./archive');
    const imported = await unpackProject(file, signal, (message, progress) => this.update({ message, progress }));
    this.update({ message: 'Checking project media', progress: null });
    const byId = new Map(imported.assets.map(asset => [asset.id, asset]));
    const source = await this.validateVideo(byId.get(imported.project.source.assetId!)!.blob, signal);
      const clipInfo = new Map([[imported.project.source.assetId!, source]]);
      for (const scene of imported.project.callResponse?.scenes ?? []) {
        let info = clipInfo.get(scene.clip.assetId);
        if (!info) { info = await this.validateVideo(byId.get(scene.clip.assetId)!.blob, signal); clipInfo.set(scene.clip.assetId, info); }
        if (scene.clip.outFrame / imported.project.callResponse!.fps > info.duration + 1 / info.fps) throw new Error('A scene clip extends beyond its media.');
      }
    for (const item of imported.project.interstitials) {
      if (item.time > source.duration + Math.max(1 / source.fps, 1 / TIMELINE_FPS)) throw new Error('An interstitial anchor lies outside the source video.');
      for (const result of [item.result, item.previousResult]) {
        if (!result) continue;
        const info = await this.validateVideo(byId.get(result.assetId!)!.blob, signal);
        if (result.start + result.duration > info.duration + 1 / info.fps) throw new Error('An interstitial asset is shorter than its saved scene boundaries.');
      }
    }
    if (imported.project.subtitle) {
      const blob = byId.get(imported.project.subtitle.assetId)!.blob;
      if (blob.size > 8 * 1024 ** 2 || !(await blob.text()).replace(/^\uFEFF/, '').startsWith('WEBVTT')) throw new Error('The project subtitle asset is invalid.');
    }
    signal.throwIfAborted(); await this.activate(imported.project, signal, imported.assets);
  }
  dispose() { this.cancel(); this.unsubscribe?.(); this.unsubscribe = undefined; }
}
