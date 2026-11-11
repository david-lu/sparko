import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../../src/app/styles.css';
import type { Interstitial } from '../../shared/interstitials';
import type { AppStatus } from '../../shared/contracts';
import { createTimelineExample } from '../../src/features/call-response/model';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import InterstitialPanel from '../../src/features/interstitials/InterstitialPanel';
import CallResponsePanel from '../../src/features/call-response/CallResponsePanel';
import type { FlowTimeline } from '../../src/features/timeline/FlowTracks';

// Render production components with deterministic states; no provider calls.
const noop = () => {};
const example = createTimelineExample('00000000-0000-4000-8000-000000000001', 20);
const clips = new InterstitialController(); clips.setCallResponse(example.flow);
const status: AppStatus = { providers: { openai: true, gemini: false, comfy: true }, models: { openai: 'test', gemini: 'test' },
  uploadMode: 'local', requiresPassword: false, defaultVideo: { name: '', url: '', size: 0 } };
const value: FlowTimeline = { flow: example.flow, session: null, selectedSceneId: 'call', selectedEdgeId: null, selectedInterstitial: false,
  onSelectInterstitial: noop, onRemoveInterstitial: noop, onRenameInterstitial: noop, onAddAnswer: noop, onRemoveAnswer: noop,
  onSelectScene: noop, onSelectEdge: noop, onBranch: noop };

function Harness() {
  const [patch, setPatch] = useState<Partial<Interstitial>>({});
  (window as any).setClipPhase = setPatch;
  const items = example.interstitials.map(item => patch.phase && patch.phase !== 'ready' ? { ...item, ...patch, previousResult: item.result, result: undefined } : item);
  const common = { controller: clips, engine: null, info: null, status, active: true, onPreviewPlay: noop };
  // Include the application's minimum resizable sidebar width on the narrow run.
  const column = { width: window.innerWidth > 660 ? 294 : 220, height: '100%', flexShrink: 0 };
  return <div style={{ display: 'flex', height: '100vh', overflow: 'auto' }}>
    <aside id="clip" className="sidebar" style={column}><CallResponsePanel {...common} value={value} items={items} onBack={noop} renderControls={() => null} /></aside>
    <aside id="rows" className="sidebar" style={column}><InterstitialPanel {...common} items={[{ ...items[0], label: 'A very long video name to verify truncation while regenerating' }]} selectedId={null} onAddRegular={noop} onAddCallResponse={noop} onSelect={noop} /></aside>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
