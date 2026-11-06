import { TIMELINE_FPS } from '../../../shared/constants';
import { assetPlacement } from './migrateClipMedia';
import { projectLoraAddress, projectLoraStrength } from '../../../shared/loras';
import { generationBusy, validateAssetSettings, type AssetGeneration } from '../../../shared/asset-generation';
import { request, requestResponse } from '../../shared/api';
import { abortableDelay } from '../../shared/abortableDelay';
import { imageDataUrl } from '../interstitials/image-references';
import { assets } from './assets';
import { inspectAsset } from './libraryFiles';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';

/** Jobs belong to the document, not to mounted inspectors. */
export class ClipGenerationController {
  private tasks = new Map<string, { controller: AbortController; scope: string; id: string }>();
  private cancelling = new Map<string, Promise<void>>();
  constructor(private projects: ProjectController) {}
  private scope() {
    const { project, generationRevision, activating } = this.projects.getSnapshot();
    return project && !activating ? JSON.stringify([project.id, generationRevision]) : undefined;
  }
  private key(scope: string, id: string) { return JSON.stringify([scope, id]); }
  private current(scope: string, id: string, controller?: AbortController) {
    return this.scope() === scope && !!this.get(id) && (!controller || !controller.signal.aborted);
  }
  private get(id: string) { const project=this.projects.getSnapshot().project; return project?.storyFlow?.nodes.some(n=>n.generationId===id) ? project.clipGenerations?.find(g => g.id === id) : undefined; }
  selectVersion(id:string,assetId:string){
    const g=this.get(id);if(!g?.versions.some(v=>v.assetId===assetId))return;
    this.projects.editAssets(project=>{const asset=project.library?.find(a=>a.assetId===assetId);if(!asset)return project;return {...project,clipGenerations:project.clipGenerations?.map(g=>g.id===id?{...g,selectedAssetId:assetId}:g),storyFlow:project.storyFlow?{...project.storyFlow,nodes:project.storyFlow.nodes.map(n=>n.generationId===id?{...n,source:assetPlacement(asset,n.source?(n.source.outFrame-n.source.inFrame)/TIMELINE_FPS:n.duration),trim:undefined}:n)}:undefined};});
  }
  edit(id: string, patch: Partial<AssetGeneration>, record = true) {
    this.projects.editAssets(project => ({ ...project, clipGenerations: project.clipGenerations?.map(g => g.id === id ? { ...g, ...patch,
      ...(patch.settings && patch.settings.model !== g.settings.model ? { settings: { ...patch.settings, lora: projectLoraAddress(project.loras, patch.settings.model), loraInstructions: undefined, loraStrength: projectLoraStrength(project.loras, patch.settings.model) } } : {}),
    } : g) }), record);
  }
  watch() {
    const check = () => {
      const project = this.projects.getSnapshot().project;
      const scope = this.scope();
      for (const task of this.tasks.values()) {
        if (task.scope !== scope || !this.get(task.id)) task.controller.abort();
      }
      if (project?.clipGenerations?.some(g => g.settings.count !== 1)) {
        this.projects.editAssets(p => ({ ...p, clipGenerations: p.clipGenerations?.map(g => g.settings.count === 1 ? g : { ...g, settings: { ...g.settings, count: 1 } }) }), false);
        return;
      }
      for (const g of project?.clipGenerations ?? []) {
        if (generationBusy(g) && g.requestId && g.submitted) void this.resume(g.id);
      }
    };
    const unsubscribe = this.projects.subscribe(check); check();
    return () => { unsubscribe(); for (const task of this.tasks.values()) task.controller.abort(); };
  }
  async generate(id: string) {
    const g = this.get(id), scope = this.scope();
    if (!g || !scope || generationBusy(g)) return;
    const key = this.key(scope, id);
    if (this.tasks.has(key) || this.cancelling.has(key)) return;
    const settings = { ...g.settings, count: 1 }, error = validateAssetSettings(settings);
    if (error) { this.edit(id, { error }, false); return; }
    const task = new AbortController(), submitted = structuredClone(settings);
    this.tasks.set(key, { controller: task, scope, id });
    this.edit(id, { phase: 'preparing', error: undefined, settings }, false);
    try {
      // A failed status read can leave a paid job running. Retire it before retrying.
      if (g.requestId && g.submitted && g.phase !== 'ready' && g.phase !== 'cancelled') {
        await request(`/api/library-generations/${g.submitted.model}/${g.requestId}`, { method: 'DELETE' });
      }
      task.signal.throwIfAborted();
      this.edit(id, { requestId: undefined, submitted }, false);
      const inputs = [];
      let total = 0;
      for (const ref of submitted.references) {
        task.signal.throwIfAborted();
        const { asset } = await assets.open(ref.assetId);
        if (asset.blob.size > 15 * 1024 ** 2) throw new Error(`${ref.name} exceeds the 15 MB reference limit. Use a shorter clip or smaller image.`);
        const data = await imageDataUrl(asset.blob, task.signal); total += data.length;
        if (total > 45 * 1024 ** 2) throw new Error('Combined references exceed 45 MB. Use smaller inputs.');
        inputs.push({ kind: ref.kind, data });
      }
      task.signal.throwIfAborted();
      // Do not abort submission: retain the accepted ID even if the user cancels or changes project.
      const { requestId } = await request<{ requestId: string }>('/api/library-generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: submitted, inputs }) });
      // Working document IDs are reused. Never attach a late submission to a new activation.
      if (!this.current(scope, id)) { await request(`/api/library-generations/${submitted.model}/${requestId}`, { method: 'DELETE' }); return; }
      this.edit(id, { requestId, phase: 'queued' }, false);
      if (task.signal.aborted) { await this.cancel(id); return; }
      await this.poll(id, scope, task);
    } catch (e) {
      if (this.current(scope, id, task)) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Generation failed.' }, false);
    } finally { if (this.tasks.get(key)?.controller === task) this.tasks.delete(key); }
  }
  async resume(id: string) {
    const g = this.get(id), scope = this.scope();
    if (!g?.requestId || !g.submitted || !scope) return;
    const key = this.key(scope, id); if (this.tasks.has(key) || this.cancelling.has(key)) return;
    const task = new AbortController(); this.tasks.set(key, { controller: task, scope, id });
    this.edit(id, { phase: 'queued', error: undefined }, false);
    try { await this.poll(id, scope, task); }
    catch (e) { if (this.current(scope, id, task)) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Unable to check result.' }, false); }
    finally { if (this.tasks.get(key)?.controller === task) this.tasks.delete(key); }
  }
  private async poll(id: string, scope: string, task: AbortController) {
    while (this.current(scope, id, task)) {
      const g = this.get(id); if (!g?.requestId || !g.submitted || g.phase === 'cancelled') return;
      const base = `/api/library-generations/${g.submitted.model}/${g.requestId}`;
      const status = await request<{ phase: 'queued' | 'rendering' | 'ready'; count?: number }>(base, { signal: task.signal });
      if (!this.current(scope, id, task) || this.get(id)?.requestId !== g.requestId) return;
      if (status.phase === 'ready') {
        this.edit(id, { phase: 'loading' }, false);
        const added: LibraryAsset[] = [], versions: AssetGeneration['versions'] = [];
        for (let i = 0; i < (status.count ?? 1); i++) {
          const response = await requestResponse(`${base}/content/${i}`, { signal: task.signal });
          const blob = await response.blob(), kind = g.kind;
          if (!blob.size || !blob.type.startsWith(`${kind}/`)) throw new Error('Generated media has an unexpected format.');
          const metadata = await inspectAsset(blob, kind, task.signal), name = `${g.name} · v${g.versions.length + i + 1}`;
          const asset = await assets.save(blob, name, task.signal); await assets.open(asset.id);
          added.push({ assetId: asset.id, name, kind: kind === 'video' ? 'generated' : kind, generationId: id, generation:{provider:'fal',settings:structuredClone(g.submitted),createdAt:Date.now()}, ...metadata });
          versions.push({ assetId: asset.id, name, createdAt: Date.now(), settings: g.submitted });
        }
        task.signal.throwIfAborted(); if (!this.current(scope, id) || this.get(id)?.requestId !== g.requestId) return;
        this.projects.editAssets(project => ({ ...project, library: [...project.library ?? [], ...added], storyFlow:project.storyFlow?{...project.storyFlow,nodes:project.storyFlow.nodes.map(n=>n.generationId===id&&added[0]?{...n,source:assetPlacement(added[0],n.source?(n.source.outFrame-n.source.inFrame)/TIMELINE_FPS:n.duration),trim:undefined}:n)}:undefined, clipGenerations: project.clipGenerations?.map(item => item.id === id ? {
          ...item, phase: 'ready', error: undefined, versions: [...item.versions, ...versions], selectedAssetId: versions[0]?.assetId,
        } : item) }), false);
        return;
      }
      this.edit(id, { phase: status.phase }, false);
      await abortableDelay(2000, task.signal);
    }
  }
  async cancel(id: string) {
    const g = this.get(id), scope = this.scope(); if (!g || !scope) return;
    const key = this.key(scope, id), pending = this.cancelling.get(key);
    if (pending) return pending;
    // Register before notifying subscribers so the watcher cannot restart polling.
    const operation = Promise.resolve().then(async () => {
      this.tasks.get(key)?.controller.abort();
      try {
        if (g.requestId && g.submitted) await request(`/api/library-generations/${g.submitted.model}/${g.requestId}`, { method: 'DELETE' });
        if (this.current(scope, id)) this.edit(id, { phase: 'cancelled', error: undefined }, false);
      } catch (e) {
        if (this.current(scope, id)) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Cancellation failed. Check result.' }, false);
      } finally { this.cancelling.delete(key); }
    });
    this.cancelling.set(key, operation);
    return operation;
  }
}
