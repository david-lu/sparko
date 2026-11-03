import { useEffect, useMemo, useState } from 'react';
import { assetThumbnails, clipThumbnails, type AssetThumbnail } from '../../media/assetThumbnails';
import ClipLoading from '../../shared/ClipLoading';

export default function VideoFilmstrip({ assetId, url, start, end }: { assetId?: string; url: string; start: number; end: number }) {
  const [preview, setPreview] = useState<{ key: string; frames: AssetThumbnail[]; failed?: boolean } | null>(null);
  const key = assetId ? `asset:${assetId}` : `url:${url}`;
  useEffect(() => {
    // An empty URL resolves to the app page and can poison an in-flight asset preview.
    if (!url) return;
    let active = true;
    void assetThumbnails({ id: assetId ?? url, assetId, name: 'Clip', url })
      .then(frames => { if (active) setPreview({ key, frames, failed: !frames.length }); })
      .catch(() => {
        if (active) setPreview(current => current?.key === key && current.frames.length ? current : { key, frames: [], failed: true });
      });
    return () => { active = false; };
  }, [assetId, url, key]);

  const current = preview?.key === key ? preview : null;
  const visible = useMemo(() => current?.frames.length ? clipThumbnails(current.frames, start, end) : [], [current?.frames, start, end]);
  const failed = current?.failed || !!current && !visible.length;
  return <span className="video-filmstrip" aria-busy={!current}>{visible.length ? visible.map(frame =>
    <img key={frame.time} src={frame.url} alt="" draggable={false} style={{ left: `${(frame.start - start) / (end - start) * 100}%`, width: `${(frame.end - frame.start) / (end - start) * 100}%` }} />) : <ClipLoading failed={failed} message={failed ? 'Preview unavailable' : 'Loading clip…'} />}</span>;
}
