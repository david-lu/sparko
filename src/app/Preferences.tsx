import { X } from 'lucide-react';
import ModalBackdrop from '../shared/ModalBackdrop';
import { defaultPinchZoomSensitivity, minPinchZoomSensitivity, maxPinchZoomSensitivity, defaultPlayheadTimeMode, type PlayheadTimeMode } from '../shared/preferences';
import './preferences.css';

export default function Preferences({ pinchZoomSensitivity, onPinchZoomSensitivity, playheadTimeMode, onPlayheadTimeMode, onClose }: {
  pinchZoomSensitivity: number; onPinchZoomSensitivity: (value: number) => void;
  playheadTimeMode: PlayheadTimeMode; onPlayheadTimeMode: (value: PlayheadTimeMode) => void; onClose: () => void;
}) {
  return <ModalBackdrop labelledBy="preferences-title" onCancel={onClose} restoreFocus={()=>document.querySelector<HTMLElement>('.playback-options>summary')?.focus({preventScroll:true})}>
    <section className="project-card preferences-card">
      <header><h2 id="preferences-title">Preferences</h2><button className="icon-button" aria-label="Close preferences" onClick={onClose}><X size={18}/></button></header>
      <h3>Timeline</h3>
      <label htmlFor="pinch-zoom-sensitivity">Pinch zoom sensitivity<output htmlFor="pinch-zoom-sensitivity" aria-hidden>{pinchZoomSensitivity}×</output></label>
      <input autoFocus id="pinch-zoom-sensitivity" type="range" min={minPinchZoomSensitivity} max={maxPinchZoomSensitivity} step={.25} value={pinchZoomSensitivity}
        aria-valuetext={`${pinchZoomSensitivity} times`} aria-describedby="pinch-zoom-help" onChange={event=>onPinchZoomSensitivity(Number(event.target.value))}/>
      <div className="preference-range-labels" aria-hidden><span>Slower</span><span>Faster</span></div>
      <p id="pinch-zoom-help" className="hint">Adjust how quickly pinching zooms the timeline. Also applies to Ctrl/Cmd + scroll.</p>
      <label className="preference-time-label" htmlFor="playhead-time-mode">Playhead time</label>
      <select id="playhead-time-mode" value={playheadTimeMode} aria-describedby="playhead-time-help" onChange={event=>onPlayheadTimeMode(event.target.value as PlayheadTimeMode)}>
        <option value="internal">Clip internal time</option><option value="elapsed">Elapsed from clip start</option>
      </select>
      <p id="playhead-time-help" className="hint">Show the position in the clip’s original timeline, or count from zero at its trimmed start.</p>
      <footer><span>Changes save automatically on this device.</span><button className="button small" onClick={()=>{onPinchZoomSensitivity(defaultPinchZoomSensitivity);onPlayheadTimeMode(defaultPlayheadTimeMode);}}>Reset default</button><button className="button primary small" onClick={onClose}>Done</button></footer>
    </section>
  </ModalBackdrop>;
}
