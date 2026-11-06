import MediaDimensions from './MediaDimensions';
import { useMediaMetadata } from './useMediaMetadata';

export default function ImageDimensions({ assetId }: { assetId?: string }) {
  const current = useMediaMetadata(assetId, 'image');
  return <MediaDimensions info={current?.info} error={current?.error} loading={!!assetId && !current}/>;
}
