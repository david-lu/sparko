import type { Interstitial, InterstitialSettings } from '../../../shared/interstitials';
import './generation-info.css';

export default function GeneratedVideoSeed({ result, settings }: { result?: Interstitial['result']; settings?: InterstitialSettings }) {
  if (!result) return null;
  const saved = result.metadata?.settings ?? settings;
  return <dl className="generated-video-seed" aria-label="Generation details"><div>
    <dt>{saved?.resolution === '2k' ? 'H3 base seed' : 'Seed'}</dt>
    <dd aria-label="Generation seed">{result.metadata?.seed ?? saved?.seed ?? 'Not recorded'}</dd>
  </div></dl>;
}
