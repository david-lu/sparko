import { useEffect, useState } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { sampleFrames, type Thumbnail } from '../../media/media';
import ClipLoading from '../../shared/ClipLoading';

export default function VideoFilmstrip({ url, start, end, width }: { url: string; start: number; end: number; width: number }) {
  const [preview, setPreview] = useState<{ key: string; frames: Thumbnail[]; failed?: boolean } | null>(null);
  const key = `${url}:${start}:${end}`;
  const count = Math.max(1, Math.min(24, Math.ceil(width / 120)));
  useEffect(() => {
    const operation = new AbortController();
    // Stay inside the final frame even if the edit boundary was rounded to 24 fps.
    const slice = { start, end: Math.max(start + 0.000001, end - 1 / TIMELINE_FPS) };
    void sampleFrames({ id: url, name: 'Clip', url }, slice, count, 240, operation.signal)
      .then(frames => { if (!operation.signal.aborted) setPreview({ key, frames, failed: !frames.length }); })
      .catch(() => {
        if (!operation.signal.aborted) setPreview(current => current?.key === key && current.frames.length ? current : { key, frames: [], failed: true });
      });
    return () => operation.abort();
  }, [url, start, end, count, key]);

  const current = preview?.key === key ? preview : null;
  return <span className="video-filmstrip" aria-busy={!current}>{current?.frames.length ? current.frames.map(frame =>
    <img key={frame.time} src={frame.url} alt="" draggable={false} />) : <ClipLoading failed={current?.failed} message={current?.failed ? 'Preview unavailable' : 'Loading clip…'} />}</span>;
}
