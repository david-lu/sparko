import { useEffect, useRef, useState } from 'react';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { assets } from './assets';
import type { ProjectController } from './ProjectController';
import type { LibraryAsset } from './types';
import ConvertFrameRate from './ConvertFrameRate';

/** Read the selected media's clock, independently of the timeline's edit grid. */
export default function VideoFrameRate({ assetId, projects, onConverted }: { assetId?: string; projects: ProjectController; onConverted: (asset: LibraryAsset) => void }) {
  const [convert, setConvert] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState<{ assetId: string; fps?: number; error?: string }>();
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false, input: Input | undefined;
    void (async () => {
      const { asset } = await assets.open(assetId);
      if (cancelled) return;
      input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        const fps = (await track?.computePacketStats(120))?.averagePacketRate;
        if (!cancelled) setValue({ assetId, fps: fps && Number.isFinite(fps) ? fps : undefined });
      } finally { input.dispose(); }
    })().catch(error => { if (!cancelled) setValue({ assetId, error: error instanceof Error ? error.message : 'Unable to read frame rate.' }); });
    return () => { cancelled = true; input?.dispose(); };
  }, [assetId]);
  const current = value?.assetId === assetId ? value : undefined;
  return <><div className="inspector-property video-frame-rate" aria-busy={!!assetId && !current}>
    <span>Frame rate</span><div className="video-frame-rate-value"><output aria-label="Video frame rate" title={current?.error ?? 'Average frame rate of this video file'}>
      {current?.fps ? `${Number(current.fps.toFixed(3))} fps` : current?.error ? 'Unavailable' : '—'}
    </output><button ref={trigger} className="text-button" aria-label="Convert frame rate…" disabled={!assetId || !!current?.error || projects.getSnapshot().busy} onClick={() => setConvert(true)}>Convert…</button></div>
  </div>{convert && assetId && <ConvertFrameRate key={assetId} projects={projects} assetId={assetId} onConverted={onConverted} onClose={() => setConvert(false)} restoreFocus={() => trigger.current?.focus({ preventScroll: true })}/>}</>;
}
