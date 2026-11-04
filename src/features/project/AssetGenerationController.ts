import { projectLoraAddress } from '../../../shared/loras';
import { generationBusy, validateAssetSettings, type AssetGeneration } from '../../../shared/asset-generation';
import { request, appHeaders } from '../../shared/api';
import { imageDataUrl } from '../interstitials/image-references';
import { assets } from './assets';
import { inspectAsset } from './libraryFiles';
import { readProject, writeProject } from './database';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';

/** Jobs belong to the document, not to mounted inspectors. */
export class AssetGenerationController {
  private tasks = new Map<string, AbortController>();
  constructor(private projects: ProjectController) {}
  private get(id: string) { return this.projects.getSnapshot().project?.assetGenerations?.find(g => g.id === id); }
  edit(id: string, patch: Partial<AssetGeneration>, record = true) {
    this.projects.editAssets(project => ({ ...project, assetGenerations: project.assetGenerations?.map(g => g.id === id ? { ...g, ...patch,
      ...(patch.settings && patch.settings.model !== g.settings.model ? { settings: { ...patch.settings, lora: projectLoraAddress(project.loras, patch.settings.model) } } : {}),
    } : g) }), record);
  }
  watch() {
    const check = () => {
      const project = this.projects.getSnapshot().project;
      if (project?.assetGenerations?.some(g => g.settings.count !== 1)) {
        this.projects.editAssets(p => ({ ...p, assetGenerations: p.assetGenerations?.map(g => g.settings.count === 1 ? g : { ...g, settings: { ...g.settings, count: 1 } }) }), false);
        return;
      }
      for (const g of project?.assetGenerations ?? []) if (generationBusy(g) && g.requestId && g.submitted && !this.tasks.has(`${project!.id}:${g.id}`)) void this.resume(g.id);
    };
    const unsubscribe = this.projects.subscribe(check); check();
    return () => { unsubscribe(); for (const task of this.tasks.values()) task.abort(); this.tasks.clear(); };
  }
  async generate(id: string) {
    const g = this.get(id), projectId = this.projects.getSnapshot().project?.id;
    if (!g || !projectId || generationBusy(g)) return;
    const settings = { ...g.settings, count: 1 }, error = validateAssetSettings(settings);
    if (error) { this.edit(id, { error }, false); return; }
    const key = `${projectId}:${id}`, task = new AbortController(), submitted = structuredClone(settings);
    this.tasks.set(key, task);
    this.edit(id, { phase: 'preparing', error: undefined, settings, submitted, requestId: undefined }, false);
    try {
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
      if (this.projects.getSnapshot().project?.id !== projectId) {
        const previous = await readProject(projectId);
        if (previous?.assetGenerations?.some(item => item.id === id)) await writeProject({ ...previous, assetGenerations: previous.assetGenerations.map(item => item.id === id ? { ...item, submitted, requestId, phase: 'queued' } : item) });
        else await request(`/api/library-generations/${submitted.model}/${requestId}`, { method: 'DELETE' });
        return;
      }
      if (!this.get(id)) { await request(`/api/library-generations/${submitted.model}/${requestId}`, { method: 'DELETE' }); return; }
      this.edit(id, { requestId, phase: 'queued' }, false);
      if (task.signal.aborted) { await this.cancel(id); return; }
      await this.poll(id, projectId, task);
    } catch (e) {
      if (!task.signal.aborted && this.projects.getSnapshot().project?.id === projectId) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Generation failed.' }, false);
    } finally { if (this.tasks.get(key) === task) this.tasks.delete(key); }
  }
  async resume(id: string) {
    const g = this.get(id), projectId = this.projects.getSnapshot().project?.id;
    if (!g?.requestId || !g.submitted || !projectId) return;
    const key = `${projectId}:${id}`; if (this.tasks.has(key)) return;
    const task = new AbortController(); this.tasks.set(key, task);
    this.edit(id, { phase: 'queued', error: undefined }, false);
    try { await this.poll(id, projectId, task); }
    catch (e) { if (!task.signal.aborted && this.projects.getSnapshot().project?.id === projectId) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Unable to check result.' }, false); }
    finally { if (this.tasks.get(key) === task) this.tasks.delete(key); }
  }
  private async poll(id: string, projectId: string, task: AbortController) {
    while (!task.signal.aborted && this.projects.getSnapshot().project?.id === projectId) {
      const g = this.get(id); if (!g?.requestId || !g.submitted || g.phase === 'cancelled') return;
      const base = `/api/library-generations/${g.submitted.model}/${g.requestId}`;
      const status = await request<{ phase: 'queued' | 'rendering' | 'ready'; count?: number }>(base, { signal: task.signal });
      if (this.projects.getSnapshot().project?.id !== projectId || task.signal.aborted) return;
      if (status.phase === 'ready') {
        this.edit(id, { phase: 'loading' }, false);
        const added: LibraryAsset[] = [], versions: AssetGeneration['versions'] = [];
        for (let i = 0; i < (status.count ?? 1); i++) {
          const response = await fetch(`${base}/content/${i}`, { headers: appHeaders(), signal: task.signal });
          if (!response.ok) throw new Error('Unable to download output. Use Check result to try again.');
          const blob = await response.blob(), kind = g.kind;
          if (!blob.size || !blob.type.startsWith(`${kind}/`)) throw new Error('Generated media has an unexpected format.');
          const metadata = await inspectAsset(blob, kind), name = `${g.name} · v${g.versions.length + i + 1}`;
          const asset = await assets.save(blob, name, task.signal); await assets.open(asset.id);
          added.push({ assetId: asset.id, name, kind: kind === 'video' ? 'generated' : kind, generationId: id, folderId: g.folderId, ...metadata });
          versions.push({ assetId: asset.id, name, createdAt: Date.now(), settings: g.submitted });
        }
        task.signal.throwIfAborted(); if (this.projects.getSnapshot().project?.id !== projectId) return;
        this.projects.editAssets(project => ({ ...project, library: [...project.library ?? [], ...added], assetGenerations: project.assetGenerations?.map(item => item.id === id ? {
          ...item, phase: 'ready', error: undefined, versions: [...item.versions, ...versions], selectedAssetId: versions[0]?.assetId,
        } : item) }), false);
        return;
      }
      this.edit(id, { phase: status.phase }, false);
      await new Promise<void>(resolve => { const finish = () => { clearTimeout(timer); task.signal.removeEventListener('abort', finish); resolve(); }; const timer = window.setTimeout(finish, 2000); task.signal.addEventListener('abort', finish, { once: true }); });
    }
  }
  async cancel(id: string) {
    const g = this.get(id), projectId = this.projects.getSnapshot().project?.id; if (!g || !projectId) return;
    this.tasks.get(`${projectId}:${id}`)?.abort();
    try {
      if (g.requestId && g.submitted) await request(`/api/library-generations/${g.submitted.model}/${g.requestId}`, { method: 'DELETE' });
      if (this.projects.getSnapshot().project?.id === projectId) this.edit(id, { phase: 'cancelled', error: undefined }, false);
    } catch (e) { if (this.projects.getSnapshot().project?.id === projectId) this.edit(id, { phase: 'error', error: e instanceof Error ? e.message : 'Cancellation failed. Check result.' }, false); }
  }
}
