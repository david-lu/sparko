import { X } from 'lucide-react';
import ModalBackdrop from '../shared/ModalBackdrop';
import { defaultPinchZoomSensitivity, minPinchZoomSensitivity, maxPinchZoomSensitivity, defaultPlayheadTimeMode, defaultTurboEnabled, defaultConvertImportedVideo, type PlayheadTimeMode } from '../shared/preferences';
import './preferences.css';

export default function Preferences({ pinchZoomSensitivity, onPinchZoomSensitivity, playheadTimeMode, onPlayheadTimeMode, defaultTurbo, onDefaultTurbo, convertImportedVideo, onConvertImportedVideo, onClose }: {
  pinchZoomSensitivity: number; onPinchZoomSensitivity: (value: number) => void;
  playheadTimeMode: PlayheadTimeMode; onPlayheadTimeMode: (value: PlayheadTimeMode) => void; onClose: () => void;
  defaultTurbo: boolean; onDefaultTurbo: (value: boolean) => void;
  convertImportedVideo: boolean; onConvertImportedVideo: (value: boolean) => void;
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
      <h3 className="preference-section">Video imports</h3>
      <label htmlFor="convert-imported-video">Convert imported videos to 24 fps
        <input id="convert-imported-video" type="checkbox" role="switch" checked={convertImportedVideo} aria-describedby="convert-imported-video-help" onChange={event=>onConvertImportedVideo(event.target.checked)}/>
      </label>
      <p id="convert-imported-video-help" className="hint">Prepare new imports at 24 fps, keeping the original, resolution, playback speed and audio timing. Imports take longer; motion may look less smooth. Existing clips stay unchanged.</p>
      <h3 className="preference-section">Video generation</h3>
      <label htmlFor="default-turbo">Enable Turbo by default
        <input id="default-turbo" type="checkbox" role="switch" checked={defaultTurbo} aria-describedby="default-turbo-help" onChange={event=>onDefaultTurbo(event.target.checked)}/>
      </label>
      <p id="default-turbo-help" className="hint">Start new H3 video clips with Turbo enabled. You can change Turbo for each clip in the inspector.</p>
      <footer><span>Changes save automatically on this device.</span><button className="button small" onClick={()=>{onPinchZoomSensitivity(defaultPinchZoomSensitivity);onPlayheadTimeMode(defaultPlayheadTimeMode);onDefaultTurbo(defaultTurboEnabled);onConvertImportedVideo(defaultConvertImportedVideo);}}>Reset default</button><button className="button primary small" onClick={onClose}>Done</button></footer>
    </section>
  </ModalBackdrop>;
}
