import { useRef, useState } from 'react';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import ConvertFrameRate from './ConvertFrameRate';
import { useMediaMetadata } from './useMediaMetadata';
import MediaDimensions from './MediaDimensions';

/** Read the selected media's clock, independently of the timeline's edit grid. */
export default function VideoFrameRate({ assetId, projects, onConverted }: { assetId?: string; projects: ProjectController; onConverted: (asset: LibraryAsset) => void }) {
  const [convert, setConvert] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const current = useMediaMetadata(assetId, 'video');
  return <><MediaDimensions info={current?.info} error={current?.error} loading={!!assetId && !current}/><div className="inspector-property video-frame-rate" aria-busy={!!assetId && !current}>
    <span>Frame rate</span><div className="video-frame-rate-value"><output aria-label="Video frame rate" title={current?.error ?? 'Average frame rate of this video file'}>
      {current?.info?.fps ? `${Number(current.info.fps.toFixed(3))} fps` : current?.error ? 'Unavailable' : '—'}
    </output><button ref={trigger} className="text-button" aria-label="Convert video…" disabled={!assetId || !current?.info || projects.getSnapshot().busy} onClick={() => setConvert(true)}>Convert…</button></div>
  </div>{convert && assetId && current?.info && <ConvertFrameRate key={assetId} projects={projects} assetId={assetId} source={current.info} onConverted={onConverted} onClose={() => setConvert(false)} restoreFocus={() => trigger.current?.focus({ preventScroll: true })}/>}</>;
}
