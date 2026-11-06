import { useRef, useState } from 'react';
import { Paintbrush } from 'lucide-react';
import MediaDimensions from './MediaDimensions';
import { useMediaMetadata } from './useMediaMetadata';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import ImageDrawingDialog from './ImageDrawingDialog';
import './asset-inspector.css';

export default function ImageAssetTools({ assetId, projects, onSaved }: { assetId?: string; projects: ProjectController; onSaved: (asset: LibraryAsset) => void }) {
  const current = useMediaMetadata(assetId, 'image'), [drawing, setDrawing] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  return <section className="image-asset-tools" aria-label="Image editing">
    <button type="button" className="button primary full-width image-draw-action" ref={trigger} disabled={!assetId || !current?.info || projects.getSnapshot().busy} onClick={() => setDrawing(true)}>
      <Paintbrush size={17} aria-hidden/>Draw on image…
    </button>
    <p className="hint">Saves your drawing as a new image.</p>
    <MediaDimensions info={current?.info} error={current?.error} loading={!!assetId && !current}/>
    {drawing && assetId && <ImageDrawingDialog key={assetId} assetId={assetId} projects={projects} onSaved={onSaved} onClose={() => setDrawing(false)} restoreFocus={() => trigger.current?.focus({ preventScroll: true })}/>}
  </section>;
}
