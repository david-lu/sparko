import { describe, expect, it, vi } from 'vitest';
import type { Interstitial } from '../../shared/interstitials';
import { generateInterstitial } from '../../src/features/interstitials/api';
import { request, sendForm } from '../../src/shared/api';

vi.mock('../../src/shared/api', () => ({ request: vi.fn(), sendForm: vi.fn() }));

const idle: Interstitial = {
  id: 'idle', label: 'Idle', phase: 'draft', method: 'comfy-loop', time: 2,
  start_range: 2, end_range: 2, duration: 2, enable_prompt_expansion: false,
  continuity: 'Keep the cyborg in frame. English speech only.',
  prompt: 'The cyborg silently points with his mouth closed completely and he does not speak. Keep the same shot, background, framing and character placement. Use smooth motion with no cuts or position jumps. English speech only.',
  dialogue: 'Say hello',
};

describe('visible prompts sent to Comfy', () => {
  it('submits the editable prompt exactly, without adding continuity, dialogue or Idle instructions', async () => {
    vi.mocked(request).mockResolvedValue({ ready: true });
    vi.mocked(sendForm).mockResolvedValue({ requestId: 'idle-job', status: 'IN_QUEUE' });
    const engine = { exportMp4: vi.fn(async () => new Blob(['reference'], { type: 'video/mp4' })) };
    const info = { duration: 4, fps: 24, width: 960, height: 544, hasAudio: true, codec: 'avc' };
    const signal = new AbortController().signal;
    await generateInterstitial(idle, engine, info, signal, () => undefined);
    const [path, body] = vi.mocked(sendForm).mock.calls[0];
    expect(path).toBe('/api/comfy/interstitials');
    expect(body.get('mode')).toBe('loop');
    expect(body.get('prompt')).toBe(idle.prompt);
    expect(body.get('prompt')).toContain('cyborg silently points');
    expect(body.get('prompt')).not.toContain('Keep the cyborg in frame.');
    expect(body.get('prompt')).not.toContain('Say hello');
    expect(body.get('prompt')).not.toContain('No speech, dialogue or lip movement');
    expect(engine.exportMp4).toHaveBeenCalledOnce();
  });
});
