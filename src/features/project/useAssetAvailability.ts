import { useEffect, useSyncExternalStore } from 'react';
import { assets } from './assets';

/** Unknown/loading files are not errors. Only a failed read marks an asset unavailable. */
export function useAssetAvailability(ids: (string | undefined)[]) {
  const revision = useSyncExternalStore(assets.subscribe, assets.getSnapshot);
  const key = JSON.stringify([...new Set(ids.filter((id): id is string => !!id))].sort());
  useEffect(() => { for (const id of JSON.parse(key) as string[]) assets.check(id); }, [key]);
  return revision;
}
