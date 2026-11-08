import { useId, useRef, useState, type ReactNode } from 'react';
import { DiamondPlus, Maximize2, X } from 'lucide-react';
import { COMFY, TIMELINE_FPS } from '../../../shared/constants';
import type { GenerationReference, InterstitialSettings } from '../../../shared/interstitials';
import { defaultMaskCurve, maskStrength } from '../../../shared/mask-curves';
import { MAX_VIDEO_KEYFRAMES, type VideoKeyframe } from '../../../shared/video-keyframes';
import type { ProjectController } from '../project/ProjectController';
import AssetThumbnail from '../project/AssetThumbnail';
import AssetPreviewButton from '../project/AssetPreviewButton';
import ModalBackdrop from '../../shared/ModalBackdrop';
import VideoKeyframes from './VideoKeyframes';
import { MaskCurvePanel, type MaskChannel, type MaskCurves } from './MaskCurveEditor';
import { maskVideoBoundaries } from './mask-video-boundaries';
import { generationTimelineSegments, timelineSeconds } from './generation-timeline';
import './generation-timeline.css';

type Selection = 'references' | 'frames' | MaskChannel;
type Props = {
  item: InterstitialSettings; projects?: ProjectController; reference?: GenerationReference;
  prefixFrames: number; middleFrames: number; suffixFrames: number;
  videoMs: number; audioMs: number; referenceControls: ReactNode; durationControl: ReactNode; transitionControls: ReactNode;
  onChange: (patch: Partial<InterstitialSettings>) => void;
  onKeyframesChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void;
  onPreviewPlay: () => void;
};

/** One full-render clock for reference footage, image guides and both regeneration masks. */
export default function GenerationTimeline(props: Props) {
  const { item, projects, reference, videoMs, audioMs, onChange, onKeyframesChange, onPreviewPlay } = props;
  const count = (value: number, min = 0) => Math.min(COMFY.maxFrames, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
  const prefixFrames = count(props.prefixFrames), middleFrames = count(props.middleFrames, 1), suffixFrames = count(props.suffixFrames);
  const keyframes = item.keyframes ?? [], totalFrames = prefixFrames + middleFrames + suffixFrames;
  const before = prefixFrames / TIMELINE_FPS, duration = middleFrames / TIMELINE_FPS, after = suffixFrames / TIMELINE_FPS;
  const [selection, setSelection] = useState<Selection>(keyframes.length ? 'frames' : 'references');
  const [selectedId, setSelectedId] = useState<string | undefined>(keyframes[0]?.id), [segmentId, setSegmentId] = useState<string>();
  const [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState(1);
  const [cursorFrame, setCursorFrame] = useState(prefixFrames + Math.floor(middleFrames / 2));
  const [maskPreview, setMaskPreview] = useState<MaskCurves>();
  const [dragFrame, setDragFrame] = useState<{ id: string; frame: number }>();
  const drag = useRef<{ id: string; startX: number; frame: number; width: number; moved: boolean; previewFrame?: number } | null>(null);
  const maskButtons = useRef<Partial<Record<MaskChannel, HTMLButtonElement | null>>>({}), restoreMask = useRef<MaskChannel | null>(null);
  const previousSelection = useRef<Selection>('references'), maskOpened = useRef(false);
  const container = useRef<HTMLDivElement>(null), frameLane = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const segments = generationTimelineSegments(reference, prefixFrames, middleFrames, suffixFrames);
  const library = projects?.getSnapshot().project?.library ?? [];
  const nameFor = (assetId?: string) => library.find(asset => asset.assetId === assetId)?.name;
  const selected = keyframes.find(keyframe => keyframe.id === selectedId) ?? keyframes[0];
  const savedCurves = { video: item.videoMaskCurve ?? defaultMaskCurve(before, after, videoMs), audio: item.audioMaskCurve ?? defaultMaskCurve(before, after, audioMs) };
  const curves = maskPreview ?? savedCurves;
  const cursor = Math.max(0, Math.min(totalFrames - 1, cursorFrame));
  const percent = (frame: number) => `${frame / totalFrames * 100}%`;
  const isMask = selection === 'video' || selection === 'audio';
  const choose = (value: Selection) => { setMaskPreview(undefined); setSelection(value); };
  const openMask = (channel: MaskChannel) => {
    restoreMask.current = channel;
    if (!isMask) previousSelection.current = selection;
    maskOpened.current = !expanded;
    choose(channel); setExpanded(true);
  };
  const finishMask = () => {
    choose(previousSelection.current);
    if (maskOpened.current) setExpanded(false);
  };
  const close = () => { setExpanded(false); if (isMask) choose(previousSelection.current); };
  const setFrame = (id: string, frame: number) => onKeyframesChange(current => current.map(keyframe => keyframe.id === id ? { ...keyframe, frame } : keyframe));
  const add = () => {
    const used = new Set(keyframes.filter(keyframe => keyframe.enabled).map(keyframe => keyframe.frame));
    const target = Math.max(0, Math.min(middleFrames - 1, cursor - prefixFrames));
    const frame = Array.from({ length: middleFrames }, (_, i) => i).sort((a, b) => Math.abs(a - target) - Math.abs(b - target)).find(value => !used.has(value));
    if (frame === undefined) return;
    const id = crypto.randomUUID();
    onKeyframesChange(current => current.length < MAX_VIDEO_KEYFRAMES ? [...current, { id, frame, enabled: true }] : current);
    setSelectedId(id); setCursorFrame(prefixFrames + frame); choose('frames');
  };
  const seek = (event: { clientX: number }, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setCursorFrame(Math.max(0, Math.min(totalFrames - 1, Math.round((event.clientX - box.left) / box.width * totalFrames))));
  };
  const endpointImages = (['start', 'end'] as const).flatMap(side => {
    const index = side === 'start' ? item.startImageIndex : item.endImageIndex;
    const enabled = side === 'start' ? item.useInputReference === false : item.useOutputReference === false;
    const image = enabled && index !== undefined ? item.imageReferences?.[index] : undefined;
    return image ? [{ side, image, frame: side === 'start' ? 0 : totalFrames - 1 }] : [];
  });
  const selectedSegment = segments.find(segment => segment.id === segmentId);
  const content = <div className="generation-timeline-editor" data-expanded={expanded} ref={container}
    onKeyDown={event => {
      // The expanded editor is hosted inside the generation form. Enter edits a field, never submits a render.
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); drag.current = null; setDragFrame(undefined); }
    }}>
    <header className="generation-timeline-heading"><div><h2 id={headingId}>Generation timeline</h2><span>Full video · {timelineSeconds(totalFrames)}s · 24 fps</span></div>
      {expanded ? <button type="button" className="icon-button" aria-label="Close generation timeline" onClick={close}><X size={16}/></button>
        : <button ref={expandButton} type="button" className="icon-button" aria-label="Expand generation timeline" onClick={() => { restoreMask.current = null; setExpanded(true); }}><Maximize2 size={14}/></button>}
    </header>
    <div className="generation-timeline-toolbar">
      <button type="button" className="text-button" onClick={add} disabled={!projects || keyframes.length >= MAX_VIDEO_KEYFRAMES}><DiamondPlus size={14}/>Add image keyframe</button>
      <label>Zoom<select aria-label="Generation timeline zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${value}×`}</option>)}</select></label>
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
        <div className="generation-guides-lane" role="group" aria-label="Timed image guides" ref={frameLane}
          onPointerDown={event => { if (event.target === event.currentTarget) seek(event, event.currentTarget); }}>
          <span className="generation-lane-label">Images</span>
          {endpointImages.map(({ side, image, frame }) => <button type="button" key={side} className="generation-image-marker endpoint" style={{ left: percent(frame) }}
            aria-label={`${side === 'start' ? 'Start' : 'End'} image guide: ${image.name}`} title={`${side} image · ${timelineSeconds(frame)}s`} onClick={() => choose('references')}>
            <AssetThumbnail asset={{ ...image, kind: 'image' }} kind="image" name={image.name}/>
          </button>)}
          {keyframes.map((keyframe, index) => {
            const frame = dragFrame?.id === keyframe.id ? dragFrame.frame : keyframe.frame, invalid = frame >= middleFrames;
            const position = prefixFrames + Math.min(frame, middleFrames - 1);
            return <button key={keyframe.id} type="button" className="generation-image-marker" data-enabled={keyframe.enabled} data-invalid={invalid}
              data-selected={selected?.id === keyframe.id && selection === 'frames'} aria-pressed={selected?.id === keyframe.id && selection === 'frames'}
              aria-label={`Select image keyframe ${index + 1}`} style={{ left: percent(position) }}
              title={`${keyframe.image?.name ?? 'Choose an image'} · ${timelineSeconds(prefixFrames + frame)}s${invalid ? ' · outside the generated section' : ''}`}
              onClick={event => { choose('frames'); setSelectedId(keyframe.id); if (event.detail === 0) setCursorFrame(prefixFrames + keyframe.frame); }}
              onPointerDown={event => {
                if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                choose('frames'); setSelectedId(keyframe.id); setCursorFrame(prefixFrames + keyframe.frame);
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
                  onKeyframesChange(current => current.filter(value => value.id !== keyframe.id));
                  return;
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
        <div className="mask-curve-control generation-mask-lanes">{(['video', 'audio'] as const).map(channel => <button key={channel} ref={element => { maskButtons.current[channel] = element; }} type="button" className="generation-mask-lane" aria-label={`Edit ${channel} mask`} onClick={() => openMask(channel)}>
          <span className="generation-lane-label">{channel === 'video' ? 'Video' : 'Audio'} mask</span>
          <svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true">
            <rect x={prefixFrames / totalFrames * 1000} width={middleFrames / totalFrames * 1000} y={0} height={44} className="mask-generated-region"/>
            <path className="mask-curve-line" d={Array.from({ length: 241 }, (_, i) => `${i ? 'L' : 'M'}${i / 240 * 1000},${39 - maskStrength(curves[channel], i / 240 * totalFrames / TIMELINE_FPS, before, duration, after) * 32}`).join(' ')}/>
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
    <div className="generation-cursor"><span>{timelineSeconds(cursor)}s</span><input type="range" aria-label="Generation timeline playhead" min={0} max={totalFrames - 1} step={1} value={cursor} onChange={event => setCursorFrame(event.currentTarget.valueAsNumber)}/><span>0% keep · 100% regenerate</span></div>
    <div className="generation-timeline-selection" role="group" aria-label="Timeline properties">
      <button type="button" aria-pressed={selection === 'references'} onClick={() => choose('references')}>References</button>
      <button type="button" aria-pressed={selection === 'frames'} onClick={() => choose('frames')}>Image frames ({keyframes.length})</button>
      <span>{timelineSeconds(middleFrames)}s generated</span>
    </div>
    <div className="generation-timeline-properties">
      {selection === 'references' && <>
        {selectedSegment?.clip && <div className="generation-selected-reference"><span>{nameFor(selectedSegment.clip.assetId) ?? 'Reference'} · {timelineSeconds(selectedSegment.startFrame)}–{timelineSeconds(selectedSegment.endFrame)}s
          <small>{selectedSegment.held ? 'Held last frame' : `Source ${timelineSeconds(selectedSegment.clip.inFrame)}–${timelineSeconds(selectedSegment.clip.outFrame)}s`}</small></span>
          <AssetPreviewButton assetId={selectedSegment.clip.assetId} kind={selectedSegment.clip.kind ?? 'video'} name={nameFor(selectedSegment.clip.assetId) ?? 'Reference'} onPlay={onPreviewPlay}/></div>}
        {props.referenceControls}
      </>}
      {selection === 'frames' && projects && <>
        {!keyframes.length && <p className="hint">Move the playhead to a moment in the generated section, then add an image keyframe. Drag image markers or use the time fields to position them.</p>}
        <VideoKeyframes projects={projects} value={keyframes} selectedId={selectedId} onSelect={id => { setSelectedId(id); const keyframe = keyframes.find(value => value.id === id); if (keyframe) setCursorFrame(prefixFrames + keyframe.frame); }} middleFrames={middleFrames} prefixFrames={prefixFrames} onChange={onKeyframesChange} onPreviewPlay={onPreviewPlay}/>
      </>}
      {isMask && <MaskCurvePanel key={`${selection}:${prefixFrames}:${middleFrames}:${suffixFrames}`} before={before} after={after} duration={duration} videoMs={videoMs} audioMs={audioMs}
        active={selection} initial={savedCurves} onPreview={setMaskPreview} onChange={onChange} onClose={finishMask}
        boundaries={maskVideoBoundaries(reference, before, duration, after)}
        imageKeyframes={keyframes.filter(keyframe => keyframe.enabled && keyframe.frame < middleFrames).map(keyframe => ({ id: keyframe.id, name: keyframe.image?.name ?? 'Image', time: (prefixFrames + keyframe.frame) / TIMELINE_FPS }))}/>}
    </div>
    <div className="generation-timeline-duration">{props.durationControl}</div>
    {selection === 'references' && props.transitionControls}
    <p className="generation-timeline-help">Start and end footage, image guides, and both masks share the full-video clock. Image guides add no duration or audio. The generated section stays at 100% regeneration.</p>
  </div>;
  return <div className="generation-timeline">
    {expanded ? <><button ref={expandButton} type="button" className="button full-width" onClick={close}>Generation timeline is open</button>
      <ModalBackdrop labelledBy={headingId} onCancel={close} restoreFocus={() => queueMicrotask(() => (restoreMask.current ? maskButtons.current[restoreMask.current] : expandButton.current)?.focus({ preventScroll: true }))}>{content}</ModalBackdrop></> : content}
  </div>;
}
