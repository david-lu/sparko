import { audioVolume } from '../../media/audioVolume';
import type { LibraryAsset } from './types';

/** Legacy migration only: resolve the audio setting inherited by prepared copies. */
export function volumeAssetId(library: LibraryAsset[] | undefined, id: string) {
  const seen = new Set<string>();
  let asset = library?.find(asset => asset.assetId === id);
  while (asset?.originalAssetId && !seen.has(asset.assetId)) {
    seen.add(asset.assetId);
    const originalId = asset.originalAssetId, original = library?.find(item => item.assetId === originalId);
    if (!original || seen.has(original.assetId)) break;
    asset = original;
  }
  return asset?.assetId ?? id;
}

export function assetVolume(library: LibraryAsset[] | undefined, id: string | undefined) {
  if (!id) return 1;
  const owner = volumeAssetId(library, id);
  return audioVolume(library?.find(asset => asset.assetId === owner)?.volume ?? library?.find(asset => asset.assetId === id)?.volume);
}
