import { useEffect, useState } from 'react';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { assets } from './assets';

export type MediaMetadata = { width: number; height: number; fps?: number };
export function useMediaMetadata(assetId: string | undefined, kind: 'video' | 'image') {
  const [value, setValue] = useState<{ assetId: string; info?: MediaMetadata; error?: string }>();
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false, input: Input | undefined;
    void (async () => {
      const { asset } = await assets.open(assetId);
      if (cancelled) return;
      let info: MediaMetadata;
      if (kind === 'image') {
        const image = await createImageBitmap(asset.blob);
        info = { width: image.width, height: image.height }; image.close();
      } else {
        input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track) throw new Error('This file has no video track.');
          const fps = (await track.computePacketStats(120)).averagePacketRate;
          info = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), fps: fps && Number.isFinite(fps) ? fps : undefined };
        } finally { input.dispose(); }
      }
      if (!cancelled) setValue({ assetId, info });
    })().catch(error => { if (!cancelled) setValue({ assetId, error: error instanceof Error ? error.message : 'Unable to read media details.' }); });
    return () => { cancelled = true; input?.dispose(); };
  }, [assetId, kind]);
  return value?.assetId === assetId ? value : undefined;
}
