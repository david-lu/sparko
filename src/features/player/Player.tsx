import './styles.css';
import { useShortcuts } from '../../shared/shortcuts';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Captions, Maximize, Minimize, PanelBottomClose, PanelBottomOpen, Pause, PictureInPicture2, Play, Repeat2, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { formatTime, type Slice } from '../../../shared/contracts';
import type { MediaInfo, MediaSource, Thumbnail } from '../../media/media';
import type { Interstitial } from '../../../shared/interstitials';
import type { TimelineComposition } from '../../media/TimelineComposition';
import type { VideoPlayerController } from './VideoPlayerController';
import Timeline from '../timeline/Timeline';
import type { FlowTimeline } from '../timeline/FlowTracks';
import PlayerChoices from './PlayerChoices';

type Props = {
  source: MediaSource; info: MediaInfo | null; thumbnails: Thumbnail[]; interstitials: Interstitial[];
  thumbnailsFailed?: boolean;
  empty?: boolean;
  selectedId: string | null; composition: TimelineComposition | null;
  controller: VideoPlayerController;
  onAddInterstitial: () => void; onSeek: (time: number) => void; onError: (error: string) => void;
  onMoveInterstitial: (id: string, time: number) => void; onRemoveInterstitial: (id: string) => void; onSelectInterstitial: (id: string | null, time?: number) => void;
  selection: Slice | null;
  subtitle: { url: string; name: string } | null; onSubtitle: (file: File) => void;
  timelineHeight: number; maxTimelineHeight: number; onTimelineHeight: (value: number) => void;
  callResponse?: FlowTimeline;
  storyCanvas?: ReactNode;
};

export default function Player(props: Props) {
  const shortcuts=useShortcuts();
  const { source, info, thumbnails, interstitials, controller, onAddInterstitial, onSeek, onError, selection } = props;
  const { playing, buffering, volume, muted, speed, loop, buffered, time, duration } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const transport = useRef<HTMLDivElement>(null);
  const captionInput = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenControls, setFullscreenControls] = useState(true);
  const [fullscreenTimeline, setFullscreenTimeline] = useState(() => {
    try { return localStorage.getItem('sparko:fullscreen-timeline') !== 'false'; } catch { return true; }
  });
  const subtitle = props.subtitle;
  const [captions, setCaptions] = useState(true);
  const flow = props.callResponse;
  const originalCues = useRef<{ url: string; cues: VTTCue[] } | null>(null);
  useEffect(() => {
    const video = controller.subtitleVideo;
    const element = video?.querySelector('track');
    if (!element || !subtitle) { controller.setSubtitles(null, []); return; }
    const remap = () => {
      const track = element.track;
      if (originalCues.current?.url !== subtitle.url) {
        if (element.readyState !== HTMLTrackElement.LOADED) return;
        originalCues.current = { url: subtitle.url, cues: Array.from(track.cues || []) as VTTCue[] };
      }
      controller.setSubtitles(track, originalCues.current.cues, captions);
    };
    remap();
    // Track load events do not bubble through React's delegated event handler.
    element.addEventListener('load', remap);
    // Changing a native clip can reload the track's original cues in the browser.
    video?.addEventListener('loadedmetadata', remap);
    video?.addEventListener('canplay', remap);
    return () => { element.removeEventListener('load', remap); video?.removeEventListener('loadedmetadata', remap); video?.removeEventListener('canplay', remap); };
  }, [controller, props.composition, subtitle, captions]);

  useEffect(() => { setCaptions(true); }, [subtitle]);
  useEffect(() => {
    try { localStorage.setItem('sparko:fullscreen-timeline', String(fullscreenTimeline)); } catch { /* The toggle still works without persistence. */ }
  }, [fullscreenTimeline]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const player = container.current;
    const controls = transport.current;
    if (!fullscreen || !player || !controls) return;
    let timeout: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setFullscreenControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!controls.matches(':hover')) setFullscreenControls(false);
      }, 2500);
    };
    reveal();
    player.addEventListener('pointermove', reveal);
    player.addEventListener('pointerdown', reveal);
    player.addEventListener('keydown', reveal);
    player.addEventListener('focusin', reveal);
    controls.addEventListener('pointerleave', reveal);
    return () => {
      clearTimeout(timeout);
      player.removeEventListener('pointermove', reveal);
      player.removeEventListener('pointerdown', reveal);
      player.removeEventListener('keydown', reveal);
      player.removeEventListener('focusin', reveal);
      controls.removeEventListener('pointerleave', reveal);
    };
  }, [fullscreen]);

  const playPause = () => controller.togglePlayback();
  const changeVolume = (value: number) => controller.setVolume(value);
  const toggleMute = () => controller.toggleMute();
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.requestFullscreen(); }
    catch { onError('Fullscreen is not available in this browser.'); }
  };
  const togglePip = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await controller.requestPictureInPicture(); }
    catch { onError('Picture-in-picture is not available for this video.'); }
  };
  const toggleCaptions = () => {
    if (!subtitle) { captionInput.current?.click(); return; }
    setCaptions(!captions);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.isComposing || target.isContentEditable || target.closest('video[controls],dialog,[role="dialog"],[role="menu"]')
        || target.closest('textarea, select, input:not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"])')) return;
      const action=shortcuts.action(event);
      if (action==='delete' && props.selectedId) {
        event.preventDefault();
        if (!event.repeat) props.onRemoveInterstitial(props.selectedId);
        return;
      }
      const video = controller.video;
      if (!video || !duration) return;
      if (action==='play'&&!target.closest('button,a,summary,[role="button"]')) {
        event.preventDefault();
        if (!event.repeat) playPause();
        return;
      }
      if (target.closest('input, button, a, summary, [role="separator"]')) return;
      const actions:Partial<Record<NonNullable<typeof action>,()=>void>>={
        play:playPause,back10:()=>onSeek(time-10),forward10:()=>onSeek(time+10),back5:()=>onSeek(time-5),forward5:()=>onSeek(time+5),
        volumeUp:()=>changeVolume(volume+.05),volumeDown:()=>changeVolume(volume-.05),mute:toggleMute,fullscreen:()=>void toggleFullscreen(),
        add:()=>{if(!props.storyCanvas)onAddInterstitial();},captions:toggleCaptions,previousFrame:()=>controller.stepFrame(-1),nextFrame:()=>controller.stepFrame(1),start:()=>onSeek(0),end:()=>onSeek(duration),
      };
      if(action?.startsWith('jump')){event.preventDefault();onSeek(duration*Number(action.slice(4))/10);}
      else if(action&&actions[action]){event.preventDefault();if(!event.repeat||['back10','forward10','back5','forward5','volumeUp','volumeDown','previousFrame','nextFrame'].includes(action))actions[action]();}
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  return <div className={`player-card${fullscreenTimeline ? '' : ' fullscreen-timeline-hidden'}`} ref={container} data-controls-visible={fullscreenControls}>
    <div className="video-stage" onDoubleClick={() => void toggleFullscreen()}>
      <video key={source.assetId??source.id} ref={controller.attach} preload="metadata" playsInline aria-label={source.name} onClick={playPause}>
        {subtitle && <track key={subtitle.url} src={subtitle.url} kind="subtitles" label={subtitle.name} srcLang="en" default />}
      </video>
      {flow?.session && flow.flow.scenes.find(scene => scene.id === flow.session!.sceneId)?.draft && <span className="draft-preview-label">Draft · reference frame</span>}
      {props.empty?<span className="player-empty">Add clips to preview your video</span>:!playing && !buffering && <button className="center-play" aria-label="Play video" onClick={playPause} disabled={!duration}><Play size={28} fill="currentColor" /></button>}
      {buffering && <div className="buffering" role="status"><span className="spinner" /><span className="sr-only">Buffering</span></div>}
      {flow && <PlayerChoices key={flow.flow.interstitial.id} value={flow} />}
    <div className="transport" ref={transport} onDoubleClick={event => event.stopPropagation()}>
      <div className="transport-group">
        <button className="icon-button play-button" aria-label={playing ? 'Pause' : 'Play'} title={shortcuts.title('play')} disabled={!duration} onClick={playPause}>{playing ? <Pause /> : <Play fill="currentColor" />}</button>
        <button className="icon-button" aria-label="Back 10 seconds" title={shortcuts.title('back10')} disabled={!duration} onClick={() => onSeek(time - 10)}><RotateCcw size={18} /><span className="sr-only">10</span></button>
        <button className="icon-button" aria-label="Forward 10 seconds" title={shortcuts.title('forward10')} disabled={!duration} onClick={() => onSeek(time + 10)}><RotateCw size={18} /></button>
        <span className="time-display"><strong>{formatTime(time)}</strong><span>/</span>{props.callResponse ? 'variable' : formatTime(duration)}</span>
      </div>
      <div className="transport-group transport-options">
        <button className="icon-button" aria-label={muted || !volume ? 'Unmute' : 'Mute'} title={shortcuts.title('mute')} onClick={toggleMute}>{muted || !volume ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <input className="volume-slider" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={event => changeVolume(Number(event.target.value))} />
        <select className="speed-select" aria-label="Playback speed" value={speed} onChange={event => controller.setSpeed(Number(event.target.value))}>
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        <button className={`icon-button ${loop ? 'active' : ''}`} aria-label="Loop video" aria-pressed={loop} title={props.callResponse ? 'Idle clip types control repeating playback' : 'Loop video'} disabled={!!props.callResponse} onClick={() => controller.setLoop(!loop)}><Repeat2 size={18} /></button>
        <button className={`icon-button ${subtitle && captions ? 'active' : ''}`} aria-label={subtitle ? 'Toggle captions' : 'Load captions'} aria-pressed={!!subtitle && captions} title={shortcuts.title('captions',subtitle?'Toggle captions':'Load WebVTT subtitles')} onClick={toggleCaptions}><Captions size={19} /></button>
        {document.pictureInPictureEnabled && <button className="icon-button pip-button" aria-label="Picture in picture" title="Picture in picture" disabled={!duration} onClick={() => void togglePip()}><PictureInPicture2 size={18} /></button>}
        {fullscreen && <button className={`icon-button fullscreen-timeline-toggle ${fullscreenTimeline ? 'active' : ''}`} aria-label={fullscreenTimeline ? 'Hide timeline' : 'Show timeline'} aria-expanded={fullscreenTimeline} title={fullscreenTimeline ? 'Hide timeline' : 'Show timeline'} onClick={() => setFullscreenTimeline(visible => !visible)}
          onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>{fullscreenTimeline ? <PanelBottomClose size={19} /> : <PanelBottomOpen size={19} />}</button>}
        <button className="icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={shortcuts.title('fullscreen')} aria-keyshortcuts={shortcuts.aria('fullscreen')} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      </div>
    </div>
    </div>

    {props.storyCanvas ?? <Timeline key={source.url} name={source.name} info={info} thumbnails={thumbnails} thumbnailsFailed={props.thumbnailsFailed} interstitials={interstitials} selectedId={props.selectedId} composition={props.composition} time={time} duration={duration} buffered={buffered} selection={selection}
      callResponse={props.callResponse}
      height={props.timelineHeight} maxHeight={props.maxTimelineHeight} onHeight={props.onTimelineHeight} onSeek={onSeek}
      onMoveInterstitial={props.onMoveInterstitial} onRemoveInterstitial={props.onRemoveInterstitial} onSelectInterstitial={props.onSelectInterstitial} />}
    <input ref={captionInput} className="sr-only" type="file" accept=".vtt,text/vtt" aria-label="Choose subtitle file" onChange={event => {
      const file = event.target.files?.[0];
      if (!file) return;
      props.onSubtitle(file);
      event.target.value = '';
    }} />
  </div>;
}
