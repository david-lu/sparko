import { readAsset, writeAsset } from './database';
import type { Asset } from './types';

/** Durable Blob storage. Object URLs are session-only and never written into project files. */
class AssetLibrary {
  private urls = new Map<string, string>();
  url(id: string) { return this.urls.get(id); }
  async open(id: string) {
    const asset = await readAsset(id);
    if (!asset) throw new Error('A saved media asset is missing. Reimport the project backup.');
    let url = this.urls.get(id);
    if (!url) { url = URL.createObjectURL(asset.blob); this.urls.set(id, url); }
    return { asset, url };
  }
  async save(blob: Blob, name: string, signal?: AbortSignal): Promise<Asset> {
    signal?.throwIfAborted();
    const asset = { id: crypto.randomUUID(), name, blob };
    await writeAsset(asset, signal); signal?.throwIfAborted(); return asset;
  }
  async fetch(url: string, name: string, signal?: AbortSignal, progress?: (received: number, total: number) => void): Promise<Asset> {
    const response = await fetch(url, { signal });
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
    } finally { reader.releaseLock(); }
    if (!received) throw new Error(`${name} is empty.`);
    signal?.throwIfAborted();
    return { id: crypto.randomUUID(), name, blob: new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] || 'video/mp4' }) };
  }
  async download(url: string, name: string, signal?: AbortSignal, progress?: (received: number, total: number) => void) {
    const asset = await this.fetch(url, name, signal, progress);
    await writeAsset(asset, signal); signal?.throwIfAborted(); return asset;
  }
  releaseExcept(keep: Set<string>) {
    for (const [id, url] of this.urls) if (!keep.has(id)) { URL.revokeObjectURL(url); this.urls.delete(id); }
  }
}
export const assets = new AssetLibrary();
