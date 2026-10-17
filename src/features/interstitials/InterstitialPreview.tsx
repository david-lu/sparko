import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import ClipLoading from '../../shared/ClipLoading';

export default function InterstitialPreview({ url, label, downloadName, active, onPlay }: {
  url: string; label: string; downloadName: string; active: boolean; onPlay: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<{ url: string; phase: 'loading' | 'ready' | 'error' }>({ url, phase: 'loading' });
  const phase = media.url === url ? media.phase : 'loading';
  const ready = () => setMedia({ url, phase: 'ready' });
  const loading = () => setMedia({ url, phase: 'loading' });
  useEffect(() => {
    const video = player.current;
    const pauseForOtherMedia = (event: Event) => {
      if (event.target instanceof HTMLMediaElement && event.target !== video) video?.pause();
    };
    document.addEventListener('play', pauseForOtherMedia, true);
    return () => { document.removeEventListener('play', pauseForOtherMedia, true); video?.pause(); };
  }, [url]);
  useEffect(() => { if (!active) player.current?.pause(); }, [active]);

  return <div className="interstitial-preview">
    <div className="interstitial-preview-heading"><span>Generated video</span>
      <a className="text-button" href={url} download={downloadName} aria-label="Download full video" title="Download full video"><Download size={13} /> Download</a>
    </div>
    <div className="clip-preview-stage" aria-busy={phase === 'loading'}>
      <video key={url} ref={player} src={url} controls playsInline preload="auto" aria-label={`Generated video for ${label}`} onPlay={onPlay}
        onLoadStart={loading} onWaiting={loading} onLoadedData={ready} onCanPlay={ready} onPlaying={ready}
        onSeeking={event => { if (event.currentTarget.readyState < 2) loading(); }}
        onSeeked={event => { if (event.currentTarget.readyState >= 2) ready(); }}
        onError={() => setMedia({ url, phase: 'error' })} />
      {phase !== 'ready' && <ClipLoading failed={phase === 'error'} message={phase === 'error' ? 'Unable to load preview' : 'Loading preview…'} />}
    </div>
  </div>;
}
