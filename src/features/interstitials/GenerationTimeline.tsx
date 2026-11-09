import { useId, useRef, useState, type ReactNode } from 'react';
import { DiamondPlus, Maximize2, Trash2, Video, X } from 'lucide-react';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import type { GenerationReference, InterstitialSettings } from '../../../shared/interstitials';
import { MAX_VIDEO_KEYFRAMES, validateVideoKeyframes, type VideoKeyframe } from '../../../shared/video-keyframes';
import type { ProjectController } from '../project/ProjectController';
import AssetThumbnail from '../project/AssetThumbnail';
import ModalBackdrop from '../../shared/ModalBackdrop';
import VideoKeyframes from './VideoKeyframes';
import ImageKeyframeMenu from './ImageKeyframeMenu';
import { MaskCurvePanel, type MaskChannel, type MaskCurves } from './MaskCurveEditor';
import { maskVideoBoundaries } from './mask-video-boundaries';
import { generationTimelineSegments, timelineSeconds } from './generation-timeline';
import './generation-timeline.css';
import { enabledImageReferences } from '../../../shared/image-references';
import GenerationPlayer, { type InputPreview } from './GenerationPlayer';
import TimelineVideoProperties from './TimelineVideoProperties';
import { inputMaskCurve, inputMaskStrength, h3MaskGroups } from '../../../shared/generation-inputs';
import { validateTimelineVideos } from '../../../shared/video-references';
import InterstitialTimeField from './InterstitialTimeField';

type Selection = 'references' | 'frames' | 'videos' | MaskChannel;
type ImageTarget = { kind: 'keyframe'; id: string } | { kind: 'endpoint'; side: 'start' | 'end' };
type Props = {
  generatedUrl?: string; item: InterstitialSettings; projects?: ProjectController; reference?: GenerationReference;
  prefixFrames: number; middleFrames: number; suffixFrames: number;
  videoMs: number; audioMs: number; imageControls?: ReactNode; durationControl: ReactNode;
  onChange: (patch: Partial<InterstitialSettings>) => void;
  onKeyframesChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void;
  onPreviewPlay: () => void;
};

/** One full-render clock for reference footage, image guides and both regeneration masks. */
export default function GenerationTimeline(props: Props) {
  const { item, projects, reference, videoMs, audioMs, onChange, onKeyframesChange, onPreviewPlay } = props;
  const count = (value: number, min = 0) => Math.min(COMFY.maxFrames, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
  const prefixFrames = count(props.prefixFrames), middleFrames = count(props.middleFrames, 1), suffixFrames = count(props.suffixFrames);
  const videos = item.timelineVideos ?? [];
  const [videoId, setVideoId] = useState<string>();
  const selectedVideo = videos.find(video => video.id === videoId) ?? videos[0];
  const ranges = videos.filter(v => v.enabled && v.video).map(v => ({ frame: v.frame, frames: v.video!.outFrame - v.video!.inFrame }));
  const preservedFrames = (item.keyframes ?? []).filter(k => k.enabled && k.method === 'frame').map(k => k.frame);
  const keyframes = item.keyframes ?? [], totalFrames = prefixFrames + middleFrames + suffixFrames;
  const before = prefixFrames / TIMELINE_FPS, duration = middleFrames / TIMELINE_FPS, after = suffixFrames / TIMELINE_FPS;
  const [selection, setSelection] = useState<Selection>(keyframes.length ? 'frames' : 'references');
  const [selectedId, setSelectedId] = useState<string | undefined>(keyframes[0]?.id), [segmentId, setSegmentId] = useState<string>();
  const [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState(1);
  const [cursorFrame, setCursorFrame] = useState(prefixFrames + Math.floor(middleFrames / 2));
  const [videoDrag, setVideoDrag] = useState<{ id: string; frame: number }>();
  const videoGesture = useRef<{ id: string; x: number; frame: number; width: number; next: number } | undefined>(undefined);
  const [maskPreview, setMaskPreview] = useState<MaskCurves>();
  const [dragFrame, setDragFrame] = useState<{ id: string; frame: number }>();
  const [endpoint, setEndpoint] = useState<'start' | 'end' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: ImageTarget; trigger: HTMLButtonElement }>();
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null), markers = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ id: string; startX: number; frame: number; width: number; moved: boolean; previewFrame?: number } | null>(null);
  const maskButtons = useRef<Partial<Record<MaskChannel, HTMLButtonElement | null>>>({}), restoreMask = useRef<MaskChannel | null>(null);
  const previousSelection = useRef<Selection>('references');
  const container = useRef<HTMLDivElement>(null), frameLane = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const segments = generationTimelineSegments(reference, prefixFrames, middleFrames, suffixFrames);
  const library = projects?.getSnapshot().project?.library ?? [];
  const nameFor = (assetId?: string) => library.find(asset => asset.assetId === assetId)?.name;
  const selected = keyframes.find(keyframe => keyframe.id === selectedId) ?? keyframes[0];
  const savedCurves = { video: inputMaskCurve(item.videoMaskCurve, before, after, videoMs, !!ranges.length), audio: inputMaskCurve(item.audioMaskCurve, before, after, audioMs, !!ranges.length) };
  const curves = maskPreview ?? savedCurves;
  const cursor = Math.max(0, Math.min(totalFrames - 1, cursorFrame));
  const percent = (frame: number) => `${frame / totalFrames * 100}%`;
  const isMask = selection === 'video' || selection === 'audio';
  const choose = (value: Selection) => { setMaskPreview(undefined); setSelection(value); setEndpoint(null); setMenu(undefined); };
  const openMask = (channel: MaskChannel) => {
    restoreMask.current = channel;
    if (!isMask) previousSelection.current = selection;
    choose(channel); setExpanded(true);
  };
  const finishMask = () => { choose(previousSelection.current); requestAnimationFrame(() => restoreMask.current && maskButtons.current[restoreMask.current]?.focus({ preventScroll: true })); };
  const close = () => { setExpanded(false); setMenu(undefined); if (isMask) choose(previousSelection.current); };
  const setFrame = (id: string, frame: number) => onKeyframesChange(current => current.map(keyframe => keyframe.id === id ? { ...keyframe, frame } : keyframe));
  const selectImage = (target: ImageTarget) => {
    setNotice('');
    if (target.kind === 'keyframe') {
      choose('frames'); setSelectedId(target.id);
      const keyframe = keyframes.find(value => value.id === target.id);
      if (keyframe) setCursorFrame(prefixFrames + keyframe.frame);
    } else { choose('references'); setEndpoint(target.side); setCursorFrame(target.side === 'start' ? 0 : totalFrames - 1); }
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
    setSelectedId(id); setCursorFrame(prefixFrames + frame); choose('frames'); setNotice('');
  };
  const seek = (event: { clientX: number }, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setCursorFrame(Math.max(0, Math.min(totalFrames - 1, Math.round((event.clientX - box.left) / box.width * totalFrames))));
  };
  const endpointImages = (['start', 'end'] as const).flatMap(side => {
    const index = side === 'start' ? item.startImageIndex : item.endImageIndex;
    const enabled = side === 'start' ? item.useInputReference === false : item.useOutputReference === false;
    const image = enabled && index !== undefined ? item.imageReferences?.[index] : undefined;
    return image && image.enabled !== false ? [{ side, image, frame: side === 'start' ? 0 : totalFrames - 1 }] : [];
  });
  const selectedEndpoint = selection === 'references' ? endpointImages.find(image => image.side === endpoint) : undefined;
  const selectedKeyframe = selection === 'frames' ? selected : undefined;
  const imageLabel = selectedKeyframe ? `Keyframe ${keyframes.indexOf(selectedKeyframe) + 1}` : selectedEndpoint ? `${item.method === 'comfy-loop' ? 'Loop' : selectedEndpoint.side === 'start' ? 'Start' : 'End'} image` : 'Select an image keyframe';
  const menuTarget = menu?.target;
  const menuKeyframe = menuTarget?.kind === 'keyframe' ? keyframes.find(value => value.id === menuTarget.id) : undefined;
  const selectedInput = keyframes.find(k => k.enabled && k.image && prefixFrames + k.frame === cursor);
  const endpointInput = endpointImages.find(k => k.frame === cursor);
  const videoInput = videos.find(v => v.enabled && v.video && cursor >= prefixFrames + v.frame && cursor < prefixFrames + v.frame + v.video.outFrame - v.video.inFrame);
  const referenceInput = segments.find(s => cursor >= s.startFrame && cursor < s.endFrame);
  const previewInput: InputPreview | undefined = selectedInput?.image ? { assetId: selectedInput.image.assetId, kind: 'image', sourceFrame: 0, label: selectedInput.image.name }
    : endpointInput ? { assetId: endpointInput.image.assetId, kind: 'image', sourceFrame: 0, label: endpointInput.image.name }
    : videoInput?.video ? { assetId: videoInput.video.assetId, sourceFrame: videoInput.video.inFrame + cursor - prefixFrames - videoInput.frame, label: videoInput.video.name }
    : referenceInput?.clip ? { assetId: referenceInput.clip.assetId, kind: referenceInput.clip.kind, sourceFrame: referenceInput.clip.inFrame + (referenceInput.held ? 0 : cursor - referenceInput.startFrame), label: nameFor(referenceInput.clip.assetId) ?? 'Reference', held: referenceInput.held } : undefined;
  let videoError = ''; try { const active = enabledImageReferences(item); validateTimelineVideos(videos, middleFrames); validateVideoKeyframes(keyframes, middleFrames, active.startImageIndex !== undefined, active.endImageIndex !== undefined); } catch (error) { videoError = (error as Error).message; }
  const content = <div className="generation-timeline-editor" data-expanded={expanded} ref={container}
    onKeyDown={event => {
      // The expanded editor is hosted inside the generation form. Enter edits a field, never submits a render.
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); drag.current = null; setDragFrame(undefined); }
    }}>
    <header className="generation-timeline-heading"><div><h2 id={headingId}>Generation timeline</h2><span>Full video · {timelineSeconds(totalFrames)}s · 24 fps</span></div>
      {expanded ? <button type="button" className="icon-button" aria-label="Close generation timeline" onClick={close}><X size={16}/></button>
        : <button ref={expandButton} type="button" className="text-button generation-expand" aria-label="Expand generation timeline" onClick={() => { restoreMask.current = null; setExpanded(true); }}><Maximize2 size={14}/>Expand</button>}
    </header>
    <div className="generation-editor-workspace"><GenerationPlayer frame={cursor} frames={totalFrames} input={previewInput} generatedUrl={props.generatedUrl} onFrame={setCursorFrame} onPlay={onPreviewPlay}/>
    <aside className="generation-selection-panel">
      <nav className="generation-timeline-selection" aria-label="Timeline properties">
        <button type="button" aria-pressed={selection === 'references'} onClick={() => choose('references')}>References</button>
        <button type="button" aria-pressed={selection === 'frames'} onClick={() => choose('frames')}>Keyframes</button>
        <button type="button" aria-pressed={selection === 'videos'} onClick={() => choose('videos')}>Videos</button>
      </nav>
      <div className="generation-timeline-properties">
        {selection === 'references' && <>
          {(['start', 'end'] as const).map(side => {
            const start = side === 'start', field = start ? 'useInputReference' : 'useOutputReference';
            const enabled = item[field] !== false && (start || item.method !== 'comfy-extend');
            return <div className="generation-reference-toggle" key={side}>
              <label><input type="checkbox" aria-label={`Reference ${side} video`} checked={enabled} onChange={event => onChange({ [item.method === 'comfy-loop' ? 'useInputReference' : field]: event.target.checked, [item.method === 'comfy-loop' || start ? 'startReferenceType' : 'endReferenceType']: event.target.checked ? 'video' : 'none', [item.method === 'comfy-loop' || start ? 'startImageIndex' : 'endImageIndex']: undefined })}/>{start ? 'Start video' : 'End video'}</label>
              <div inert={!enabled}><InterstitialTimeField name={start ? 'start_range' : 'end_range'} label="Duration" value={start ? item.start_range : item.end_range} min={COMFY.minContextFrames / TIMELINE_FPS} max={4} step={1 / TIMELINE_FPS} onChange={value => onChange({ [item.method === 'comfy-loop' || start ? 'start_range' : 'end_range']: value })}/></div>
            </div>;
          })}
          <details className="generation-image-references"><summary>Image references <small>{item.imageReferences?.filter(image => image.enabled !== false).length ?? 0}</small></summary>{props.imageControls}</details>
          {selectedEndpoint && <div className="generation-property-actions"><span>{imageLabel}</span><button type="button" className="text-button" onClick={() => removeImage({ kind: 'endpoint', side: selectedEndpoint.side })}>Remove image</button></div>}
        </>}
        {selection === 'frames' && projects && <>
          <VideoKeyframes projects={projects} value={keyframes} selectedId={selectedId} onSelect={id => selectImage({ kind: 'keyframe', id })} middleFrames={middleFrames} prefixFrames={prefixFrames} onChange={onKeyframesChange} onPreviewPlay={onPreviewPlay}/>
          {selectedKeyframe && <button type="button" className="generation-image-delete" aria-label="Delete image keyframe" onClick={() => removeImage({ kind: 'keyframe', id: selectedKeyframe.id })}><Trash2 size={14}/>Delete keyframe</button>}
          {!keyframes.length && <p className="hint">Add a keyframe at the playhead.</p>}
        </>}
        {selection === 'videos' && projects && (selectedVideo ? <>
          <label className="generation-video-select">Video<select aria-label="Selected timeline video" value={selectedVideo.id} onChange={event => setVideoId(event.target.value)}>{videos.map((v, i) => <option key={v.id} value={v.id}>{v.video?.name ?? `Video ${i + 1}`}</option>)}</select></label>
          <TimelineVideoProperties value={selectedVideo} prefixFrames={prefixFrames} middleFrames={middleFrames} projects={projects} onPreviewPlay={onPreviewPlay}
            onChange={patch => onChange({ timelineVideos: videos.map(v => v.id === selectedVideo.id ? { ...v, ...patch } : v) })}
            onDelete={() => { const next = videos.filter(v => v.id !== selectedVideo.id); onChange({ timelineVideos: next }); setVideoId(next[0]?.id); }}/>
        </> : <p className="hint">Add a video at the playhead.</p>)}
        {isMask && <p className="hint">Edit the selected mask below. 0% keeps input; 100% regenerates.</p>}
        <div className="generation-property-status" role="status">{videoError || notice}</div>
      </div>
    </aside></div>
    <div className="generation-timeline-toolbar">
      <button ref={addButton} type="button" className="text-button" onClick={add} disabled={!projects || keyframes.length >= MAX_VIDEO_KEYFRAMES}><DiamondPlus size={14}/>Add image keyframe</button>
      <button type="button" className="text-button" disabled={!projects || videos.length >= 16} onClick={() => { const id = crypto.randomUUID(); onChange({ timelineVideos: [...videos, { id, frame: Math.max(0, Math.min(middleFrames - 1, cursor - prefixFrames)), enabled: true }] }); setVideoId(id); choose('videos'); }}><Video size={14}/>Add video</button>
      <div className="generation-duration-control">{props.durationControl}</div><label>Zoom<select aria-label="Generation timeline zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${value}×`}</option>)}</select></label>
    </div>
    <div className="generation-timeline-scroll" role="group" aria-label="Generation timeline tracks">
      <div className="generation-timeline-tracks" style={{ width: `${zoom * 100}%` }}>
        <div className="generation-time-ruler" onPointerDown={event => seek(event, event.currentTarget)}>
          {Array.from({ length: 5 * zoom + 1 }, (_, i) => <span key={i} style={{ left: `${i / (5 * zoom) * 100}%` }}>{timelineSeconds(Math.round(totalFrames * i / (5 * zoom)))}s</span>)}
        </div>
        <div className="generation-footage-lane" role="group" aria-label="Reference and generated footage">
          <button type="button" className="generation-body-segment" aria-label="Edit generated duration" style={{ left: percent(prefixFrames), width: percent(middleFrames) }} onClick={() => {
            choose('references'); container.current?.querySelector<HTMLInputElement>('[aria-label="Duration"]')?.focus();
          }} title={`${timelineSeconds(prefixFrames)}–${timelineSeconds(prefixFrames + middleFrames)}s · new video and audio`}><span>Generated</span></button>
          {segments.map(segment => {
            const name = nameFor(segment.clip?.assetId) ?? (segment.side === 'start' ? 'Start reference' : 'End reference');
            return <button type="button" key={segment.id} className="generation-reference-segment" data-side={segment.side} data-selected={segmentId === segment.id && selection === 'references'}
              style={{ left: percent(segment.startFrame), width: percent(segment.endFrame - segment.startFrame) }}
              aria-label={`${segment.side === 'start' ? 'Start' : 'End'} reference: ${name}${segment.held ? ' (held frame)' : ''}`}
              title={`${name}${segment.held ? ' · held frame' : ''} · ${timelineSeconds(segment.startFrame)}–${timelineSeconds(segment.endFrame)}s`}
              onClick={() => { choose('references'); setSegmentId(segment.id); }}>
              {segment.clip && <AssetThumbnail asset={{ ...segment.clip, kind: segment.clip.kind ?? 'video' }} kind={segment.clip.kind ?? 'video'} name={name}/>}
              <span>{segment.held ? 'Held frame' : name}</span>
            </button>;
          })}
        </div>
        {!!videos.length && <div className="generation-video-lane" aria-label="Added videos">{videos.map((v, i) => <button type="button" key={v.id} className="generation-added-video" data-selected={selection === 'videos' && videoId === v.id} data-enabled={v.enabled} aria-label={`Select timeline video ${i + 1}`}
          style={{ left: percent(prefixFrames + (videoDrag?.id === v.id ? videoDrag.frame : v.frame)), width: percent(v.video ? Math.max(1, Math.min(middleFrames - v.frame, v.video.outFrame - v.video.inFrame)) : 12) }} onClick={() => { choose('videos'); setVideoId(v.id); setCursorFrame(prefixFrames + v.frame); }}
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); choose('videos'); setVideoId(v.id); videoGesture.current = { id: v.id, x: event.clientX, frame: v.frame, next: v.frame, width: event.currentTarget.parentElement!.getBoundingClientRect().width }; }}
          onPointerMove={event => { const gesture = videoGesture.current; if (!gesture || gesture.id !== v.id) return; const frame = Math.max(0, Math.min(middleFrames - (v.video ? v.video.outFrame - v.video.inFrame : 1), gesture.frame + Math.round((event.clientX - gesture.x) / gesture.width * totalFrames))); gesture.next = frame; setVideoDrag({ id: v.id, frame }); setCursorFrame(prefixFrames + frame); }}
          onPointerUp={() => { const gesture = videoGesture.current; videoGesture.current = undefined; setVideoDrag(undefined); if (gesture && gesture.next !== gesture.frame) onChange({ timelineVideos: videos.map(clip => clip.id === v.id ? { ...clip, frame: gesture.next } : clip) }); }}
          onPointerCancel={() => { videoGesture.current = undefined; setVideoDrag(undefined); }}
          onKeyDown={event => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onChange({ timelineVideos: videos.filter(clip => clip.id !== v.id) }); } }}>
          <Video size={14}/><span>{v.video?.name ?? 'Choose video'}</span></button>)}</div>}
        <div className="generation-guides-lane" role="group" aria-label="Timed image guides" ref={frameLane}
          onPointerDown={event => { if (event.target === event.currentTarget) seek(event, event.currentTarget); }}>
          <span className="generation-lane-label">Images</span>
          {!keyframes.length && !endpointImages.length && <span className="generation-empty-images">Add an image to guide a moment</span>}
          {endpointImages.map(({ side, image, frame }) => <button type="button" key={side} className="generation-image-marker endpoint" style={{ left: percent(frame) }}
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
            const frame = dragFrame?.id === keyframe.id ? dragFrame.frame : keyframe.frame, invalid = frame >= middleFrames;
            const position = prefixFrames + Math.min(frame, middleFrames - 1);
            return <button key={keyframe.id} ref={element => { if (element) markers.current.set(keyframe.id, element); else markers.current.delete(keyframe.id); }} type="button" className="generation-image-marker" data-enabled={keyframe.enabled} data-invalid={invalid}
              data-selected={selected?.id === keyframe.id && selection === 'frames'} aria-pressed={selected?.id === keyframe.id && selection === 'frames'}
              aria-label={`Select image keyframe ${index + 1}`} aria-haspopup="menu" style={{ left: percent(position) }}
              title={`${keyframe.image?.name ?? 'Choose an image'} · ${timelineSeconds(prefixFrames + frame)}s${invalid ? ' · outside the generated section' : ''}`}
              onClick={event => { if (event.detail === 0) selectImage({ kind: 'keyframe', id: keyframe.id }); else { choose('frames'); setSelectedId(keyframe.id); } }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openImageMenu(event.currentTarget, { kind: 'keyframe', id: keyframe.id }, event.clientX, event.clientY); }}
              onPointerDown={event => {
                if (event.button === 2) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); return; }
                if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                selectImage({ kind: 'keyframe', id: keyframe.id });
                drag.current = { id: keyframe.id, startX: event.clientX, frame: keyframe.frame, width: frameLane.current!.getBoundingClientRect().width, moved: false };
              }}
              onPointerMove={event => {
                const current = drag.current; if (!current || current.id !== keyframe.id) return;
                if (Math.abs(event.clientX - current.startX) < 3 && !current.moved) return;
                current.moved = true;
                const frame = Math.max(0, Math.min(middleFrames - 1, current.frame + Math.round((event.clientX - current.startX) / current.width * totalFrames)));
                current.previewFrame = frame; setDragFrame({ id: current.id, frame }); setCursorFrame(prefixFrames + frame);
              }}
              onPointerUp={() => { if (drag.current?.moved && drag.current.previewFrame !== undefined) setFrame(drag.current.id, drag.current.previewFrame); drag.current = null; setDragFrame(undefined); }}
              onPointerCancel={() => { drag.current = null; setDragFrame(undefined); }}
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
            </button>;
          })}
        </div>
        <div className="mask-curve-control generation-mask-lanes">{(['video', 'audio'] as const).map(channel => <button key={channel} ref={element => { maskButtons.current[channel] = element; }} type="button" className="generation-mask-lane" data-selected={selection === channel} aria-label={`Edit ${channel} mask`} onClick={() => openMask(channel)}>
          <span className="generation-lane-label">{channel === 'video' ? 'Video' : 'Audio'} mask</span>
          <span className="generation-mask-edit">Edit</span>
          <svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true">
            {channel === 'video' && h3MaskGroups(totalFrames).map(group => <line key={group.start} className="mask-frame-group" x1={group.start / totalFrames * 1000} x2={group.start / totalFrames * 1000} y1={0} y2={44}/>)}
            <rect x={prefixFrames / totalFrames * 1000} width={middleFrames / totalFrames * 1000} y={0} height={44} className="mask-generated-region"/>
            <path className="mask-curve-line" d={Array.from({ length: 241 }, (_, i) => `${i ? 'L' : 'M'}${i / 240 * 1000},${39 - inputMaskStrength(curves[channel], i / 240 * totalFrames, prefixFrames, middleFrames, suffixFrames, ranges, channel === 'video' ? preservedFrames : []) * 32}`).join(' ')}/>
          </svg>
        </button>)}</div>
        <div className="generation-timeline-lines" aria-hidden="true">
          {[prefixFrames, prefixFrames + middleFrames].filter(frame => frame > 0 && frame < totalFrames).map(frame => <i className="generation-window-line" key={frame} style={{ left: percent(frame) }}/>)}
          {segments.filter(segment => segment.startFrame !== 0 && segment.startFrame !== prefixFrames + middleFrames).map(segment => <i className="generation-cut-line" key={segment.id} style={{ left: percent(segment.startFrame) }}/>)}
          {keyframes.filter(keyframe => keyframe.enabled && keyframe.frame < middleFrames).map(keyframe => <i className="generation-guide-line" key={keyframe.id} style={{ left: percent(prefixFrames + (dragFrame?.id === keyframe.id ? dragFrame.frame : keyframe.frame)) }}/>)}
          <i className="generation-cursor-line" style={{ left: percent(cursor) }}/>
        </div>
      </div>
    </div>
    {isMask && <div className="generation-mask-editor"><MaskCurvePanel key={`${selection}:${prefixFrames}:${middleFrames}:${suffixFrames}`} before={before} after={after} duration={duration} videoMs={videoMs} audioMs={audioMs}
      active={selection} initial={savedCurves} onPreview={setMaskPreview} onChange={onChange} onClose={finishMask} allowBody={!!ranges.length}
      boundaries={maskVideoBoundaries(reference, before, duration, after)} imageKeyframes={keyframes.filter(k => k.enabled).map(k => ({ id: k.id, name: k.image?.name ?? 'Image', time: (prefixFrames + k.frame) / TIMELINE_FPS }))}/></div>}
    {menu && <ImageKeyframeMenu x={menu.x} y={menu.y} enabled={menuKeyframe?.enabled} deleteLabel={menu.target.kind === 'keyframe' ? 'Delete keyframe' : `Remove ${item.method === 'comfy-loop' ? 'loop' : menu.target.side} image`}
      onClose={() => setMenu(undefined)} restoreFocus={() => menu.trigger.focus({ preventScroll: true })}
      onDelete={() => removeImage(menu.target)} onToggle={menuKeyframe ? () => {
        onKeyframesChange(current => current.map(value => value.id === menuKeyframe.id ? { ...value, enabled: !value.enabled } : value));
        setMenu(undefined); menu.trigger.focus({ preventScroll: true });
      } : undefined}/>}
  </div>;
  return <div className="generation-timeline">
    <button ref={expandButton} type="button" className="generation-timeline-summary" aria-label="Expand generation timeline" onClick={() => setExpanded(true)}>
      <span className="generation-summary-heading">Timeline <small>{timelineSeconds(totalFrames)}s</small><Maximize2 size={14}/></span>
      <span className="generation-summary-track"><i style={{ left: percent(prefixFrames), width: percent(middleFrames) }}/>{segments.map(segment => <b key={segment.id} style={{ left: percent(segment.startFrame), width: percent(segment.endFrame - segment.startFrame) }}/>)}</span>
      <span className="generation-summary-guides">{keyframes.filter(k => k.enabled).map(k => <i key={k.id} style={{ left: percent(prefixFrames + Math.min(k.frame, middleFrames - 1)) }}/>)}</span>
      {(['video', 'audio'] as const).map(channel => <svg key={channel} viewBox="0 0 500 16" preserveAspectRatio="none" aria-hidden="true"><path d={Array.from({ length: 121 }, (_, i) => `${i ? 'L' : 'M'}${i / 120 * 500},${14 - inputMaskStrength(curves[channel], i / 120 * totalFrames, prefixFrames, middleFrames, suffixFrames, ranges, channel === 'video' ? preservedFrames : []) * 11}`).join(' ')}/></svg>)}
    </button>
    {expanded && <ModalBackdrop labelledBy={headingId} onCancel={close} restoreFocus={() => expandButton.current?.focus({ preventScroll: true })}>{content}</ModalBackdrop>}
  </div>;
}
