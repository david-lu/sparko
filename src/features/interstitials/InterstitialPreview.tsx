import { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';

export default function InterstitialPreview({ url, label, downloadName, active, onPlay }: {
  url: string; label: string; downloadName: string; active: boolean; onPlay: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
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
    <video key={url} ref={player} src={url} controls playsInline preload="metadata" aria-label={`Generated video for ${label}`} onPlay={onPlay} />
  </div>;
}
