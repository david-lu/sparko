import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { FolderOpen, Pin as PinIcon, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import Player from './components/Player';
import AiPanel from './components/AiPanel';
import FalPanel from './components/FalPanel';
import ResizeHandle from './components/ResizeHandle';
import { MediaEngine } from './lib/MediaEngine';
import { VideoPlayerController } from './lib/VideoPlayerController';
import type { MediaInfo, MediaSource, Thumbnail } from './lib/media';
import { loadPins, savePins, type Pin } from './lib/pins';
import { getStatus, request } from './lib/api';
import { formatTime, type AppStatus, type Slice } from '../shared/contracts';

const defaultSource: MediaSource = { id: 'default:episode_mock.mp4', name: 'episode_mock.mp4', url: '/media/episode_mock.mp4' };
type Tab = 'pins' | 'ai' | 'fal';
function savedSize(key: string, fallback: number) {
  try { const value = Number(localStorage.getItem(key)); return value > 0 && Number.isFinite(value) ? value : fallback; } catch { return fallback; }
}
export default function App() {
  const [controller] = useState(() => new VideoPlayerController());
  const player = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [source, setSource] = useState<MediaSource>(defaultSource);
  const [engine, setEngine] = useState<MediaEngine | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [pins, setPins] = useState<Pin[]>(() => loadPins(defaultSource.id));
  const [tab, setTab] = useState<Tab>('pins');
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState('');
  const [slice, setSlice] = useState<Slice>({ start: 0, end: 10 });
  const [shortcuts, setShortcuts] = useState(false);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [sideWidth, setSideWidth] = useState(() => savedSize('sparko:side-width', 294));
  const [timelineHeight, setTimelineHeight] = useState(() => savedSize('sparko:timeline-height', 134));
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const maxSideWidth = Math.max(220, Math.min(700, viewport.width - 340));
  const maxTimelineHeight = Math.max(118, Math.floor(viewport.height * (viewport.width <= 660 ? 0.28 : 0.55)));
  const actualSideWidth = Math.max(220, Math.min(maxSideWidth, sideWidth));
  const actualTimelineHeight = Math.max(118, Math.min(maxTimelineHeight, timelineHeight));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('sparko:side-width', String(sideWidth)); localStorage.setItem('sparko:timeline-height', String(timelineHeight)); } catch { /* The layout still works without persistence. */ }
  }, [sideWidth, timelineHeight]);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const defaultUrl = useRef(defaultSource.url);
  const sourceVersion = useRef(0);
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); fileInput.current?.click(); }
    };
    window.addEventListener('keydown', open);
    return () => window.removeEventListener('keydown', open);
  }, []);

  useEffect(() => { void getStatus().then(data => {
    setStatus(data); defaultUrl.current = data.defaultVideo.url;
    if (data.requiresPassword && !sessionStorage.getItem('sparko:password')) setLogin(true);
    if (data.defaultVideo.url !== defaultSource.url) setSource(current => current.id === defaultSource.id ? { ...current, url: data.defaultVideo.url } : current);
  }).catch(err => setError(err.message)); }, []);
  useEffect(() => {
    const show = () => setLogin(true);
    window.addEventListener('sparko:auth-required', show);
    return () => window.removeEventListener('sparko:auth-required', show);
  }, []);
  useEffect(() => {
    const version = ++sourceVersion.current;
    const media = new MediaEngine(source);
    setEngine(media); setInfo(null); setThumbnails([]); setError('');
    setPins(loadPins(source.id)); setSlice({ start: 0, end: 10 }); controller.load(source);
    void media.inspect().then(metadata => {
      if (sourceVersion.current !== version) return;
      setInfo(metadata); setSlice({ start: 0, end: Math.min(10, metadata.duration) });
      return media.thumbnails().then(frames => { if (sourceVersion.current === version) setThumbnails(frames); });
    }).catch(err => { if (sourceVersion.current === version && err.name !== 'AbortError') setError(err.message || 'Unable to read video metadata.'); });
    return () => { sourceVersion.current++; media.dispose(); };
  }, [source, controller]);
  useEffect(() => () => { if (source.file) URL.revokeObjectURL(source.url); }, [source]);
  const updatePins = (next: Pin[]) => {
    const sorted = [...next].sort((a, b) => a.time - b.time); setPins(sorted);
    if (!savePins(source.id, sorted)) setError('Pins are available in this session, but browser storage could not save them.');
  };
  const addPin = () => {
    if (!player.duration) return;
    const time = controller.video?.currentTime || 0;
    if (pins.some(pin => Math.abs(pin.time - time) < 0.03)) { setTab('pins'); return; }
    updatePins([...pins, { id: crypto.randomUUID(), time, label: `Pin ${pins.length + 1}` }]);
  };
  const openFile = (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) { setError('Choose a video file.'); return; }
    setSource({ id: `file:${file.name}:${file.size}:${file.lastModified}`, name: file.name, url: URL.createObjectURL(file), file });
  };
  const visibleError = error || player.error;
  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) openFile(file); }}>
    <header className="menubar" aria-label="Application menu">
      <details className="file-menu" ref={fileMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>File</summary><div className="menu-items" role="menu" aria-label="File">
        <button role="menuitem" onClick={() => { if (fileMenu.current) fileMenu.current.open = false; fileInput.current?.click(); }}><FolderOpen size={14} />Open video<span>Ctrl O</span></button>
        <button role="menuitem" disabled={!source.file} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; setSource({ ...defaultSource, url: defaultUrl.current }); }}><RotateCcw size={14} />Open default video</button>
      </div></details>
      <button className={`menu-button ${shortcuts ? 'selected' : ''}`} aria-expanded={shortcuts} onClick={() => setShortcuts(!shortcuts)}>Shortcuts</button>
      <span className="menu-document">{source.name}</span><span className="menu-app-name">SPARKO</span>
    </header>
    <main className="workspace">
      {visibleError && <div className="error-banner" role="alert"><span>{visibleError}</span><button className="icon-button small" aria-label="Dismiss error" onClick={() => { setError(''); controller.clearError(); }}><X size={16} /></button></div>}
      <div className="workspace-grid" style={{ '--sidebar-width': `${actualSideWidth}px` } as CSSProperties}><section className="main-column" aria-label="Video player">
        <Player source={source} info={info} thumbnails={thumbnails} pins={pins} controller={controller} onPin={addPin} onSeek={time => controller.seek(time)} onError={setError} selection={tab === 'ai' ? slice : null}
          timelineHeight={actualTimelineHeight} maxTimelineHeight={maxTimelineHeight} onTimelineHeight={setTimelineHeight} />
        {shortcuts && <div className="shortcuts"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 5s</span><span><kbd>J</kbd><kbd>L</kbd> Seek 10s</span><span><kbd>,</kbd><kbd>.</kbd> Step frame</span><span><kbd>P</kbd> Add pin</span><span><kbd>M</kbd> Mute</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>0–9</kbd> Jump to %</span></div>}
      </section><ResizeHandle orientation="vertical" label="Resize side panel" value={actualSideWidth} min={220} max={maxSideWidth} onChange={setSideWidth} /><aside className="sidebar">
        <div className="tabs" role="tablist" aria-label="Video tools">{([{ id: 'pins', label: 'Pins', icon: PinIcon }, { id: 'ai', label: 'Describe', icon: Sparkles }, { id: 'fal', label: 'fal.ai', icon: Upload }] as const).map(item => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}><item.icon size={15} />{item.label}{item.id === 'pins' && <span className="count">{pins.length}</span>}</button>)}</div>
        <div role="tabpanel" id="panel-pins" aria-labelledby="tab-pins" hidden={tab !== 'pins'}><div className="panel-content">
          <div className="panel-intro"><h2>Timeline pins</h2></div>
          <button className="button full-width" disabled={!player.duration} onClick={addPin}><Plus size={16} /> Pin current time<span className="button-trailing">{formatTime(player.time)}</span></button>
          {!pins.length ? <div className="empty-state"><h3>No pins yet</h3><p>Press <kbd>P</kbd> to mark the playhead.<br />Pins are saved in this browser.</p></div> : <ol className="pin-list">{pins.map((pin, i) => <li key={pin.id} className={Math.abs(pin.time - player.time) < 0.2 ? 'current' : ''}><button className="pin-number" aria-label={`Jump to pin ${i + 1}`} onClick={() => controller.seek(pin.time)}>{i + 1}</button><div className="pin-details"><input aria-label={`Pin ${i + 1} label`} value={pin.label} maxLength={80} onChange={event => updatePins(pins.map(item => item.id === pin.id ? { ...item, label: event.target.value } : item))} /><button className="text-button pin-time" onClick={() => controller.seek(pin.time)}>{formatTime(pin.time, true)}</button></div><button className="icon-button small delete-pin" aria-label={`Remove pin ${i + 1}`} onClick={() => updatePins(pins.filter(item => item.id !== pin.id))}><Trash2 size={14} /></button></li>)}</ol>}
        </div></div>
        <div role="tabpanel" id="panel-ai" aria-labelledby="tab-ai" hidden={tab !== 'ai'}><AiPanel engine={engine} controller={controller} status={status} slice={slice} onSlice={setSlice} /></div>
        <div role="tabpanel" id="panel-fal" aria-labelledby="tab-fal" hidden={tab !== 'fal'}><FalPanel source={source} controller={controller} status={status} /></div>
      </aside></div>
    </main>
    <input className="sr-only" ref={fileInput} type="file" aria-label="Choose video file" accept="video/*,.mkv" onChange={event => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = ''; }} />
    {login && <div className="modal-backdrop"><div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title"><h2 id="login-title">Unlock video tools</h2><p className="hint">Enter this workspace’s password to use its AI providers.</p><form onSubmit={event => {
      event.preventDefault(); sessionStorage.setItem('sparko:password', password); setLoginError('');
      void request('/api/session', { method: 'POST' }).then(() => { setLogin(false); setPassword(''); }).catch(err => { sessionStorage.removeItem('sparko:password'); setLoginError(err.message); });
    }}><label className="field">Workspace password<input type="password" autoFocus autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary full-width" type="submit">Unlock</button></form>{loginError && <p className="inline-error" role="alert">{loginError}</p>}</div></div>}
  </div>;
}
