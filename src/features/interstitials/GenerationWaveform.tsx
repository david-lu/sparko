import { useEffect, useState } from 'react';
import { audioWaveform, waveformKey, type WaveformData, type WaveformSource } from './audio-waveform';
import { useAssetAvailability } from '../project/useAssetAvailability';
import { assets } from '../project/assets';

export type WaveformClip = WaveformSource & { startFrame: number; label: string };
function WaveformClipView({ clip, frames }: { clip: WaveformClip; frames: number }) {
  const key = waveformKey(clip);
  const [result, setResult] = useState<{ key: string; data?: WaveformData; error?: boolean }>();
  useAssetAvailability([clip.assetId]);
  const missing = clip.assetId && assets.error(clip.assetId);
  useEffect(() => {
    const controller = new AbortController();
    if (!missing) void audioWaveform(clip, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, error: true }); });
    return () => controller.abort();
  }, [key, missing]);
  const current = result?.key === key ? result : undefined;
  const state = missing || current?.error ? 'unavailable' : current?.data ? current.data.hasAudio ? 'ready' : 'silent' : 'loading';
  const peaks = current?.data?.peaks ?? [];
  const path = peaks.map((peak, i) => { const height = Math.sqrt(Math.min(1, peak)) * 18; return `M${i + .5},${24 - height}v${2 * height}`; }).join('');
  return <div className="generation-waveform-clip" data-state={state} style={{ left: `${clip.startFrame / frames * 100}%`, width: `${clip.frames / frames * 100}%` }} title={`${clip.label}${state === 'silent' ? ' · no audio' : ''}`}>
    {state === 'ready' ? <svg role="img" aria-label={`Audio waveform of ${clip.label}`} viewBox={`0 0 ${peaks.length} 48`} preserveAspectRatio="none"><path d={path}/></svg>
      : <span role="status">{state === 'loading' ? 'Loading audio…' : state === 'unavailable' ? 'Audio unavailable' : 'No audio'}</span>}
  </div>;
}

export default function GenerationWaveform({ clips, frames }: { clips: WaveformClip[]; frames: number }) {
  return <>{clips.map((clip, index) => <WaveformClipView key={`${index}:${waveformKey(clip)}`} clip={clip} frames={frames}/>)}</>;
}
