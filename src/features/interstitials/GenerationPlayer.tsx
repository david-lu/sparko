import { useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';

export type InputPreview = { assetId: string; kind?: 'image' | 'audio'; sourceFrame: number; label: string; held?: boolean };
/** Both views share a playhead. Loading and missing inputs stay inside the player. */
export default function GenerationPlayer({ frame, frames, input, generatedUrl, generatedFrames, onFrame, onPlay }: {
  frame: number; frames: number; input?: InputPreview; generatedUrl?: string; generatedFrames?: number; onFrame: (frame: number) => void; onPlay: () => void;
}) {
  const [mode, setMode] = useState<'input' | 'generated'>('input'), [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(''), [error, setError] = useState('');
  const [savedLength, setSavedLength] = useState<{ url: string; frames: number }>();
  const resultFrames = savedLength && savedLength.url === generatedUrl ? savedLength.frames : generatedFrames ?? frames;
  const length = mode === 'generated' ? resultFrames : frames;
  const currentFrame = Math.max(0, Math.min(length - 1, frame));
  const video = useRef<HTMLVideoElement>(null), playhead = useRef(frame), emitted = useRef(frame), advance = useRef(onFrame);
  playhead.current = currentFrame; advance.current = onFrame;
  useAssetAvailability([input?.assetId]);
  const url = mode === 'generated' ? generatedUrl : input && assets.url(input.assetId);
  const image = mode === 'input' && input?.kind === 'image';
  const sourceTime = mode === 'generated' ? currentFrame / TIMELINE_FPS : (input?.sourceFrame ?? 0) / TIMELINE_FPS;
  useEffect(() => { setError(''); setLoaded(''); }, [url]);
  useEffect(() => {
    const media = video.current;
    if (!media || media.readyState < 1) return;
    const time = Math.min(sourceTime, Math.max(0, media.duration - 1 / TIMELINE_FPS));
    if (!playing || Math.abs(media.currentTime - time) > .12) media.currentTime = time;
    if (playing && !(mode === 'input' && input?.held)) void media.play().catch(() => setPlaying(false)); else media.pause();
  }, [sourceTime, playing, loaded, input?.held, mode]);
  useEffect(() => { if (playing && frame !== emitted.current) setPlaying(false); }, [frame]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    const start = performance.now(), first = playhead.current; let request = 0;
    const tick = (now: number) => {
      const next = first + Math.floor((now - start) / 1000 * TIMELINE_FPS);
      emitted.current = Math.min(length - 1, next); advance.current(emitted.current);
      if (next >= length - 1) setPlaying(false); else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick); return () => cancelAnimationFrame(request);
  }, [playing, length]);
  const seek = (next: number) => { setPlaying(false); onFrame(Math.max(0, Math.min(length - 1, next))); };
  return <section className="generation-player" aria-label="Generation preview">
    <div className="generation-player-modes" role="group" aria-label="Preview mode">
      {(['input', 'generated'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={value === 'generated' && !generatedUrl}
        title={value === 'generated' && !generatedUrl ? 'Generate a video to preview the result' : undefined}
        onClick={() => { setPlaying(false); setMode(value); onFrame(Math.min(frame, (value === 'input' ? frames : resultFrames) - 1)); }}>{value === 'input' ? 'Input' : 'Generated'}</button>)}
    </div>
    <div className="generation-player-screen">
      {url && (image ? <img src={url} alt={input?.label ?? 'Image keyframe'} onLoad={() => setLoaded(url)} onError={() => setError('Image unavailable')}/>
        : <video ref={video} src={url} playsInline preload="auto" onLoadedMetadata={event => {
          const media = event.currentTarget;
          if (mode === 'generated' && Number.isFinite(media.duration)) setSavedLength({ url, frames: Math.max(1, Math.round(media.duration * TIMELINE_FPS)) });
          media.currentTime = Math.min(sourceTime, Math.max(0, media.duration - 1 / TIMELINE_FPS)); setLoaded(url);
        }} onError={() => setError('Video unavailable')}/>)}
      <span className="generation-player-status" role="status">{error || (mode === 'input' && input && assets.error(input.assetId)) || (url ? loaded === url ? '' : 'Loading…' : input ? 'Loading…' : 'No input at this frame')}</span>
    </div>
    <div className="generation-player-transport">
      <button type="button" className="icon-button" aria-label="Previous frame" disabled={currentFrame === 0} onClick={() => seek(currentFrame - 1)}><SkipBack size={15}/></button>
      <button type="button" className="icon-button" aria-label={playing ? 'Pause timeline' : 'Play timeline'} onClick={() => {
        if (!playing) { onPlay(); const next = currentFrame >= length - 1 ? 0 : currentFrame; playhead.current = emitted.current = next; onFrame(next); }
        setPlaying(!playing);
      }}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>
      <button type="button" className="icon-button" aria-label="Next frame" disabled={currentFrame >= length - 1} onClick={() => seek(currentFrame + 1)}><SkipForward size={15}/></button>
      <input type="range" aria-label="Generation timeline playhead" min={0} max={length - 1} step={1} value={currentFrame} onChange={event => seek(event.currentTarget.valueAsNumber)}/>
      <time title={mode === 'generated' ? 'Saved video duration' : 'Input timeline duration'}>{(currentFrame / TIMELINE_FPS).toFixed(2)} / {(length / TIMELINE_FPS).toFixed(2)}s</time>
    </div>
  </section>;
}
