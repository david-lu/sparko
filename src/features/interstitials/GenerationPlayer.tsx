import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import { previewFrames, previewOutput, type GenerationPreviewState, type GenerationPreviewAction, type InputPreview, type PreviewMode } from './generation-preview';

export type GenerationPlayback = { pause: () => void; toggle: () => void };
const modes: { value: PreviewMode; label: string; unavailable: string }[] = [
  { value: 'input', label: 'Input', unavailable: '' },
  { value: 'generated', label: 'Generated', unavailable: 'Generate a video to preview the result' },
  { value: 'upscaled', label: 'Upscaled', unavailable: 'Upscale the generated video to 2K to preview it here' },
];
/** All views share a playhead. Loading and missing inputs stay inside the player. */
export default function GenerationPlayer({ preview, input, onAction, onPlay, active, ref }: {
  preview: GenerationPreviewState; input?: InputPreview; onAction: (action: GenerationPreviewAction) => void; onPlay: () => void;
  active: boolean; ref?: Ref<GenerationPlayback>;
}) {
  const { frame: currentFrame, mode, playing } = preview, length = previewFrames(preview), output = previewOutput(preview), rendered = mode !== 'input';
  const [mediaState, setMediaState] = useState<{ url: string; loaded?: boolean; error?: string }>();
  const video = useRef<HTMLVideoElement>(null), playhead = useRef(currentFrame), dispatch = useRef(onAction);
  playhead.current = currentFrame; dispatch.current = onAction;
  useAssetAvailability([input?.assetId]);
  const url = rendered ? output?.url : input && assets.url(input.assetId);
  const loaded = mediaState?.url === url && mediaState?.loaded, error = mediaState?.url === url ? mediaState?.error : undefined;
  const image = mode === 'input' && input?.kind === 'image';
  useLayoutEffect(() => { setMediaState(undefined); }, [url, image]);
  const sourceTime = rendered ? currentFrame / TIMELINE_FPS : (input?.sourceFrame ?? 0) / TIMELINE_FPS;
  const loading = url ? !loaded && !error : mode === 'input' && !!input && !assets.error(input.assetId);
  const pause = () => { video.current?.pause(); dispatch.current({ type: 'pause' }); };
  const toggle = () => {
    if (!active) return;
    if (playing) { pause(); return; }
    onPlay(); onAction({ type: 'toggle' });
  };
  useImperativeHandle(ref, () => ({ pause, toggle }));
  useEffect(() => { if (!active) pause(); }, [active]);
  useEffect(() => { const media = video.current; return () => media?.pause(); }, [url, image]);
  useEffect(() => {
    const otherPlayback = (event: Event) => { if (event.target instanceof HTMLMediaElement && event.target !== video.current) pause(); };
    document.addEventListener('play', otherPlayback, true);
    return () => document.removeEventListener('play', otherPlayback, true);
  }, []);
  useEffect(() => {
    const media = video.current;
    if (rendered && url && media && media.readyState >= 1 && Number.isFinite(media.duration))
      onAction({ type: 'metadata', url, frames: Math.max(1, Math.round(media.duration * TIMELINE_FPS)) });
  }, [mode, url, loaded]);
  useEffect(() => {
    const media = video.current;
    if (!media || media.readyState < 1) return;
    const time = Math.min(sourceTime, Math.max(0, media.duration - 1 / TIMELINE_FPS));
    if (Math.abs(media.currentTime - time) > (playing ? .12 : 1 / TIMELINE_FPS / 2)) media.currentTime = time;
    if (playing && !(mode === 'input' && input?.held)) {
      if (media.paused) void media.play().catch(reason => {
        // Seeking to frame zero or switching input files can interrupt an older
        // play request. That cancellation must not stop the timeline transport.
        if (reason?.name !== 'AbortError' && video.current === media && url) { setMediaState({ url, error: 'Unable to play audio/video' }); pause(); }
      });
    } else media.pause();
  }, [sourceTime, playing, loaded, input?.held, mode, url]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    if (loading) return;
    const start = performance.now(), first = playhead.current; let request = 0;
    const tick = (now: number) => {
      const next = first + Math.floor((now - start) / 1000 * TIMELINE_FPS);
      dispatch.current({ type: 'tick', frame: next });
      if (next < length - 1) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick); return () => cancelAnimationFrame(request);
  }, [playing, length, url, loading]);
  const seek = (frame: number) => { video.current?.pause(); onAction({ type: 'seek', frame }); };
  const gap = mode === 'input' && !input;
  return <section className="generation-player" aria-label="Generation preview">
    <div className="generation-player-modes" role="group" aria-label="Preview mode">
      {modes.map(({ value, label, unavailable }) => {
        const missing = value !== 'input' && !preview[value];
        return <button key={value} type="button" aria-pressed={mode === value} disabled={missing} title={missing ? unavailable : undefined}
          onClick={() => { pause(); onAction({ type: 'mode', mode: value }); }}>{label}</button>;
      })}
    </div>
    <div className="generation-player-screen" data-empty={gap}>
      {url && (image ? <img key={url} src={url} alt={input?.label ?? 'Image keyframe'} onLoad={() => setMediaState({ url, loaded: true })} onError={() => { setMediaState({ url, error: 'Image unavailable' }); pause(); }}/>
        : <video key={url} ref={video} src={url} playsInline preload="auto" onLoadedMetadata={event => {
          const media = event.currentTarget;
          if (rendered && Number.isFinite(media.duration)) onAction({ type: 'metadata', url, frames: Math.max(1, Math.round(media.duration * TIMELINE_FPS)) });
          media.currentTime = Math.min(sourceTime, Math.max(0, media.duration - 1 / TIMELINE_FPS)); setMediaState({ url, loaded: true });
        }} onError={() => { setMediaState({ url, error: 'Video unavailable' }); pause(); }}/>) }
      <span className="generation-player-status" role="status">{gap ? '' : error || (mode === 'input' && input && assets.error(input.assetId)) || (url ? loaded ? '' : 'Loading…' : input ? 'Loading…' : '')}</span>
    </div>
    <div className="generation-player-transport">
      <button type="button" className="icon-button" aria-label="Previous frame" disabled={currentFrame === 0} onClick={() => seek(currentFrame - 1)}><SkipBack size={15}/></button>
      <button type="button" className="icon-button" aria-label={playing ? 'Pause timeline' : 'Play timeline'} disabled={!active} onClick={toggle}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>
      <button type="button" className="icon-button" aria-label="Next frame" disabled={currentFrame >= length - 1} onClick={() => seek(currentFrame + 1)}><SkipForward size={15}/></button>
      <input type="range" aria-label="Generation timeline playhead" min={0} max={length - 1} step={1} value={currentFrame} onChange={event => seek(event.currentTarget.valueAsNumber)}/>
      <time title={mode === 'upscaled' ? '2K video duration' : mode === 'generated' ? 'Saved video duration' : 'Input timeline duration'}>{(currentFrame / TIMELINE_FPS).toFixed(2)} / {(length / TIMELINE_FPS).toFixed(2)}s</time>
    </div>
  </section>;
}
