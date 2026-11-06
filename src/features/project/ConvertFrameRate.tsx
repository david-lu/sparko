import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import ModalBackdrop from '../../shared/ModalBackdrop';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import type { MediaMetadata } from './useMediaMetadata';
import { validVideoDimensions, type VideoDimensions } from '../../media/prepareVideo';

export default function ConvertFrameRate({ projects, assetId, source, onConverted, onClose, restoreFocus }: {
  projects: ProjectController; assetId: string; source: MediaMetadata; onConverted: (asset: LibraryAsset) => void; onClose: () => void; restoreFocus: () => void;
}) {
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot), id = useId();
  const [target, setTarget] = useState('24'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [resize, setResize] = useState(false), [locked, setLocked] = useState(true);
  const [width, setWidth] = useState(String(Math.max(2, Math.round(source.width / 2) * 2))), [height, setHeight] = useState(String(Math.max(2, Math.round(source.height / 2) * 2)));
  const [fit, setFit] = useState<VideoDimensions['fit']>('contain');
  const mounted = useRef(true), converting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (converting.current) projects.cancel(); }; }, [projects]);
  const dimensions: VideoDimensions | undefined = resize ? { width: Number(width), height: Number(height), fit: locked ? 'contain' : fit } : undefined;
  const fps = Number(target), valid = Number.isFinite(fps) && fps >= 1 && fps <= 240 && (!dimensions || validVideoDimensions(dimensions));
  const changeWidth = (value: string) => { setWidth(value); if (locked && Number(value) > 0) setHeight(String(Math.max(2, Math.round(Number(value) * source.height / source.width / 2) * 2))); };
  const changeHeight = (value: string) => { setHeight(value); if (locked && Number(value) > 0) setWidth(String(Math.max(2, Math.round(Number(value) * source.width / source.height / 2) * 2))); };
  const name = state.project?.library?.find(asset => asset.assetId === assetId)?.name ?? 'Video';
  const cancel = () => { if (converting.current) projects.cancel(); onClose(); };
  return <ModalBackdrop labelledBy={`${id}-title`} onCancel={cancel} restoreFocus={restoreFocus}>
    <form className="project-card frame-rate-dialog" onSubmit={event => {
      event.preventDefault(); if (!valid || busy || state.busy) return;
      setBusy(true); setError(''); converting.current = true;
      void projects.convertVideoAsset(assetId, fps, dimensions).then(copy => {
        if (!mounted.current) return;
        if (copy) { onClose(); onConverted(copy); }
        else setError(projects.getSnapshot().error ?? 'Conversion cancelled.');
      }).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Unable to convert this video.'); })
        .finally(() => { converting.current = false; if (mounted.current) setBusy(false); });
    }}>
      <h2 id={`${id}-title`}>Convert video</h2>
      <p className="frame-rate-source" title={name}>{name}</p>
      <p className="hint">Original: {source.width} × {source.height}{source.fps ? ` · ${Number(source.fps.toFixed(3))} fps` : ''}</p>
      <label className="inspector-property" htmlFor={`${id}-fps`}><span>Target FPS</span>
        <input autoFocus id={`${id}-fps`} type="number" min={1} max={240} step="any" list={`${id}-rates`} required value={target}
          disabled={busy} aria-describedby={`${id}-help`} onChange={event => setTarget(event.target.value)}/>
      </label>
      <datalist id={`${id}-rates`}>{[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].map(rate => <option key={rate} value={rate}/>)}</datalist>
      <label className="conversion-toggle"><input type="checkbox" checked={resize} disabled={busy} onChange={event => setResize(event.target.checked)}/>Resize video</label>
      <label className="inspector-property"><span>Width (px)</span><input type="number" min={2} max={8192} step={2} required value={width} disabled={!resize || busy} onChange={event => changeWidth(event.target.value)}/></label>
      <label className="inspector-property"><span>Height (px)</span><input type="number" min={2} max={8192} step={2} required value={height} disabled={!resize || busy} onChange={event => changeHeight(event.target.value)}/></label>
      <label className="conversion-toggle"><input type="checkbox" checked={locked} disabled={!resize || busy} onChange={event => {
        setLocked(event.target.checked); if (event.target.checked && Number(width) > 0) setHeight(String(Math.max(2, Math.round(Number(width) * source.height / source.width / 2) * 2)));
      }}/>Lock aspect ratio</label>
      <label className="inspector-property"><span>Fit</span><select aria-label="Fit" value={locked ? 'contain' : fit} disabled={!resize || locked || busy} onChange={event => setFit(event.target.value as VideoDimensions['fit'])}>
        <option value="contain">Fit with black bars</option><option value="cover">Fill and crop</option><option value="fill">Stretch</option>
      </select></label>
      <p id={`${id}-help`} className="hint">Creates a separate Library copy. Playback speed and audio timing stay the same. Dimensions must be even, from 2 to 8192 pixels. Changing FPS drops or repeats frames.</p>
      <div className="frame-rate-feedback" role="status" title={error}>{error}</div>
      <div className="frame-rate-actions"><button className="button" type="button" onClick={cancel}>Cancel</button>
        <button className="button primary" type="submit" disabled={!valid || busy || state.busy} aria-busy={busy}>
          {busy ? state.progress === null ? 'Converting…' : `Converting ${Math.floor(state.progress * 100)}%` : 'Create copy'}
        </button>
      </div>
    </form>
  </ModalBackdrop>;
}
