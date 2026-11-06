import { useRef, useState } from 'react';
import MediaDimensions from './MediaDimensions';
import { useMediaMetadata } from './useMediaMetadata';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import ImageDrawingDialog from './ImageDrawingDialog';

export default function ImageAssetTools({ assetId, projects, onSaved }: { assetId?: string; projects: ProjectController; onSaved: (asset: LibraryAsset) => void }) {
  const current = useMediaMetadata(assetId, 'image'), [drawing, setDrawing] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  return <>
    <MediaDimensions info={current?.info} error={current?.error} loading={!!assetId && !current}/>
    <div className="asset-preview-actions"><button type="button" className="text-button" ref={trigger} disabled={!assetId || !current?.info || projects.getSnapshot().busy} onClick={() => setDrawing(true)}>Draw on image…</button></div>
    {drawing && assetId && <ImageDrawingDialog key={assetId} assetId={assetId} projects={projects} onSaved={onSaved} onClose={() => setDrawing(false)} restoreFocus={() => trigger.current?.focus({ preventScroll: true })}/>}
  </>;
}
