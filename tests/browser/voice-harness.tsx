import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../../src/app/styles.css';
import VoicePanel from '../../src/features/voice-input/VoicePanel';
import { VideoPlayerController } from '../../src/features/player/VideoPlayerController';
import type { AppStatus } from '../../shared/contracts';

// Exercise the retained Voice component independently of the graph workspace.
const player = new VideoPlayerController();
player.getSourceTime = () => 12.5;
const status: AppStatus = { providers: { openai: true, gemini: true, comfy: false }, models: { openai: 'test', gemini: 'test' },
  uploadMode: 'local', requiresPassword: false, defaultVideo: { name: '', url: '', size: 0 } };
function Harness() {
  const [active, setActive] = useState(true);
  return <main style={{ height: '100vh', overflow: 'auto' }}>
    <button onClick={() => setActive(value => !value)}>Toggle voice panel</button>
    <VoicePanel sourceId="voice-test" controller={player} status={status} active={active} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
