import { useEffect, useState } from 'react';
import { sampleFrame, type Thumbnail } from '../../media/media';

export default function InterstitialThumbnail({ url, time }: { url: string; time: number }) {
  const [thumbnail, setThumbnail] = useState<{ source: string; frame: Thumbnail } | null>(null);
  useEffect(() => {
    const operation = new AbortController();
    void sampleFrame({ id: url, name: 'Interstitial', url }, time, 240, operation.signal)
      .then(frame => { if (!operation.signal.aborted) setThumbnail({ source: url, frame }); })
      // A missing thumbnail leaves the clip's colored placeholder and controls usable.
      .catch(() => undefined);
    return () => operation.abort();
  }, [url, time]);

  if (thumbnail?.source !== url || thumbnail.frame.time !== time) return null;
  return <span className="interstitial-thumbnail" aria-hidden="true" style={{ backgroundImage: `url("${thumbnail.frame.url}")` }} />;
}
