import type { MediaSource } from '../../media/media';
import { MediaEngine } from '../../media/MediaEngine';
import { prepareVideo } from '../../media/prepareVideo';
import type { InterstitialController } from '../interstitials/InterstitialController';
import { assets } from './assets';
import { deleteSavedProject, forgetRecentFile, listRecentFiles, listSavedProjects, readActiveProject, readAsset, readProject, rememberRecentFile, storageError, writeProject, type RecentFile } from './database';
import { activeFlows, projectFlows, withFlows, assetIds, emptyAnalysis, type AnalysisState, type Asset, type Project } from './types';
import { TIMELINE_FPS } from '../../../shared/constants';
import { createTimelineExample, groupCallResponse, lockCallResponseStructure, migrateDefaultAnswerLabels, removeAnswer, responseInterstitialIds, type CallResponseFlow } from '../call-response/model';
import { createCallResponseDraft, reanchorFlow } from '../call-response/draft';
import { isGenerating } from '../../../shared/interstitials';
import { ProjectHistory } from './ProjectHistory';

type State = { project: Project | null; source: MediaSource | null; subtitle: { name: string; url: string } | null;
  busy: boolean; message: string; progress: number | null; error: string | null;
  undoLabel: string | null; redoLabel: string | null; historyRevision: number;
  savedProjects: { id: string; name: string; updatedAt: number }[]; savedProjectId: string | null;
  recentFiles: RecentFile[]; fileName: string | null };

/** Owns project persistence and portable snapshots; media and job controllers stay independent. */
export class ProjectController {
  private state: State = { project: null, source: null, subtitle: null, busy: false, message: '', progress: null, error: null,
    undoLabel: null, redoLabel: null, historyRevision: 0, savedProjects: [], savedProjectId: null,
    recentFiles: [], fileName: null };
  private fileHandle: FileSystemFileHandle | null = null;
  private draftId = (() => {
    try {
      const existing = localStorage.getItem('sparko:draft-id');
      if (existing?.startsWith('draft:')) return existing;
      const id = `draft:${crypto.randomUUID()}`; localStorage.setItem('sparko:draft-id', id); return id;
    } catch { return `draft:${crypto.randomUUID()}`; }
  })();
  private history = new ProjectHistory();
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
  private save(project: Project, record = true) {
    if (record && this.state.project?.id === project.id) this.history.record(this.state.project, project);
    this.update({ project, undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel });
    this.writes = this.writes.catch(() => undefined).then(() => writeProject(project));
    void this.writes.catch(error => this.update({ error: storageError(error) }));
  }
  async init(defaultSource: MediaSource) {
    this.unsubscribe ??= this.interstitials.subscribe(() => {
      const project = this.state.project;
      if (!project || this.switching || project.interstitials === this.interstitials.getSnapshot().items) return;
      this.save({ ...project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() });
    });
    await this.task('Loading projects', async signal => {
      const active = await readActiveProject();
      const previous = await readProject(defaultSource.id);
      if (previous && previous.saved === undefined) {
        if (previous.interstitials.length || projectFlows(previous).length || previous.subtitle || previous.analysis.result || previous.analysis.instructions)
          await writeProject({ ...previous, id: `project:${crypto.randomUUID()}`, saved: true, updatedAt: Date.now() });
        await writeProject({ ...previous, saved: false });
      }
      if (active && active.id !== defaultSource.id && active.saved === undefined && !active.id.startsWith('draft:'))
        await writeProject({ ...active, saved: true });
      signal.throwIfAborted();
      this.update({ savedProjects: await listSavedProjects(), recentFiles: await listRecentFiles() });
    });
  }
  private async loadSampleFromExample(url: string, id: string, sourceName: string, signal: AbortSignal) {
    this.update({ message: 'Downloading sample video', progress: null });
    const archive = await assets.fetch(url, 'example.sparko', signal, (received, total) => {
      if (!signal.aborted) this.update({ progress: total ? received / total : null });
    });
    const { unpackProject } = await import('./archive');
    const imported = await unpackProject(archive.blob, signal, (message, progress) => this.update({ message, progress }));
    const project = { ...imported.project, name: 'Sample video', source: { ...imported.project.source, name: sourceName },
      interstitials: [], callResponse: undefined, callResponses: undefined,
      subtitle: null, analysis: emptyAnalysis() };
    const needed = new Set(assetIds(project));
    await this.activate(project, signal, imported.assets.filter(asset => needed.has(asset.id)), null, id);
  }
  private async activate(project: Project, signal: AbortSignal, pendingAssets: Asset[] = [], savedProjectId: string | null = null, workingId = this.draftId) {
    signal.throwIfAborted();
    project = { ...project, id: workingId, saved: false };
    const renamedClips = new Map<string, { before: string; after: string }>();
    if (projectFlows(project).length) project = withFlows(project, projectFlows(project).map(flow => {
      const grouped = lockCallResponseStructure(migrateDefaultAnswerLabels(groupCallResponse(flow)));
      for (const scene of grouped.scenes) {
        const previous = flow.scenes.find(previous => previous.id === scene.id);
        if (scene.interstitialId && previous && previous.label !== scene.label) renamedClips.set(scene.interstitialId, { before: previous.label, after: scene.label });
      }
      if (!flow.interstitial) grouped.interstitial.time = project.interstitials.find(item => grouped.scenes.some(scene => scene.interstitialId === item.id))?.time ?? grouped.interstitial.time;
      return grouped;
    }));
    project = { ...project, interstitials: project.interstitials.map(item => {
      const rename = renamedClips.get(item.id);
      return rename && item.label === rename.before ? { ...item, label: rename.after } : item;
    }) };
    ({ project, pendingAssets } = await this.prepareSource(project, pendingAssets, signal));
    project = { ...project, interstitials: project.interstitials.map(item => ({ ...item, groupId: projectFlows(project).find(flow => flow.scenes.some(scene => scene.interstitialId === item.id))?.interstitial.id, phase: ['preparing', 'uploading'].includes(item.phase) ? 'draft' : item.phase })) };
    this.update({ message: 'Saving prepared project', progress: null });
    await this.writes;
    await writeProject(project, pendingAssets, true, signal);
    const { asset, url } = await assets.open(project.source.assetId!);
    const source: MediaSource = { id: project.id, name: project.source.name, url, assetId: asset.id, file: new File([asset.blob], project.source.name, { type: asset.blob.type }) };
    const subtitle = project.subtitle ? { name: project.subtitle.name, url: (await assets.open(project.subtitle.assetId)).url } : null;
    // Restore retained renders before publishing the timeline, including failed/cancelled retries.
    await Promise.all([...new Set([...project.interstitials.flatMap(item => [item.previousResult?.assetId, ...(project.callResponse ? [item.result?.assetId] : [])]), ...projectFlows(project).flatMap(flow => flow.scenes.map(scene => scene.clip.assetId))]
      .filter((id): id is string => !!id))].map(id => assets.open(id)));
    signal.throwIfAborted();
    this.switching = true;
    this.history.clear();
    this.fileHandle = null;
    this.update({ project, source, subtitle, error: null, undoLabel: null, redoLabel: null,
      savedProjectId, fileName: null, historyRevision: this.state.historyRevision + 1 });
    this.interstitials.load(project.id, project.interstitials, project.callResponse ? responseInterstitialIds(project.callResponse) : [], projectFlows(project));
    this.interstitials.setCallResponses(activeFlows(project));
    assets.releaseExcept(new Set(assetIds(project)));
    this.switching = false;
    this.save({ ...project, interstitials: this.interstitials.getSnapshot().items }, false);
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
      updatedAt: Date.now(), interstitials: [], subtitle: null, analysis: emptyAnalysis() };
  }
  async openDefault(source: MediaSource, exampleUrl?: string) {
    await this.task('Opening sample video', async signal => {
      const previous = await readProject(source.id);
      const media = previous?.source.name === source.name && previous.source.assetId && await readAsset(previous.source.assetId)
        ? { ...previous.source, url: source.url } : { name: source.name, url: source.url };
      if (!media.assetId && !media.url && exampleUrl) await this.loadSampleFromExample(exampleUrl, source.id, source.name, signal);
      else await this.activate({ ...this.create(source), source: media }, signal, [], null, source.id);
    });
  }
  async openSavedProject(id: string) {
    return this.task('Opening saved project', async signal => {
      const project = await readProject(id);
      if (!project || project.saved === false || (!project.saved && project.id.startsWith('draft:'))) throw new Error('Saved project not found.');
      await this.activate(project, signal, [], id);
      return true;
    });
  }
  async deleteSavedProject(id: string) {
    return this.task('Deleting saved project', async signal => {
      signal.throwIfAborted(); await deleteSavedProject(id);
      this.update({ savedProjectId: this.state.savedProjectId === id ? null : this.state.savedProjectId,
        savedProjects: await listSavedProjects() });
      return true;
    });
  }
  getFileHandle() { return this.fileHandle; }
  async openProjectFile(handle: FileSystemFileHandle) {
    return this.task('Opening project file', async signal => {
      const permissionHandle = handle as FileSystemFileHandle & { requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState> };
      if (permissionHandle.requestPermission && await permissionHandle.requestPermission({ mode: 'read' }) !== 'granted')
        throw new Error('Permission to read this project file was not granted.');
      const file = await handle.getFile();
      if (!/\.sparko$/i.test(file.name)) throw new Error('Choose a Sparko project file.');
      await this.restoreArchive(file, signal);
      this.fileHandle = handle;
      await rememberRecentFile(handle);
      this.update({ fileName: handle.name, recentFiles: await listRecentFiles() });
      return true;
    });
  }
  async saveToFile(handle: FileSystemFileHandle) {
    return this.task('Saving project file', async signal => {
      // Open the writer while the Save click still has user activation.
      const writer = await handle.createWritable();
      try {
        const archive = await this.buildArchive(signal, handle.name.replace(/\.sparko$/i, ''));
        signal.throwIfAborted();
        await writer.write(archive.blob);
        await writer.close();
      } catch (error) { await writer.abort().catch(() => undefined); throw error; }
      this.fileHandle = handle;
      await rememberRecentFile(handle);
      this.update({ fileName: handle.name, savedProjectId: null, recentFiles: await listRecentFiles() });
      return true;
    });
  }
  async removeRecentFile(id: string, deleteFromDisk = false) {
    return this.task(deleteFromDisk ? 'Deleting project file' : 'Removing recent project', async signal => {
      const item = this.state.recentFiles.find(item => item.id === id);
      if (!item) throw new Error('Recent project not found.');
      signal.throwIfAborted();
      if (deleteFromDisk) {
        const removable = item.handle as FileSystemFileHandle & { remove?: () => Promise<void> };
        if (!removable.remove) throw new Error('This browser cannot delete the file. Delete it in your file manager or remove it from Recent.');
        await removable.remove();
      }
      await forgetRecentFile(id);
      if (this.fileHandle && await this.fileHandle.isSameEntry(item.handle)) this.fileHandle = null;
      this.update({ recentFiles: await listRecentFiles(), fileName: this.fileHandle?.name ?? null });
      return true;
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
        updatedAt: Date.now(), interstitials: example.interstitials, callResponse: example.flow, callResponses: [example.flow], subtitle: null };
      await this.activate(project, signal);
      this.interstitials.select(example.flow.interstitial.id);
    });
  }
  updateCallResponse(callResponse: CallResponseFlow) {
    if (this.operation) return;
    callResponse = lockCallResponseStructure(callResponse);
    callResponse = groupCallResponse({ ...callResponse, scenes: callResponse.scenes.map(scene => scene.clip.kind !== 'video' && !scene.interstitialId
      ? { ...scene, interstitialId: `call-response-${scene.id}` } : scene) });
    this.switching = true;
    try {
      this.interstitials.setCallResponse(callResponse);
      this.interstitials.rename(callResponse.interstitial.id, callResponse.interstitial.label);
      for (const answer of callResponse.interaction.answers) {
        const previous = projectFlows(this.state.project).find(flow => flow.interstitial.id === callResponse.interstitial.id)?.interaction.answers.find(item => item.id === answer.id);
        const scene = callResponse.scenes.find(scene => scene.id === answer.sceneId);
        if (previous && (previous.label !== answer.label || previous.sceneId !== answer.sceneId) && scene?.interstitialId) this.interstitials.rename(scene.interstitialId, answer.label);
      }
    }
    finally { this.switching = false; }
    if (this.state.project) {
      const project = withFlows({ ...this.state.project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() },
        [...projectFlows(this.state.project).filter(flow => flow.interstitial.id !== callResponse.interstitial.id), callResponse].sort((a, b) => a.interstitial.time - b.interstitial.time));
      this.interstitials.setCallResponses(activeFlows(project)); this.save(project);
    }
  }
  async setInterstitialType(id: string, kind: 'regular' | 'call-response', duration: number) {
    return this.task('Changing interstitial type', async signal => {
      let project = this.state.project;
      if (!project?.source.assetId) return;
      let pin = project.interstitials.find(item => item.id === id);
      const existing = projectFlows(project).find(flow => flow.interstitial.id === id);
      // Older example projects stored the parent only in the flow.
      if (!pin && existing) pin = { id, label: existing.interstitial.label, time: existing.interstitial.time,
        kind: 'call-response', method: 'comfy', phase: 'draft', prompt: '', start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false };
      if (!pin || pin.groupId) return;
      const owned = [pin.id, ...existing?.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []) ?? []];
      if (!await this.interstitials.cancelSequence()) throw new Error('Cancel the active generation before changing interstitial type.');
      for (const item of project.interstitials.filter(item => owned.includes(item.id) && (isGenerating(item) || item.phase === 'error' && item.requestId))) {
        if (!await this.interstitials.cancel(item.id)) throw new Error('Could not cancel the active clip. Try again.');
        signal.throwIfAborted();
      }
      let flows = projectFlows(project);
      if (kind === 'call-response' && !existing) flows = [...flows, createCallResponseDraft(pin, project.source.assetId, duration).flow];
      else if (kind === 'call-response' && existing) flows = flows.map(flow => flow === existing ? reanchorFlow(flow, pin!, duration) : flow);
      this.switching = true;
      try {
        if (!this.interstitials.getSnapshot().items.some(item => item.id === id)) {
          this.interstitials.ensureItem(pin);
        }
        this.interstitials.setType(id, kind);
        const flow = flows.find(flow => flow.interstitial.id === id);
        if (kind === 'call-response' && flow) this.interstitials.setCallResponse(flow);
        project = withFlows({ ...project, interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() }, flows);
        this.interstitials.setCallResponses(activeFlows(project));
      } finally { this.switching = false; }
      this.save(project); this.interstitials.select(id);
    });
  }
  endHistoryGroup() { this.history.endGroup(); }
  async removeAnswer(id: string, groupId?: string) {
    return this.task('Removing answer', async signal => {
      const project = this.state.project, flow = projectFlows(project).find(flow => !groupId || flow.interstitial.id === groupId);
      if (!project || !flow) return false;
      const next = removeAnswer(flow, id);
      if (next === flow) return false;
      const ids = flow.scenes.filter(scene => !next.scenes.some(remaining => remaining.id === scene.id))
        .flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []);
      let removed = false;
      this.switching = true;
      try {
        removed = await this.interstitials.removeMany(ids, signal);
        if (removed) this.interstitials.setCallResponse(next);
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save(withFlows({ ...this.state.project,
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() },
          projectFlows(project).map(group => group.interstitial.id === flow.interstitial.id && removed ? next : group)));
      }
      if (!removed && !signal.aborted) throw new Error('Could not remove the answer because its generation job could not be cancelled. Try again.');
      return removed;
    });
  }
  undo() { return this.restoreHistory('undo'); }
  redo() { return this.restoreHistory('redo'); }
  private async restoreHistory(direction: 'undo' | 'redo') {
    if (this.operation || !this.history.target(direction)) return;
    await this.task(direction === 'undo' ? 'Undoing edit' : 'Redoing edit', async signal => {
      const target = this.history.target(direction), project = this.state.project;
      if (!target || !project) return;
      const subtitle = target.subtitle ? { name: target.subtitle.name, url: (await assets.open(target.subtitle.assetId)).url } : null;
      signal.throwIfAborted();
      let restored = false;
      this.switching = true;
      try {
        await this.interstitials.restoreEdits(target.interstitials, target.callResponse, signal);
        this.interstitials.setCallResponses(activeFlows({ ...project, callResponse: target.callResponse, callResponses: target.callResponses, interstitials: this.interstitials.getSnapshot().items }));
        restored = true; this.history.commit(direction);
        this.update({ subtitle, historyRevision: this.state.historyRevision + 1 });
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save({ ...this.state.project,
          ...(restored ? { callResponse: target.callResponse, callResponses: target.callResponses, subtitle: target.subtitle } : {}),
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() }, false);
      }
    });
  }
  async removeCallResponse(groupId?: string) {
    return this.task('Removing call-response interstitial', async signal => {
      const project = this.state.project;
      const flow = projectFlows(project).find(flow => !groupId || flow.interstitial.id === groupId);
      if (!project || !flow) return false;
      const ids = [flow.interstitial.id, ...flow.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : [])];
      let removed = false;
      this.switching = true;
      try {
        removed = await this.interstitials.removeMany(ids, signal);
        if (removed) this.interstitials.setCallResponses(activeFlows(project).filter(group => group.interstitial.id !== flow.interstitial.id));
      } finally {
        this.switching = false;
        if (this.state.project?.id === project.id) this.save({ ...this.state.project,
          callResponse: removed ? projectFlows(project).find(group => group.interstitial.id !== flow.interstitial.id) : project.callResponse,
          callResponses: removed ? projectFlows(project).filter(group => group.interstitial.id !== flow.interstitial.id) : projectFlows(project),
          interstitials: this.interstitials.getSnapshot().items, updatedAt: Date.now() });
      }
      if (!removed && !signal.aborted) throw new Error('Could not remove the call-response interstitial because a generation job could not be cancelled. Try again.');
      return removed;
    });
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
    return this.task('Collecting project assets', signal => this.buildArchive(signal));
  }
  private async buildArchive(signal: AbortSignal, fileName?: string): Promise<{ blob: Blob; name: string }> {
      if (!this.state.project) throw new Error('Open a video first.');
      const snapshot = structuredClone(this.state.project);
      if (fileName) snapshot.name = fileName;
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
      for (const scene of projectFlows(imported.project).flatMap(flow => flow.scenes)) {
        let info = clipInfo.get(scene.clip.assetId);
        if (!info) { info = await this.validateVideo(byId.get(scene.clip.assetId)!.blob, signal); clipInfo.set(scene.clip.assetId, info); }
        if (scene.clip.outFrame / TIMELINE_FPS > info.duration + 1 / info.fps) throw new Error('A scene clip extends beyond its media.');
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
