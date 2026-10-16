import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Captions, Maximize, Minimize, Pause, PictureInPicture2, Play, Repeat2, RotateCcw, RotateCw, Volume2, VolumeX, Pin as PinIcon, SkipBack, SkipForward } from 'lucide-react';
import { formatTime, type Slice } from '../../shared/contracts';
import type { MediaInfo, MediaSource, Thumbnail } from '../lib/media';
import type { Pin } from '../lib/pins';
import type { VideoPlayerController } from '../lib/VideoPlayerController';
import ResizeHandle from './ResizeHandle';

type Props = {
  source: MediaSource; info: MediaInfo | null; thumbnails: Thumbnail[]; pins: Pin[];
  controller: VideoPlayerController;
  onPin: () => void; onSeek: (time: number) => void; onError: (error: string) => void;
  selection: Slice | null;
  timelineHeight: number; maxTimelineHeight: number; onTimelineHeight: (value: number) => void;
};

export default function Player(props: Props) {
  const { source, info, thumbnails, pins, controller, onPin, onSeek, onError, selection } = props;
  const { playing, buffering, volume, muted, speed, loop, buffered, time, duration } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const captionInput = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [subtitle, setSubtitle] = useState<{ url: string; name: string } | null>(null);
  const [captions, setCaptions] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    setSubtitle(null);
  }, [source.id]);
  useEffect(() => () => { if (subtitle) URL.revokeObjectURL(subtitle.url); }, [subtitle]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const playPause = () => controller.togglePlayback();
  const changeVolume = (value: number) => controller.setVolume(value);
  const toggleMute = () => controller.toggleMute();
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.requestFullscreen(); }
    catch { onError('Fullscreen is not available in this browser.'); }
  };
  const togglePip = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await controller.video?.requestPictureInPicture(); }
    catch { onError('Picture-in-picture is not available for this video.'); }
  };
  const toggleCaptions = () => {
    if (!subtitle) { captionInput.current?.click(); return; }
    const track = controller.video?.textTracks[0];
    if (track) track.mode = captions ? 'hidden' : 'showing';
    setCaptions(!captions);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
      const video = controller.video;
      if (!video || !duration) return;
      const key = event.key.toLowerCase();
      if ([' ', 'k', 'j', 'l', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'm', 'f', 'p', ',', '.', 'home', 'end', 'c'].includes(key) || /^[0-9]$/.test(key)) event.preventDefault();
      switch (key) {
        case ' ': case 'k': playPause(); break;
        case 'j': onSeek(video.currentTime - 10); break;
        case 'l': onSeek(video.currentTime + 10); break;
        case 'arrowleft': onSeek(video.currentTime - 5); break;
        case 'arrowright': onSeek(video.currentTime + 5); break;
        case 'arrowup': changeVolume(video.volume + 0.05); break;
        case 'arrowdown': changeVolume(video.volume - 0.05); break;
        case 'm': toggleMute(); break;
        case 'f': void toggleFullscreen(); break;
        case 'p': onPin(); break;
        case 'c': toggleCaptions(); break;
        case ',': controller.stepFrame(-1, info?.fps || 30); break;
        case '.': controller.stepFrame(1, info?.fps || 30); break;
        case 'home': onSeek(0); break;
        case 'end': onSeek(duration); break;
        default: if (/^[0-9]$/.test(key)) onSeek(duration * Number(key) / 10);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const progress = duration ? Math.min(100, time / duration * 100) : 0;
  const hoveredFrame = hover === null ? null : thumbnails.reduce<Thumbnail | null>((nearest, frame) => !nearest || Math.abs(frame.time - hover) < Math.abs(nearest.time - hover) ? frame : nearest, null);

  return <div className="player-card" ref={container}>
    <div className="video-stage" onDoubleClick={() => void toggleFullscreen()}>
      <video ref={controller.attach} preload="metadata" playsInline aria-label={source.name} onClick={playPause}>
        {subtitle && <track key={subtitle.url} src={subtitle.url} kind="subtitles" label={subtitle.name} srcLang="en" default onLoad={event => { event.currentTarget.track.mode = captions ? 'showing' : 'hidden'; }} />}
      </video>
      {!playing && !buffering && <button className="center-play" aria-label="Play video" onClick={playPause} disabled={!duration}><Play size={28} fill="currentColor" /></button>}
      {buffering && <div className="buffering" role="status"><span className="spinner" /> Buffering</div>}
    <div className="transport" onDoubleClick={event => event.stopPropagation()}>
      <div className="transport-group">
        <button className="icon-button play-button" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" disabled={!duration} onClick={playPause}>{playing ? <Pause /> : <Play fill="currentColor" />}</button>
        <button className="icon-button" aria-label="Back 10 seconds" title="Back 10 seconds (J)" disabled={!duration} onClick={() => onSeek(time - 10)}><RotateCcw size={18} /><span className="sr-only">10</span></button>
        <button className="icon-button" aria-label="Forward 10 seconds" title="Forward 10 seconds (L)" disabled={!duration} onClick={() => onSeek(time + 10)}><RotateCw size={18} /></button>
        <span className="time-display"><strong>{formatTime(time)}</strong><span>/</span>{formatTime(duration)}</span>
      </div>
      <div className="transport-group transport-options">
        <button className="icon-button" aria-label={muted || !volume ? 'Unmute' : 'Mute'} title="Mute (M)" onClick={toggleMute}>{muted || !volume ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <input className="volume-slider" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={event => changeVolume(Number(event.target.value))} />
        <select className="speed-select" aria-label="Playback speed" value={speed} onChange={event => controller.setSpeed(Number(event.target.value))}>
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        <button className={`icon-button ${loop ? 'active' : ''}`} aria-label="Loop video" aria-pressed={loop} title="Loop video" onClick={() => controller.setLoop(!loop)}><Repeat2 size={18} /></button>
        <button className={`icon-button ${subtitle && captions ? 'active' : ''}`} aria-label={subtitle ? 'Toggle captions' : 'Load captions'} aria-pressed={!!subtitle && captions} title={subtitle ? 'Toggle subtitles (C)' : 'Load WebVTT subtitles'} onClick={toggleCaptions}><Captions size={19} /></button>
        {document.pictureInPictureEnabled && <button className="icon-button pip-button" aria-label="Picture in picture" title="Picture in picture" disabled={!duration} onClick={() => void togglePip()}><PictureInPicture2 size={18} /></button>}
        <button className="icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      </div>
    </div>
    </div>

    <div className="timeline-section" style={{ height: props.timelineHeight }}>
      <ResizeHandle orientation="horizontal" label="Resize timeline" value={props.timelineHeight} min={118} max={props.maxTimelineHeight} onChange={props.onTimelineHeight} />
      <div className="timeline-heading"><span className="eyebrow">TIMELINE <span className="subtle">/ 1 VIDEO</span></span>
        <div className="timeline-actions">
          <button className="icon-button small" aria-label="Previous pin" disabled={!pins.some(pin => pin.time < time - 0.05)} onClick={() => onSeek([...pins].reverse().find(pin => pin.time < time - 0.05)?.time || 0)}><SkipBack size={14} /></button>
          <button className="icon-button small" aria-label="Next pin" disabled={!pins.some(pin => pin.time > time + 0.05)} onClick={() => onSeek(pins.find(pin => pin.time > time + 0.05)?.time || 0)}><SkipForward size={14} /></button>
          <button className="button small" disabled={!duration} onClick={onPin}><PinIcon size={13} /> Add pin <kbd>P</kbd></button>
        </div>
      </div>
      <div className="timeline-ruler" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>{formatTime(duration * i / 5)}</span>)}</div>
      <div className="timeline-track" onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration); }} onPointerLeave={() => setHover(null)}>
        <div className="filmstrip" aria-hidden="true">{thumbnails.length ? thumbnails.map(frame => <img key={frame.time} src={frame.url} alt="" draggable={false} />) : <div className="filmstrip-placeholder">{duration ? source.name : 'Loading video…'}</div>}</div>
        <div className="timeline-shade" style={{ width: `${progress}%` }} />
        {selection && duration > 0 && selection.end > selection.start && <div className="selection-overlay" style={{ left: `${selection.start / duration * 100}%`, width: `${(selection.end - selection.start) / duration * 100}%` }} />}
        <div className="buffer-track" aria-hidden="true">{buffered.map((range, i) => <span key={i} style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` }} />)}</div>
        <input className="timeline-input" type="range" aria-label="Video timeline" aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`} min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 1)} disabled={!duration} onChange={event => onSeek(Number(event.target.value))} />
        <div className="playhead" style={{ left: `${progress}%` }} aria-hidden="true"><span /></div>
        {duration > 0 && pins.filter(pin => pin.time <= duration).map((pin, index) => <button key={pin.id} className="timeline-pin" style={{ left: `${Math.max(0.8, Math.min(99.2, pin.time / duration * 100))}%` }} aria-label={`Go to ${pin.label} at ${formatTime(pin.time)}`} title={`${pin.label} · ${formatTime(pin.time, true)}`} onClick={() => onSeek(pin.time)}>{index + 1}</button>)}
        {hover !== null && hoveredFrame && <div className="hover-preview" style={{ left: `${Math.max(9, Math.min(91, hover / duration * 100))}%` }}><img src={hoveredFrame.url} alt="Timeline preview" /><span>{formatTime(hover)}</span></div>}
      </div>
      <div className="timeline-footer"><span className="source-name">{source.name}</span><span>{info ? `${info.width} × ${info.height} · ${info.fps.toFixed(2)} fps · ${info.codec.toUpperCase()}` : 'Reading media…'}</span></div>
    </div>
    <input ref={captionInput} className="sr-only" type="file" accept=".vtt,text/vtt" aria-label="Choose subtitle file" onChange={event => {
      const file = event.target.files?.[0];
      if (!file) return;
      void file.text().then(text => {
        if (!text.replace(/^\uFEFF/, '').startsWith('WEBVTT')) { onError('Use a valid WebVTT (.vtt) subtitle file.'); return; }
        setSubtitle({ url: URL.createObjectURL(new Blob([text], { type: 'text/vtt' })), name: file.name }); setCaptions(true);
      }).catch(() => onError('The subtitle file could not be read.'));
      event.target.value = '';
    }} />
  </div>;
}
