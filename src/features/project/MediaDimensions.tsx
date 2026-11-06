import type { MediaMetadata } from './useMediaMetadata';

export default function MediaDimensions({ info, error, loading }: { info?: MediaMetadata; error?: string; loading?: boolean }) {
  return <div className="inspector-property media-dimensions" aria-busy={loading}>
    <span>Dimensions</span><output aria-label="Media dimensions" title={error ?? 'Width × height in pixels'}>{info ? `${info.width} × ${info.height}` : error ? 'Unavailable' : '—'}</output>
  </div>;
}
