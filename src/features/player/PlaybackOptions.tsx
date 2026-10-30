import { Check } from 'lucide-react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { maxCrossfadeFrames } from './preferences';
import './options.css';
import DropdownMenu from '../../shared/DropdownMenu';

export { crossfadePreference, savedCrossfadePreference, crossfadeLengthPreference, savedCrossfadeFrames, framingPreference, savedFramingPreference } from './preferences';

export default function PlaybackOptions({ crossfade, onCrossfade, crossfadeFrames, onCrossfadeFrames, matchFraming, onMatchFraming, perClip = false }: {
  crossfade: boolean; onCrossfade: (value: boolean) => void; matchFraming: boolean; onMatchFraming: (value: boolean) => void;
  crossfadeFrames: number; onCrossfadeFrames: (value: number) => void;
  perClip?: boolean;
}) {
  const length = `${(crossfadeFrames / TIMELINE_FPS).toFixed(2)} s`;
  return <DropdownMenu className="file-menu playback-options" onKeyDown={event => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    // Keep Space usable for the checkbox without triggering the player's global shortcut.
    if (event.key === ' ' && (event.target as HTMLElement).getAttribute('role') === 'menuitemcheckbox') event.stopPropagation();
  }}><summary>Options</summary><div className="menu-items" role="menu" aria-label="Options">
    <button role="menuitemcheckbox" aria-checked={crossfade} onClick={() => onCrossfade(!crossfade)}>
      <Check size={14} style={{ visibility: crossfade ? 'visible' : 'hidden' }} />Interstitial crossfades
    </button>
    {!perClip && <label className="crossfade-length" aria-disabled={!crossfade}>
      <span>Crossfade length <output>{length}</output></span>
      <input type="range" aria-label="Crossfade length" aria-valuetext={`${(crossfadeFrames / TIMELINE_FPS).toFixed(2)} seconds`}
        min={2} max={maxCrossfadeFrames} step={2} value={crossfadeFrames} disabled={!crossfade}
        onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}
        onChange={event => onCrossfadeFrames(Number(event.target.value))} />
      <small>Saved with this project. Limited to reference overlap.</small>
    </label>}
    {perClip && <p className="hint" style={{padding:'6px 10px'}}>Click a crossfade button on a connection to edit it.</p>}
    <button role="menuitemcheckbox" aria-checked={matchFraming} onClick={() => onMatchFraming(!matchFraming)}
      title="Match generated clips to the parent frame with a small center crop (up to 5%). Larger aspect differences keep the full image.">
      <Check size={14} style={{ visibility: matchFraming ? 'visible' : 'hidden' }} />Match generated framing
    </button>
  </div></DropdownMenu>;
}
