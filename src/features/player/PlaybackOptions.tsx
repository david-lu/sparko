import { Check } from 'lucide-react';
import { INTERSTITIAL_CROSSFADE_FRAMES, TIMELINE_FPS } from '../../../shared/constants';
import './options.css';

export const crossfadePreference = 'sparko:interstitial-crossfades';
export function savedCrossfadePreference() {
  try { return localStorage.getItem(crossfadePreference) !== 'false'; } catch { return true; }
}

export default function PlaybackOptions({ crossfade, onCrossfade }: { crossfade: boolean; onCrossfade: (value: boolean) => void }) {
  return <details className="file-menu playback-options" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    // Keep Space usable for the checkbox without triggering the player's global shortcut.
    if (event.key === ' ' && (event.target as HTMLElement).getAttribute('role') === 'menuitemcheckbox') event.stopPropagation();
  }}><summary>Options</summary><div className="menu-items" role="menu" aria-label="Options">
    <button role="menuitemcheckbox" aria-checked={crossfade} onClick={() => onCrossfade(!crossfade)}>
      <Check size={14} style={{ visibility: crossfade ? 'visible' : 'hidden' }} />Interstitial crossfades
      <span>{(INTERSTITIAL_CROSSFADE_FRAMES / TIMELINE_FPS).toFixed(2)} s</span>
    </button>
  </div></details>;
}
