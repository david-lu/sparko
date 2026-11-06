import { downloadBlob } from '../../media/media';
import { assets } from './assets';
import type { LibraryAsset } from './types';

export async function downloadAsset(asset: LibraryAsset, signal?: AbortSignal) {
  const { asset: stored } = await assets.open(asset.assetId);
  signal?.throwIfAborted();
  const blob = stored.blob;
  signal?.throwIfAborted();
  const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };
  const extension = extensions[blob.type];
  const name = extension && !/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|mkv|m4v|wav|mp3|m4a|aac|ogg|flac|vtt)$/i.test(asset.name) ? `${asset.name}.${extension}` : asset.name;
  downloadBlob(blob, name);
}
