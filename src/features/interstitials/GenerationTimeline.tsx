import { useId, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { DiamondPlus, Pencil, Trash2, Video, X, ZoomIn, ZoomOut } from 'lucide-react';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import type { GenerationReference, InterstitialSettings } from '../../../shared/interstitials';
import { MAX_VIDEO_KEYFRAMES, validateVideoKeyframes, type VideoKeyframe } from '../../../shared/video-keyframes';
import type { ProjectController } from '../project/ProjectController';
import AssetThumbnail from '../project/AssetThumbnail';
import { useGenerationWorkspace } from './GenerationWorkspace';
import VideoKeyframes from './VideoKeyframes';
import ImageKeyframeMenu, { ImageTimelineMenu } from './ImageKeyframeMenu';
import { MaskCurvePanel, type MaskChannel, type MaskCurves } from './MaskCurveEditor';
import { maskVideoBoundaries } from './mask-video-boundaries';
import { generationTimelineSegments, timelineSeconds } from './generation-timeline';
import './generation-timeline.css';
import { enabledImageReferences } from '../../../shared/image-references';
import GenerationPlayer, { type GenerationPlayback } from './GenerationPlayer';
import { createGenerationPreview, generationPreviewReducer, generationEndpointImages, generationInputAtFrame, previewFrames, previewKeyboardFrame, previewOutput } from './generation-preview';
import TimelineVideoProperties from './TimelineVideoProperties';
import { inputMaskCurve, inputMaskStrength, h3MaskGroups } from '../../../shared/generation-inputs';
import { validateTimelineVideos } from '../../../shared/video-references';
import InterstitialTimeField from './InterstitialTimeField';
import { useGenerationDrop } from './useGenerationDrop';
import { useTimelineScrub } from './useTimelineScrub';
import { useTimelineZoom } from './useTimelineZoom';
import GenerationWaveform, { type WaveformClip } from './GenerationWaveform';
import { captureGenerationPromptFrame } from './generation-prompt-frame';

type Selection = 'references' | 'frames' | 'videos' | MaskChannel;
type ImageTarget = { kind: 'keyframe'; id: string } | { kind: 'endpoint'; side: 'start' | 'end' };
type Props = {
  itemId: string; workspace?: boolean; generatedUrl?: string; generatedFrames?: number; upscaledUrl?: string; upscaledFrames?: number; item: InterstitialSettings; projects?: ProjectController; reference?: GenerationReference;
  prefixFrames: number; middleFrames: number; suffixFrames: number;
  videoMs: number; audioMs: number; imageControls?: ReactNode; durationControl: ReactNode;
  onChange: (patch: Partial<InterstitialSettings>) => void;
  onKeyframesChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void;
  onPreviewPlay: () => void;
};

/** One full-render clock for reference footage, image guides and both regeneration masks. */
export default function GenerationTimeline(props: Props) {
  const { item, projects, reference, videoMs, audioMs, onPreviewPlay } = props;
  const count = (value: number, min = 0) => Math.min(COMFY.maxFrames, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
  const prefixFrames = count(props.prefixFrames), middleFrames = count(props.middleFrames, 1), suffixFrames = count(props.suffixFrames);
  const videos = item.timelineVideos ?? [];
  const [videoId, setVideoId] = useState<string>();
  const selectedVideo = videos.find(video => video.id === videoId) ?? videos[0];
  const ranges = videos.filter(v => v.enabled && v.video).map(v => ({ frame: v.frame, frames: v.video!.outFrame - v.video!.inFrame }));
  const preservedFrames = (item.keyframes ?? []).filter(k => k.enabled && k.method === 'frame').map(k => k.frame);
  const keyframes = item.keyframes ?? [], inputFrames = prefixFrames + middleFrames + suffixFrames;
  const before = prefixFrames / TIMELINE_FPS, duration = middleFrames / TIMELINE_FPS, after = suffixFrames / TIMELINE_FPS;
  const [selection, setSelection] = useState<Selection>(keyframes.length ? 'frames' : 'references');
  const [selectedId, setSelectedId] = useState<string | undefined>(keyframes[0]?.id), [segmentId, setSegmentId] = useState<string>();
  const workspace = useGenerationWorkspace();
  const [inline, setInline] = useState(false);
  const expanded = props.workspace || inline;
  const open = () => { if (workspace) workspace.open(props.itemId); else setInline(true); };
  const [preview, dispatchPreview] = useReducer(generationPreviewReducer, undefined, () => createGenerationPreview(inputFrames, prefixFrames + Math.floor(middleFrames / 2), props.generatedUrl, props.generatedFrames, props.upscaledUrl, props.upscaledFrames));
  const { frame: cursorFrame, mode: previewMode } = preview, totalFrames = previewFrames(preview);
  const setCursorFrame = (frame: number) => dispatchPreview({ type: 'seek', frame });
  useLayoutEffect(() => { dispatchPreview({ type: 'configure', inputFrames, generatedUrl: props.generatedUrl, generatedFrames: props.generatedFrames, upscaledUrl: props.upscaledUrl, upscaledFrames: props.upscaledFrames }); },
    [inputFrames, props.generatedUrl, props.generatedFrames, props.upscaledUrl, props.upscaledFrames]);
  useLayoutEffect(() => { dispatchPreview({ type: 'pause' }); }, [reference, item.keyframes, item.timelineVideos, item.imageReferences, item.startImageIndex, item.endImageIndex, item.useInputReference, item.useOutputReference]);
  const playback = useRef<GenerationPlayback>(null), tracks = useRef<HTMLDivElement>(null);
  const onChange: Props['onChange'] = patch => { playback.current?.pause(); props.onChange(patch); };
  const onKeyframesChange: Props['onKeyframesChange'] = update => { playback.current?.pause(); props.onKeyframesChange(update); };
  const { zoom, change: setZoom } = useTimelineZoom(tracks, cursorFrame, totalFrames, !!expanded);
  const seekTo = (frame: number, mode?: 'input') => {
    playback.current?.pause(); dispatchPreview(mode === 'input' ? { type: 'inspect-input', frame } : { type: 'seek', frame });
  };
  const scrub = useTimelineScrub({ track: tracks, frame: cursorFrame, frames: totalFrames, onSeek: seekTo });
  const [videoDrag, setVideoDrag] = useState<{ id: string; frame: number }>();
  const videoGesture = useRef<{ id: string; x: number; frame: number; width: number; next: number; moved: boolean } | undefined>(undefined);
  const [maskPreview, setMaskPreview] = useState<MaskCurves>();
  const [dragFrame, setDragFrame] = useState<{ id: string; frame: number }>();
  const [endpoint, setEndpoint] = useState<'start' | 'end' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: ImageTarget; trigger: HTMLButtonElement }>();
  const [cluster, setCluster] = useState<{ ids: string[]; x: number; y: number; trigger: HTMLButtonElement }>();
  const [laneWidth, setLaneWidth] = useState(0), imageClick = useRef(false);
  const [notice, setNotice] = useState('');
  const videoButtons = useRef(new Map<string, HTMLButtonElement>()), addVideoButton = useRef<HTMLButtonElement>(null);
  const videoClick = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null), markers = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ id: string; startX: number; frame: number; width: number; moved: boolean; previewFrame?: number } | null>(null);
  const maskButtons = useRef<Partial<Record<MaskChannel, HTMLButtonElement | null>>>({}), restoreMask = useRef<MaskChannel | null>(null);
  const previousSelection = useRef<Selection>('references');
  const container = useRef<HTMLDivElement>(null), frameLane = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useLayoutEffect(() => {
    if (!expanded) return;
    container.current?.querySelector<HTMLElement>('.generation-timeline-heading')?.scrollIntoView({ block: 'nearest' });
    container.current?.querySelector<HTMLButtonElement>('.generation-return')?.focus({ preventScroll: true });
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded || !frameLane.current) return;
    const observer = new ResizeObserver(([entry]) => setLaneWidth(entry.contentRect.width));
    observer.observe(frameLane.current); return () => observer.disconnect();
  }, [expanded]);
  const frameGroups: VideoKeyframe[][] = [];
  for (const keyframe of [...keyframes].sort((a, b) => a.frame - b.frame)) {
    const previous = frameGroups.at(-1), last = previous?.at(-1);
    if (last && (Math.min(keyframe.frame, middleFrames - 1) - Math.min(last.frame, middleFrames - 1)) / totalFrames * laneWidth < 40) previous!.push(keyframe);
    else frameGroups.push([keyframe]);
  }
  const segments = generationTimelineSegments(reference, prefixFrames, middleFrames, suffixFrames);
  const library = projects?.getSnapshot().project?.library ?? [];
  const nameFor = (assetId?: string) => library.find(asset => asset.assetId === assetId)?.name;
  const selected = keyframes.find(keyframe => keyframe.id === selectedId) ?? keyframes[0];
  const savedCurves = { video: inputMaskCurve(item.videoMaskCurve, before, after, videoMs, !!ranges.length), audio: inputMaskCurve(item.audioMaskCurve, before, after, audioMs, !!ranges.length) };
  const curves = maskPreview ?? savedCurves;
  const cursor = Math.max(0, Math.min(totalFrames - 1, cursorFrame));
  const percent = (frame: number) => `${frame / totalFrames * 100}%`;
  const isMask = selection === 'video' || selection === 'audio';
  const choose = (value: Selection) => { setMaskPreview(undefined); setSelection(value); setEndpoint(null); setMenu(undefined); setCluster(undefined); };
  const openMask = (channel: MaskChannel) => {
    playback.current?.pause();
    restoreMask.current = channel;
    if (!isMask) previousSelection.current = selection;
    choose(channel);
  };
  const finishMask = () => { container.current?.focus({ preventScroll: true }); choose(previousSelection.current); requestAnimationFrame(() => restoreMask.current && maskButtons.current[restoreMask.current]?.focus({ preventScroll: true })); };
  const close = () => {
    if (isMask) { finishMask(); return; }
    // The overview remains mounted while editing. Restore focus now; a queued
    // callback can steal the user's next story action after this view unmounts.
    (expandButton.current ?? document.querySelector<HTMLButtonElement>('.generation-timeline-summary'))?.focus({ preventScroll: true });
    setInline(false); workspace?.close(); setMenu(undefined); setCluster(undefined);
  };
  const selectVideo = (id: string) => { choose('videos'); setVideoId(id); const video = videos.find(v => v.id === id); if (video) seekTo(prefixFrames + video.frame, 'input'); };
  const removeVideo = (id: string) => {
    const index = videos.findIndex(v => v.id === id), remaining = videos.filter(v => v.id !== id), next = remaining[Math.min(index, remaining.length - 1)];
    onChange({ timelineVideos: remaining }); setVideoId(next?.id); setNotice('Video removed. Undo restores it.');
    requestAnimationFrame(() => (next && videoButtons.current.get(next.id) || addVideoButton.current)?.focus({ preventScroll: true }));
  };
  useLayoutEffect(() => {
    if (!expanded || scrub.active || videoGesture.current || drag.current) return;
    const scroll = container.current?.querySelector<HTMLElement>('.generation-timeline-scroll'), line = container.current?.querySelector<HTMLElement>('.generation-cursor-line');
    if (!scroll || !line) return;
    const view = scroll.getBoundingClientRect(), point = line.getBoundingClientRect().left;
    if (point < view.left + 24 || point > view.right - 24) scroll.scrollLeft += point - (view.left + view.width / 2);
  }, [cursor, totalFrames, expanded, scrub.active]);
  useLayoutEffect(() => {
    if (!isMask || !expanded) return;
    const panel = container.current?.querySelector<HTMLElement>('.generation-mask-editor');
    panel?.scrollIntoView({ block: 'nearest' });
    panel?.querySelector<SVGSVGElement>('[aria-label="Mask value graph"]')?.focus({ preventScroll: true });
  }, [isMask, expanded]);
  const setFrame = (id: string, frame: number) => onKeyframesChange(current => current.map(keyframe => keyframe.id === id ? { ...keyframe, frame } : keyframe));
  const selectImage = (target: ImageTarget) => {
    setNotice('');
    if (target.kind === 'keyframe') {
      choose('frames'); setSelectedId(target.id);
      const keyframe = keyframes.find(value => value.id === target.id);
      if (keyframe) seekTo(prefixFrames + keyframe.frame, 'input');
    } else { choose('references'); setEndpoint(target.side); seekTo(target.side === 'start' ? 0 : inputFrames - 1, 'input'); }
  };
  const removeImage = (target: ImageTarget) => {
    setMenu(undefined); drag.current = null; setDragFrame(undefined);
    if (target.kind === 'keyframe') {
      const index = keyframes.findIndex(value => value.id === target.id), remaining = keyframes.filter(value => value.id !== target.id);
      const next = remaining[Math.min(index, remaining.length - 1)];
      onKeyframesChange(current => current.filter(value => value.id !== target.id));
      setSelectedId(next?.id); choose('frames');
      if (next) setCursorFrame(prefixFrames + next.frame);
      setNotice('Keyframe deleted. Undo restores it.');
      requestAnimationFrame(() => (next && markers.current.get(next.id) || addButton.current)?.focus({ preventScroll: true }));
    } else {
      const side = item.method === 'comfy-loop' ? 'start' : target.side;
      onChange(side === 'start' ? { startImageIndex: undefined, startReferenceType: 'none', useInputReference: false } : { endImageIndex: undefined, endReferenceType: 'none', useOutputReference: false });
      choose('references'); setNotice('Image guide removed. Undo restores it.');
      requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
    }
  };
  const openImageMenu = (trigger: HTMLButtonElement, target: ImageTarget, x?: number, y?: number) => {
    selectImage(target);
    const box = trigger.getBoundingClientRect();
    setMenu({ target, trigger, x: x || box.left, y: y || box.bottom });
  };
  const add = () => {
    const used = new Set(keyframes.filter(keyframe => keyframe.enabled).map(keyframe => keyframe.frame));
    const target = Math.max(0, Math.min(middleFrames - 1, cursor - prefixFrames));
    const frame = Array.from({ length: middleFrames }, (_, i) => i).sort((a, b) => Math.abs(a - target) - Math.abs(b - target)).find(value => !used.has(value));
    if (frame === undefined) return;
    const id = crypto.randomUUID();
    onKeyframesChange(current => current.length < MAX_VIDEO_KEYFRAMES ? [...current, { id, frame, enabled: true }] : current);
    setSelectedId(id); seekTo(prefixFrames + frame, 'input'); choose('frames'); setNotice('');
  };
  const endpointImages = generationEndpointImages(item, inputFrames);
  const selectedEndpoint = selection === 'references' ? endpointImages.find(image => image.side === endpoint) : undefined;
  const selectedKeyframe = selection === 'frames' ? selected : undefined;
  const imageLabel = selectedKeyframe ? `Keyframe ${keyframes.indexOf(selectedKeyframe) + 1}` : selectedEndpoint ? `${item.method === 'comfy-loop' ? 'Loop' : selectedEndpoint.side === 'start' ? 'Start' : 'End'} image` : 'Select an image keyframe';
  const menuTarget = menu?.target;
  const menuKeyframe = menuTarget?.kind === 'keyframe' ? keyframes.find(value => value.id === menuTarget.id) : undefined;
  const previewItem = { ...item,
    keyframes: dragFrame ? keyframes.map(k => k.id === dragFrame.id ? { ...k, frame: dragFrame.frame } : k) : keyframes,
    timelineVideos: videoDrag ? videos.map(v => v.id === videoDrag.id ? { ...v, frame: videoDrag.frame } : v) : videos };
  const previewInput = generationInputAtFrame(previewItem, segments, cursor, prefixFrames, middleFrames, inputFrames, nameFor);
  useLayoutEffect(() => {
    if (expanded) return workspace?.registerFrameCapture(signal => captureGenerationPromptFrame(preview, previewInput, signal));
  }, [expanded, workspace, preview, previewInput]);
  const output = previewOutput(preview);
  const waveformClips: WaveformClip[] = previewMode !== 'input' ? (output ? [{ url: output.url, sourceFrame: 0, startFrame: 0, frames: totalFrames, label: previewMode === 'upscaled' ? '2K video' : 'Generated video' }] : [])
    : [...segments.flatMap(segment => segment.clip && segment.clip.kind !== 'image' && !segment.held ? [{ assetId: segment.clip.assetId, sourceFrame: segment.clip.inFrame, startFrame: segment.startFrame, frames: segment.endFrame - segment.startFrame, label: nameFor(segment.clip.assetId) ?? 'Reference video' }] : []),
      ...videos.flatMap(video => video.enabled && video.video && video.frame < middleFrames ? [{ assetId: video.video.assetId, sourceFrame: video.video.inFrame, startFrame: prefixFrames + video.frame, frames: Math.min(video.video.outFrame - video.video.inFrame, middleFrames - video.frame), label: video.video.name }] : [])];
  const drop = useGenerationDrop({ active: expanded && !isMask, projects, item, prefix: prefixFrames, middle: middleFrames, total: totalFrames, onChange, onKeyframesChange, onFrame: frame => seekTo(frame, 'input'),
    onSelect: (type, id) => { choose(type === 'image' ? 'frames' : 'videos'); if (type === 'image') setSelectedId(id); else setVideoId(id); } });
  let videoError = ''; try { const active = enabledImageReferences(item); validateTimelineVideos(videos, middleFrames); validateVideoKeyframes(keyframes, middleFrames, active.startImageIndex !== undefined, active.endImageIndex !== undefined); } catch (error) { videoError = (error as Error).message; }
  const content = <div className="generation-timeline-editor" data-project-edit data-workspace={expanded} data-mask={isMask} role="region" aria-labelledby={headingId} ref={container} tabIndex={-1}
    onKeyDown={event => {
      if (event.target instanceof Element && event.target.closest('dialog,[popover]')) return;
      // Timeline shortcuts never operate on the hidden story or submit a render.
      if (event.key === ' ') {
        event.stopPropagation();
        if (!isMask && event.target instanceof Element && (event.target === event.currentTarget || event.target.closest('.generation-timeline-tracks'))) {
          event.preventDefault(); if (!event.repeat) playback.current?.toggle();
        }
      }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
      if (event.key === 'Escape' && scrub.active) { event.preventDefault(); event.stopPropagation(); scrub.cancel(); }
      if (event.key === 'Escape' && videoGesture.current) { event.preventDefault(); event.stopPropagation(); setCursorFrame(prefixFrames + videoGesture.current.frame); videoGesture.current = undefined; videoClick.current = true; setVideoDrag(undefined); }
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); setCursorFrame(prefixFrames + drag.current.frame); drag.current = null; imageClick.current = true; setDragFrame(undefined); }
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <header className="generation-timeline-heading"><div><h2 id={headingId}>Generation timeline</h2><span>Full video · {timelineSeconds(totalFrames)}s · 24 fps</span></div>
      <button type="button" className="text-button generation-return" aria-label={isMask ? 'Cancel mask edits' : 'Close generation timeline'} onClick={close}>{isMask ? 'Cancel mask' : 'Back to timeline'}<X size={14}/></button>
    </header>
    <div className="generation-editor-workspace"><GenerationPlayer ref={playback} preview={preview} onAction={dispatchPreview} active={!isMask} input={previewInput} onPlay={onPreviewPlay}/>
    <aside className="generation-selection-panel">
      <div className="generation-inputs-heading">Inputs</div>
      <div className="generation-timeline-properties">
        {!isMask && <>
          {(['start', 'end'] as const).map(side => {
            const start = side === 'start', linked = item.method === 'comfy-loop', field = start || linked ? 'useInputReference' : 'useOutputReference';
            const enabled = item[field] !== false && (start || item.method !== 'comfy-extend');
            return <div className="generation-reference-toggle" key={side}>
              <label title={!start && linked ? 'Uses the start reference’s final pose; these controls are linked.' : undefined}><input type="checkbox" aria-label={`Reference ${side} video`} checked={enabled} onChange={event => onChange({ [field]: event.target.checked, [linked || start ? 'startReferenceType' : 'endReferenceType']: event.target.checked ? 'video' : 'none', [linked || start ? 'startImageIndex' : 'endImageIndex']: undefined, ...(!start && !linked ? { method: event.target.checked ? 'comfy' : 'comfy-extend' } : {}) })}/>{start ? 'Start video' : linked ? 'End · linked' : 'End video'}</label>
              <div inert={!enabled}><InterstitialTimeField name={start ? 'start_range' : 'end_range'} label="Duration" value={start || linked ? item.start_range : item.end_range} min={COMFY.minContextFrames / TIMELINE_FPS} max={4} step={1 / TIMELINE_FPS} onChange={value => onChange({ [linked || start ? 'start_range' : 'end_range']: value })}/></div>
            </div>;
          })}
          <details className="generation-image-references"><summary>Image references <small>{item.imageReferences?.filter(image => image.enabled !== false).length ?? 0}</small></summary>{props.imageControls}</details>
          {selectedEndpoint && <div className="generation-property-actions"><span>{imageLabel}</span><button type="button" className="text-button" onClick={() => removeImage({ kind: 'endpoint', side: selectedEndpoint.side })}>Remove image</button></div>}
        </>}
        {!isMask && !!(keyframes.length || videos.length) && <label className="generation-selected-input">Selected input<select aria-label="Selected generation input" value={selection === 'frames' && selected ? `image:${selected.id}` : selection === 'videos' && selectedVideo ? `video:${selectedVideo.id}` : 'references'} onChange={event => {
          const value = event.target.value;
          if (value.startsWith('image:')) selectImage({ kind: 'keyframe', id: value.slice(6) });
          else if (value.startsWith('video:')) selectVideo(value.slice(6)); else choose('references');
        }}><option value="references">Start / end references</option>
          {keyframes.map((k, i) => <option key={k.id} value={`image:${k.id}`}>Image {i + 1} · {k.image?.name ?? 'Choose image'}</option>)}
          {videos.map((v, i) => <option key={v.id} value={`video:${v.id}`}>Video {i + 1} · {v.video?.name ?? 'Choose video'}</option>)}
        </select></label>}
        {selection === 'frames' && projects && <>
          <VideoKeyframes projects={projects} value={keyframes} selectedId={selectedId} onSelect={id => selectImage({ kind: 'keyframe', id })} middleFrames={middleFrames} prefixFrames={prefixFrames} onChange={onKeyframesChange} onPreviewPlay={onPreviewPlay} onSeek={frame => seekTo(frame, 'input')}/>
          {selectedKeyframe && <button type="button" className="generation-image-delete" aria-label="Delete image keyframe" onClick={() => removeImage({ kind: 'keyframe', id: selectedKeyframe.id })}><Trash2 size={14}/>Delete keyframe</button>}
          {!keyframes.length && <p className="hint">Add a keyframe at the playhead.</p>}
        </>}
        {selection === 'videos' && projects && (selectedVideo ? <>
          <label className="generation-video-select">Video<select aria-label="Selected timeline video" value={selectedVideo.id} onChange={event => selectVideo(event.target.value)}>{videos.map((v, i) => <option key={v.id} value={v.id}>{v.video?.name ?? `Video ${i + 1}`}</option>)}</select></label>
          <TimelineVideoProperties key={selectedVideo.id} value={selectedVideo} prefixFrames={prefixFrames} middleFrames={middleFrames} projects={projects} onPreviewPlay={onPreviewPlay}
            onChange={patch => {
              onChange({ timelineVideos: videos.map(v => v.id === selectedVideo.id ? { ...v, ...patch } : v) });
              if (patch.frame !== undefined || patch.video) seekTo(prefixFrames + (patch.frame ?? selectedVideo.frame), 'input');
            }}
            onDelete={() => removeVideo(selectedVideo.id)}/>
        </> : <p className="hint">Add a video at the playhead.</p>)}
        {isMask && <p className="hint">Edit the selected mask below. 0% keeps input; 100% regenerates.</p>}
        <div className="generation-property-status" role="status">{drop.message || videoError || notice}</div>
      </div>
    </aside></div>
    <div className="generation-timeline-toolbar">
      <button ref={addButton} type="button" className="text-button" onClick={add} disabled={isMask || !projects || keyframes.length >= MAX_VIDEO_KEYFRAMES}><DiamondPlus size={14}/>Add image keyframe</button>
      <button ref={addVideoButton} type="button" className="text-button" disabled={isMask || !projects || videos.length >= 16} onClick={() => { const id = crypto.randomUUID(), frame = Math.max(0, Math.min(middleFrames - 1, cursor - prefixFrames)); onChange({ timelineVideos: [...videos, { id, frame, enabled: true }] }); setVideoId(id); choose('videos'); seekTo(prefixFrames + frame, 'input'); }}><Video size={14}/>Add video</button>
      <div className="generation-duration-control" inert={isMask}>{props.durationControl}</div>
      <div className="generation-zoom" role="group" aria-label="Timeline zoom" title="Ctrl/Cmd + scroll or pinch to zoom at the pointer">
        <button type="button" className="icon-button" aria-label="Zoom out generation timeline" disabled={zoom <= 1} onClick={() => setZoom(zoom / 2)}><ZoomOut size={15}/></button>
        <select aria-label="Generation timeline zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          {![1, 2, 4, 8, 16].includes(zoom) && <option value={zoom}>{zoom}×</option>}
          {[1, 2, 4, 8, 16].map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${value}×`}</option>)}
        </select>
        <button type="button" className="icon-button" aria-label="Zoom in generation timeline" disabled={zoom >= 16} onClick={() => setZoom(zoom * 2)}><ZoomIn size={15}/></button>
      </div>
    </div>
    <div className="generation-timeline-scroll" role="group" aria-label="Generation timeline tracks">
      <div ref={tracks} className="generation-timeline-tracks" style={{ width: `${zoom * 100}%` }} {...drop.handlers}>
        <div className="generation-time-ruler" role="slider" aria-label="Timeline ruler" tabIndex={0} aria-valuemin={0} aria-valuemax={totalFrames - 1} aria-valuenow={cursor} aria-valuetext={`${timelineSeconds(cursor)} seconds, frame ${cursor}`} {...scrub.handlers()}
          onKeyDown={event => {
            const next = previewKeyboardFrame(event.key, event.shiftKey, cursor, totalFrames);
            if (next !== undefined) { event.preventDefault(); event.stopPropagation(); seekTo(next); }
          }}>
          {Array.from({ length: 5 * zoom + 1 }, (_, i) => <span key={i} style={{ left: `${i / (5 * zoom) * 100}%` }}>{timelineSeconds(Math.round(totalFrames * i / (5 * zoom)))}s</span>)}
          <i className="generation-playhead-handle" style={{ left: percent(cursor) }} aria-hidden="true"/>
        </div>
        <div className="generation-footage-lane" role="group" aria-label="Reference and generated footage" tabIndex={-1} {...scrub.handlers(undefined, true)}>
          <button type="button" className="generation-body-segment" hidden={prefixFrames >= totalFrames} disabled={isMask} aria-label="Preview generated section" style={{ left: percent(prefixFrames), width: percent(Math.max(0, Math.min(middleFrames, totalFrames - prefixFrames))) }}
            {...scrub.handlers()}
            onClick={event => { if (event.detail === 0) seekTo(prefixFrames); }}
            title={`${timelineSeconds(prefixFrames)}–${timelineSeconds(prefixFrames + middleFrames)}s · click or drag to preview`}><span>Generated</span></button>
          {segments.filter(segment => segment.startFrame < totalFrames).map(segment => {
            const name = nameFor(segment.clip?.assetId) ?? (segment.side === 'start' ? 'Start reference' : 'End reference');
            return <button type="button" key={segment.id} className="generation-reference-segment" disabled={isMask} data-side={segment.side} data-selected={segmentId === segment.id && selection === 'references'}
              style={{ left: percent(segment.startFrame), width: percent(Math.min(segment.endFrame, totalFrames) - segment.startFrame) }}
              aria-label={`${segment.side === 'start' ? 'Start' : 'End'} reference: ${name}${segment.held ? ' (held frame)' : ''}`}
              title={`${name}${segment.held ? ' · held frame' : ''} · ${timelineSeconds(segment.startFrame)}–${timelineSeconds(segment.endFrame)}s`}
              {...scrub.handlers(() => { choose('references'); setSegmentId(segment.id); })}
              onClick={event => { if (event.detail === 0) { choose('references'); setSegmentId(segment.id); seekTo(segment.startFrame); } }}>
              {segment.clip && <AssetThumbnail asset={{ ...segment.clip, kind: segment.clip.kind ?? 'video' }} kind={segment.clip.kind ?? 'video'} name={name}/>}
              <span>{segment.held ? 'Held frame' : name}</span>
            </button>;
          })}
        </div>
        {!!videos.length && <div className="generation-video-lane" aria-label="Added videos" tabIndex={-1} {...scrub.handlers(undefined, true)}>{videos.map((v, i) => {
          const maxFrame = Math.max(0, middleFrames - (v.video ? v.video.outFrame - v.video.inFrame : 1));
          const frame = videoDrag?.id === v.id ? videoDrag.frame : v.frame;
          return <button type="button" key={v.id} ref={el => { if (el) videoButtons.current.set(v.id, el); else videoButtons.current.delete(v.id); }}
            className="generation-added-video" hidden={prefixFrames + Math.min(frame, middleFrames - 1) >= totalFrames} disabled={isMask} data-selected={selection === 'videos' && selectedVideo?.id === v.id} data-enabled={v.enabled} aria-label={`Select timeline video ${i + 1}`}
            style={{ left: percent(prefixFrames + Math.min(frame, middleFrames - 1)), width: percent(Math.max(0, Math.min(totalFrames - prefixFrames - frame, v.video ? Math.max(1, Math.min(middleFrames - frame, v.video.outFrame - v.video.inFrame)) : 12))) }}
            onClick={() => { if (videoClick.current) { videoClick.current = false; return; } selectVideo(v.id); }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); selectVideo(v.id); videoClick.current = false;
              videoGesture.current = { id: v.id, x: event.clientX, frame: v.frame, next: v.frame, width: event.currentTarget.parentElement!.getBoundingClientRect().width, moved: false };
            }}
            onPointerMove={event => {
              const gesture = videoGesture.current; if (!gesture || gesture.id !== v.id || !gesture.moved && Math.abs(event.clientX - gesture.x) < 3) return;
              gesture.moved = true;
              const frame = Math.max(0, Math.min(maxFrame, gesture.frame + Math.round((event.clientX - gesture.x) / gesture.width * totalFrames)));
              gesture.next = frame; setVideoDrag({ id: v.id, frame }); setCursorFrame(prefixFrames + frame);
            }}
            onPointerUp={() => {
              const gesture = videoGesture.current; videoGesture.current = undefined; setVideoDrag(undefined);
              if (gesture?.moved) { videoClick.current = true; if (gesture.next !== gesture.frame) onChange({ timelineVideos: videos.map(clip => clip.id === v.id ? { ...clip, frame: gesture.next } : clip) }); }
            }}
            onPointerCancel={() => { if (videoGesture.current) setCursorFrame(prefixFrames + videoGesture.current.frame); videoGesture.current = undefined; setVideoDrag(undefined); }}
            onLostPointerCapture={() => { if (videoGesture.current) { setCursorFrame(prefixFrames + videoGesture.current.frame); videoGesture.current = undefined; setVideoDrag(undefined); videoClick.current = true; } }}
            onKeyDown={event => {
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removeVideo(v.id); }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault(); event.stopPropagation(); const frame = Math.max(0, Math.min(maxFrame, v.frame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)));
                onChange({ timelineVideos: videos.map(clip => clip.id === v.id ? { ...clip, frame } : clip) }); setCursorFrame(prefixFrames + frame);
              }
            }}><Video size={14}/><span>{v.video?.name ?? 'Choose video'}</span></button>;
        })}</div>}
        <div className="generation-guides-lane" role="group" aria-label="Timed image guides" ref={frameLane} tabIndex={-1} {...scrub.handlers(undefined, true)}>
          <span className="generation-lane-label">Images</span>
          {!keyframes.length && !endpointImages.length && <span className="generation-empty-images">Add an image to guide a moment</span>}
          {endpointImages.filter(image => image.frame < totalFrames).map(({ side, image, frame }) => <button type="button" key={side} className="generation-image-marker endpoint" disabled={isMask} style={{ left: percent(frame) }}
            data-selected={selectedEndpoint?.side === side} aria-pressed={selectedEndpoint?.side === side} aria-haspopup="menu"
            aria-label={`${side === 'start' ? 'Start' : 'End'} image guide: ${image.name}`} title={`${side} image · ${timelineSeconds(frame)}s`}
            onClick={() => selectImage({ kind: 'endpoint', side })}
            onPointerDown={event => { if (event.button === 2) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); } }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openImageMenu(event.currentTarget, { kind: 'endpoint', side }, event.clientX, event.clientY); }}
            onKeyDown={event => {
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removeImage({ kind: 'endpoint', side }); }
              if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); openImageMenu(event.currentTarget, { kind: 'endpoint', side }); }
            }}>
            <AssetThumbnail asset={{ ...image, kind: 'image' }} kind="image" name={image.name}/>
          </button>)}
          {keyframes.map((keyframe, index) => {
            const group = frameGroups.find(group => group.some(k => k.id === keyframe.id))!;
            const representative = group.find(k => k.id === selectedId) ?? group[0];
            if (representative.id !== keyframe.id) return null;
            const frame = dragFrame?.id === keyframe.id ? dragFrame.frame : keyframe.frame, invalid = frame >= middleFrames;
            const position = prefixFrames + Math.min(frame, middleFrames - 1);
            if (position >= totalFrames) return null;
            return <button key={keyframe.id} ref={element => { if (element) markers.current.set(keyframe.id, element); else markers.current.delete(keyframe.id); }} type="button" className="generation-image-marker" disabled={isMask} data-enabled={keyframe.enabled} data-invalid={invalid}
              data-selected={selected?.id === keyframe.id && selection === 'frames'} aria-pressed={selected?.id === keyframe.id && selection === 'frames'}
              aria-label={`Select image keyframe ${index + 1}`} aria-haspopup="menu" style={{ left: percent(position) }}
              title={`${keyframe.image?.name ?? 'Choose an image'} · ${timelineSeconds(prefixFrames + frame)}s${invalid ? ' · outside the generated section' : ''}`}
              onClick={event => {
                if (imageClick.current) { imageClick.current = false; return; }
                selectImage({ kind: 'keyframe', id: keyframe.id });
                if (group.length > 1) { const box = event.currentTarget.getBoundingClientRect(); setCluster({ ids: group.map(k => k.id), x: box.left, y: box.bottom, trigger: event.currentTarget }); }
              }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openImageMenu(event.currentTarget, { kind: 'keyframe', id: keyframe.id }, event.clientX, event.clientY); }}
              onPointerDown={event => {
                if (event.button === 2) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); return; }
                if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
                selectImage({ kind: 'keyframe', id: keyframe.id });
                imageClick.current = false;
                drag.current = { id: keyframe.id, startX: event.clientX, frame: keyframe.frame, width: frameLane.current!.getBoundingClientRect().width, moved: false };
              }}
              onPointerMove={event => {
                const current = drag.current; if (!current || current.id !== keyframe.id) return;
                if (Math.abs(event.clientX - current.startX) < 3 && !current.moved) return;
                current.moved = true;
                const frame = Math.max(0, Math.min(middleFrames - 1, current.frame + Math.round((event.clientX - current.startX) / current.width * totalFrames)));
                current.previewFrame = frame; setDragFrame({ id: current.id, frame }); setCursorFrame(prefixFrames + frame);
              }}
              onPointerUp={() => { if (!drag.current) return; imageClick.current = drag.current.moved; if (drag.current.moved && drag.current.previewFrame !== undefined) setFrame(drag.current.id, drag.current.previewFrame); drag.current = null; setDragFrame(undefined); }}
              onPointerCancel={() => { if (drag.current) setCursorFrame(prefixFrames + drag.current.frame); drag.current = null; setDragFrame(undefined); imageClick.current = true; }}
              onLostPointerCapture={() => { if (drag.current) { setCursorFrame(prefixFrames + drag.current.frame); drag.current = null; setDragFrame(undefined); imageClick.current = true; } }}
              onKeyDown={event => {
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault(); event.stopPropagation();
                  removeImage({ kind: 'keyframe', id: keyframe.id });
                  return;
                }
                if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
                  event.preventDefault(); event.stopPropagation(); openImageMenu(event.currentTarget, { kind: 'keyframe', id: keyframe.id }); return;
                }
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault(); event.stopPropagation();
                const frame = Math.max(0, Math.min(middleFrames - 1, keyframe.frame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)));
                setFrame(keyframe.id, frame); setCursorFrame(prefixFrames + frame);
              }}>
              {keyframe.image ? <AssetThumbnail asset={{ ...keyframe.image, kind: 'image' }} kind="image" name={keyframe.image.name}/> : <DiamondPlus size={16}/>}
              <small>{index + 1}</small>
              {group.length > 1 && <span className="generation-marker-count" aria-label={`${group.length} nearby keyframes`}>{group.length}</span>}
            </button>;
          })}
        </div>
        <div className="mask-curve-control generation-mask-lanes">{(['video', 'audio'] as const).map(channel => <button key={channel} ref={element => { maskButtons.current[channel] = element; }} type="button" className="generation-mask-lane" disabled={isMask} data-selected={selection === channel} aria-label={`Edit ${channel} mask`} onClick={() => openMask(channel)}>
          <span className="generation-lane-label">{channel === 'video' ? 'Video' : 'Audio'} mask</span>
          <span className="generation-mask-edit">Edit</span>
          <svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true">
            {channel === 'video' && h3MaskGroups(totalFrames).map(group => <line key={group.start} className="mask-frame-group" x1={group.start / totalFrames * 1000} x2={group.start / totalFrames * 1000} y1={0} y2={44}/>)}
            <rect x={prefixFrames / totalFrames * 1000} width={middleFrames / totalFrames * 1000} y={0} height={44} className="mask-generated-region"/>
            <path className="mask-curve-line" d={Array.from({ length: 241 }, (_, i) => `${i ? 'L' : 'M'}${i / 240 * 1000},${39 - inputMaskStrength(curves[channel], i / 240 * totalFrames, prefixFrames, middleFrames, suffixFrames, ranges, channel === 'video' ? preservedFrames : []) * 32}`).join(' ')}/>
          </svg>
        </button>)}</div>
        <div className="generation-audio-lane" role="slider" aria-label="Audio waveform playhead" tabIndex={0} aria-valuemin={0} aria-valuemax={totalFrames - 1} aria-valuenow={cursor} aria-valuetext={`${timelineSeconds(cursor)} seconds, frame ${cursor}`} {...scrub.handlers()}
          onKeyDown={event => {
            const next = previewKeyboardFrame(event.key, event.shiftKey, cursor, totalFrames);
            if (next !== undefined) { event.preventDefault(); event.stopPropagation(); seekTo(next); }
          }}>
          {expanded && <GenerationWaveform clips={waveformClips} frames={totalFrames}/>}
          <span className="generation-lane-label">{previewMode === 'upscaled' ? '2K' : previewMode === 'generated' ? 'Generated' : 'Input'} audio</span>
        </div>
        <div className="generation-timeline-lines" aria-hidden="true">
          {[prefixFrames, prefixFrames + middleFrames].filter(frame => frame > 0 && frame < totalFrames).map(frame => <i className="generation-window-line" key={frame} style={{ left: percent(frame) }}/>)}
          {segments.filter(segment => segment.startFrame !== 0 && segment.startFrame !== prefixFrames + middleFrames).map(segment => <i className="generation-cut-line" key={segment.id} style={{ left: percent(segment.startFrame) }}/>)}
          {keyframes.filter(keyframe => keyframe.enabled && keyframe.frame < middleFrames).map(keyframe => <i className="generation-guide-line" key={keyframe.id} style={{ left: percent(prefixFrames + (dragFrame?.id === keyframe.id ? dragFrame.frame : keyframe.frame)) }}/>)}
          <i className="generation-cursor-line" style={{ left: percent(cursor) }}/>
        </div>
        {(drop.preview || videoDrag || dragFrame || scrub.active) && <output className="generation-placement-time" style={{ left: percent(cursor) }}>{timelineSeconds(cursor)}s · frame {cursor}</output>}
        {drop.preview?.placements.map((p, i) => <div className={`generation-drop-preview ${p.image ? 'image' : 'video'}`} key={i} style={{ left: percent(prefixFrames + p.frame), width: p.image ? 36 : percent(p.frames) }}>
          <AssetThumbnail asset={p.asset} kind={p.image ? 'image' : 'video'} name={p.asset.name}/><span>{p.asset.name}</span>
        </div>)}
      </div>
    </div>
    <div className="generation-drop-status" role="status" title={drop.preview?.error || drop.message}>{drop.busy ? 'Adding media…' : drop.preview?.error || drop.message || (drop.preview ? 'Release to add reference' : 'Drag images or videos from Library onto the timeline')}</div>
    {isMask && <div className="generation-mask-editor"><MaskCurvePanel key={`${selection}:${prefixFrames}:${middleFrames}:${suffixFrames}`} before={before} after={after} duration={duration} videoMs={videoMs} audioMs={audioMs}
      active={selection} initial={savedCurves} onPreview={setMaskPreview} onChange={onChange} onClose={finishMask} allowBody={!!ranges.length}
      boundaries={maskVideoBoundaries(reference, before, duration, after)} imageKeyframes={keyframes.filter(k => k.enabled).map(k => ({ id: k.id, name: k.image?.name ?? 'Image', time: (prefixFrames + k.frame) / TIMELINE_FPS }))}/></div>}
    {menu && <ImageKeyframeMenu x={menu.x} y={menu.y} enabled={menuKeyframe?.enabled} deleteLabel={menu.target.kind === 'keyframe' ? 'Delete keyframe' : `Remove ${item.method === 'comfy-loop' ? 'loop' : menu.target.side} image`}
      onClose={() => setMenu(undefined)} restoreFocus={() => menu.trigger.focus({ preventScroll: true })}
      onDelete={() => removeImage(menu.target)} onToggle={menuKeyframe ? () => {
        onKeyframesChange(current => current.map(value => value.id === menuKeyframe.id ? { ...value, enabled: !value.enabled } : value));
        setMenu(undefined); menu.trigger.focus({ preventScroll: true });
      } : undefined}/>}
    {cluster && <ImageTimelineMenu x={cluster.x} y={cluster.y} label="Nearby image keyframes" onClose={() => setCluster(undefined)} restoreFocus={() => cluster.trigger.focus({ preventScroll: true })}>
      {keyframes.filter(k => cluster.ids.includes(k.id)).map(k => <button type="button" role="menuitem" key={k.id} onClick={() => {
        selectImage({ kind: 'keyframe', id: k.id }); requestAnimationFrame(() => markers.current.get(k.id)?.focus({ preventScroll: true }));
      }}>{keyframes.indexOf(k) + 1}. {k.image?.name ?? 'Choose image'} · {timelineSeconds(prefixFrames + k.frame)}s</button>)}
    </ImageTimelineMenu>}
  </div>;
  if (props.workspace) return content;
  return <div className="generation-timeline">
    <button ref={expandButton} type="button" className="generation-timeline-summary" aria-label="Edit generation timeline" onClick={open}>
      <span className="generation-summary-heading">Timeline <small>{timelineSeconds(totalFrames)}s</small><Pencil size={14}/></span>
      <span className="generation-summary-track"><i style={{ left: percent(prefixFrames), width: percent(middleFrames) }}/>{segments.map(segment => <b key={segment.id} style={{ left: percent(segment.startFrame), width: percent(segment.endFrame - segment.startFrame) }}/>)}</span>
      {!!videos.length && <span className="generation-summary-videos">{videos.filter(v => v.enabled && v.video).map(v => <b key={v.id} title={v.video!.name} style={{ left: percent(prefixFrames + v.frame), width: percent(v.video!.outFrame - v.video!.inFrame) }}/>)}</span>}
      <span className="generation-summary-guides">{keyframes.filter(k => k.enabled).map(k => <i key={k.id} style={{ left: percent(prefixFrames + Math.min(k.frame, middleFrames - 1)) }}/>)}</span>
      {(['video', 'audio'] as const).map(channel => <svg key={channel} viewBox="0 0 500 16" preserveAspectRatio="none" aria-hidden="true"><path d={Array.from({ length: 121 }, (_, i) => `${i ? 'L' : 'M'}${i / 120 * 500},${14 - inputMaskStrength(curves[channel], i / 120 * totalFrames, prefixFrames, middleFrames, suffixFrames, ranges, channel === 'video' ? preservedFrames : []) * 11}`).join(' ')}/></svg>)}
    </button>
    {inline && content}
  </div>;
}
