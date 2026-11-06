import { readAsset, writeAsset } from './database';
import type { Asset } from './types';
import { requestResponse } from '../../shared/api';

/** Durable Blob storage. Object URLs are session-only and never written into project files. */
class AssetLibrary {
  private urls = new Map<string, string>();
  private availability = new Map<string, string | undefined>();
  private opening = new Map<string, Promise<{ asset: Asset; url: string }>>();
  private deleted = new Set<string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.revision;
  error = (id: string) => this.availability.get(id);
  setDeleted(ids: readonly string[] = []) {
    const next = new Set(ids), changed = [...new Set([...this.deleted, ...next])].filter(id => this.deleted.has(id) !== next.has(id));
    this.deleted = next;
    for (const id of changed) {
      this.opening.delete(id);
      const url = this.urls.get(id); if (url) URL.revokeObjectURL(url);
      this.urls.delete(id); this.availability.delete(id);
      if (next.has(id)) this.availability.set(id, 'This asset was deleted from the Library. Undo the deletion or replace the missing reference.');
    }
    if (changed.length) { this.revision++; this.listeners.forEach(listener => listener()); }
  }
  private report(id: string, error?: string) {
    const changed = !this.availability.has(id) || this.availability.get(id) !== error;
    this.availability.set(id, error);
    if (changed) { this.revision++; this.listeners.forEach(listener => listener()); }
  }
  check(id: string) {
    if (id && !this.availability.has(id)) void this.open(id).catch(() => {});
  }
  url(id: string) { return this.urls.get(id); }
  async open(id: string) {
    if (this.deleted.has(id)) throw new Error(this.error(id) ?? 'This asset was deleted from the Library.');
    const pending = this.opening.get(id);
    if (pending) return pending;
    let operation!: Promise<{ asset: Asset; url: string }>;
    operation = (async () => {
      try {
        const asset = await readAsset(id);
        if (this.opening.get(id) !== operation) throw new DOMException('Asset availability changed.', 'AbortError');
        if (!asset) throw new Error('This saved media file is missing. Import a project backup containing it, or replace it with a file from the Library.');
        if (!asset.blob.size) throw new Error('This saved media file is empty. Replace it with a working file from the Library.');
        let url = this.urls.get(id);
        if (!url) { url = URL.createObjectURL(asset.blob); this.urls.set(id, url); }
        this.report(id);
        return { asset, url };
      } catch (error) {
        if (this.opening.get(id) === operation) this.report(id, error instanceof Error ? error.message : 'This media file could not be read. Reimport the file and replace this reference.');
        throw error;
      } finally { if (this.opening.get(id) === operation) this.opening.delete(id); }
    })();
    this.opening.set(id, operation);
    return operation;
  }
  async save(blob: Blob, name: string, signal?: AbortSignal): Promise<Asset> {
    signal?.throwIfAborted();
    const asset = { id: crypto.randomUUID(), name, blob };
    await writeAsset(asset, signal); signal?.throwIfAborted(); return asset;
  }
  async fetch(url: string, name: string, signal?: AbortSignal, progress?: (received: number, total: number) => void): Promise<Asset> {
    const localComfy = /^\/api\/comfy\/assets\/[A-Za-z0-9_-]{8,128}\/content$/.test(url);
    const response = await (localComfy ? requestResponse(url, { signal }) : fetch(url, { signal }));
    if (!response.ok) throw new Error(`Unable to save ${name} (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`No media was returned for ${name}.`);
    const parts: BlobPart[] = []; let received = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        parts.push(value); received += value.byteLength; progress?.(received, total);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (!received) throw new Error(`${name} is empty.`);
    signal?.throwIfAborted();
    return { id: crypto.randomUUID(), name, blob: new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] || 'video/mp4' }) };
  }
  async download(url: string, name: string, signal?: AbortSignal, progress?: (received: number, total: number) => void) {
    const asset = await this.fetch(url, name, signal, progress);
    await writeAsset(asset, signal); signal?.throwIfAborted(); return asset;
  }
  releaseExcept(keep: Set<string>) {
    // Invalidate reads too: they may finish after their project has been closed.
    for (const id of this.opening.keys()) if (!keep.has(id)) this.opening.delete(id);
    for (const [id, url] of this.urls) if (!keep.has(id)) { URL.revokeObjectURL(url); this.urls.delete(id); }
    for (const id of this.availability.keys()) if (!keep.has(id) && !this.deleted.has(id)) this.availability.delete(id);
  }
}
export const assets = new AssetLibrary();
