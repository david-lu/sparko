import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Trash2, Volume2, VolumeX } from 'lucide-react';
import { TIMELINE_FPS as FPS } from '../../../shared/constants';
import { AUDIO_TRACKS, audioClipFrames, audioClipRoom, audioLevel, placeAudioClip, soundLevel, storedVolume, type AudioTrack, type AudioTrackClip } from '../../../shared/audio-tracks';
import type { AssetReference } from '../../../shared/asset-generation';
import AssetInput from '../project/AssetInput';
import { assets } from '../project/assets';
import { useAssetAvailability } from '../project/useAssetAvailability';
import type { ProjectController } from '../project/ProjectController';
import GenerationWaveform from './GenerationWaveform';
import { timelineSeconds } from './generation-timeline';
import type { useTimelineScrub } from './useTimelineScrub';
import type { useGenerationDrop } from './useGenerationDrop';

export type SoundMode = 'input' | 'generated';

/** One audio level: mute, a 0–100% slider and its readout. A slider drag is one undo step. */
export function VolumeRow({ label, name = `${label} volume`, volume, muted, disabled, onChange, onMute, onBoundary }: {
  label: string; name?: string; volume: number; muted?: boolean; disabled?: boolean;
  onChange: (volume: number) => void; onMute?: (muted: boolean) => void; onBoundary?: () => void;
}) {
  const previous = useRef(volume || 1);
  useEffect(() => { if (volume > 0) previous.current = volume; }, [volume]);
  const silent = muted ?? volume === 0, percent = Math.round(audioLevel(volume) * 100), boundary = () => onBoundary?.();
  return <div className="generation-volume-row" data-muted={silent}>
    <button type="button" className="icon-button small" disabled={disabled} aria-label={`${silent ? 'Unmute' : 'Mute'} ${label}`}
      onClick={() => { boundary(); if (onMute) onMute(!silent); else onChange(silent ? previous.current : 0); boundary(); }}>{silent ? <VolumeX size={14}/> : <Volume2 size={14}/>}</button>
    <span title={label}>{label}</span>
    <output aria-hidden="true">{percent}%</output>
    <input type="range" min={0} max={100} step={1} value={percent} disabled={disabled} aria-label={name} aria-valuetext={`${percent}%${muted ? ', muted' : ''}`}
      onPointerDown={boundary} onPointerUp={boundary} onPointerCancel={boundary} onBlur={boundary} onKeyUp={boundary}
      onChange={event => onChange(event.currentTarget.valueAsNumber / 100)}/>
  </div>;
}
export type SoundGesture = { id: string; x: number; frame: number; next: number; width: number; moved: boolean };
const modeLabel = (mode: SoundMode) => mode === 'input' ? 'Input' : 'Generated';

/** One lane per track. Positions are relative to the generated section, drawn on the current preview clock. */
export function AudioTrackLanes({ tracks, mode, body, frames, expanded, disabled, selectedTrackId, selectedSoundId, scrub, drop, drag, gesture, onDrag, onSelect, onMove, onRemove, onCursor }: {
  tracks: AudioTrack[]; mode: SoundMode; body: number; frames: number; expanded: boolean; disabled: boolean;
  selectedTrackId?: string; selectedSoundId?: string;
  scrub: ReturnType<typeof useTimelineScrub>; drop: ReturnType<typeof useGenerationDrop>;
  drag?: { id: string; frame: number }; gesture: MutableRefObject<SoundGesture | undefined>;
  onDrag: (drag?: { id: string; frame: number }) => void; onSelect: (trackId: string, soundId?: string) => void;
  onMove: (trackId: string, soundId: string, frame: number) => void; onRemove: (trackId: string, soundId: string, nextId?: string) => void;
  onCursor: (frame: number) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>()), lanes = useRef(new Map<string, HTMLDivElement>()), clicked = useRef(false);
  const percent = (frame: number) => `${frame / frames * 100}%`;
  const min = -body, max = frames - 1 - body;
  const remove = (track: AudioTrack, clip: AudioTrackClip) => {
    const ordered = [...track.clips].sort((a, b) => a.frame - b.frame), index = ordered.indexOf(clip), rest = ordered.filter(other => other !== clip);
    const next = rest[Math.min(index, rest.length - 1)];
    onRemove(track.id, clip.id, next?.id);
    requestAnimationFrame(() => (next && buttons.current.get(next.id) || lanes.current.get(track.id))?.focus({ preventScroll: true }));
  };
  const cancel = () => { if (!gesture.current) return; onCursor(body + gesture.current.frame); gesture.current = undefined; clicked.current = true; onDrag(undefined); };
  return <>
    {tracks.map(track => {
      const preview = drop.soundPreview?.trackId === track.id ? drop.soundPreview : undefined, label = `${modeLabel(mode)} · ${track.name}`;
      const position = (clip: AudioTrackClip) => body + (drag?.id === clip.id ? drag.frame : clip.frame);
      return <div key={track.id} ref={element => { if (element) lanes.current.set(track.id, element); else lanes.current.delete(track.id); }}
        className="generation-track-lane" role="group" aria-label={`${label} audio track`} tabIndex={-1} data-track-id={track.id}
        data-selected={selectedTrackId === track.id} data-muted={track.muted} data-drop={!!preview}
        {...scrub.handlers(() => onSelect(track.id), true)} {...drop.soundHandlers(track.id)}>
        {expanded && <GenerationWaveform frames={frames} clips={track.clips.map(clip => ({ assetId: clip.assetId, sourceFrame: clip.inFrame, frames: audioClipFrames(clip), startFrame: position(clip), label: clip.name, gain: audioLevel(track.volume) * audioLevel(clip.volume) }))}/>}
        <span className="generation-lane-label">{label}{track.muted ? ' · muted' : ''}</span>
        {!track.clips.length && !preview && <span className="generation-empty-track">Drop audio from Library here, or add a sound in the panel</span>}
        {track.clips.map(clip => <button type="button" key={clip.id} ref={element => { if (element) buttons.current.set(clip.id, element); else buttons.current.delete(clip.id); }}
          className="generation-track-sound" disabled={disabled} data-selected={selectedSoundId === clip.id} data-silent={clip.volume === 0}
          aria-label={`Sound ${clip.name} on ${track.name}`} aria-pressed={selectedSoundId === clip.id}
          title={`${clip.name} · ${timelineSeconds(position(clip))}–${timelineSeconds(position(clip) + audioClipFrames(clip))}s${clip.volume === 0 ? ' · silent' : ''}`}
          style={{ left: percent(position(clip)), width: percent(audioClipFrames(clip)) }}
          onClick={() => { if (clicked.current) { clicked.current = false; return; } onSelect(track.id, clip.id); }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
            onSelect(track.id, clip.id); clicked.current = false;
            gesture.current = { id: clip.id, x: event.clientX, frame: clip.frame, next: clip.frame, width: event.currentTarget.parentElement!.getBoundingClientRect().width, moved: false };
          }}
          onPointerMove={event => {
            const current = gesture.current; if (!current || current.id !== clip.id || !current.moved && Math.abs(event.clientX - current.x) < 3) return;
            current.moved = true;
            current.next = placeAudioClip(track, clip, current.frame + Math.round((event.clientX - current.x) / current.width * frames), min, max);
            onDrag({ id: clip.id, frame: current.next }); onCursor(body + current.next);
          }}
          onPointerUp={() => {
            const current = gesture.current; gesture.current = undefined; onDrag(undefined);
            if (current?.moved) { clicked.current = true; if (current.next !== current.frame) onMove(track.id, clip.id, current.next); }
          }}
          onPointerCancel={cancel} onLostPointerCapture={cancel}
          onKeyDown={event => {
            if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(track, clip); return; }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault(); event.stopPropagation();
            const frame = placeAudioClip(track, clip, clip.frame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1), min, max);
            if (frame !== clip.frame) onMove(track.id, clip.id, frame);
            onCursor(body + frame);
          }}><span>{clip.name}</span></button>)}
        {preview?.placements.map((p, i) => <div key={i} className="generation-sound-drop" style={{ left: percent(body + p.frame), width: percent(p.frames) }}><span>{p.asset.name}</span></div>)}
      </div>;
    })}
  </>;
}

function SecondsField({ label, frames, min, max, onChange }: { label: string; frames: number; min: number; max: number; onChange: (frames: number) => void }) {
  return <label>{label}<input type="number" aria-label={label} step={1 / FPS} min={timelineSeconds(min)} max={timelineSeconds(max)} value={timelineSeconds(frames)}
    onChange={event => { const value = Math.round(event.currentTarget.valueAsNumber * FPS); if (Number.isFinite(value)) onChange(Math.max(min, Math.min(max, value))); }}/></label>;
}

/** Track name, mute and deletion, adding sounds at the playhead, and the selected sound's timing and level. */
export function AudioTrackProperties({ projects, mode, track, sound, body, frames, onTrackChange, onSoundChange, onLevel, onAddSounds, onDeleteTrack, onDeleteSound, onPreviewPlay }: {
  projects: ProjectController; mode: SoundMode; track: AudioTrack; sound?: AudioTrackClip; body: number; frames: number;
  onTrackChange: (patch: Partial<AudioTrack>) => void; onSoundChange: (patch: Partial<AudioTrackClip>) => void;
  /** Level edits keep the preview playing so the mix can be adjusted while listening. */
  onLevel: (track?: Partial<AudioTrack>, sound?: Partial<AudioTrackClip>) => void; onAddSounds: (refs: AssetReference[]) => void;
  onDeleteTrack: () => void; onDeleteSound: () => void; onPreviewPlay: () => void;
}) {
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const commitName = () => { const value = name.trim().slice(0, 200); if (value && value !== track.name) onTrackChange({ name: value }); else setName(track.name); };
  const sourceFrames = sound ? Math.max(sound.outFrame, Math.floor((projects.getSnapshot().project?.library?.find(asset => asset.assetId === sound.assetId)?.duration ?? 0) * FPS)) : 1;
  const room = sound ? audioClipRoom(track, sound) : Infinity;
  return <div className="generation-sound-properties">
    <p className="hint">{mode === 'input' ? 'The model hears this track in its input. Where the audio mask keeps it, the sound stays and the picture is generated to match it.'
      : 'Plays over the generated video wherever it appears in the story. Changes never need a new render.'}</p>
    <label className="generation-sound-name">Track name<input aria-label="Audio track name" value={name} maxLength={200} onChange={event => setName(event.target.value)} onBlur={commitName}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.stopPropagation(); setName(track.name); } }}/></label>
    <VolumeRow label={`Track ${track.name}`} name="Track volume" volume={audioLevel(track.volume)} muted={track.muted} onBoundary={() => projects.endHistoryGroup()}
      onChange={volume => onLevel({ volume: storedVolume(volume) })} onMute={muted => onTrackChange({ muted })}/>
    <div className="generation-property-actions">
      <button type="button" className="text-button" onClick={onDeleteTrack}><Trash2 size={14}/>Delete track</button>
    </div>
    <div className="generation-sound-add"><span>Add sounds at the playhead</span>
      <AssetInput key={track.id} projects={projects} kinds={['audio']} label="sounds" value={[]} multiple maxCount={Math.max(0, AUDIO_TRACKS.maxClips - track.clips.length)}
        onChange={onAddSounds} onPreviewPlay={onPreviewPlay}/></div>
    {sound ? <div className="generation-sound-card" role="group" aria-label={`Sound ${sound.name}`}>
      <strong title={sound.name}>{sound.name}</strong>
      <div className="generation-property-fields">
        <SecondsField label="Start (s)" frames={body + sound.frame} min={0} max={frames - 1} onChange={frame => onSoundChange({ frame: placeAudioClip(track, sound, frame - body, -body, frames - 1 - body) })}/>
        <SecondsField label="Source in (s)" frames={sound.inFrame} min={Math.max(0, sound.outFrame - room)} max={sound.outFrame - 1} onChange={inFrame => onSoundChange({ inFrame })}/>
        <SecondsField label="Source out (s)" frames={sound.outFrame} min={sound.inFrame + 1} max={Math.min(sourceFrames, sound.inFrame + room)} onChange={outFrame => onSoundChange({ outFrame })}/>
      </div>
      <VolumeRow label="Sound" name={`Volume ${sound.name}`} volume={sound.volume} onBoundary={() => projects.endHistoryGroup()} onChange={volume => onLevel(undefined, { volume: audioLevel(volume) })}/>
      <button type="button" className="generation-image-delete" onClick={onDeleteSound}><Trash2 size={14}/>Delete sound</button>
    </div> : <p className="hint">{track.clips.length ? 'Select a sound on this track to edit it.' : 'Add a sound above, or drag audio from the Library onto this track.'}</p>}
  </div>;
}

function SoundPreview({ clip, volume, start, frame, playing }: { clip: AudioTrackClip; volume: number; start: number; frame: number; playing: boolean }) {
  const media = useRef<HTMLAudioElement>(null);
  useAssetAvailability([clip.assetId]);
  const url = assets.url(clip.assetId), inside = frame >= start && frame < start + audioClipFrames(clip), time = (clip.inFrame + frame - start) / FPS;
  useEffect(() => {
    const audio = media.current; if (!audio) return;
    audio.volume = volume;
    if (!playing || !inside) { audio.pause(); return; }
    if (Math.abs(audio.currentTime - time) > .15) audio.currentTime = time;
    if (audio.paused) void audio.play().catch(() => undefined);
  }, [playing, inside, time, volume, url]);
  useEffect(() => { const audio = media.current; return () => audio?.pause(); }, [url]);
  return url ? <audio ref={media} src={url} preload="auto" data-generation-sound=""/> : null;
}

/** Plays the current mode's tracks with the preview transport. Muted tracks and silent sounds are skipped. */
export function TrackAudioPreview({ tracks, body, frame, playing }: { tracks: AudioTrack[]; body: number; frame: number; playing: boolean }) {
  return <div hidden>{tracks.flatMap(track => track.clips.filter(clip => soundLevel(track, clip) > 0)
    .map(clip => <SoundPreview key={clip.id} clip={clip} volume={soundLevel(track, clip)} start={body + clip.frame} frame={frame} playing={playing}/>))}</div>;
}
