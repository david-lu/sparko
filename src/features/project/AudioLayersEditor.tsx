import { Copy, Music, Pause, Play, RotateCcw, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TIMELINE_FPS as FPS } from '../../../shared/constants';
import ModalBackdrop from '../../shared/ModalBackdrop';
import AssetInput from './AssetInput';
import { assets } from './assets';
import { useAssetAvailability } from './useAssetAvailability';
import type { ProjectController } from './ProjectController';
import { audioLayerEnd, type AudioLayer } from './audioLayers';
import './audio-layers.css';
import type { VideoPlayerController } from '../player/VideoPlayerController';

function TimeField({ label, frames, min = 0, max = 1e8, onChange }: {
  label: string; frames: number; min?: number; max?: number; onChange: (frames: number) => void;
}) {
  const [value, setValue] = useState((frames / FPS).toFixed(3));
  useEffect(() => setValue((frames / FPS).toFixed(3)), [frames]);
  const commit = () => {
    const parsed = Number(value);
    const next = value.trim() && Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed * FPS))) : frames;
    setValue((next / FPS).toFixed(3));
    if (next !== frames) onChange(next);
  };
  return <label>{label}<input type="number" step={1 / FPS} min={min / FPS} max={max / FPS} value={value}
    onChange={event => setValue(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/></label>;
}

function LayerRow({ layer, total, sourceFrames, disabled, update, remove, duplicate }: {
  layer: AudioLayer; total: number; sourceFrames: number; disabled: boolean;
  update: (patch: Partial<AudioLayer>) => void; remove: () => void; duplicate: () => void;
}) {
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const dragging = useRef<{ x: number; start: number; scale: number; frame: number } | null>(null);
  const duration = layer.outFrame - layer.inFrame, start = dragFrame ?? layer.startFrame;
  const unavailable = assets.error(layer.assetId);
  return <fieldset className={`audio-layer${layer.muted ? ' is-muted' : ''}`} disabled={disabled} aria-label={`Audio layer ${layer.name}`}>
    <div className="audio-layer-heading"><Music size={15}/><strong title={layer.name}>{layer.name}</strong>
      <button type="button" className="icon-button small" aria-label={`Mute ${layer.name}`} aria-pressed={layer.muted} onClick={() => update({ muted: !layer.muted })}>{layer.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button>
      <button type="button" className="icon-button small" aria-label={`Duplicate ${layer.name}`} onClick={duplicate}><Copy size={14}/></button>
      <button type="button" className="icon-button small" aria-label={`Remove ${layer.name}`} onClick={remove}><Trash2 size={14}/></button>
    </div>
    <div className="audio-layer-track">
      <button type="button" className="audio-layer-bar" role="slider" aria-label={`Position ${layer.name}`} aria-valuemin={0}
        aria-valuemax={Math.max(0, total - duration) / FPS} aria-valuenow={start / FPS} aria-valuetext={`${(start / FPS).toFixed(3)} seconds`}
        style={{ left: `${start / total * 100}%`, width: `${duration / total * 100}%` }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
          dragging.current = { x: event.clientX, start: layer.startFrame, scale: total / width, frame: layer.startFrame };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragging.current; if (!drag) return;
          drag.frame = Math.max(0, Math.min(total - duration, Math.round(drag.start + (event.clientX - drag.x) * drag.scale)));
          setDragFrame(drag.frame);
        }}
        onPointerUp={() => { const drag = dragging.current; dragging.current = null; setDragFrame(null); if (drag && drag.frame !== layer.startFrame) update({ startFrame: drag.frame }); }}
        onPointerCancel={() => { dragging.current = null; setDragFrame(null); }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          update({ startFrame: Math.max(0, Math.min(total - duration, event.key === 'Home' ? 0 : event.key === 'End' ? total - duration
            : layer.startFrame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? FPS : 1))) });
        }}><span>{(duration / FPS).toFixed(2)} s</span></button>
    </div>
    <div className="audio-layer-controls">
      <TimeField label="Start (s)" frames={layer.startFrame} onChange={startFrame => update({ startFrame })}/>
      <TimeField label="In (s)" frames={layer.inFrame} max={layer.outFrame - 1} onChange={inFrame => update({ inFrame })}/>
      <TimeField label="Out (s)" frames={layer.outFrame} min={layer.inFrame + 1} max={sourceFrames} onChange={outFrame => update({ outFrame })}/>
      <label className="audio-layer-volume">Volume · {Math.round(layer.volume * 100)}%<input type="range" aria-label={`Volume ${layer.name}`} min={0} max={100} step={1} value={Math.round(layer.volume * 100)} onChange={event => update({ volume: Number(event.target.value) / 100 })}/></label>
    </div>
    {unavailable && <p className="audio-layer-error">{unavailable} Restore the file, mute or remove this layer.</p>}
  </fieldset>;
}

export default function AudioLayers({ projects, player, duration = 0 }: { projects: ProjectController; player: VideoPlayerController; duration?: number }) {
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot);
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null), id = useId();
  const layers = state.project?.audioLayers ?? [];
  useAssetAvailability(layers.map(layer => layer.assetId));
  useEffect(() => { setOpen(false); setError(''); }, [state.activationRevision]);
  const total = Math.max(FPS, Math.ceil(duration * FPS), ...layers.map(audioLayerEnd)) + FPS;
  const change = (edit: (current: AudioLayer[]) => AudioLayer[]) => {
    try { projects.setAudioLayers(edit(projects.getSnapshot().project?.audioLayers ?? [])); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to update audio layers.'); }
  };
  return <>
    <button type="button" ref={trigger} className="button small" aria-label="Edit audio layers" disabled={!state.project}
      onClick={() => { player.pause(); setOpen(true); }}><Music size={14}/>Audio layers{layers.length ? ` (${layers.length})` : ''}</button>
    {open && createPortal(<ModalBackdrop labelledBy={`${id}-title`} onCancel={() => setOpen(false)} restoreFocus={() => trigger.current?.focus()}>
      <section className="project-card audio-layers-dialog" data-project-edit>
        <div className="audio-layers-heading"><h2 id={`${id}-title`}>Audio layers</h2><button type="button" className="icon-button" aria-label="Close audio layers" onClick={() => setOpen(false)}><X size={18}/></button></div>
        <p className="hint">Layer music, voiceover, and sound effects over your video. Layers mix together and continue across cuts. Start times use elapsed project playback; branches and repeated clips do not restart the audio.</p>
        <AssetInput key={`${state.project?.id}:${state.activationRevision}`} label="audio layers" projects={projects} kinds={['audio']} value={[]} multiple maxCount={Math.max(0, 1000 - layers.length)}
          onChange={references => { projects.endHistoryGroup(); projects.addAudioLayers(references.map(ref => ref.assetId)); projects.endHistoryGroup(); }} onPreviewPlay={() => player.pause()}/>
        <div className="audio-layers-transport">
          <button type="button" className="button small" disabled={!duration || state.busy} onClick={() => player.togglePlayback()}>{playback.playing ? <Pause size={14}/> : <Play size={14}/>} {playback.playing ? 'Pause audio preview' : 'Play with audio layers'}</button>
          <button type="button" className="icon-button small" disabled={!duration || state.busy} aria-label="Restart audio preview" onClick={() => { player.seek(0); void player.play(); }}><RotateCcw size={14}/></button>
          <span>{((playback.flow?.elapsedFrames ?? playback.time * FPS) / FPS).toFixed(2)} s</span>
        </div>
        <div className="audio-layers-feedback" role="status" title={error || playback.error || undefined}>{error || playback.error}</div>
        <div className="audio-layers-list" aria-label="Soundtrack layers">
          <div className="audio-layers-scale" aria-hidden><span>0 s</span><span>{(total / FPS).toFixed(2)} s</span></div>
          {!layers.length && <p className="hint">Add audio files above. Each file gets its own layer; drag a bar or edit Start to position it.</p>}
          {layers.map(layer => <LayerRow key={layer.id} layer={layer} total={total} disabled={state.busy}
            sourceFrames={Math.max(1, Math.floor((state.project?.library?.find(asset => asset.assetId === layer.assetId)?.duration ?? layer.outFrame / FPS) * FPS))}
            update={patch => change(current => current.map(item => item.id === layer.id ? { ...item, ...patch } : item))}
            remove={() => change(current => current.filter(item => item.id !== layer.id))}
            duplicate={() => change(current => [...current, { ...layer, id: crypto.randomUUID() }])}/>)}
        </div>
      </section>
    </ModalBackdrop>, document.body)}
  </>;
}
