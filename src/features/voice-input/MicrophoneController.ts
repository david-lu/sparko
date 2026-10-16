import type { MicVAD } from '@ricky0123/vad-web';
import { AI_MODELS, MAX_VOICE_SECONDS, VOICE_DETECTION } from '../../../shared/constants';

export type MicrophoneState = {
  phase: 'idle' | 'requesting' | 'loading' | 'listening' | 'recording' | 'stopping' | 'ready';
  seconds: number;
  audio: Blob | null;
  error: string;
};
type Session = { stream: MediaStream | null; context: AudioContext; detector: MicVAD | null; initializing: boolean };
const initialState = (): MicrophoneState => ({ phase: 'idle', seconds: 0, audio: null, error: '' });
export const isMicrophoneEnabled = (state: MicrophoneState) => !['idle', 'ready'].includes(state.phase);

/** Local speech detection and utterance capture. No scene logic, timeline dependency or network uploads. */
export class MicrophoneController {
  private state = initialState();
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  getSnapshot = (): MicrophoneState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<MicrophoneState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  async enable(): Promise<void> {
    if (isMicrophoneEnabled(this.state)) return;
    this.cancel();
    const generation = this.generation;
    this.update({ phase: 'requesting' });
    let session: Session | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
        throw new Error('Microphone input needs a supported browser on HTTPS or localhost.');
      }
      // Resume during the click gesture, before permission and model loading await points.
      session = { stream: null, context: new AudioContext(), detector: null, initializing: true };
      this.session = session;
      void session.context.resume().catch(() => undefined);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      session.stream = stream;
      if (generation !== this.generation) return;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (generation === this.generation && isMicrophoneEnabled(this.state)) this.fail('The microphone disconnected. Reconnect it and enable it again.');
      }, { once: true });
      this.update({ phase: 'loading' });
      const { MicVAD, utils } = await import('@ricky0123/vad-web');
      if (generation !== this.generation) return;
      session.detector = await MicVAD.new({
        model: AI_MODELS.voiceActivity,
        baseAssetPath: '/voice-assets/', onnxWASMBasePath: '/voice-assets/',
        audioContext: session.context, startOnLoad: true,
        getStream: async () => stream,
        pauseStream: async input => { input.getTracks().forEach(track => track.stop()); },
        ortConfig: ort => { ort.env.wasm.numThreads = 1; ort.env.logLevel = 'error'; },
        ...VOICE_DETECTION, submitUserSpeechOnPause: true,
        onSpeechRealStart: () => {
          if (generation !== this.generation) return;
          const started = performance.now();
          this.update({ phase: 'recording', seconds: 0 });
          this.timer = setInterval(() => this.update({ seconds: Math.min(MAX_VOICE_SECONDS, (performance.now() - started) / 1000) }), 100);
          this.deadline = setTimeout(() => void this.stop(), MAX_VOICE_SECONDS * 1000);
        },
        onVADMisfire: () => {
          if (generation !== this.generation) return;
          this.clearTimers(); this.update({ phase: 'listening', seconds: 0 });
        },
        onSpeechEnd: samples => {
          if (generation !== this.generation) return;
          // Include the short pre-speech buffer, preserving the beginning of the first word.
          const audio = samples.subarray(0, MAX_VOICE_SECONDS * 16000);
          const blob = new Blob([utils.encodeWAV(audio, 1, 16000, 1, 16)], { type: 'audio/wav' });
          this.generation++; this.releaseDevice();
          this.update({ phase: 'ready', seconds: audio.length / 16000, audio: blob });
        },
      });
      if (generation !== this.generation) return;
      if (session.detector.errored || !session.detector.listening) throw new Error('Speech detection could not start. Enable the microphone again.');
      this.update({ phase: 'listening' });
    } catch (error) {
      if (generation !== this.generation) return;
      const name = error instanceof Error ? error.name : '';
      this.fail(name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser site settings and try again.'
        : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.'
        : name === 'NotReadableError' ? 'The microphone is unavailable or in use by another app.'
        : 'Unable to start speech detection. Check your connection and microphone, then try again.');
    } finally {
      if (session) {
        session.initializing = false;
        // A cancelled permission/model load can still finish later. Release its resources too.
        if (generation !== this.generation) this.disposeSession(session);
      }
    }
  }

  async stop(): Promise<void> {
    const detector = this.session?.detector;
    if (this.state.phase !== 'recording' || !detector) return;
    const generation = this.generation;
    this.update({ phase: 'stopping' }); this.clearTimers();
    try {
      await detector.pause(); // Flushes a valid utterance through onSpeechEnd.
      if (generation === this.generation) this.cancel();
    } catch { if (generation === this.generation) this.fail('Unable to finish the answer. Please try again.'); }
  }

  cancel(): void { this.generation++; this.releaseDevice(); this.update(initialState()); }
  dispose(): void { this.cancel(); this.listeners.clear(); }
  private fail(error: string) { this.cancel(); this.update({ error }); }
  private clearTimers() { clearInterval(this.timer); clearTimeout(this.deadline); }
  private releaseDevice() {
    this.clearTimers();
    const session = this.session; this.session = null;
    if (!session) return;
    if (!session.stream && session.context.state !== 'closed') void session.context.close().catch(() => undefined);
    session.stream?.getTracks().forEach(track => track.stop());
    if (!session.initializing) this.disposeSession(session);
  }
  private disposeSession(session: Session) {
    session.stream?.getTracks().forEach(track => track.stop());
    // Defer teardown until the current VAD frame callback has finished.
    queueMicrotask(() => {
      void (session.detector?.destroy() ?? Promise.resolve()).catch(() => undefined)
        .finally(() => { if (session.context.state !== 'closed') void session.context.close().catch(() => undefined); });
    });
  }
}
