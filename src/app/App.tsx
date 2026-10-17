import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Download, FolderOpen, GitBranch, Redo2, RotateCcw, Save, Trash2, Undo2, Upload, X } from 'lucide-react';
import CallResponseControls from '../features/call-response/CallResponseControls';
import { addAnswer, branchScenes, resolveFlow, type SceneId } from '../features/call-response/model';
import type { FlowTimeline } from '../features/timeline/FlowTracks';
import Player from '../features/player/Player';
import PlaybackOptions, { crossfadePreference, savedCrossfadePreference, framingPreference, savedFramingPreference } from '../features/player/PlaybackOptions';
import InterstitialPanel from '../features/interstitials/InterstitialPanel';
import { InterstitialController } from '../features/interstitials/InterstitialController';
import { ProjectController } from '../features/project/ProjectController';
import { TimelineComposition } from '../media/TimelineComposition';
import ResizeHandle from '../shared/ResizeHandle';
import { MediaEngine } from '../media/MediaEngine';
import { VideoPlayerController } from '../features/player/VideoPlayerController';
import type { MediaInfo, MediaSource, Thumbnail } from '../media/media';
import { getStatus, request } from '../shared/api';
import type { AppStatus } from '../../shared/contracts';
import { activeFlows, projectFlows } from '../features/project/types';
import { composeFlows } from '../features/call-response/compose';
import { playableResult } from '../../shared/interstitials';
import ProjectStart from './ProjectStart';

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
type ProjectPickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options: { multiple: boolean; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
};
const projectFileTypes = [{ description: 'Sparko project', accept: { 'application/zip': ['.sparko'] } }];
function savedSize(key: string, fallback: number) {
  try { const value = Number(localStorage.getItem(key)); return value > 0 && Number.isFinite(value) ? value : fallback; } catch { return fallback; }
}
export default function App() {
  const [controller] = useState(() => new VideoPlayerController());
  const player = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [engine, setEngine] = useState<MediaEngine | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [thumbnailsFailed, setThumbnailsFailed] = useState(false);
  const [interstitials] = useState(() => new InterstitialController());
  const interstitialState = useSyncExternalStore(interstitials.subscribe, interstitials.getSnapshot);
  const [projects] = useState(() => new ProjectController(interstitials));
  const projectState = useSyncExternalStore(projects.subscribe, projects.getSnapshot);
  const source = projectState.source || defaultSource;
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [startReady, setStartReady] = useState(false);
  const [showProjectStart, setShowProjectStart] = useState(true);
  const [error, setError] = useState('');
  const [shortcuts, setShortcuts] = useState(false);
  const [projectDialog, setProjectDialog] = useState<'library' | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [crossfade, setCrossfade] = useState(savedCrossfadePreference);
  useEffect(() => { try { localStorage.setItem(crossfadePreference, String(crossfade)); } catch { /* Apply without persistence. */ } }, [crossfade]);
  const [matchFraming, setMatchFraming] = useState(savedFramingPreference);
  useEffect(() => { try { localStorage.setItem(framingPreference, String(matchFraming)); } catch { /* Apply without persistence. */ } }, [matchFraming]);
  const [selectedFlowScene, setSelectedFlowScene] = useState<SceneId | null>(null);
  const [selectedFlowEdge, setSelectedFlowEdge] = useState<string | null>(null);
  const savedFlows = useMemo(() => activeFlows(projectState.project), [projectState.project?.callResponses, projectState.project?.callResponse, projectState.project?.interstitials]);
  const savedFlow = savedFlows.find(flow => flow.interstitial.id === interstitialState.selectedId || flow.scenes.some(scene => scene.interstitialId === interstitialState.selectedId)) ?? savedFlows[0];
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [sideWidth, setSideWidth] = useState(() => savedSize('sparko:side-width', 294));
  const [timelineHeight, setTimelineHeight] = useState(() => savedSize('sparko:timeline-height', 134));
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const maxSideWidth = Math.max(220, Math.min(700, viewport.width - 340));
  const maxTimelineHeight = Math.max(savedFlow ? 290 : 134, Math.floor(viewport.height * (viewport.width <= 660 ? savedFlow ? 0.4 : 0.28 : 0.55)));
  const actualSideWidth = Math.max(220, Math.min(maxSideWidth, sideWidth));
  const minimumTimelineHeight = savedFlow ? Math.min(maxTimelineHeight, Math.max(290, branchScenes(savedFlow).length * 76 + 138)) : 134;
  const actualTimelineHeight = Math.max(minimumTimelineHeight, Math.min(maxTimelineHeight, timelineHeight));
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
  const readyKey = JSON.stringify(interstitialState.items.map(item => ({ id: item.id, kind: item.kind, groupId: item.groupId, label: item.label, time: item.time, duration: !playableResult(item) ? item.duration : undefined, result: playableResult(item) })));
  const flow = useMemo(() => info && source.assetId ? composeFlows(savedFlows, interstitialState.items, source.assetId, info.duration) : undefined, [savedFlows, readyKey, info, source.assetId]);
  const composition = useMemo(() => info ? new TimelineComposition(source, info, interstitialState.items, { crossfade, matchFraming }) : null, [source, info, readyKey, crossfade, matchFraming]);
  useEffect(() => { if (flow && info) controller.setFlow(flow, info, matchFraming); else if (!flow && composition) controller.setComposition(composition); }, [composition, controller, flow, info, matchFraming]);
  useEffect(() => {
    controller.pause(); setSelectedFlowScene(null); setSelectedFlowEdge(null);
  }, [controller, projectState.historyRevision]);
  useEffect(() => {
    const historyKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = event.target as HTMLElement;
      const textInput = target.closest('textarea, input:not([type="range"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="reset"])');
      if ((target.isContentEditable || textInput) && !target.closest('[data-project-edit]')) return;
      event.preventDefault();
      if (event.repeat || projects.getSnapshot().busy) return;
      controller.pause();
      if (key === 'y' || event.shiftKey) void projects.redo(); else void projects.undo();
    };
    window.addEventListener('keydown', historyKey);
    return () => window.removeEventListener('keydown', historyKey);
  }, [controller, projects]);
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
    return projects.init({ ...defaultSource, url: data.defaultVideo.url });
  }).catch(err => { if (active) { setError(err.message); return projects.init(defaultSource); } })
    .finally(() => { if (active) setStartReady(true); });
    return () => { active = false; };
  }, [projects]);
  useEffect(() => {
    const show = () => setLogin(true);
    window.addEventListener('sparko:auth-required', show);
    return () => window.removeEventListener('sparko:auth-required', show);
  }, []);
  useEffect(() => {
    if (!projectState.source) return;
    setShowProjectStart(false);
    const version = ++sourceVersion.current;
    const media = new MediaEngine(source);
    setEngine(media); setInfo(null); setThumbnails([]); setThumbnailsFailed(false); setError('');
    controller.load(source);
    void media.inspect().then(metadata => {
      if (sourceVersion.current !== version) return;
      setInfo(metadata);
      const current = projects.getSnapshot().project;
      if (current?.id === source.id && current.analysis.slice.end > metadata.duration) projects.updateAnalysis({ ...current.analysis, slice: { start: 0, end: metadata.duration } });
      return media.thumbnails().then(frames => { if (sourceVersion.current === version) setThumbnails(frames); });
    }).catch(err => { if (sourceVersion.current === version && err.name !== 'AbortError') { setThumbnailsFailed(true); setError(err.message || 'Unable to read video metadata.'); } });
    return () => { sourceVersion.current++; media.dispose(); };
  }, [source, controller, projects, projectState.source]);
  const selectInterstitial = (id: string | null, time?: number) => {
    interstitials.select(id);
    if (!id) { setSelectedFlowScene(null); setSelectedFlowEdge(null); return; }
    if (flow && id) { const scene = flow.scenes.find(scene => scene.interstitialId === id); setSelectedFlowScene(scene?.id ?? null); setSelectedFlowEdge(null); if (scene) { controller.seekFlowScene(scene.id); return; } }
    const item = interstitialState.items.find(item => item.id === id);
    if (item) { controller.pause(); controller.seek(time ?? composition?.itemTime(item) ?? item.time); }
  };
  const addInterstitial = () => {
    if (!info || !projectState.project || projectState.busy) return;
    const item = interstitials.add(controller.getSourceTime(), info.duration);
    controller.pause(); controller.seek(composition?.itemTime(item) ?? item.time);
  };
  const moveInterstitial = (id: string, time: number) => {
    if (!info || projectState.busy) return;
    // Removing the moved scene from this mapping lets its start follow the drop position,
    // including arrow-key moves within the space its old rendered block occupied.
    const remaining = new TimelineComposition(source, info, interstitialState.items.filter(item => item.id !== id));
    interstitials.move(id, Math.max(0, Math.min(remaining.sourceDuration, Math.round(remaining.sourceTime(time) * remaining.fps) / remaining.fps)));
  };
  const removeInterstitial = (id: string) => {
    if (projectState.busy) return;
    if (projectFlows(projectState.project).some(group => group.interstitial.id === id)) {
      controller.pause();
      void projects.removeCallResponse(id).then(removed => {
        if (removed) { setSelectedFlowScene(null); setSelectedFlowEdge(null); }
      });
    } else if (!interstitialState.items.find(item => item.id === id)?.groupId) void interstitials.remove(id);
  };
  const openFile = (file: File) => {
    if (/\.sparko$/i.test(file.name)) void projects.importProject(file); else void projects.openVideo(file);
  };
  const exportProject = async () => {
    const result = await projects.exportProject(); if (!result) return;
    const url = URL.createObjectURL(result.blob), link = document.createElement('a');
    link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const saveAsFile = async () => {
    const picker = (window as ProjectPickerWindow).showSaveFilePicker;
    if (!picker) { await exportProject(); return; }
    try {
      const name = `${(projectState.project?.name || 'project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.sparko`;
      const handle = await picker.call(window, { suggestedName: name, types: projectFileTypes });
      await projects.saveToFile(handle);
    } catch (cause) { if ((cause as DOMException).name !== 'AbortError') setError((cause as Error).message); }
  };
  const saveCurrent = () => {
    if (fileMenu.current) fileMenu.current.open = false;
    const handle = projects.getFileHandle();
    if (handle) void projects.saveToFile(handle); else void saveAsFile();
  };
  const openProjectFile = async () => {
    const picker = (window as ProjectPickerWindow).showOpenFilePicker;
    if (!picker) { projectInput.current?.click(); return; }
    try {
      const [handle] = await picker.call(window, { multiple: false, types: projectFileTypes });
      if (handle) await projects.openProjectFile(handle);
    } catch (cause) { if ((cause as DOMException).name !== 'AbortError') setError((cause as Error).message); }
  };
  const visibleError = projectState.error || error || player.error || interstitialState.error;
  const runtimeId = (groupId: string, id: string) => flow?.scenes.find(scene => scene.groupId === groupId && scene.localId === id)?.id ?? id;
  const selectedRuntimeScene = flow?.scenes.find(scene => scene.interstitialId === interstitialState.selectedId)?.id ?? selectedFlowScene;
  const staleClipIds = new Set(interstitialState.items.filter(item => interstitials.dependency(item.id)?.stale).map(item => item.id));
  const groupTimelines: FlowTimeline[] = savedFlows.map(saved => {
    const resolved = resolveFlow(saved, interstitialState.items), groupId = saved.interstitial.id;
    const localScene = flow?.scenes.find(scene => scene.id === selectedRuntimeScene);
    const selectedSceneId = resolved.scenes.find(scene => scene.interstitialId === interstitialState.selectedId)?.id
      ?? (localScene?.groupId === groupId ? localScene.localId! : !flow?.groups ? selectedFlowScene : null);
    const prefix = flow?.groups ? `${groupId}/` : '';
    return { flow: resolved, session: player.flow, selectedSceneId, selectedEdgeId: selectedFlowEdge?.startsWith(prefix) ? selectedFlowEdge.slice(prefix.length) : null,
      selectedInterstitial: interstitialState.selectedId === groupId, staleClipIds,
      onSelectInterstitial: () => { interstitials.select(groupId); setSelectedFlowScene(null); setSelectedFlowEdge(null); controller.pause(); },
      onRemoveInterstitial: () => removeInterstitial(groupId),
      onRenameInterstitial: label => projects.updateCallResponse({ ...saved, interstitial: { ...saved.interstitial, label } }),
      onChange: value => projects.updateCallResponse(value),
      onTypeChange: kind => { if (info) void projects.setInterstitialType(groupId, kind, info.duration); },
      onAddAnswer: () => {
        const next = addAnswer(saved), answer = next.interaction.answers.at(-1)!;
        controller.pause(); projects.updateCallResponse(next); setSelectedFlowScene(runtimeId(groupId, answer.sceneId)); setSelectedFlowEdge(null);
        interstitials.select(next.scenes.find(scene => scene.id === answer.sceneId)!.interstitialId!);
      },
      onRemoveAnswer: id => { controller.pause(); setSelectedFlowScene(null); setSelectedFlowEdge(null); interstitials.select(groupId); void projects.removeAnswer(id, groupId); },
      onSelectScene: (id, frame) => {
        const runtime = runtimeId(groupId, id); setSelectedFlowScene(runtime); setSelectedFlowEdge(null);
        interstitials.select(resolved.scenes.find(scene => scene.id === id)?.interstitialId ?? null); controller.seekFlowScene(runtime, frame);
      },
      onSelectEdge: id => {
        const scene = resolved.scenes.find(scene => scene.id === resolved.edges.find(edge => edge.id === id)?.from);
        setSelectedFlowEdge(prefix + id); setSelectedFlowScene(scene ? runtimeId(groupId, scene.id) : null); interstitials.select(scene?.interstitialId ?? null);
      },
      onBranch: (id, outcome) => controller.branchFlow(runtimeId(groupId, id), prefix + outcome),
    };
  });
  const groupForScene = (id: string) => groupTimelines.find(group => group.flow.interstitial.id === flow?.scenes.find(scene => scene.id === id)?.groupId) ?? groupTimelines[0];
  const flowTimeline: FlowTimeline | undefined = flow && groupTimelines.length ? { ...groupTimelines[0], flow, groups: groupTimelines, session: player.flow,
    selectedSceneId: selectedRuntimeScene ?? null, selectedEdgeId: selectedFlowEdge,
    onSelectInterstitial: id => groupTimelines.find(group => group.flow.interstitial.id === (id ?? flow.interstitial.id))?.onSelectInterstitial(),
    onRemoveInterstitial: id => removeInterstitial(id ?? flow.interstitial.id),
    onSelectScene: (id, frame) => {
      const scene = flow.scenes.find(scene => scene.id === id);
      if (scene?.groupId || !flow.groups) groupForScene(id)?.onSelectScene(scene?.localId ?? id, frame);
      else { setSelectedFlowScene(id); setSelectedFlowEdge(null); interstitials.select(scene?.interstitialId ?? null); controller.seekFlowScene(id, frame); }
    },
    onSelectEdge: id => {
      const edge = flow.edges.find(edge => edge.id === id), group = edge && groupForScene(edge.from);
      if (group) group.onSelectEdge(flow.groups ? id.slice(group.flow.interstitial.id.length + 1) : id);
    },
    onBranch: (id, outcome) => { setSelectedFlowScene(id); controller.branchFlow(id, outcome); },
  } : undefined;
  const panelTimeline = groupTimelines.find(group => group.selectedInterstitial || group.flow.scenes.some(scene => scene.interstitialId === interstitialState.selectedId)) ?? groupTimelines.find(group => group.selectedSceneId);
  const parentPanelOpen = !!panelTimeline && (panelTimeline.selectedInterstitial || panelTimeline.flow.scenes.some(scene => scene.clip.kind !== 'video' && scene.id === panelTimeline.selectedSceneId));
  const clipControls = (id: SceneId) => panelTimeline && <CallResponseControls flow={panelTimeline.flow}
    selectedSceneId={id} selectedEdgeId={panelTimeline.selectedEdgeId} onChange={value => projects.updateCallResponse(value)}
    onSelectEdge={panelTimeline.onSelectEdge} />;
  return <div className="app-shell" onBlurCapture={() => projects.endHistoryGroup()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) openFile(file); }}>
    {showProjectStart ? <ProjectStart projects={projects} state={projectState} ready={startReady} error={visibleError} hasExample={!!status?.defaultProject}
      onOpenVideo={() => fileInput.current?.click()} onOpenProject={() => void openProjectFile()}
      onOpenSample={() => void projects.openDefault({ ...defaultSource, url: defaultUrl.current }, status?.defaultProject?.url)}
      onOpenExample={() => { if (status?.defaultProject) void projects.openExample(status.defaultProject.url); }}
      onReturn={projectState.source ? () => setShowProjectStart(false) : undefined}
      onDismissError={() => { setError(''); controller.clearError(); interstitials.clearError(); projects.clearError(); }} /> : <>
    <header className="menubar" aria-label="Application menu">
      <details className="file-menu" ref={fileMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>File</summary><div className="menu-items" role="menu" aria-label="File">
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; setShowProjectStart(true); }}><FolderOpen size={14} />Choose project</button>
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; fileInput.current?.click(); }}><FolderOpen size={14} />Open video<span>Ctrl O</span></button>
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void projects.openDefault({ ...defaultSource, url: defaultUrl.current }, status?.defaultProject?.url); }}><RotateCcw size={14} />Open sample video</button>
        {status?.defaultProject && <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void projects.openExample(status.defaultProject!.url); }}><FolderOpen size={14} />Open example project</button>}
        <button role="menuitem" disabled={projectState.busy || !info} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; controller.pause(); setSelectedFlowEdge(null); setSelectedFlowScene(null); setTimelineHeight(Math.max(300, timelineHeight)); if (info) void projects.openTestCallResponse(info.duration); }}><GitBranch size={14} />Open test call response</button>
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void openProjectFile(); }}><Upload size={14} />Open project file</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={saveCurrent}><Save size={14} />Save project</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void saveAsFile(); }}><Save size={14} />Save as new file</button>
        <button role="menuitem" disabled={projectState.busy} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; setDeleteCandidate(null); setProjectDialog('library'); }}><FolderOpen size={14} />Recent projects<span>{projectState.recentFiles.length}</span></button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void exportProject(); }}><Download size={14} />Export project</button>
      </div></details>
      <PlaybackOptions crossfade={crossfade} onCrossfade={setCrossfade} matchFraming={matchFraming} onMatchFraming={setMatchFraming} />
      <div className="history-controls" role="group" aria-label="Edit history">
        <button className="icon-button small" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" title={`${projectState.undoLabel ? `Undo: ${projectState.undoLabel}` : 'Undo'} (Ctrl/Cmd+Z)`}
          disabled={projectState.busy || !projectState.undoLabel} onClick={() => { controller.pause(); void projects.undo(); }}><Undo2 size={14} /></button>
        <button className="icon-button small" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" title={`${projectState.redoLabel ? `Redo: ${projectState.redoLabel}` : 'Redo'} (Ctrl/Cmd+Shift+Z)`}
          disabled={projectState.busy || !projectState.redoLabel} onClick={() => { controller.pause(); void projects.redo(); }}><Redo2 size={14} /></button>
      </div>
      <button className={`menu-button ${shortcuts ? 'selected' : ''}`} aria-expanded={shortcuts} onClick={() => setShortcuts(!shortcuts)}>Shortcuts</button>
      <span className="menu-document">{projectState.fileName || (savedFlow ? projectState.project?.name : source.name)}</span><span className="menu-app-name">SPARKO</span>
    </header>
    <main className="workspace">
      {visibleError && <div className="error-banner" role="alert"><span>{visibleError}</span><button className="icon-button small" aria-label="Dismiss error" onClick={() => { setError(''); controller.clearError(); interstitials.clearError(); projects.clearError(); }}><X size={16} /></button></div>}
      {projectState.busy && <div className="project-status" role="status"><span className="spinner" /><span>{projectState.message}{projectState.progress !== null ? ` · ${Math.round(projectState.progress * 100)}%` : ''}</span><button className="icon-button small" aria-label="Cancel project operation" onClick={() => projects.cancel()}><X size={14} /></button></div>}
      <div className="workspace-grid" inert={projectState.busy} style={{ '--sidebar-width': `${actualSideWidth}px` } as CSSProperties}><section className="main-column" aria-label="Video player">
        {projectState.source ? <Player source={source} info={info} thumbnails={thumbnails} thumbnailsFailed={thumbnailsFailed} interstitials={interstitialState.items} selectedId={interstitialState.selectedId} composition={composition}
          callResponse={flowTimeline}
          subtitle={projectState.subtitle} onSubtitle={file => void projects.setSubtitle(file)}
          controller={controller} onAddInterstitial={addInterstitial} onSeek={time => controller.seek(time)} onError={setError} selection={null}
          onMoveInterstitial={moveInterstitial} onRemoveInterstitial={removeInterstitial} onSelectInterstitial={selectInterstitial}
          timelineHeight={actualTimelineHeight} maxTimelineHeight={maxTimelineHeight} onTimelineHeight={setTimelineHeight} /> : <div className="project-opening" role="status">{projectState.busy ? 'Preparing video…' : 'Open a video from the File menu.'}</div>}
        {shortcuts && <div className="shortcuts"><span><kbd>Ctrl/Cmd Z</kbd> Undo</span><span><kbd>Ctrl/Cmd Shift Z</kbd> / <kbd>Ctrl Y</kbd> Redo</span><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 5s</span><span><kbd>J</kbd><kbd>L</kbd> Seek 10s</span><span><kbd>,</kbd><kbd>.</kbd> Step frame</span><span><kbd>P</kbd> New interstitial</span><span><kbd>M</kbd> Mute</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>0–9</kbd> Jump to %</span></div>}
      </section><ResizeHandle orientation="vertical" label="Resize side panel" value={actualSideWidth} min={220} max={maxSideWidth} onChange={setSideWidth} /><aside className="sidebar" aria-label="Interstitials">
        {panelTimeline && !parentPanelOpen && <CallResponseControls flow={panelTimeline.flow} selectedSceneId={panelTimeline.selectedSceneId} selectedEdgeId={panelTimeline.selectedEdgeId} onChange={value => projects.updateCallResponse(value)} onSelectEdge={panelTimeline.onSelectEdge} />}
        <InterstitialPanel items={interstitialState.items} selectedId={interstitialState.selectedId} controller={interstitials}
          callResponse={panelTimeline} groups={groupTimelines}
          onTypeChange={(id, kind) => { if (info) void projects.setInterstitialType(id, kind, info.duration); }}
          renderClipControls={clipControls}
          connectedIds={flow?.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : [])}
          engine={engine} info={info} status={status} active onAdd={addInterstitial} onSelect={selectInterstitial} onRemove={removeInterstitial} onPreviewPlay={() => controller.pause()} />
      </aside></div>
    </main></>}
    <input className="sr-only" ref={fileInput} type="file" aria-label="Choose video file" accept="video/*,.mkv" onChange={event => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = ''; }} />
    <input className="sr-only" ref={projectInput} type="file" aria-label="Choose project file" accept=".sparko,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) void projects.importProject(file); event.target.value = ''; }} />
    {projectDialog === 'library' && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProjectDialog(null); }}><div className="project-card project-library" role="dialog" aria-modal="true" aria-labelledby="saved-projects-title">
      <div className="project-card-heading"><h2 id="saved-projects-title">Recent projects</h2><button className="icon-button small" aria-label="Close" onClick={() => setProjectDialog(null)}><X size={16} /></button></div>
      {projectState.recentFiles.length === 0 && projectState.savedProjects.length === 0 && <p className="hint">Open or save a project file to see it here.</p>}
      {projectState.recentFiles.length > 0 && <div className="project-list">{projectState.recentFiles.map(item => <div className="project-row" key={item.id}>
        <div className="project-row-info"><strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></div>
        {deleteCandidate === `file:${item.id}` ? <div className="project-row-actions"><span>Delete this file from disk?</span><button className="button small danger" disabled={projectState.busy} onClick={() => { void projects.removeRecentFile(item.id, true).then(deleted => { if (deleted) setDeleteCandidate(null); }); }}>Delete file</button><button className="button small" onClick={() => setDeleteCandidate(null)}>Cancel</button></div>
          : <div className="project-row-actions"><button className="button small" disabled={projectState.busy} onClick={() => { void projects.openProjectFile(item.handle).then(opened => { if (opened) setProjectDialog(null); }); }}>Open</button><button className="icon-button small" title={`Remove ${item.name} from Recent`} aria-label={`Remove ${item.name} from Recent`} disabled={projectState.busy} onClick={() => { void projects.removeRecentFile(item.id); }}><X size={14} /></button>{'remove' in item.handle && <button className="icon-button small" title={`Delete file ${item.name}`} aria-label={`Delete file ${item.name}`} disabled={projectState.busy} onClick={() => setDeleteCandidate(`file:${item.id}`)}><Trash2 size={14} /></button>}</div>}
      </div>)}</div>}
      {projectState.savedProjects.length > 0 && <><h3 className="project-section-title">Earlier browser projects</h3><p className="hint">Open one and choose Save as new file to keep it on disk.</p><div className="project-list">{projectState.savedProjects.map(item => <div className="project-row" key={item.id}>
        <div className="project-row-info"><strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}{projectState.savedProjectId === item.id ? ' · Current project' : ''}</span></div>
        {deleteCandidate === `browser:${item.id}` ? <div className="project-row-actions"><span>Delete browser copy?</span><button className="button small danger" disabled={projectState.busy} onClick={() => { void projects.deleteSavedProject(item.id).then(deleted => { if (deleted) setDeleteCandidate(null); }); }}>Delete</button><button className="button small" onClick={() => setDeleteCandidate(null)}>Cancel</button></div>
          : <div className="project-row-actions"><button className="button small" disabled={projectState.busy} onClick={() => { void projects.openSavedProject(item.id).then(opened => { if (opened) setProjectDialog(null); }); }}>Open</button><button className="icon-button small" title={`Delete browser copy ${item.name}`} aria-label={`Delete browser copy ${item.name}`} disabled={projectState.busy} onClick={() => setDeleteCandidate(`browser:${item.id}`)}><Trash2 size={14} /></button></div>}
      </div>)}</div></>}
    </div></div>}
    {login && <div className="modal-backdrop"><div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title"><h2 id="login-title">Unlock video tools</h2><p className="hint">Enter this workspace’s password to use its AI providers.</p><form onSubmit={event => {
      event.preventDefault(); sessionStorage.setItem('sparko:password', password); setLoginError('');
      void request('/api/session', { method: 'POST' }).then(() => { setLogin(false); setPassword(''); }).catch(err => { sessionStorage.removeItem('sparko:password'); setLoginError(err.message); });
    }}><label className="field">Workspace password<input type="password" autoFocus autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary full-width" type="submit">Unlock</button></form>{loginError && <p className="inline-error" role="alert">{loginError}</p>}</div></div>}
  </div>;
}
