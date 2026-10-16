import './styles.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Captions, Maximize, Minimize, Pause, PictureInPicture2, Play, Repeat2, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { formatTime, type Slice } from '../../../shared/contracts';
import type { MediaInfo, MediaSource, Thumbnail } from '../../media/media';
import type { Interstitial } from '../../../shared/interstitials';
import type { TimelineComposition } from '../../media/TimelineComposition';
import type { VideoPlayerController } from './VideoPlayerController';
import Timeline from '../timeline/Timeline';
import { remapSubtitles } from './subtitles';

type Props = {
  source: MediaSource; info: MediaInfo | null; thumbnails: Thumbnail[]; interstitials: Interstitial[];
  selectedId: string | null; composition: TimelineComposition | null;
  controller: VideoPlayerController;
  onAddInterstitial: () => void; onSeek: (time: number) => void; onError: (error: string) => void;
  onMoveInterstitial: (id: string, time: number) => void; onRemoveInterstitial: (id: string) => void; onSelectInterstitial: (id: string | null, time?: number) => void;
  selection: Slice | null;
  subtitle: { url: string; name: string } | null; onSubtitle: (file: File) => void;
  timelineHeight: number; maxTimelineHeight: number; onTimelineHeight: (value: number) => void;
};

export default function Player(props: Props) {
  const { source, info, thumbnails, interstitials, controller, onAddInterstitial, onSeek, onError, selection } = props;
  const { playing, buffering, volume, muted, speed, loop, buffered, time, duration } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const captionInput = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const subtitle = props.subtitle;
  const [captions, setCaptions] = useState(true);
  const originalCues = useRef<{ url: string; cues: VTTCue[] } | null>(null);
  useEffect(() => {
    const video = controller.video;
    const element = video?.querySelector('track');
    if (!element || !subtitle) return;
    const remap = () => {
      const track = element.track;
      if (originalCues.current?.url !== subtitle.url) {
        if (element.readyState !== HTMLTrackElement.LOADED) return;
        originalCues.current = { url: subtitle.url, cues: Array.from(track.cues || []) as VTTCue[] };
      }
      remapSubtitles(track, originalCues.current.cues, props.composition);
      track.mode = captions ? 'showing' : 'hidden';
    };
    remap();
    // Track load events do not bubble through React's delegated event handler.
    element.addEventListener('load', remap);
    // Loading a new MediaSource restores the track's original cues in the browser.
    video?.addEventListener('loadedmetadata', remap);
    video?.addEventListener('canplay', remap);
    return () => { element.removeEventListener('load', remap); video?.removeEventListener('loadedmetadata', remap); video?.removeEventListener('canplay', remap); };
  }, [controller, props.composition, subtitle, captions]);

  useEffect(() => { setCaptions(true); }, [subtitle]);
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
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || target.isContentEditable
        || target.closest('textarea, select, input:not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"])')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && props.selectedId) {
        event.preventDefault();
        if (!event.repeat) props.onRemoveInterstitial(props.selectedId);
        return;
      }
      const video = controller.video;
      if (!video || !duration) return;
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) playPause();
        return;
      }
      if (target.closest('input, button, a, summary, [role="separator"]')) return;
      const key = event.key.toLowerCase();
      if ([' ', 'k', 'j', 'l', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'm', 'f', 'p', ',', '.', 'home', 'end', 'c'].includes(key) || /^[0-9]$/.test(key)) event.preventDefault();
      switch (key) {
        case ' ': case 'k': playPause(); break;
        case 'j': onSeek(time - 10); break;
        case 'l': onSeek(time + 10); break;
        case 'arrowleft': onSeek(time - 5); break;
        case 'arrowright': onSeek(time + 5); break;
        case 'arrowup': changeVolume(video.volume + 0.05); break;
        case 'arrowdown': changeVolume(video.volume - 0.05); break;
        case 'm': toggleMute(); break;
        case 'f': void toggleFullscreen(); break;
        case 'p': onAddInterstitial(); break;
        case 'c': toggleCaptions(); break;
        case ',': controller.stepFrame(-1); break;
        case '.': controller.stepFrame(1); break;
        case 'home': onSeek(0); break;
        case 'end': onSeek(duration); break;
        default: if (/^[0-9]$/.test(key)) onSeek(duration * Number(key) / 10);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  return <div className="player-card" ref={container}>
    <div className="video-stage" onDoubleClick={() => void toggleFullscreen()}>
      <video ref={controller.attach} preload="metadata" playsInline aria-label={source.name} onClick={playPause}>
        {subtitle && <track key={subtitle.url} src={subtitle.url} kind="subtitles" label={subtitle.name} srcLang="en" default />}
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

    <Timeline key={source.url} name={source.name} info={info} thumbnails={thumbnails} interstitials={interstitials} selectedId={props.selectedId} composition={props.composition} time={time} duration={duration} buffered={buffered} selection={selection}
      height={props.timelineHeight} maxHeight={props.maxTimelineHeight} onHeight={props.onTimelineHeight} onAddInterstitial={onAddInterstitial} onSeek={onSeek}
      onMoveInterstitial={props.onMoveInterstitial} onRemoveInterstitial={props.onRemoveInterstitial} onSelectInterstitial={props.onSelectInterstitial} />
    <input ref={captionInput} className="sr-only" type="file" accept=".vtt,text/vtt" aria-label="Choose subtitle file" onChange={event => {
      const file = event.target.files?.[0];
      if (!file) return;
      props.onSubtitle(file);
      event.target.value = '';
    }} />
  </div>;
}
