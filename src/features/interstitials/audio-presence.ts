import { useEffect, useState } from 'react';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { assets } from '../project/assets';

const known = new Map<string, boolean>(), pending = new Map<string, Promise<boolean | undefined>>();

/** Whether an asset has an audio track. Undefined until checked, or when the asset cannot be read. */
export const audioPresence = (assetId: string) => known.get(assetId);

export function loadAudioPresence(assetId: string): Promise<boolean | undefined> {
  if (known.has(assetId)) return Promise.resolve(known.get(assetId));
  let request = pending.get(assetId);
  if (!request) {
    request = (async () => {
      const { asset } = await assets.open(assetId);
      if (asset.blob.type.startsWith('image/')) return false;
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(asset.blob) });
      try { return !!await input.getPrimaryAudioTrack(); } finally { input.dispose(); }
    })().then(value => { known.set(assetId, value); return value; }, () => undefined)
      .finally(() => pending.delete(assetId));
    pending.set(assetId, request);
  }
  return request;
}

/** Checks the given assets and re-renders as each answer arrives. */
export function useAudioPresence(assetIds: (string | undefined)[]) {
  const key = [...new Set(assetIds.filter((id): id is string => !!id))].sort().join('\n');
  const [, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split('\n') : []) {
      if (!known.has(id)) void loadAudioPresence(id).then(() => { if (live) setVersion(version => version + 1); });
    }
    return () => { live = false; };
  }, [key]);
  return audioPresence;
}
