import { z } from 'zod';
import type { LibraryAsset } from './types';

/**
 * Projects once had project-wide audio layers. Sound now belongs to individual
 * clips, so older files are read only to keep each layer's audio in Library.
 */
export const legacyAudioLayersSchema = z.array(z.object({ assetId: z.uuid(), name: z.string().min(1).max(1000) })).max(1000);
type LegacyAudioLayer = z.infer<typeof legacyAudioLayersSchema>[number];

/** Drop old layer placements; their files stay in Library as ordinary audio assets. */
export function withoutAudioLayers<T extends { library?: LibraryAsset[]; deletedAssetIds?: string[] }>(project: T & { audioLayers?: LegacyAudioLayer[] }): T {
  if (!('audioLayers' in project)) return project;
  const { audioLayers, ...rest } = project, library: LibraryAsset[] = [...project.library ?? []];
  for (const layer of audioLayers ?? []) {
    if (!library.some(asset => asset.assetId === layer.assetId) && !rest.deletedAssetIds?.includes(layer.assetId))
      library.push({ assetId: layer.assetId, name: layer.name, kind: 'audio' });
  }
  return { ...rest, library } as unknown as T;
}
