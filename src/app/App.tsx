import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Download, FolderOpen, Redo2, Save, Undo2, X } from 'lucide-react';
import CallResponseControls from '../features/call-response/CallResponseControls';
import { addAnswer, branchScenes, interstitialScenes, resolveFlow, type SceneId } from '../features/call-response/model';
import type { FlowTimeline } from '../features/timeline/FlowTracks';
import Player from '../features/player/Player';
import PlaybackOptions, { crossfadePreference, savedCrossfadePreference, framingPreference, savedFramingPreference } from '../features/player/PlaybackOptions';
import { INTERSTITIAL_CROSSFADE_FRAMES } from '../../shared/constants';
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
import { runtimeFlow } from '../features/story-flow/model';
import { useStoryEditor } from '../features/story-flow/useStoryEditor';
import StoryCanvas from '../features/story-flow/StoryCanvas';
import StoryInspector from '../features/story-flow/StoryInspector';
import StoryLibrary from '../features/story-flow/StoryLibrary';
import WorkspacePanels from '../shared/panels/WorkspacePanels';

// Fast Refresh preserves useState, including instances with obsolete controller methods.
// Reload saved project state when a controller changes during local development.
if (import.meta.hot) {
  import.meta.hot.accept([
    '../features/interstitials/InterstitialController',
    '../features/project/ProjectController',
    '../features/player/VideoPlayerController',
  ], () => window.location.reload());
}

const defaultSource: MediaSource = { id: 'default:sample.mp4', name: 'sample.mp4', url: '/media/sample.mp4' };
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
  const storyGraph=projectState.project?.storyFlow;
  const storyEditor=useStoryEditor(storyGraph,interstitialState.items,projects,interstitials,controller);
  const crossfadeFrames = projectState.project?.crossfadeFrames ?? INTERSTITIAL_CROSSFADE_FRAMES;
  const source = useMemo<MediaSource>(()=>projectState.source??{id:projectState.project?.id??'empty',name:projectState.project?.name??'Untitled project',url:''},[projectState.source,projectState.project?.id,projectState.project?.name]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [startReady, setStartReady] = useState(false);
  const [error, setError] = useState('');
  const [shortcuts, setShortcuts] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
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
  const [sideWidth, setSideWidth] = useState(() => savedSize('sparko:side-width', 330));
  const onPanelColumns = useCallback((count: number) => { if (count === 2) setSideWidth(width => Math.max(width, 580)); }, []);
  const [timelineHeight, setTimelineHeight] = useState(() => savedSize('sparko:story-height', 360));
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const maxSideWidth = Math.max(220, Math.min(700, viewport.width - 340));
  const maxTimelineHeight = Math.max(300, Math.floor(viewport.height * (viewport.width <= 660 ? 0.5 : 0.7)));
  const actualSideWidth = Math.max(220, Math.min(maxSideWidth, sideWidth));
  const minimumTimelineHeight = 280;
  const actualTimelineHeight = Math.max(minimumTimelineHeight, Math.min(maxTimelineHeight, timelineHeight));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('sparko:side-width', String(sideWidth)); localStorage.setItem('sparko:story-height', String(timelineHeight)); } catch { /* The layout still works without persistence. */ }
  }, [sideWidth, timelineHeight]);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const sourceVersion = useRef(0);
  const readyKey = JSON.stringify(interstitialState.items.map(item => ({ id: item.id, kind: item.kind, groupId: item.groupId, label: item.label, time: item.time, loopAudio: item.loopAudio, duration: !playableResult(item) ? item.duration : undefined, result: playableResult(item) })));
  useEffect(()=>{if(info&&projectState.source)projects.initializeStoryFlow(info.duration);},[info,projectState.source,projects]);
  const flow = useMemo(() => storyGraph ? runtimeFlow(storyGraph,interstitialState.items,source.assetId??'',info?.duration??0) : info&&source.assetId?composeFlows(savedFlows, interstitialState.items, source.assetId, info.duration):undefined, [storyGraph,savedFlows, readyKey, info, source.assetId]);
  const composition = useMemo(() => info ? new TimelineComposition(source, info, interstitialState.items, { crossfade, crossfadeFrames, matchFraming }) : null, [source, info, readyKey, crossfade, crossfadeFrames, matchFraming]);
  useEffect(() => { if (!projectState.source) return; if (flow && info) controller.setFlow(flow, info, matchFraming, crossfade, crossfadeFrames); else if (!flow && composition) controller.setComposition(composition); }, [composition, controller, flow, info, matchFraming, crossfade, crossfadeFrames, projectState.source]);
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
  useEffect(() => { let active = true; void getStatus().then(data => {
    if (!active) return;
    setStatus(data);
    if (data.requiresPassword && !data.defaultProject && !sessionStorage.getItem('sparko:password')) setLogin(true);
    return projects.init(defaultSource);
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
    if (!projectState.source) {
      controller.close(); setEngine(null); setInfo(null); setThumbnails([]); setThumbnailsFailed(false);
      setSelectedFlowScene(null); setSelectedFlowEdge(null); setShortcuts(false);
      return;
    }
    const version = ++sourceVersion.current;
    const media = new MediaEngine(source);
    setEngine(media); setInfo(null); setThumbnails([]); setThumbnailsFailed(false); setError('');
    controller.load(source);
    void media.inspect().then(metadata => {
      if (sourceVersion.current !== version) return;
      setInfo(metadata);
      const current = projects.getSnapshot().project;
      if (current?.id === source.id && current.analysis.slice.end > metadata.duration) projects.updateAnalysis({ ...current.analysis, slice: { start: 0, end: metadata.duration } }, false);
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
    if(storyGraph){storyEditor.add('simple');return;}
    if (!info || !projectState.project || projectState.busy) return;
    const item = interstitials.add(controller.getSourceTime(), info.duration);
    controller.pause(); controller.seek(composition?.itemTime(item) ?? item.time);
  };
  const addCallResponse = () => {
    if (!info || !projectState.project || projectState.busy) return;
    const time = controller.getSourceTime(); controller.pause();
    void projects.addCallResponse(time, info.duration).then(pin => { if (pin && !flow) controller.seek(composition?.timelineTime(pin.time) ?? pin.time); });
  };
  const moveInterstitial = (id: string, time: number) => {
    if (!info || projectState.busy) return;
    // Removing the moved scene from this mapping lets its start follow the drop position,
    // including arrow-key moves within the space its old rendered block occupied.
    const remaining = new TimelineComposition(source, info, interstitialState.items.filter(item => item.id !== id));
    interstitials.move(id, Math.max(0, Math.min(remaining.sourceDuration, Math.round(remaining.sourceTime(time) * remaining.fps) / remaining.fps)));
  };
  const removeInterstitial = (id: string) => {
    if(storyGraph){const node=storyGraph.nodes.find(n=>n.interstitialId===id);if(node)void projects.removeStoryNodes([node.id]);return;}
    if (projectState.busy) return;
    if (projectFlows(projectState.project).some(group => group.interstitial.id === id)) {
      controller.pause();
      void projects.removeCallResponse(id).then(removed => {
        if (removed) { setSelectedFlowScene(null); setSelectedFlowEdge(null); }
      });
    } else if (!interstitialState.items.find(item => item.id === id)?.groupId) void interstitials.remove(id);
  };
  const openFile = (file: File) => {
    if (/\.sparko$/i.test(file.name)) void projects.importProject(file); else if(storyGraph)void storyEditor.importVideos([file]);else void projects.openVideo(file);
  };
  const exportProject = async () => {
    const result = await projects.exportProject(); if (!result) return false;
    const url = URL.createObjectURL(result.blob), link = document.createElement('a');
    link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  };
  const saveAsFile = async () => {
    const picker = (window as ProjectPickerWindow).showSaveFilePicker;
    if (!picker) return exportProject();
    try {
      const name = `${(projectState.project?.name || 'project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.sparko`;
      const handle = await picker.call(window, { suggestedName: name, types: projectFileTypes });
      return !!await projects.saveToFile(handle);
    } catch (cause) { if ((cause as DOMException).name !== 'AbortError') setError((cause as Error).message); return false; }
  };
  const saveCurrent = () => {
    if (fileMenu.current) fileMenu.current.open = false;
    const handle = projects.getFileHandle();
    return handle ? projects.saveToFile(handle).then(Boolean) : saveAsFile();
  };
  const closeCurrent = () => {
    if (fileMenu.current) fileMenu.current.open = false;
    if (projects.getSnapshot().dirty) setClosePrompt(true);
    else void projects.closeProject();
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
      onAddAnswer: () => {
        const next = addAnswer(saved), answer = next.interaction.answers.at(-1)!;
        controller.pause(); projects.updateCallResponse(next); setSelectedFlowScene(runtimeId(groupId, answer.sceneId)); setSelectedFlowEdge(null);
        interstitials.select(next.scenes.find(scene => scene.id === answer.sceneId)!.interstitialId!);
      },
      onRemoveAnswer: id => { controller.pause(); setSelectedFlowScene(null); setSelectedFlowEdge(null); interstitials.select(groupId); void projects.removeAnswer(id, groupId); },
      onSelectScene: (id, frame) => {
        const runtime = runtimeId(groupId, id); setSelectedFlowScene(runtime); setSelectedFlowEdge(null);
        interstitials.select(resolved.scenes.find(scene => scene.id === id)?.interstitialId ?? null);
        if (flow?.scenes.some(scene => scene.id === runtime)) controller.seekFlowScene(runtime, frame);
        else controller.seek(composition?.timelineTime(saved.interstitial.time) ?? saved.interstitial.time);
      },
      onSelectEdge: id => {
        const scene = resolved.scenes.find(scene => scene.id === resolved.edges.find(edge => edge.id === id)?.from);
        setSelectedFlowEdge(prefix + id); setSelectedFlowScene(scene ? runtimeId(groupId, scene.id) : null); interstitials.select(scene?.interstitialId ?? null);
      },
      onBranch: (id, outcome) => controller.branchFlow(runtimeId(groupId, id), prefix + outcome),
    };
  });
  const groupForScene = (id: string) => groupTimelines.find(group => group.flow.interstitial.id === flow?.scenes.find(scene => scene.id === id)?.groupId) ?? groupTimelines[0];
  const flowTimeline: FlowTimeline | undefined = flow?.storyGraph ? {flow,session:flow.scenes.some(s=>s.id===player.flow?.sceneId)?player.flow:null,selectedSceneId:storyEditor.selectedId,selectedEdgeId:storyEditor.selectedEdge,selectedInterstitial:false,
    onSelectInterstitial:()=>{},onRemoveInterstitial:()=>storyEditor.remove(),onRenameInterstitial:()=>{},onAddAnswer:()=>{},onRemoveAnswer:()=>{},
    onSelectScene:(id,frame)=>storyEditor.select(id,frame),onSelectEdge:id=>storyEditor.setSelectedEdge(id),onBranch:(id,outcome)=>controller.branchFlow(id,outcome)} : flow && groupTimelines.length ? { ...groupTimelines[0], flow, groups: groupTimelines, session: player.flow, crossfade, crossfadeFrames,
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
  return <div className="app-shell" onBlurCapture={() => projects.endHistoryGroup()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const files=Array.from(event.dataTransfer.files);if(!files.length)return;if(storyGraph&&files.every(file=>!/\.sparko$/i.test(file.name)))void storyEditor.importVideos(files);else openFile(files[0]); }}>
    {!projectState.project ? <ProjectStart projects={projects} state={projectState} ready={startReady} error={visibleError} hasSampleProject={!!status?.defaultProject}
      onNewProject={() => void projects.newProject()} onOpenProject={() => void openProjectFile()}
      onOpenSampleProject={() => { if (status?.defaultProject) void projects.openSampleProject(status.defaultProject.url); }}
      onDismissError={() => { setError(''); controller.clearError(); interstitials.clearError(); projects.clearError(); }} /> : <>
    <header className="menubar" aria-label="Application menu">
      <details className="file-menu" ref={fileMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>File</summary><div className="menu-items" role="menu" aria-label="File">
        <button role="menuitem" disabled={projectState.busy} onClick={closeCurrent}><FolderOpen size={14} />Close project</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { void saveCurrent(); }}><Save size={14} />Save project</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void saveAsFile(); }}><Save size={14} />Save as new file</button>
        <button role="menuitem" disabled={projectState.busy || !projectState.project} onClick={() => { if (fileMenu.current) fileMenu.current.open = false; void exportProject(); }}><Download size={14} />Export project</button>
      </div></details>
      <PlaybackOptions perClip={!!storyGraph} crossfade={crossfade} onCrossfade={setCrossfade} crossfadeFrames={crossfadeFrames} onCrossfadeFrames={value => projects.setCrossfadeFrames(value)} matchFraming={matchFraming} onMatchFraming={setMatchFraming} />
      <div className="history-controls" role="group" aria-label="Edit history">
        <button className="icon-button small" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" title={`${projectState.undoLabel ? `Undo: ${projectState.undoLabel}` : 'Undo'} (Ctrl/Cmd+Z)`}
          disabled={projectState.busy || !projectState.undoLabel} onClick={() => { controller.pause(); void projects.undo(); }}><Undo2 size={14} /></button>
        <button className="icon-button small" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" title={`${projectState.redoLabel ? `Redo: ${projectState.redoLabel}` : 'Redo'} (Ctrl/Cmd+Shift+Z)`}
          disabled={projectState.busy || !projectState.redoLabel} onClick={() => { controller.pause(); void projects.redo(); }}><Redo2 size={14} /></button>
      </div>
      <button className={`menu-button ${shortcuts ? 'selected' : ''}`} aria-expanded={shortcuts} onClick={() => setShortcuts(!shortcuts)}>Shortcuts</button>
      <span className="menu-document">{projectState.fileName || (savedFlow || projectState.project?.name!==source.name.replace(/\.[^.]+$/,'') ? projectState.project?.name : source.name)}</span><span className="menu-app-name">SPARKO</span>
    </header>
    <main className="workspace">
      {visibleError && <div className="error-banner" role="alert"><span>{visibleError}</span><button className="icon-button small" aria-label="Dismiss error" onClick={() => { setError(''); controller.clearError(); interstitials.clearError(); projects.clearError(); }}><X size={16} /></button></div>}
      {projectState.busy && <div className="project-status" role="status"><span className="spinner" /><span>{projectState.message}{projectState.progress !== null ? ` · ${Math.round(projectState.progress * 100)}%` : ''}</span><button className="icon-button small" aria-label="Cancel project operation" onClick={() => projects.cancel()}><X size={14} /></button></div>}
      <div className="workspace-grid" inert={projectState.busy} style={{ '--sidebar-width': `${actualSideWidth}px` } as CSSProperties}><section className="main-column" aria-label="Video player">
        <Player source={source} empty={!projectState.source||storyGraph?.nodes.length===0} info={info} thumbnails={thumbnails} thumbnailsFailed={thumbnailsFailed} interstitials={interstitialState.items} selectedId={interstitialState.selectedId} composition={composition}
          callResponse={flowTimeline}
          storyCanvas={storyGraph&&flow?<StoryCanvas key={`${source.id}:${projectState.activationRevision}`} editor={storyEditor} flow={flow} session={player.flow} height={actualTimelineHeight} maxHeight={maxTimelineHeight} onHeight={setTimelineHeight}/>:undefined}
          subtitle={projectState.subtitle} onSubtitle={file => void projects.setSubtitle(file)}
          controller={controller} onAddInterstitial={addInterstitial} onSeek={time => controller.seek(time)} onError={setError} selection={null}
          onMoveInterstitial={moveInterstitial} onRemoveInterstitial={removeInterstitial} onSelectInterstitial={selectInterstitial}
          timelineHeight={actualTimelineHeight} maxTimelineHeight={maxTimelineHeight} onTimelineHeight={setTimelineHeight} />
        {shortcuts && <div className="shortcuts"><span><kbd>Ctrl/Cmd Z</kbd> Undo</span><span><kbd>Ctrl/Cmd Shift Z</kbd> / <kbd>Ctrl Y</kbd> Redo</span><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Seek 5s</span><span><kbd>J</kbd><kbd>L</kbd> Seek 10s</span><span><kbd>,</kbd><kbd>.</kbd> Step frame</span><span><kbd>N</kbd> New clip</span><span><kbd>C</kbd> Cut tool</span><span><kbd>V</kbd> Select tool</span><span><kbd>H</kbd> Hand tool</span><span><kbd>Space</kbd> + drag to pan</span><span><kbd>Shift F</kbd> Fit selected</span><span>Drag background to select; click to deselect</span><span><kbd>S</kbd> Split at playhead</span><span><kbd>Ctrl/Cmd D</kbd> Duplicate</span><span><kbd>Ctrl/Cmd G</kbd> Group clips</span><span><kbd>Ctrl/Cmd Shift G</kbd> Ungroup</span><span>Right-click for clip actions</span><span><kbd>M</kbd> Mute</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>0–9</kbd> Jump to %</span></div>}
      </section><ResizeHandle orientation="vertical" label="Resize side panel" value={actualSideWidth} min={220} max={maxSideWidth} onChange={setSideWidth} /><aside className="sidebar" aria-label="Library and Inspector">
        {storyGraph?<WorkspacePanels inspectorRevision={storyEditor.inspectorRevision} library={<StoryLibrary editor={storyEditor}/>} inspector={<StoryInspector editor={storyEditor} engine={engine} info={info} status={status}/>} narrow={viewport.width<=660} onColumns={onPanelColumns} onReset={()=>{setSideWidth(330);setTimelineHeight(360);}}/>:<>{panelTimeline && !parentPanelOpen && <CallResponseControls flow={panelTimeline.flow} selectedSceneId={panelTimeline.selectedSceneId} selectedEdgeId={panelTimeline.selectedEdgeId} onChange={value => projects.updateCallResponse(value)} onSelectEdge={panelTimeline.onSelectEdge} />}
        <InterstitialPanel items={interstitialState.items} selectedId={interstitialState.selectedId} controller={interstitials}
          callResponse={panelTimeline} groups={groupTimelines}
          renderClipControls={clipControls}
          connectedIds={groupTimelines.flatMap(group => group.flow.scenes.flatMap(scene => scene.interstitialId ? [scene.interstitialId] : []))}
          engine={engine} info={info} status={status} active onAddRegular={addInterstitial} onAddCallResponse={addCallResponse} onSelect={selectInterstitial} onRemove={removeInterstitial} onPreviewPlay={() => controller.pause()} /></>}
      </aside></div>
    </main></>}
    <input className="sr-only" ref={fileInput} type="file" aria-label="Choose video file" accept="video/*,.mkv" onChange={event => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = ''; }} />
    <input className="sr-only" ref={projectInput} type="file" aria-label="Choose project file" accept=".sparko,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) void projects.importProject(file); event.target.value = ''; }} />
    {closePrompt && <div className="modal-backdrop"><div className="project-card" role="dialog" aria-modal="true" aria-labelledby="close-project-title">
      <h2 id="close-project-title">Save changes before closing?</h2>
      <p className="hint">Changes to {projectState.project?.name || 'this project'} have not been saved to a project file.</p>
      {(projectState.error || error) && <p className="inline-error" role="alert">{projectState.error || error}</p>}
      <div className="close-project-actions">
        <button className="button" disabled={projectState.busy} onClick={() => setClosePrompt(false)}>Cancel</button>
        <button className="button danger" disabled={projectState.busy} onClick={() => { setClosePrompt(false); void projects.closeProject(true); }}>Discard changes</button>
        <button className="button primary" disabled={projectState.busy} onClick={() => { void saveCurrent().then(async saved => {
          if (!saved) return;
          const closed = await projects.closeProject(!(window as ProjectPickerWindow).showSaveFilePicker);
          if (closed) setClosePrompt(false);
        }); }}>Save and close</button>
      </div>
    </div></div>}
    {login && <div className="modal-backdrop"><div className="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title"><h2 id="login-title">Unlock video tools</h2><p className="hint">Enter this workspace’s password to use its AI providers.</p><form onSubmit={event => {
      event.preventDefault(); sessionStorage.setItem('sparko:password', password); setLoginError('');
      void request('/api/session', { method: 'POST' }).then(() => { setLogin(false); setPassword(''); }).catch(err => { sessionStorage.removeItem('sparko:password'); setLoginError(err.message); });
    }}><label className="field">Workspace password<input type="password" autoFocus autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary full-width" type="submit">Unlock</button></form>{loginError && <p className="inline-error" role="alert">{loginError}</p>}</div></div>}
  </div>;
}
