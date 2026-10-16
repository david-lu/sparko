import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicVAD } from '@ricky0123/vad-web';
import { MicrophoneController } from '../../src/features/voice-input/MicrophoneController';
import { MAX_VOICE_SECONDS } from '../../shared/constants';

const vad = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@ricky0123/vad-web', () => ({ MicVAD: { new: vad.create }, utils: { encodeWAV: (audio: Float32Array) => new ArrayBuffer(44 + audio.length * 2) } }));
let callbacks: NonNullable<Parameters<typeof MicVAD.new>[0]>;
let microphone: MicrophoneController;
const stopTrack = vi.fn();
const closeContext = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ addEventListener: vi.fn() }] } as unknown as MediaStream;
const getUserMedia = vi.fn(async () => stream);
const pause = vi.fn(async () => { callbacks.onSpeechEnd?.(new Float32Array(16000)); });
const destroy = vi.fn(async () => undefined);
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  getUserMedia.mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    resume = async () => undefined;
    close = async () => { closeContext(); this.state = 'closed'; };
  });
  vad.create.mockImplementation(async options => { callbacks = options; return { listening: true, errored: null, pause, destroy }; });
  microphone = new MicrophoneController();
});
afterEach(async () => { microphone.dispose(); await vi.runAllTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('voice-activated microphone lifecycle', () => {
  it('arms on enable and produces no recording while silent or after a misfire', async () => {
    await microphone.enable();
    expect(microphone.getSnapshot()).toMatchObject({ phase: 'listening', seconds: 0, audio: null });
    await vi.advanceTimersByTimeAsync(10_000);
    callbacks.onVADMisfire?.();
    expect(microphone.getSnapshot()).toMatchObject({ phase: 'listening', seconds: 0, audio: null });
    expect(callbacks.preSpeechPadMs).toBeGreaterThan(0);
    microphone.cancel();
    expect(stopTrack).toHaveBeenCalled();
  });
  it('captures confirmed speech and releases the mic at the end of the utterance', async () => {
    await microphone.enable(); callbacks.onSpeechRealStart?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(microphone.getSnapshot().phase).toBe('recording');
    callbacks.onSpeechEnd?.(new Float32Array(32000));
    expect(microphone.getSnapshot()).toMatchObject({ phase: 'ready', seconds: 2 });
    expect(microphone.getSnapshot().audio?.type).toBe('audio/wav');
    expect(stopTrack).toHaveBeenCalled();
    await vi.runAllTimersAsync(); expect(destroy).toHaveBeenCalled(); expect(closeContext).toHaveBeenCalled();
  });
  it('finishes bounded answers automatically and supports a manual finish', async () => {
    await microphone.enable(); callbacks.onSpeechRealStart?.();
    await vi.advanceTimersByTimeAsync(MAX_VOICE_SECONDS * 1000);
    expect(pause).toHaveBeenCalledOnce();
    expect(microphone.getSnapshot().phase).toBe('ready');
    await microphone.enable(); callbacks.onSpeechRealStart?.(); await microphone.stop();
    expect(microphone.getSnapshot().phase).toBe('ready');
  });
  it('stops a permission grant arriving after cancellation without starting detection', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const enabling = microphone.enable(); microphone.cancel(); grant(stream); await enabling;
    expect(vad.create).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
    expect(microphone.getSnapshot().phase).toBe('idle');
  });
  it('ignores late detection events and shows an actionable permission error', async () => {
    await microphone.enable(); microphone.cancel(); callbacks.onSpeechRealStart?.(); callbacks.onSpeechEnd?.(new Float32Array(16000));
    expect(microphone.getSnapshot()).toMatchObject({ phase: 'idle', audio: null });
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await microphone.enable();
    expect(microphone.getSnapshot().error).toContain('Microphone access was denied');
  });
  it('releases a cancelled model initialization and caps PCM output including pre-roll', async () => {
    let finishLoad!: (detector: unknown) => void;
    vad.create.mockImplementationOnce(options => { callbacks = options; return new Promise(resolve => { finishLoad = resolve; }); });
    const enabling = microphone.enable();
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    microphone.cancel(); expect(stopTrack).toHaveBeenCalled();
    finishLoad({ listening: true, errored: null, pause, destroy }); await enabling;
    await vi.runAllTimersAsync(); expect(destroy).toHaveBeenCalled(); expect(closeContext).toHaveBeenCalled();
    await microphone.enable(); callbacks.onSpeechRealStart?.();
    callbacks.onSpeechEnd?.(new Float32Array(62 * 16000));
    expect(microphone.getSnapshot().seconds).toBe(MAX_VOICE_SECONDS);
    expect(microphone.getSnapshot().audio?.size).toBe(44 + MAX_VOICE_SECONDS * 16000 * 2);
  });
});
