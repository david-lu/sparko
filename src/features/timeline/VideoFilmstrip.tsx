import { useEffect, useMemo, useState } from 'react';
import { assetThumbnails, clipThumbnails, type AssetThumbnail } from '../../media/assetThumbnails';
import ClipLoading from '../../shared/ClipLoading';

export default function VideoFilmstrip({ assetId, url, start, end, kind }: { kind?: 'image'|'audio'; assetId?: string; url: string; start: number; end: number }) {
  const [preview, setPreview] = useState<{ key: string; frames: AssetThumbnail[]; failed?: boolean } | null>(null);
  const key = assetId ? `asset:${assetId}` : `url:${url}`;
  useEffect(() => {
    // An empty URL resolves to the app page and can poison an in-flight asset preview.
    if (!url||kind==='audio') return;
    let active = true;
    void assetThumbnails({ id: assetId ?? url, assetId, name: 'Clip', url, kind })
      .then(frames => { if (active) setPreview({ key, frames, failed: !frames.length }); })
      .catch(() => {
        if (active) setPreview(current => current?.key === key && current.frames.length ? current : { key, frames: [], failed: true });
      });
    return () => { active = false; };
  }, [assetId, url, key, kind]);

  const current = preview?.key === key ? preview : null;
  const visible = useMemo(() => current?.frames.length ? clipThumbnails(current.frames, start, end) : [], [current?.frames, start, end]);
  if(kind==='audio')return <span className="video-filmstrip" role="img" aria-label="Audio clip"/>;
  if (kind === 'image') return <span className="video-filmstrip" aria-busy={!current}>{current?.frames[0] ? <img src={current.frames[0].url} alt="" draggable={false} style={{ left: 0, width: '100%', objectFit: 'cover' }}/> : <ClipLoading failed={current?.failed} message={current?.failed ? 'Preview unavailable' : 'Loading image…'}/>}</span>;
  const failed = current?.failed || !!current && !visible.length;
  return <span className="video-filmstrip" aria-busy={!current}>{visible.length ? visible.map(frame =>
    <img key={frame.time} src={frame.url} alt="" draggable={false} style={{ left: `${(frame.start - start) / (end - start) * 100}%`, width: `${(frame.end - frame.start) / (end - start) * 100}%` }} />) : <ClipLoading failed={failed} message={failed ? 'Preview unavailable' : 'Loading clip…'} />}</span>;
}
