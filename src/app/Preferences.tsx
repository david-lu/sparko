import { X } from 'lucide-react';
import ModalBackdrop from '../shared/ModalBackdrop';
import { defaultPinchZoomSensitivity, minPinchZoomSensitivity, maxPinchZoomSensitivity } from '../shared/preferences';
import './preferences.css';

export default function Preferences({ pinchZoomSensitivity, onPinchZoomSensitivity, onClose }: {
  pinchZoomSensitivity: number; onPinchZoomSensitivity: (value: number) => void; onClose: () => void;
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
      <footer><span>Changes save automatically on this device.</span><button className="button small" onClick={()=>onPinchZoomSensitivity(defaultPinchZoomSensitivity)}>Reset default</button><button className="button primary small" onClick={onClose}>Done</button></footer>
    </section>
  </ModalBackdrop>;
}
