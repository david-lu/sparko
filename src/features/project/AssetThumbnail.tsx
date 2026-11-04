import { Image, ImageOff, Music, Video } from 'lucide-react';
import { AudioBufferSink, BlobSource, Input, ALL_FORMATS } from 'mediabunny';
import { useEffect, useRef, useState } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { sampleFrame } from '../../media/media';
import { assets } from './assets';
import type { LibraryAsset } from './types';

type PreviewAsset = Pick<LibraryAsset, 'assetId' | 'kind' | 'duration' | 'inFrame' | 'outFrame'>;
const cache = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let running = 0;
async function queued<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else running--; }
}

/** Small, cached previews; decoding never starts for offscreen library rows. */
function thumbnail(asset: PreviewAsset): Promise<string> {
  const key = `${asset.assetId}:${asset.kind}:${asset.inFrame ?? 0}:${asset.outFrame ?? ''}`;
  const existing = cache.get(key); if (existing) return existing;
  const task = queued(async () => {
    const { asset: stored, url } = await assets.open(asset.assetId);
    const canvas = document.createElement('canvas'); canvas.width = 112; canvas.height = 66;
    const ctx = canvas.getContext('2d')!;
    if (asset.kind === 'image') {
      const bitmap = await createImageBitmap(stored.blob, { resizeWidth: 112, resizeQuality: 'low' });
      try { const scale = Math.min(112 / bitmap.width, 66 / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
        ctx.drawImage(bitmap, (112 - w) / 2, (66 - h) / 2, w, h);
      } finally { bitmap.close(); }
    } else if (asset.kind === 'video' || asset.kind === 'generated') {
      const start = (asset.inFrame ?? 0) / TIMELINE_FPS, end = asset.outFrame !== undefined ? asset.outFrame / TIMELINE_FPS : asset.duration ?? start;
      return (await sampleFrame({ id: asset.assetId, assetId: asset.assetId, name: stored.name, url }, start + Math.min(.5, Math.max(0, end - start) / 2), 112, AbortSignal.timeout(15_000))).url;
    } else {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(stored.blob) });
      const signal = AbortSignal.timeout(15_000), abort = () => input.dispose(); signal.addEventListener('abort', abort, { once: true });
      try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !await track.canDecode()) throw new Error('Audio preview unavailable.');
        const duration = await track.computeDuration(), sink = new AudioBufferSink(track), levels: number[] = [];
        // Sample evenly across the recording without decoding a long file into memory.
        for (let i = 0; i < 24; i++) {
          signal.throwIfAborted();
          const sample = await sink.getBuffer(duration * (i + .5) / 24);
          let peak = 0;
          if (sample) for (let c = 0; c < sample.buffer.numberOfChannels; c++) {
            const data = sample.buffer.getChannelData(c), step = Math.max(1, Math.floor(data.length / 1000));
            for (let j = 0; j < data.length; j += step) peak = Math.max(peak, Math.abs(data[j]));
          }
          levels.push(peak);
        }
        const max = Math.max(.01, ...levels); ctx.fillStyle = '#d5b386';
        levels.forEach((level, i) => { const h = Math.max(2, level / max * 48); ctx.fillRect(9 + i * 4, (66 - h) / 2, 2, h); });
      } finally { signal.removeEventListener('abort', abort); input.dispose(); }
    }
    return canvas.toDataURL('image/png');
  });
  cache.set(key, task);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  void task.catch(() => { if (cache.get(key) === task) cache.delete(key); });
  return task;
}

export default function AssetThumbnail({ asset, kind, name, eager = false }: { asset?: PreviewAsset; kind: LibraryAsset['kind']; name: string; eager?: boolean }) {
  const element = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(eager);
  const key = asset ? `${asset.assetId}:${asset.kind}:${asset.inFrame ?? 0}:${asset.outFrame ?? ''}` : '';
  const [preview, setPreview] = useState<{ key: string; url?: string; failed?: boolean }>();
  useEffect(() => {
    if (eager) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '80px' });
    if (element.current) observer.observe(element.current); return () => observer.disconnect();
  }, [eager]);
  useEffect(() => {
    if (!visible || !asset) return;
    let active = true;
    void thumbnail(asset).then(url => { if (active) setPreview({ key, url }); }).catch(() => { if (active) setPreview({ key, failed: true }); });
    return () => { active = false; };
  }, [key, visible, kind]);
  const current = preview?.key === key ? preview : undefined;
  const state = !asset ? 'placeholder' : current?.url ? 'ready' : current?.failed ? 'unavailable' : 'loading';
  const Icon = current?.failed ? ImageOff : kind === 'image' ? Image : kind === 'audio' ? Music : Video;
  return <span ref={element} className="library-thumb" data-preview-state={state} aria-busy={state === 'loading'} title={state === 'unavailable' ? `Preview unavailable for ${name}` : undefined}>
    {current?.url ? <img src={current.url} alt={kind === 'audio' ? `Waveform of ${name}` : `Thumbnail of ${name}`} draggable={false}/> : <Icon size={17} aria-hidden/>}
  </span>;
}
