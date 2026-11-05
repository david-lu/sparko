import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import ClipLoading from '../../shared/ClipLoading';
import ContentIssues from '../../shared/ContentIssues';
import AssetDownload from '../project/AssetDownload';
import type { LibraryAsset } from '../project/types';

export default function InterstitialPreview({ url, label, downloadName, downloadAsset, heading = 'Generated video', active, onPlay }: {
  url: string; label: string; downloadName: string; downloadAsset?: LibraryAsset; heading?: string; active: boolean; onPlay: () => void;
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
    <div className="interstitial-preview-heading"><span>{heading}</span>
      <ContentIssues label="Video preview errors" issues={phase === 'error' ? [{ key: 'preview', title: 'Video preview unavailable', message: 'The saved video could not be loaded or decoded. Restore the media from a project backup, select another version, or regenerate the clip in the Inspector.' }] : []}/>
      {downloadAsset && downloadAsset.volume !== undefined && downloadAsset.volume !== 1
        ? <AssetDownload asset={{ ...downloadAsset, name: downloadName }} label={heading === 'Loop video' ? 'Download loop video' : 'Download full video'}/>
        : <a className="text-button" href={url} download={downloadName} aria-label={heading === 'Loop video' ? 'Download loop video' : 'Download full video'} title={heading === 'Loop video' ? 'Download loop video' : 'Download full video'}><Download size={13} /> Download</a>}
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
