import { useEffect, useMemo, useState } from 'react';
import { assetThumbnails, clipThumbnails } from '../../media/assetThumbnails';
import type { Thumbnail } from '../../media/media';
import ClipLoading from '../../shared/ClipLoading';

export default function VideoFilmstrip({ assetId, url, start, end }: { assetId?: string; url: string; start: number; end: number }) {
  const [preview, setPreview] = useState<{ key: string; frames: Thumbnail[]; failed?: boolean } | null>(null);
  const key = assetId ? `asset:${assetId}` : `url:${url}`;
  useEffect(() => {
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
  return <span className="video-filmstrip" aria-busy={!current}>{visible.length ? visible.map((frame, index) =>
    <img key={index} src={frame.url} alt="" draggable={false} />) : <ClipLoading failed={current?.failed} message={current?.failed ? 'Preview unavailable' : 'Loading clip…'} />}</span>;
}
