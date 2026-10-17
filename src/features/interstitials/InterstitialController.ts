import { INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { frameTime, hasUnsubmittedChanges, interstitialSettings, isGenerating, playableResult, type Interstitial, type InterstitialSettings, type GenerationMethod } from '../../../shared/interstitials';
import type { InsertionRange } from '../../../shared/contracts';
import { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from './api';
import { watchComfyJob } from './progress-stream';
import { loadInterstitials, saveInterstitials } from './storage';
import { assets } from '../project/assets';
import { responseInterstitialIds, type CallResponseFlow } from '../call-response/model';
import { baselineReferences, clipDependency } from '../call-response/dependencies';
import { generationSource } from '../call-response/generation';

type State = { items: Interstitial[]; selectedId: string | null; error: string | null };
const requestMethod = (item: Interstitial): GenerationMethod => item.requestMethod ?? item.generationSettings?.method ?? 'fal';
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, INTERSTITIAL.pollMilliseconds);
  signal.addEventListener('abort', abort, { once: true });
});

/** Owns persisted drafts and independently cancellable generation jobs, outside React. */
export class InterstitialController {
  private sourceId = '';
  private linkedDurationIds: string[] = [];
  private callResponse?: CallResponseFlow;
  private state: State = { items: [], selectedId: null, error: null };
  private listeners = new Set<() => void>();
  private tasks = new Map<string, AbortController>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<State>, persist = false) {
    this.state = { ...this.state, ...patch };
    if (persist && !saveInterstitials(this.sourceId, this.state.items)) this.state.error = 'Interstitial changes could not be saved in this browser.';
    this.listeners.forEach(listener => listener());
  }
  private patch(id: string, patch: Partial<Interstitial>) {
    this.update({ items: this.state.items.map(item => item.id === id ? { ...item, ...patch } : item).sort((a, b) => a.time - b.time) }, true);
  }
  load(sourceId: string, items?: Interstitial[], linkedDurationIds: string[] = [], callResponse?: CallResponseFlow) {
    this.dispose(); this.sourceId = sourceId;
    this.callResponse = callResponse;
    this.linkedDurationIds = linkedDurationIds;
    const loaded = (items ?? loadInterstitials(sourceId)).map(item => {
      const restored = { ...item, method: item.method ?? 'fal' as const, duration: item.duration ?? INTERSTITIAL.defaultDuration,
        enable_prompt_expansion: item.enable_prompt_expansion ?? INTERSTITIAL.enablePromptExpansion };
      return { ...restored, generationSettings: item.generationSettings ?? (item.result || item.requestId ? interstitialSettings(restored) : undefined) };
    });
    const linked = loaded.filter(item => linkedDurationIds.includes(item.id));
    const duration = Math.max(...linked.map(item => item.duration));
    const normalized = loaded.map(item => linked.includes(item) ? { ...item, duration } : item);
    this.update({ items: callResponse ? baselineReferences(callResponse, normalized) : normalized, selectedId: null, error: null });
    for (const item of this.state.items) if (['queued', 'rendering', 'loading', 'ready'].includes(item.phase)) void this.resume(item.id);
  }
  select(id: string | null) { this.update({ selectedId: id }); }
  clearError() { this.update({ error: null }); }
  hasLinkedDuration(id: string) { return this.linkedDurationIds.length > 1 && this.linkedDurationIds.includes(id); }
  setCallResponse(flow: CallResponseFlow) {
    this.callResponse = flow;
    this.linkedDurationIds = responseInterstitialIds(flow);
    const added: Interstitial[] = flow.scenes.filter(scene => scene.clip.kind !== 'video' && scene.interstitialId && !this.state.items.some(item => item.id === scene.interstitialId)).map(scene => ({
      id: scene.interstitialId!, label: scene.label, time: flow.interstitial.time, method: 'fal', phase: 'ready',
      start_range: INTERSTITIAL.defaultRange, end_range: INTERSTITIAL.defaultRange,
      duration: this.state.items.find(item => this.linkedDurationIds.includes(item.id))?.duration ?? INTERSTITIAL.defaultDuration,
      enable_prompt_expansion: INTERSTITIAL.enablePromptExpansion, prompt: scene.dialogue,
      result: { url: `asset:${scene.clip.assetId}`, assetId: scene.clip.assetId, start: scene.clip.inFrame / flow.fps,
        duration: (scene.clip.outFrame - scene.clip.inFrame) / flow.fps,
        totalDuration: Math.max(scene.clip.outFrame / flow.fps, ...this.state.items.flatMap(item => item.result?.assetId === scene.clip.assetId ? [item.result.totalDuration] : [])) },
    }));
    if (added.length) this.update({ items: baselineReferences(flow, [...this.state.items, ...added]) }, true);
  }
  dependency(id: string) {
    const scene = this.callResponse?.scenes.find(scene => scene.interstitialId === id && scene.clip.kind !== 'video');
    return scene && this.callResponse ? clipDependency(this.callResponse, this.state.items, scene.id) : undefined;
  }
  add(time: number, duration: number) {
    const fps = TIMELINE_FPS;
    const anchor = Math.max(0, Math.min(frameTime(duration, fps), frameTime(time, fps)));
    const existing = this.state.items.find(item => Math.abs(item.time - anchor) < 0.5 / fps);
    if (existing) { this.select(existing.id); return existing; }
    const number = Math.max(0, ...this.state.items.map(item => Number(item.label.match(/^Interstitial (\d+)$/)?.[1]) || 0)) + 1;
    const item: Interstitial = { id: crypto.randomUUID(), label: `Interstitial ${number}`, time: anchor,
      start_range: INTERSTITIAL.defaultRange, end_range: INTERSTITIAL.defaultRange, duration: INTERSTITIAL.defaultDuration,
      enable_prompt_expansion: INTERSTITIAL.enablePromptExpansion, method: 'fal', prompt: '', phase: 'draft' };
    this.update({ items: [...this.state.items, item].sort((a, b) => a.time - b.time), selectedId: item.id }, true);
    return item;
  }
  move(id: string, time: number) {
    const item = this.state.items.find(item => item.id === id);
    if (item && !isGenerating(item) && Number.isFinite(time) && time >= 0) this.patch(id, { time: frameTime(time, TIMELINE_FPS) });
  }
  edit(id: string, values: Partial<InterstitialSettings>) {
    const item = this.state.items.find(item => item.id === id);
    // The editor always stays usable. Jobs and media retain the inputs they were submitted with.
    if (!item) return;
    if (values.duration !== undefined && this.hasLinkedDuration(id)) {
      this.update({ items: this.state.items.map(current => current.id === id ? { ...current, ...values }
        : this.linkedDurationIds.includes(current.id) ? { ...current, duration: values.duration! } : current) }, true);
    } else this.patch(id, values);
  }
  async generate(id: string, engine: MediaEngine, info: MediaInfo) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || isGenerating(item) || this.tasks.has(id)) return;
    // An unchanged scene that only failed to download can reuse its existing render.
    if (item.result && item.phase !== 'ready' && !hasUnsubmittedChanges(item)) return this.resume(id);
    const dependency = this.dependency(id);
    if (dependency?.blocked) { this.update({ error: dependency.blocked }); return; }
    const operation = new AbortController(); this.tasks.set(id, operation);
    const method = item.method ?? 'fal';
    this.patch(id, { phase: 'preparing', error: undefined, progress: 0, progressDetails: undefined, queuePosition: undefined,
      previousResult: playableResult(item), result: undefined, requestId: item.phase === 'ready' ? undefined : item.requestId,
      requestMethod: requestMethod(item), generationSettings: interstitialSettings(item), requestReference: dependency?.reference });
    try {
      // A failed status request may still belong to an active job. Retire it before resubmitting.
      if (item.requestId && item.phase !== 'cancelled' && item.phase !== 'ready') await cancelInterstitialJob(item.requestId, requestMethod(item));
      operation.signal.throwIfAborted();
      this.patch(id, { requestId: undefined, requestMethod: method, requestInsertion: undefined, result: undefined });
      const source = dependency?.reference ? await generationSource(item, dependency.reference, operation.signal) : { item, engine, info };
      operation.signal.throwIfAborted();
      const job = await generateInterstitial(source.item, source.engine, source.info, operation.signal, (phase, progress) => {
        if (!operation.signal.aborted) this.patch(id, { phase, progress });
      });
      if (operation.signal.aborted) { void cancelInterstitialJob(job.requestId, method).catch(() => undefined); return; }
      this.patch(id, { requestId: job.requestId, requestMethod: method, requestInsertion: job.insertion, phase: 'queued', progress: undefined });
      await this.poll(id, job.requestId, operation.signal, method, job.insertion);
    } catch (error) { this.fail(id, operation, error); }
    finally { if (this.tasks.get(id) === operation) this.tasks.delete(id); }
  }
  private fail(id: string, operation: AbortController, error: unknown) {
    if (!operation.signal.aborted) this.patch(id, { phase: 'error', progress: undefined, error: error instanceof Error ? error.message : 'Generation failed. Try again.' });
  }
  async resume(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || this.tasks.has(id)) return;
    const operation = new AbortController(); this.tasks.set(id, operation);
    try {
      this.patch(id, { phase: item.result ? 'loading' : 'queued', error: undefined });
      if (item.result) await this.loadResult(id, item.result, operation.signal);
      else if (item.requestId) await this.poll(id, item.requestId, operation.signal, requestMethod(item), item.requestInsertion);
      else throw new Error('No generation job was saved. Retry to generate the scene.');
    } catch (error) { this.fail(id, operation, error); }
    finally { if (this.tasks.get(id) === operation) this.tasks.delete(id); }
  }
  private async poll(id: string, requestId: string, signal: AbortSignal, method: GenerationMethod, submittedInsertion?: InsertionRange) {
    const stream = new AbortController(), streamSignal = AbortSignal.any([signal, stream.signal]);
    let liveAt = -Infinity;
    if (method === 'comfy') void watchComfyJob(requestId, streamSignal, event => {
      if (streamSignal.aborted) return;
      liveAt = Date.now();
      if (event.type === 'progress') this.patch(id, { phase: 'rendering', progress: event.progress, progressDetails: event.progressDetails, queuePosition: undefined });
      if (event.type === 'status') this.patch(id, { phase: event.status === 'IN_QUEUE' ? 'queued' : 'rendering', queuePosition: event.queuePosition });
    });
    try { for (;;) {
      signal.throwIfAborted();
      const job = await getInterstitialJob(requestId, signal, method);
      signal.throwIfAborted();
      if (job.status === 'CANCELLED') { this.patch(id, { phase: 'cancelled' }); return; }
      if (job.status === 'COMPLETED') {
        const insertion = job.insertion || submittedInsertion;
        if (!job.videoUrl || !insertion) throw new Error('The result is missing its generated scene boundaries. Retry checking the result.');
        const result = { url: job.videoUrl, ...insertion, reference: this.state.items.find(item => item.id === id)?.requestReference };
        stream.abort();
        this.patch(id, { phase: 'loading', result, queuePosition: undefined, progress: undefined, progressDetails: undefined });
        await this.loadResult(id, result, signal); return;
      }
      // A slow status response must not overwrite newer live steps. Polling takes over on disconnect.
      if (Date.now() - liveAt > 5_000) this.patch(id, { phase: job.status === 'IN_QUEUE' ? 'queued' : 'rendering', queuePosition: job.queuePosition, progress: job.progress, progressDetails: job.progressDetails });
      await wait(signal);
    } } finally { stream.abort(); }
  }
  private async loadResult(id: string, result: NonNullable<Interstitial['result']>, signal: AbortSignal) {
    if (!result.assetId) {
      const asset = await assets.download(result.url, `${id}.mp4`, signal);
      signal.throwIfAborted();
      result = { ...result, assetId: asset.id };
      this.patch(id, { result });
    }
    const { url } = await assets.open(result.assetId!);
    signal.throwIfAborted();
    const media = new MediaEngine({ id, name: 'Interstitial', url });
    const abort = () => media.dispose(); signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const info = await media.inspect();
      signal.throwIfAborted();
      if (result.start < 0 || result.duration <= 0 || result.start + result.duration > info.duration + 1 / info.fps) throw new Error('The returned video does not contain the full interstitial.');
      this.patch(id, { phase: 'ready', result, previousResult: undefined, error: undefined });
    } finally { signal.removeEventListener('abort', abort); media.dispose(); }
  }
  async cancel(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item) return false;
    this.tasks.get(id)?.abort(); this.tasks.delete(id);
    const source = this.sourceId;
    try {
      if (item.requestId && !item.result) await cancelInterstitialJob(item.requestId, requestMethod(item));
      if (source === this.sourceId) this.patch(id, { phase: 'cancelled', progress: undefined, error: undefined });
      return true;
    } catch (error) {
      if (source === this.sourceId) this.patch(id, { phase: 'error', error: `Could not cancel the remote job. ${error instanceof Error ? error.message : ''}` });
      return false;
    }
  }
  async remove(id: string) {
    const source = this.sourceId, item = this.state.items.find(item => item.id === id);
    if (item && (isGenerating(item) || item.phase === 'error' && item.requestId && !item.result) && !await this.cancel(id)) return;
    if (source !== this.sourceId) return;
    this.update({ items: this.state.items.filter(item => item.id !== id), selectedId: this.state.selectedId === id ? null : this.state.selectedId }, true);
  }
  dispose() { this.tasks.forEach(task => task.abort()); this.tasks.clear(); }
}
