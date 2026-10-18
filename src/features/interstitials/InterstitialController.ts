import { INTERSTITIAL, TIMELINE_FPS } from '../../../shared/constants';
import { frameTime, generationPrompt, hasUnsubmittedChanges, interstitialSettings, isGenerating, normalizeGenerationMethod, playableResult, promptOnlySettings, type Interstitial, type InterstitialSettings } from '../../../shared/interstitials';
import type { AppStatus, InsertionRange, PromptClipKind } from '../../../shared/contracts';
import { MediaEngine } from '../../media/MediaEngine';
import type { MediaInfo } from '../../media/media';
import { cancelInterstitialJob, generateInterstitial, getInterstitialJob } from './api';
import { watchComfyJob } from './progress-stream';
import { loadInterstitials, saveInterstitials } from './storage';
import { assets } from '../project/assets';
import { responseInterstitialIds, type CallResponseFlow } from '../call-response/model';
import { baselineReferences, clipDependency, sameReference } from '../call-response/dependencies';
import { generationSource } from '../call-response/generation';
import { generationOrder, sequenceActive, sequenceStructure, type GenerationSequence } from '../call-response/sequence';
import type { InterstitialEdit } from '../project/ProjectHistory';
import { draftClip } from '../call-response/draft';
import { finishLoop } from '../call-response/finishLoop';

type State = { items: Interstitial[]; selectedId: string | null; error: string | null; sequence: GenerationSequence | null };
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
  private callResponses: CallResponseFlow[] = [];
  private state: State = { items: [], selectedId: null, error: null, sequence: null };
  private listeners = new Set<() => void>();
  private tasks = new Map<string, AbortController>();
  private retained = new Map<string, Interstitial>();
  private sequenceOperation?: AbortController;
  private cancelling = new Map<string, Promise<boolean>>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<State>, persist = false) {
    this.state = { ...this.state, ...patch };
    if (patch.items) for (const item of patch.items) this.retained.set(item.id, item);
    if (persist && !saveInterstitials(this.sourceId, this.state.items)) this.state.error = 'Interstitial changes could not be saved in this browser.';
    this.listeners.forEach(listener => listener());
  }
  private patch(id: string, patch: Partial<Interstitial>) {
    this.update({ items: this.state.items.map(item => item.id === id ? { ...item, ...patch } : item).sort((a, b) => a.time - b.time) }, true);
  }
  load(sourceId: string, items?: Interstitial[], linkedDurationIds: string[] = [], callResponse?: CallResponseFlow | CallResponseFlow[]) {
    this.dispose(); this.sourceId = sourceId;
    this.retained.clear();
    this.callResponses = Array.isArray(callResponse) ? callResponse : callResponse ? [callResponse] : [];
    this.callResponse = this.callResponses[0];
    this.linkedDurationIds = linkedDurationIds;
    const loaded = (items ?? loadInterstitials(sourceId)).map(item => {
      const legacyJob = (item.requestMethod as string | undefined) === 'fal'
        || (!item.requestMethod && (item.generationSettings?.method as string | undefined) === 'fal');
      const restored = { ...promptOnlySettings(item), method: normalizeGenerationMethod(item.method), duration: item.duration ?? INTERSTITIAL.defaultDuration,
        enable_prompt_expansion: item.enable_prompt_expansion ?? INTERSTITIAL.enablePromptExpansion };
      const generationSettings = item.generationSettings
        ? promptOnlySettings({ ...item.generationSettings, method: normalizeGenerationMethod(item.generationSettings.method) })
        : (item.result || item.requestId ? interstitialSettings(restored) : undefined);
      return { ...restored, generationSettings, requestMethod: legacyJob ? undefined : item.requestMethod,
        ...(legacyJob && item.requestId && !item.result ? { requestId: undefined, phase: 'error' as const,
          error: 'This older generation job cannot resume. Generate again with Comfy Cloud.' } : {}) };
    });
    const linked = loaded.filter(item => this.callResponse?.interstitial.linkResponseDurations !== false && linkedDurationIds.includes(item.id));
    const duration = Math.max(...linked.map(item => item.duration));
    const normalized = loaded.map(item => linked.includes(item) ? { ...item, duration } : item);
    // Initialize every group's legacy references before resuming any downloads.
    const referenced = this.callResponses.reduce<Interstitial[]>((items, flow) => baselineReferences(flow, items), normalized);
    this.update({ items: referenced, selectedId: null, error: null, sequence: null });
    for (const item of this.state.items) if (['queued', 'rendering', 'loading', 'ready'].includes(item.phase)) void this.resume(item.id);
  }
  select(id: string | null) { this.update({ selectedId: id }); }
  clearError() { this.update({ error: null }); }
  hasLinkedDuration(id: string) { const flow = this.flowFor(id); if (flow?.interstitial.linkResponseDurations === false) return false; const ids = flow ? responseInterstitialIds(flow) : this.linkedDurationIds; return ids.length > 1 && ids.includes(id); }
  setCallResponse(flow?: CallResponseFlow) {
    if (sequenceStructure(flow) !== sequenceStructure(this.callResponses.find(group => group.interstitial.id === flow?.interstitial.id)) && sequenceActive(this.state.sequence)
      && (!flow || generationOrder(flow).some(id => this.state.sequence!.ids.includes(id)))) {
      void this.cancelSequence('Clip structure changed. Start a new sequence to include the updated clips.');
    }
    const previous = this.callResponses.find(group => group.interstitial.id === flow?.interstitial.id);
    this.callResponse = flow;
    this.callResponses = flow ? [...this.callResponses.filter(group => group.interstitial.id !== flow.interstitial.id), flow] : [];
    if (!flow) { this.linkedDurationIds = []; return; }
    this.linkedDurationIds = responseInterstitialIds(flow);
    const added = flow.scenes.filter(scene => scene.interstitialId && !this.state.items.some(item => item.id === scene.interstitialId)).map(scene => ({ ...draftClip(flow, scene),
      ...(scene.clip.kind === 'response' && flow.interstitial.linkResponseDurations !== false ? { duration: this.state.items.find(item => responseInterstitialIds(flow).includes(item.id))?.duration ?? 6 } : {}) }));
    const items = [...this.state.items, ...added].map(item => {
      const scene = flow.scenes.find(scene => scene.interstitialId === item.id);
      if (!scene) return item;
      return { ...item, groupId: flow.interstitial.id, time: flow.interstitial.time,
        ...(flow.interstitial.linkResponseDurations && previous?.interstitial.linkResponseDurations === false && scene.clip.kind === 'response'
          ? { duration: Math.max(INTERSTITIAL.minDuration, ...this.state.items.filter(item => responseInterstitialIds(flow).includes(item.id)).map(item => item.duration)) } : {}),
        ...(previous && previous.interstitial.brief !== flow.interstitial.brief ? { continuity: flow.interstitial.brief } : {}) };
    });
    if (added.length || JSON.stringify(items) !== JSON.stringify(this.state.items)) this.update({ items: baselineReferences(flow, items) }, true);
  }
  setCallResponses(flows: CallResponseFlow[]) {
    const active = this.callResponses.find(flow => generationOrder(flow).some(id => this.state.sequence?.ids.includes(id)));
    if (sequenceActive(this.state.sequence) && (!active || sequenceStructure(active) !== sequenceStructure(flows.find(flow => flow.interstitial.id === active.interstitial.id)))) void this.cancelSequence('The interstitial type or structure changed.');
    this.callResponses = flows; this.callResponse = flows[0];
  }
  private flowFor(id: string) { return this.callResponses.find(flow => flow.scenes.some(scene => scene.interstitialId === id)); }
  dependency(id: string) {
    const flow = this.flowFor(id), scene = flow?.scenes.find(scene => scene.interstitialId === id);
    return scene && flow ? clipDependency(flow, this.state.items, scene.id) : undefined;
  }
  clipKind(id: string): PromptClipKind {
    const kind = this.flowFor(id)?.scenes.find(scene => scene.interstitialId === id)?.clip.kind;
    return kind === 'call' || kind === 'idle' || kind === 'response' ? kind : 'interstitial';
  }
  add(time: number, duration: number) {
    const fps = TIMELINE_FPS;
    const anchor = Math.max(0, Math.min(frameTime(duration, fps), frameTime(time, fps)));
    const existing = this.state.items.find(item => !item.groupId && item.kind !== 'call-response' && Math.abs(item.time - anchor) < 0.5 / fps);
    if (existing) { this.select(existing.id); return existing; }
    const item: Interstitial = { id: crypto.randomUUID(), label: 'Untitled', time: anchor,
      start_range: INTERSTITIAL.defaultRange, end_range: INTERSTITIAL.defaultRange, duration: INTERSTITIAL.defaultDuration,
      enable_prompt_expansion: INTERSTITIAL.enablePromptExpansion, method: 'comfy', prompt: '', phase: 'draft' };
    this.update({ items: [...this.state.items, item].sort((a, b) => a.time - b.time), selectedId: item.id }, true);
    return item;
  }
  move(id: string, time: number) {
    const item = this.state.items.find(item => item.id === id);
    if (item && !isGenerating(item) && Number.isFinite(time) && time >= 0) this.patch(id, { time: frameTime(time, TIMELINE_FPS) });
  }
  rename(id: string, name: string) {
    const label = name.trim().slice(0, 1000) || 'Untitled';
    if (this.state.items.some(item => item.id === id && item.label !== label)) this.patch(id, { label });
  }
  ensureItem(item: Interstitial) { if (!this.state.items.some(current => current.id === item.id)) this.update({ items: [...this.state.items, item] }, true); }
  edit(id: string, values: Partial<InterstitialSettings>) {
    const item = this.state.items.find(item => item.id === id);
    // The editor always stays usable. Jobs and media retain the inputs they were submitted with.
    if (!item) return;
    if (values.duration !== undefined && this.hasLinkedDuration(id)) {
      const linked = this.flowFor(id) ? responseInterstitialIds(this.flowFor(id)!) : this.linkedDurationIds;
      this.update({ items: this.state.items.map(current => current.id === id ? { ...current, ...values }
        : linked.includes(current.id) ? { ...current, duration: values.duration! } : current) }, true);
    } else this.patch(id, values);
  }
  canRecover(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || hasUnsubmittedChanges(item)) return false;
    const reference = this.dependency(id)?.reference, submitted = item.result?.reference ?? item.requestReference;
    return !reference || !!submitted && sameReference(reference, submitted);
  }
  async generateAll(engine: MediaEngine, info: MediaInfo, providers?: AppStatus['providers'], remaining = false, groupId?: string) {
    const flow = groupId ? this.callResponses.find(flow => flow.interstitial.id === groupId) : this.callResponse;
    if (!flow || sequenceActive(this.state.sequence)) return;
    const ids = generationOrder(flow);
    if (!ids.length || ids.some(id => {
      const item = this.state.items.find(item => item.id === id);
      return !item || this.tasks.has(id) || this.cancelling.has(id) || isGenerating(item);
    })) return;
    const previous = this.state.sequence;
    const completedIds = remaining && previous?.ids.join('|') === ids.join('|') ? previous.completedIds.filter(id => {
      const item = this.state.items.find(item => item.id === id);
      return item && playableResult(item) && !hasUnsubmittedChanges(item) && !this.dependency(id)?.stale;
    }) : [];
    const operation = new AbortController(); this.sequenceOperation = operation;
    this.update({ sequence: { ids, completedIds, phase: 'running' }, error: null });
    try {
      for (const id of ids) {
        if (completedIds.includes(id)) continue;
        operation.signal.throwIfAborted();
        const item = this.state.items.find(item => item.id === id);
        if (!item) throw new Error('A clip was removed. Start a new sequence.');
        this.update({ sequence: { ids, completedIds: [...completedIds], activeId: id, phase: 'running' } });
        if (!item.prompt.trim()) throw new Error(`Add a prompt for ${item.label} to continue.`);
        if (providers && !providers.comfy) throw new Error(`${item.label}: Comfy Cloud is not connected.`);
        const blocked = this.dependency(id)?.blocked;
        if (blocked) throw new Error(blocked);
        // Read editable fields and references only when this clip's turn starts.
        await this.generateClip(id, engine, info);
        operation.signal.throwIfAborted();
        const result = this.state.items.find(item => item.id === id);
        if (result?.phase !== 'ready') throw new Error(`${item.label}: ${result?.error || 'Generation stopped. Retry this clip or continue the sequence.'}`);
        if (this.dependency(id)?.stale) throw new Error(`${item.label}'s reference changed. Regenerate it before continuing.`);
        completedIds.push(id);
        this.update({ sequence: { ids, completedIds: [...completedIds], phase: 'running' } });
      }
      this.update({ sequence: { ids, completedIds, phase: 'ready' } });
    } catch (error) {
      if (!operation.signal.aborted) this.update({ sequence: { ...this.state.sequence!, phase: 'error', activeId: undefined,
        message: error instanceof Error ? error.message : 'Sequence stopped. Try again.' } });
    } finally {
      if (!operation.signal.aborted && this.sequenceOperation === operation) this.sequenceOperation = undefined;
    }
  }
  async cancelSequence(message?: string) {
    const sequence = this.state.sequence;
    if (!sequenceActive(sequence)) return true;
    const source = this.sourceId, operation = this.sequenceOperation;
    operation?.abort();
    this.update({ sequence: { ...sequence!, phase: 'cancelling' } });
    const cancelled = sequence?.activeId ? await this.cancelClip(sequence.activeId) : true;
    if (source === this.sourceId && this.sequenceOperation === operation) {
      this.sequenceOperation = undefined;
      this.update({ sequence: { ...sequence!, activeId: undefined, phase: cancelled ? 'cancelled' : 'error',
        message: cancelled ? message : 'The sequence stopped, but its remote job could not be cancelled. Retry cancellation on the clip.' } });
    }
    return cancelled;
  }
  async generate(id: string, engine: MediaEngine, info: MediaInfo) {
    if (sequenceActive(this.state.sequence) && this.state.sequence!.ids.includes(id)) return;
    return this.generateClip(id, engine, info);
  }
  private async generateClip(id: string, engine: MediaEngine, info: MediaInfo) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || isGenerating(item) || this.tasks.has(id) || this.cancelling.has(id)) return;
    // An unchanged scene that only failed to download can reuse its existing render.
    if (item.result && item.phase !== 'ready' && this.canRecover(id)) return this.resumeClip(id);
    const dependency = this.dependency(id);
    if (dependency?.blocked) { this.update({ error: dependency.blocked }); return; }
    const operation = new AbortController(); this.tasks.set(id, operation);
    const method = normalizeGenerationMethod(item.method);
    this.patch(id, { phase: 'preparing', error: undefined, progress: 0, progressDetails: undefined, queuePosition: undefined,
      previousResult: playableResult(item), result: undefined, requestId: item.phase === 'ready' ? undefined : item.requestId,
      requestMethod: item.requestMethod, generationSettings: interstitialSettings(item), requestReference: dependency?.reference });
    try {
      // A failed status request may still belong to an active job. Retire it before resubmitting.
      if (item.requestId && item.phase !== 'cancelled' && item.phase !== 'ready') await cancelInterstitialJob(item.requestId);
      operation.signal.throwIfAborted();
      this.patch(id, { requestId: undefined, requestMethod: method, requestInsertion: undefined, result: undefined });
      const source = dependency?.reference ? await generationSource(item, dependency.reference, operation.signal) : { item, engine, info };
      operation.signal.throwIfAborted();
      const submittedPrompt = generationPrompt(source.item);
      const job = await generateInterstitial(source.item, source.engine, source.info, operation.signal, (phase, progress) => {
        if (!operation.signal.aborted) this.patch(id, { phase, progress });
      });
      if (operation.signal.aborted) { void cancelInterstitialJob(job.requestId).catch(() => undefined); return; }
      this.patch(id, { requestId: job.requestId, requestMethod: method, requestPrompt: submittedPrompt, requestInsertion: job.insertion, phase: 'queued', progress: undefined });
      await this.poll(id, job.requestId, operation.signal, job.insertion);
    } catch (error) { this.fail(id, operation, error); }
    finally { if (this.tasks.get(id) === operation) this.tasks.delete(id); }
  }
  private fail(id: string, operation: AbortController, error: unknown) {
    if (!operation.signal.aborted) this.patch(id, { phase: 'error', progress: undefined, error: error instanceof Error ? error.message : 'Generation failed. Try again.' });
  }
  async resume(id: string) {
    if (sequenceActive(this.state.sequence) && this.state.sequence!.ids.includes(id)) return;
    return this.resumeClip(id);
  }
  private async resumeClip(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || this.tasks.has(id) || this.cancelling.has(id)) return;
    const operation = new AbortController(); this.tasks.set(id, operation);
    try {
      this.patch(id, { phase: item.result ? 'loading' : 'queued', error: undefined, progress: undefined, progressDetails: undefined, queuePosition: undefined });
      if (item.result) await this.loadResult(id, item.result, operation.signal);
      else if (item.requestId) await this.poll(id, item.requestId, operation.signal, item.requestInsertion);
      else throw new Error('No generation job was saved. Retry to generate the scene.');
    } catch (error) { this.fail(id, operation, error); }
    finally { if (this.tasks.get(id) === operation) this.tasks.delete(id); }
  }
  private async poll(id: string, requestId: string, signal: AbortSignal, submittedInsertion?: InsertionRange) {
    const stream = new AbortController(), streamSignal = AbortSignal.any([signal, stream.signal]);
    let liveRevision = 0;
    void watchComfyJob(requestId, streamSignal, event => {
      if (streamSignal.aborted) return;
      liveRevision++;
      if (event.type === 'progress') this.patch(id, { phase: 'rendering', progress: event.progress, progressDetails: event.progressDetails, queuePosition: undefined });
      if (event.type === 'status') this.patch(id, { phase: event.status === 'IN_QUEUE' ? 'queued' : 'rendering', queuePosition: event.queuePosition,
        ...(event.status === 'IN_QUEUE' ? { progress: undefined, progressDetails: undefined } : {}) });
    });
    try { for (;;) {
      signal.throwIfAborted();
      const revisionAtRequest = liveRevision;
      const job = await getInterstitialJob(requestId, signal);
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
      // Discard a snapshot requested before a newer live update, however long the request took.
      // A subsequent poll still reconciles the state, including when the stream is silent.
      if (revisionAtRequest === liveRevision) this.patch(id, { phase: job.status === 'IN_QUEUE' ? 'queued' : 'rendering', queuePosition: job.queuePosition,
        progress: job.status === 'IN_QUEUE' ? undefined : job.progress, progressDetails: job.status === 'IN_QUEUE' ? undefined : job.progressDetails });
      await wait(signal);
    } } finally { stream.abort(); }
  }
  private async loadResult(id: string, result: NonNullable<Interstitial['result']>, signal: AbortSignal) {
    if (!result.assetId) {
      this.patch(id, { phase: 'loading', progress: undefined, progressDetails: { stage: 'Downloading generated video' } });
      let lastPercent: number | undefined;
      const fetched = await assets.fetch(result.url, `${id}.mp4`, signal, (received, total) => {
        if (signal.aborted) return;
        const progress = Number.isFinite(total) && total > 0 ? Math.min(1, received / total) : undefined;
        const percent = progress === undefined ? undefined : Math.floor(progress * 100);
        if (percent !== lastPercent) { lastPercent = percent; this.patch(id, { progress }); }
      });
      signal.throwIfAborted();
      let blob = fetched.blob;
      let fullBlob: Blob | undefined;
      let fullRange: Pick<typeof result, 'start' | 'duration' | 'totalDuration'> | undefined;
      const idle = this.flowFor(id)?.scenes.some(scene => scene.interstitialId === id && scene.clip.kind === 'idle');
      if (result.reference?.mode === 'loop' || idle && result.reference?.before) {
        this.patch(id, { progress: undefined, progressDetails: { stage: 'Matching loop boundaries' } });
        fullBlob = blob;
        fullRange = { start: result.start, duration: result.duration, totalDuration: result.totalDuration };
        const loop = await finishLoop(blob, result, signal); blob = loop.blob; result = loop.result;
      }
      this.patch(id, { progress: undefined, progressDetails: { stage: 'Saving generated video' } });
      const asset = await assets.save(blob, fetched.name, signal);
      const fullAsset = fullBlob ? await assets.save(fullBlob, `${id}-full.mp4`, signal) : undefined;
      if (fullAsset) await assets.open(fullAsset.id);
      signal.throwIfAborted();
      result = { ...result, assetId: asset.id, ...(fullAsset ? { fullAssetId: fullAsset.id, fullRange } : {}) };
      this.patch(id, { result });
    }
    this.patch(id, { phase: 'loading', progress: undefined, progressDetails: { stage: 'Checking generated video' } });
    const { url } = await assets.open(result.assetId!);
    signal.throwIfAborted();
    const media = new MediaEngine({ id, name: 'Interstitial', url });
    const abort = () => media.dispose(); signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const info = await media.inspect();
      signal.throwIfAborted();
      if (result.start < 0 || result.duration <= 0 || result.start + result.duration > info.duration + 1 / info.fps) throw new Error('The returned video does not contain the full interstitial.');
      this.patch(id, { phase: 'ready', result, previousResult: undefined, error: undefined, progress: undefined, progressDetails: undefined });
    } finally { signal.removeEventListener('abort', abort); media.dispose(); }
  }
  async cancel(id: string) {
    if (sequenceActive(this.state.sequence) && this.state.sequence?.activeId === id) return this.cancelSequence();
    return this.cancelClip(id);
  }
  private async cancelClip(id: string) {
    const pending = this.cancelling.get(id);
    if (pending) return pending;
    const cancellation = this.performCancellation(id);
    this.cancelling.set(id, cancellation);
    try { return await cancellation; }
    finally { if (this.cancelling.get(id) === cancellation) this.cancelling.delete(id); }
  }
  private async performCancellation(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item) return false;
    if (item.phase === 'ready') return true;
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
  async remove(id: string) {
    return this.removeMany([id]);
  }
  async removeMany(ids: string[], signal?: AbortSignal) {
    const source = this.sourceId, removed = new Set(ids);
    if (sequenceActive(this.state.sequence) && this.state.sequence!.ids.some(id => removed.has(id)) && !await this.cancelSequence('A clip was removed. Start a new sequence to include the remaining clips.')) return false;
    const items = this.state.items.filter(item => removed.has(item.id));
    // Retain the whole group if any active job cannot be cancelled.
    for (const item of items) {
      if (signal?.aborted || source !== this.sourceId) return false;
      if ((isGenerating(item) || item.phase === 'error' && item.requestId && !item.result) && !await this.cancel(item.id)) return false;
    }
    if (signal?.aborted || source !== this.sourceId) return false;
    this.update({ items: this.state.items.filter(item => !removed.has(item.id)), selectedId: this.state.selectedId && removed.has(this.state.selectedId) ? null : this.state.selectedId }, true);
    return true;
  }
  async restoreEdits(edits: InterstitialEdit[], flow: CallResponseFlow | undefined, signal: AbortSignal) {
    const ids = new Set(edits.map(item => item.id)), previousIds = new Set(this.state.items.map(item => item.id));
    if (edits.some(item => !this.retained.has(item.id))) throw new Error('This edit is no longer available in the current project.');
    const removed = this.state.items.filter(item => !ids.has(item.id)).map(item => item.id);
    if (removed.length && !await this.removeMany(removed, signal)) throw new Error('Could not cancel a generation job. Retry undo or redo.');
    signal.throwIfAborted();
    const selectedId = this.state.selectedId && (ids.has(this.state.selectedId) || this.state.selectedId === flow?.interstitial.id)
      ? this.state.selectedId : flow?.interstitial.id ?? edits.find(item => !previousIds.has(item.id))?.id ?? null;
    if (sequenceStructure(flow) !== sequenceStructure(this.callResponse) && !await this.cancelSequence('Clip structure changed. Start a new sequence to include the updated clips.')) throw new Error('Could not cancel generation. Retry undo or redo.');
    this.callResponse = flow; this.linkedDurationIds = flow ? responseInterstitialIds(flow) : [];
    // Preserve the latest job and render even when the corresponding edit predates them.
    this.update({ items: edits.map(edit => ({ ...this.retained.get(edit.id)!, ...edit })), selectedId, error: null }, true);
  }
  dispose() {
    this.sequenceOperation?.abort(); this.sequenceOperation = undefined;
    this.tasks.forEach(task => task.abort()); this.tasks.clear(); this.cancelling.clear();
  }
}
