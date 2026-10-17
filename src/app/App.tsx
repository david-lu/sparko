import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Clapperboard, Download, FolderOpen, Mic, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import Player from '../features/player/Player';
import AiPanel from '../features/video-analysis/AiPanel';
import VoicePanel from '../features/voice-input/VoicePanel';
import InterstitialPanel from '../features/interstitials/InterstitialPanel';
import { InterstitialController } from '../features/interstitials/InterstitialController';
import { ProjectController } from '../features/project/ProjectController';
import { TimelineComposition } from '../media/TimelineComposition';
import ResizeHandle from '../shared/ResizeHandle';
import { MediaEngine } from '../media/MediaEngine';
import { VideoPlayerController } from '../features/player/VideoPlayerController';
import type { MediaInfo, MediaSource, Thumbnail } from '../media/media';
import { getStatus, request } from '../shared/api';
import type { AppStatus, Slice } from '../../shared/contracts';
import { emptyAnalysis } from '../features/project/types';
import { playableResult } from '../../shared/interstitials';

// Fast Refresh preserves useState, including instances with obsolete controller methods.
// Reload saved project state when a controller changes during local development.
if (import.meta.hot) {
  import.meta.hot.accept([
    '../features/interstitials/InterstitialController',
    '../features/project/ProjectController',
    '../features/player/VideoPlayerController',
  ], () => window.location.reload());
}

const defaultSource: MediaSource = { id: 'default:episode_mock.mp4', name: 'episode_mock.mp4', url: '/media/episode_mock.mp4' };
type Tab = 'interstitials' | 'ai' | 'voice';
function savedSize(key: string, fallback: number) {
  try { const value = Number(localStorage.getItem(key)); return value > 0 && Number.isFinite(value) ? value : fallback; } catch { return fallback; }
}
export default function App() {
  const [controller] = useState(() => new VideoPlayerController());
  const player = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [engine, setEngine] = useState<MediaEngine | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [interstitials] = useState(() => new InterstitialController());
  const interstitialState = useSyncExternalStore(interstitials.subscribe, interstitials.getSnapshot);
  const [projects] = useState(() => new ProjectController(interstitials));
  const projectState = useSyncExternalStore(projects.subscribe, projects.getSnapshot);
  const source = projectState.source || defaultSource;
  const analysis = projectState.project?.analysis || emptyAnalysis();
  const slice = analysis.slice;
  const setSlice = (slice: Slice) => projects.updateAnalysis({ ...analysis, slice });
  const [tab, setTab] = useState<Tab>('interstitials');
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState('');
  const [shortcuts, setShortcuts] = useState(false);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [sideWidth, setSideWidth] = useState(() => savedSize('sparko:side-width', 294));
  const [timelineHeight, setTimelineHeight] = useState(() => savedSize('sparko:timeline-height', 134));
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const maxSideWidth = Math.max(220, Math.min(700, viewport.width - 340));
  const maxTimelineHeight = Math.max(134, Math.floor(viewport.height * (viewport.width <= 660 ? 0.28 : 0.55)));
  const actualSideWidth = Math.max(220, Math.min(maxSideWidth, sideWidth));
  const actualTimelineHeight = Math.max(134, Math.min(maxTimelineHeight, timelineHeight));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('sparko:side-width', String(sideWidth)); localStorage.setItem('sparko:timeline-height', String(timelineHeight)); } catch { /* The layout still works without persistence. */ }
  }, [sideWidth, timelineHeight]);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const defaultUrl = useRef(defaultSource.url);
  const sourceVersion = useRef(0);
  const readyKey = JSON.stringify(interstitialState.items.filter(item => playableResult(item)).map(item => ({ id: item.id, label: item.label, time: item.time, result: playableResult(item) })));
  const composition = useMemo(() => info ? new TimelineComposition(source, info, interstitialState.items) : null, [source, info, readyKey]);
  useEffect(() => { if (composition) controller.setComposition(composition); }, [composition, controller]);
  useEffect(() => () => { interstitials.dispose(); projects.dispose(); }, [interstitials, projects]);
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); fileInput.current?.click(); }
    };
    window.addEventListener('keydown', open);
    return () => window.removeEventListener('keydown', open);
  }, []);

  useEffect(() => { let active = true; void getStatus().then(data => {
    if (!active) return;
    setStatus(data); defaultUrl.current = data.defaultVideo.url;
    if (data.requiresPassword && !data.defaultProject && !sessionStorage.getItem('sparko:password')) setLogin(true);
    return projects.init({ ...defaultSource, url: data.defaultVideo.url }, data.defaultProject?.url);
  }).catch(err => { if (active) { setError(err.message); void projects.init(defaultSource); } });
    return () => { active = false; };
  }, [projects]);
  useEffect(() => {
    const show = () => setLogin(true);
    window.addEventListener('sparko:auth-required', show);
    return () => window.removeEventListener('sparko:auth-required', show);
  }, []);
  useEffect(() => {
    if (!projectState.source) return;
    const version = ++sourceVersion.current;
    const media = new MediaEngine(source);
    setEngine(media); setInfo(null); setThumbnails([]); setError('');
    controller.load(source);
    void media.inspect().then(metadata => {
      if (sourceVersion.current !== version) return;
      setInfo(metadata);
      const current = projects.getSnapshot().project;
      if (current?.id === source.id && current.analysis.slice.end > metadata.duration) projects.updateAnalysis({ ...current.analysis, slice: { start: 0, end: metadata.duration } });
      return media.thumbnails().then(frames => { if (sourceVersion.current === version) setThumbnails(frames); });
    }).catch(err => { if (sourceVersion.current === version && err.name !== 'AbortError') setError(err.message || 'Unable to read video metadata.'); });
    return () => { sourceVersion.current++; media.dispose(); };
  }, [source, controller, projects, projectState.source]);
  const selectInterstitial = (id: string | null, time?: number) => {
    interstitials.select(id); setTab('interstitials');
    const item = interstitialState.items.find(item => item.id === id);
    if (item) { controller.pause(); controller.seek(time ?? composition?.itemTime(item) ?? item.time); }
  };
  const addInterstitial = () => {
    if (!info || !projectState.project) return;
    const item = interstitials.add(controller.getSourceTime(), info.duration);
    setTab('interstitials'); controller.pause(); controller.seek(composition?.itemTime(item) ?? item.time);
  };
  const moveInterstitial = (id: string, time: number) => {
    if (!info) return;
    // Removing the moved scene from this mapping lets its start follow the drop position,
    // including arrow-key moves within the space its old rendered block occupied.
    const remaining = new TimelineComposition(source, info, interstitialState.items.filter(item => item.id !== id));
    interstitials.move(id, Math.max(0, Math.min(remaining.sourceDuration, Math.round(remaining.sourceTime(time) * remaining.fps) / remaining.fps)));
  };
  const openFile = (file: File) => {
    if (/\.sparko$/i.test(file.name)) void projects.importProject(file); else void projects.openVideo(file);
  };
  const exportProject = async () => {
    const result = await projects.exportProject(); if (!result) return;
    const url = URL.createObjectURL(result.blob), link = document.createElement('a');
    link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const visibleError = projectState.error || error || player.error || interstitialState.error;
  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) openFile(file); }}>
    <header className="menubar" aria-label="Application menu">
      <details className="file-menu" ref={fileMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>File</summary><div className="menu-items" role="menu" aria-label="File">
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; fileInput.current?.click(); }}><FolderOpen size={14} />Open video<span>Ctrl O</span></button>
        <button role="menuitem" disabled={projectState.busy || (!status?.defaultProject && projectState.source?.id === defaultSource.id)} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void (status?.defaultProject ? projects.openExample(status.defaultProject.url) : projects.openDefault({ ...defaultSource, url: defaultUrl.current })).catch(err => setError(err.message)); }}><RotateCcw size={14} />{status?.defaultProject ? 'Open example project' : 'Open default video'}</button>
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; projectInput.current?.click(); }}><Upload size={14} />Import project</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void exportProject(); }}><Download size={14} />Export project</button>
      </div></details>
      <button className={`menu-button ${shortcuts ? 'selected' : ''}`} aria-expanded={shortcuts} onClick={() => setShortcuts(!shortcuts)}>Shortcuts</button>
      <span className="menu-document">{source.name}</span><span className="menu-app-name">SPARKO</span>
    </header>
    <main className="workspace">
      {visibleError && <div className="error-banner" role="alert"><span>{visibleError}</span><button className="icon-button small" aria-label="Dismiss error" onClick={() => { setError(''); controller.clearError(); interstitials.clearError(); projects.clearError(); }}><X size={16} /></button></div>}
      {projectState.busy && <div className="project-status" role="status"><span className="spinner" /><span>{projectState.message}{projectState.progress !== null ? ` · ${Math.round(projectState.progress * 100)}%` : ''}</span><button className="icon-button small" aria-label="Cancel project operation" onClick={() => projects.cancel()}><X size={14} /></button></div>}
      <div className="workspace-grid" style={{ '--sidebar-width': `${actualSideWidth}px` } as CSSProperties}><section className="main-column" aria-label="Video player">
        {projectState.source ? <Player source={source} info={info} thumbnails={thumbnails} interstitials={interstitialState.items} selectedId={interstitialState.selectedId} composition={composition}
          subtitle={projectState.subtitle} onSubtitle={file => void projects.setSubtitle(file)}
          controller={controller} onAddInterstitial={addInterstitial} onSeek={time => controller.seek(time)} onError={setError} selection={tab === 'ai' ? slice : null}
          onMoveInterstitial={moveInterstitial} onRemoveInterstitial={id => void interstitials.remove(id)} onSelectInterstitial={selectInterstitial}
          timelineHeight={actualTimelineHeight} maxTimelineHeight={maxTimelineHeight} onTimelineHeight={setTimelineHeight} /> : <div className="project-opening" role="status">{projectState.busy ? 'Preparing video…' : 'Open a video from the File menu.'}</div>}
        {shortcuts && <div className="shortcuts"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 5s</span><span><kbd>J</kbd><kbd>L</kbd> Seek 10s</span><span><kbd>,</kbd><kbd>.</kbd> Step frame</span><span><kbd>P</kbd> New interstitial</span><span><kbd>M</kbd> Mute</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>0–9</kbd> Jump to %</span></div>}
      </section><ResizeHandle orientation="vertical" label="Resize side panel" value={actualSideWidth} min={220} max={maxSideWidth} onChange={setSideWidth} /><aside className="sidebar">
        <div className="tabs" role="tablist" aria-label="Video tools">{([{ id: 'interstitials', label: 'Interstitials', icon: Clapperboard }, { id: 'ai', label: 'Describe', icon: Sparkles }, { id: 'voice', label: 'Voice', icon: Mic }] as const).map(item => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}><item.icon size={15} />{item.label}{item.id === 'interstitials' && <span className="count">{interstitialState.items.length}</span>}</button>)}</div>
        <div role="tabpanel" id="panel-interstitials" aria-labelledby="tab-interstitials" hidden={tab !== 'interstitials'}><InterstitialPanel items={interstitialState.items} selectedId={interstitialState.selectedId} controller={interstitials}
          engine={engine} info={info} status={status} active={tab === 'interstitials'} onAdd={addInterstitial} onSelect={selectInterstitial} onPreviewPlay={() => controller.pause()} /></div>
        <div role="tabpanel" id="panel-ai" aria-labelledby="tab-ai" hidden={tab !== 'ai'}><AiPanel engine={engine} controller={controller} status={status} analysis={analysis} onAnalysis={value => projects.updateAnalysis(value)} slice={slice} onSlice={setSlice} /></div>
        <div role="tabpanel" id="panel-voice" aria-labelledby="tab-voice" hidden={tab !== 'voice'}><VoicePanel key={source.url} sourceId={source.id} controller={controller} status={status} active={tab === 'voice'} /></div>
      </aside></div>
    </main>
    <input className="sr-only" ref={fileInput} type="file" aria-label="Choose video file" accept="video/*,.mkv" onChange={event => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = ''; }} />
    <input className="sr-only" ref={projectInput} type="file" aria-label="Choose project file" accept=".sparko,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) void projects.importProject(file); event.target.value = ''; }} />
    {login && <div className="modal-backdrop"><div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title"><h2 id="login-title">Unlock video tools</h2><p className="hint">Enter this workspace’s password to use its AI providers.</p><form onSubmit={event => {
      event.preventDefault(); sessionStorage.setItem('sparko:password', password); setLoginError('');
      void request('/api/session', { method: 'POST' }).then(() => { setLogin(false); setPassword(''); }).catch(err => { sessionStorage.removeItem('sparko:password'); setLoginError(err.message); });
    }}><label className="field">Workspace password<input type="password" autoFocus autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary full-width" type="submit">Unlock</button></form>{loginError && <p className="inline-error" role="alert">{loginError}</p>}</div></div>}
  </div>;
}
