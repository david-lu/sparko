import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import ModalBackdrop from '../../shared/ModalBackdrop';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';

export default function ConvertFrameRate({ projects, assetId, onConverted, onClose, restoreFocus }: {
  projects: ProjectController; assetId: string; onConverted: (asset: LibraryAsset) => void; onClose: () => void; restoreFocus: () => void;
}) {
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot), id = useId();
  const [target, setTarget] = useState('24'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), converting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (converting.current) projects.cancel(); }; }, [projects]);
  const fps = Number(target), valid = Number.isFinite(fps) && fps >= 1 && fps <= 240;
  const name = state.project?.library?.find(asset => asset.assetId === assetId)?.name ?? 'Video';
  const cancel = () => { if (converting.current) projects.cancel(); onClose(); };
  return <ModalBackdrop labelledBy={`${id}-title`} onCancel={cancel} restoreFocus={restoreFocus}>
    <form className="project-card frame-rate-dialog" onSubmit={event => {
      event.preventDefault(); if (!valid || busy || state.busy) return;
      setBusy(true); setError(''); converting.current = true;
      void projects.convertVideoAsset(assetId, fps).then(copy => {
        if (!mounted.current) return;
        if (copy) { onClose(); onConverted(copy); }
        else setError(projects.getSnapshot().error ?? 'Conversion cancelled.');
      }).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Unable to convert this video.'); })
        .finally(() => { converting.current = false; if (mounted.current) setBusy(false); });
    }}>
      <h2 id={`${id}-title`}>Convert frame rate</h2>
      <p className="frame-rate-source" title={name}>{name}</p>
      <label className="inspector-property" htmlFor={`${id}-fps`}><span>Target FPS</span>
        <input autoFocus id={`${id}-fps`} type="number" min={1} max={240} step="any" list={`${id}-rates`} required value={target}
          disabled={busy} aria-describedby={`${id}-help`} onChange={event => setTarget(event.target.value)}/>
      </label>
      <datalist id={`${id}-rates`}>{[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120].map(rate => <option key={rate} value={rate}/>)}</datalist>
      <p id={`${id}-help`} className="hint">Create a separate Library copy at this frame rate. Keeps resolution, playback speed and audio timing. Frames are dropped or repeated; motion may look less smooth.</p>
      <div className="frame-rate-feedback" role="status" title={error}>{error}</div>
      <div className="frame-rate-actions"><button className="button" type="button" onClick={cancel}>Cancel</button>
        <button className="button primary" type="submit" disabled={!valid || busy || state.busy} aria-busy={busy}>
          {busy ? state.progress === null ? 'Converting…' : `Converting ${Math.floor(state.progress * 100)}%` : 'Create copy'}
        </button>
      </div>
    </form>
  </ModalBackdrop>;
}
