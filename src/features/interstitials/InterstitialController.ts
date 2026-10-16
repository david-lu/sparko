import { INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { frameTime, isGenerating, type Interstitial } from '../../../shared/interstitials';
import { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from './api';
import { loadInterstitials, saveInterstitials } from './storage';
import { assets } from '../project/assets';

type State = { items: Interstitial[]; selectedId: string | null; error: string | null };
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, INTERSTITIAL.pollMilliseconds);
  signal.addEventListener('abort', abort, { once: true });
});

/** Owns persisted drafts and independently cancellable generation jobs, outside React. */
export class InterstitialController {
  private sourceId = '';
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
  load(sourceId: string, items?: Interstitial[]) {
    this.dispose(); this.sourceId = sourceId;
    this.update({ items: items ?? loadInterstitials(sourceId), selectedId: null, error: null });
    for (const item of this.state.items) if (['queued', 'rendering', 'loading', 'ready'].includes(item.phase)) void this.resume(item.id);
  }
  select(id: string | null) { this.update({ selectedId: id }); }
  clearError() { this.update({ error: null }); }
  add(time: number, duration: number) {
    const fps = TIMELINE_FPS;
    const anchor = Math.max(0, Math.min(frameTime(duration, fps), frameTime(time, fps)));
    const existing = this.state.items.find(item => Math.abs(item.time - anchor) < 0.5 / fps);
    if (existing) { this.select(existing.id); return existing; }
    const number = Math.max(0, ...this.state.items.map(item => Number(item.label.match(/^Interstitial (\d+)$/)?.[1]) || 0)) + 1;
    const item: Interstitial = { id: crypto.randomUUID(), label: `Interstitial ${number}`, time: anchor,
      start_range: INTERSTITIAL.defaultRange, end_range: INTERSTITIAL.defaultRange, prompt: '', phase: 'draft' };
    this.update({ items: [...this.state.items, item].sort((a, b) => a.time - b.time), selectedId: item.id }, true);
    return item;
  }
  move(id: string, time: number) {
    const item = this.state.items.find(item => item.id === id);
    if (item && !isGenerating(item) && Number.isFinite(time) && time >= 0) this.patch(id, { time: frameTime(time, TIMELINE_FPS) });
  }
  edit(id: string, values: Partial<Pick<Interstitial, 'start_range' | 'end_range' | 'prompt'>>) {
    const item = this.state.items.find(item => item.id === id);
    if (item && !isGenerating(item) && item.phase !== 'ready' && !item.requestId) this.patch(id, { ...values, phase: 'draft', error: undefined });
  }
  async generate(id: string, engine: MediaEngine, info: MediaInfo) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || isGenerating(item) || item.requestId || item.result || this.tasks.has(id)) return;
    const operation = new AbortController(); this.tasks.set(id, operation);
    this.patch(id, { phase: 'preparing', error: undefined, requestId: undefined, result: undefined, progress: 0 });
    try {
      const job = await generateInterstitial(item, engine, info, operation.signal, (phase, progress) => {
        if (!operation.signal.aborted) this.patch(id, { phase, progress });
      });
      if (operation.signal.aborted) { void cancelInterstitialJob(job.requestId).catch(() => undefined); return; }
      this.patch(id, { requestId: job.requestId, phase: 'queued', progress: undefined });
      await this.poll(id, job.requestId, operation.signal);
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
      else if (item.requestId) await this.poll(id, item.requestId, operation.signal);
      else throw new Error('No generation job was saved. Return to draft and generate again.');
    } catch (error) { this.fail(id, operation, error); }
    finally { if (this.tasks.get(id) === operation) this.tasks.delete(id); }
  }
  private async poll(id: string, requestId: string, signal: AbortSignal) {
    for (;;) {
      signal.throwIfAborted();
      const job = await getInterstitialJob(requestId, signal);
      signal.throwIfAborted();
      if (job.status === 'CANCELLED') { this.patch(id, { phase: 'cancelled' }); return; }
      if (job.status === 'COMPLETED') {
        if (!job.videoUrl || !job.insertion) throw new Error('The result is missing its generated scene boundaries. Retry checking the result.');
        const result = { url: job.videoUrl, ...job.insertion };
        this.patch(id, { phase: 'loading', result, queuePosition: undefined });
        await this.loadResult(id, result, signal); return;
      }
      this.patch(id, { phase: job.status === 'IN_QUEUE' ? 'queued' : 'rendering', queuePosition: job.queuePosition });
      await wait(signal);
    }
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
      this.patch(id, { phase: 'ready', error: undefined });
    } finally { signal.removeEventListener('abort', abort); media.dispose(); }
  }
  async cancel(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item) return false;
    this.tasks.get(id)?.abort(); this.tasks.delete(id);
    const source = this.sourceId;
    try {
      if (item.requestId && !item.result) await cancelInterstitialJob(item.requestId);
      if (source === this.sourceId) this.patch(id, { phase: 'cancelled', progress: undefined, error: undefined });
      return true;
    } catch (error) {
      if (source === this.sourceId) this.patch(id, { phase: 'error', error: `Could not cancel the remote job. ${error instanceof Error ? error.message : ''}` });
      return false;
    }
  }
  async reset(id: string) {
    const source = this.sourceId, item = this.state.items.find(item => item.id === id);
    if (!item || isGenerating(item)) return;
    if (item.requestId && !item.result && item.phase !== 'cancelled' && !await this.cancel(id)) return;
    if (source === this.sourceId) this.patch(id, { phase: 'draft', result: undefined, requestId: undefined, error: undefined });
  }
  async remove(id: string) {
    const source = this.sourceId, item = this.state.items.find(item => item.id === id);
    if (item && (isGenerating(item) || item.phase === 'error' && item.requestId && !item.result) && !await this.cancel(id)) return;
    if (source !== this.sourceId) return;
    this.update({ items: this.state.items.filter(item => item.id !== id), selectedId: this.state.selectedId === id ? null : this.state.selectedId }, true);
  }
  dispose() { this.tasks.forEach(task => task.abort()); this.tasks.clear(); }
}
