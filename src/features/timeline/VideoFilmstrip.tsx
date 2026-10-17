import { useEffect, useState } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { sampleFrames, type Thumbnail } from '../../media/media';

export default function VideoFilmstrip({ url, start, end, width }: { url: string; start: number; end: number; width: number }) {
  const [preview, setPreview] = useState<{ key: string; frames: Thumbnail[] } | null>(null);
  const key = `${url}:${start}:${end}`;
  const count = Math.max(1, Math.min(24, Math.ceil(width / 120)));
  useEffect(() => {
    const operation = new AbortController();
    // Stay inside the final frame even if the edit boundary was rounded to 24 fps.
    const slice = { start, end: Math.max(start + 0.000001, end - 1 / TIMELINE_FPS) };
    void sampleFrames({ id: url, name: 'Clip', url }, slice, count, 240, operation.signal)
      .then(frames => { if (!operation.signal.aborted) setPreview({ key, frames }); })
      .catch(() => undefined);
    return () => operation.abort();
  }, [url, start, end, count, key]);

  return <span className="video-filmstrip" aria-hidden="true">{preview?.key === key && preview.frames.map(frame =>
    <img key={frame.time} src={frame.url} alt="" draggable={false} />)}</span>;
}
