import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import '../../src/app/styles.css';
import '../../src/features/timeline/styles.css';
import '../../src/features/interstitials/styles.css';
import VideoFilmstrip from '../../src/features/timeline/VideoFilmstrip';
import InterstitialPreview from '../../src/features/interstitials/InterstitialPreview';
import FlowTracks, { type FlowTimeline } from '../../src/features/timeline/FlowTracks';
import { createTimelineExample } from '../../src/features/call-response/model';
import { assets } from '../../src/features/project/assets';

const noop = () => {};
function Harness() {
  const [url, setUrl] = useState('/__clips/slow.mp4');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    void fetch('/__clips/flow.mp4').then(response => response.blob()).then(blob => assets.save(blob, 'flow.mp4')).then(async asset => {
      await assets.open(asset.id); setAssetId(asset.id);
    });
  }, []);
  const example = useMemo(() => assetId ? createTimelineExample(assetId, 4) : null, [assetId]);
  const flow: FlowTimeline | null = example && { flow: example.flow, session: null, selectedSceneId: null, selectedEdgeId: null, selectedInterstitial: false,
    onSelectInterstitial: noop, onRemoveInterstitial: noop, onRenameInterstitial: noop, onAddAnswer: noop, onRemoveAnswer: noop,
    onSelectScene: noop, onSelectEdge: noop, onBranch: noop };
  return <main style={{ padding: 16, height: '100vh', overflow: 'auto' }}>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button onClick={() => setUrl('/__clips/new.mp4')}>Switch clip</button>
      <button onClick={() => setUrl('/__clips/broken.mp4')}>Fail clip</button>
      <button onClick={() => setGenerating(!generating)}>{generating ? 'Finish generation' : 'Render clips'}</button>
    </div>
    <div style={{ width: 'min(420px, 100%)' }}>
      <button id="strip" aria-label="Select test clip" style={{ position: 'relative', width: '100%', height: 76, display: 'block' }}><VideoFilmstrip url={url} start={0} end={3} width={420} /></button>
      <button id="narrow-strip" aria-label="Select short clip" style={{ position: 'relative', width: 64, height: 76, display: 'block', marginTop: 10 }}><VideoFilmstrip url={url} start={0} end={3} width={64} /></button>
      <InterstitialPreview url={url} label="Test clip" downloadName="test.mp4" active onPlay={noop} />
    </div>
    {flow && example && <div className="timeline-section has-flow" style={{ width: 'min(800px, 100%)', height: 270, marginTop: 20, overflow: 'auto' }}>
      <FlowTracks value={flow} width={800} items={example.interstitials.map(item => generating ? { ...item, phase: 'rendering', progress: .4 } : item)} />
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
