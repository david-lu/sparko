import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../../src/app/styles.css';
import type { Interstitial } from '../../shared/interstitials';
import type { AppStatus } from '../../shared/contracts';
import type { MediaEngine } from '../../src/media/MediaEngine';
import { createTimelineExample } from '../../src/features/call-response/model';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import InterstitialPanel from '../../src/features/interstitials/InterstitialPanel';
import CallResponsePanel from '../../src/features/call-response/CallResponsePanel';
import type { FlowTimeline } from '../../src/features/timeline/FlowTracks';
import { VideoPlayerController } from '../../src/features/player/VideoPlayerController';
import AiPanel from '../../src/features/video-analysis/AiPanel';
import VoicePanel from '../../src/features/voice-input/VoicePanel';
import { MicrophoneController, type MicrophoneState } from '../../src/features/voice-input/MicrophoneController';
import type { AnalysisState } from '../../src/features/project/types';

// Render production components with deterministic states; no provider or microphone calls.
const noop = () => {};
const example = createTimelineExample('00000000-0000-4000-8000-000000000001', 20);
const clips = new InterstitialController(); clips.setCallResponse(example.flow);
const player = new VideoPlayerController();
player.getSourceDuration = () => 20;
const status: AppStatus = { providers: { openai: true, gemini: false, comfy: true }, models: { openai: 'test', gemini: 'test' },
  uploadMode: 'local', requiresPassword: false, defaultVideo: { name: '', url: '', size: 0 } };
const value: FlowTimeline = { flow: example.flow, session: null, selectedSceneId: 'call', selectedEdgeId: null, selectedInterstitial: false,
  onSelectInterstitial: noop, onRemoveInterstitial: noop, onRenameInterstitial: noop, onAddAnswer: noop, onRemoveAnswer: noop,
  onSelectScene: noop, onSelectEdge: noop, onBranch: noop };
const engine = { frames: async () => [], audio: async () => null } as unknown as MediaEngine;
let microphone: MicrophoneController;
MicrophoneController.prototype.enable = async function () { microphone = this; };

function Harness() {
  const [patch, setPatch] = useState<Partial<Interstitial>>({});
  const [analysis, setAnalysis] = useState<AnalysisState>({ slice: { start: 0, end: 4 }, provider: 'openai', instructions: '',
    result: { caption: 'Existing caption', description: 'Existing description', provider: 'openai', model: 'test', start: 0, end: 0, basis: 'Frames' } });
  (window as any).setClipPhase = setPatch;
  (window as any).setMicPhase = (phase: MicrophoneState['phase']) => {
    // Expose the controller's notification path only in this isolated test page.
    (microphone as unknown as { update: (patch: Partial<MicrophoneState>) => void }).update({ phase,
      audio: phase === 'ready' ? new Blob(['test recording'], { type: 'audio/wav' }) : null });
  };
  const items = example.interstitials.map(item => patch.phase && patch.phase !== 'ready' ? { ...item, ...patch, previousResult: item.result, result: undefined } : item);
  const common = { controller: clips, engine: null, info: null, status, active: true, onPreviewPlay: noop };
  // Include the application's minimum resizable sidebar width on the narrow run.
  const column = { width: window.innerWidth > 660 ? 294 : 220, height: '100%', flexShrink: 0 };
  return <div style={{ display: 'flex', height: '100vh', overflow: 'auto' }}>
    <aside id="clip" className="sidebar" style={column}><CallResponsePanel {...common} value={value} items={items} onBack={noop} renderControls={() => null} /></aside>
    <aside id="rows" className="sidebar" style={column}><InterstitialPanel {...common} items={[{ ...items[0], label: 'A very long interstitial name to verify truncation while regenerating' }]} selectedId={null} onAddRegular={noop} onAddCallResponse={noop} onSelect={noop} /></aside>
    <aside id="voice" className="sidebar" style={column}><VoicePanel sourceId="test" controller={player} status={status} active /></aside>
    <aside id="analysis" className="sidebar" style={column}><AiPanel engine={engine} controller={player} status={status} slice={analysis.slice} onSlice={noop} analysis={analysis} onAnalysis={setAnalysis} /></aside>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
