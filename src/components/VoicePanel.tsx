import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Play, Send, Square, X } from 'lucide-react';
import { MAX_VOICE_SECONDS } from '../../shared/constants';
import { formatTime, type AppStatus, type Provider, type VoiceAnswer, type VoiceContext } from '../../shared/contracts';
import { isMicrophoneEnabled, MicrophoneController } from '../lib/MicrophoneController';
import type { VideoPlayerController } from '../lib/VideoPlayerController';
import { sendVoiceAnswer } from '../lib/api';

export default function VoicePanel({ sourceId, controller, status, active, scene }: {
  sourceId: string; controller: VideoPlayerController; status: AppStatus | null; active: boolean;
  scene?: Pick<VoiceContext, 'sceneId' | 'question'>;
}) {
  const [microphone] = useState(() => new MicrophoneController());
  const recording = useSyncExternalStore(microphone.subscribe, microphone.getSnapshot);
  const [provider, setProvider] = useState<Provider>('openai');
  const [context, setContext] = useState<VoiceContext | null>(null);
  const [result, setResult] = useState<VoiceAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const preview = useRef<HTMLAudioElement>(null);
  const task = useRef<AbortController | null>(null);
  const capturing = isMicrophoneEnabled(recording);
  useEffect(() => {
    const stopCapture = () => {
      if (isMicrophoneEnabled(microphone.getSnapshot())) microphone.cancel();
      preview.current?.pause();
    };
    const visibility = () => { if (document.hidden) stopCapture(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stopCapture);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', stopCapture);
      microphone.dispose(); task.current?.abort(); task.current = null;
    };
  }, [microphone]);
  useEffect(() => {
    if (!active) {
      if (isMicrophoneEnabled(microphone.getSnapshot())) microphone.cancel();
      preview.current?.pause();
    }
  }, [active, microphone]);
  useEffect(() => {
    if (!recording.audio) { setAudioUrl(''); return; }
    const url = URL.createObjectURL(recording.audio); setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording.audio]);

  const start = () => {
    preview.current?.pause(); controller.pause();
    setContext({ ...scene, sourceId, videoTime: controller.video?.currentTime ?? controller.getSnapshot().time });
    setResult(null); setError('');
    void microphone.enable();
  };
  const send = async () => {
    if (!recording.audio || !context || task.current) return;
    preview.current?.pause();
    const operation = new AbortController(); task.current = operation;
    setBusy(true); setError(''); setResult(null);
    try {
      const answer = await sendVoiceAnswer(recording.audio, provider, context, operation.signal);
      if (task.current === operation) setResult(answer);
    } catch (err) {
      if (!operation.signal.aborted && task.current === operation) setError(err instanceof Error ? err.message : 'Unable to send your answer.');
    } finally { if (task.current === operation) { task.current = null; setBusy(false); } }
  };
  return <div className="panel-content voice-panel">
    <div className="panel-intro"><h2>Spoken answer</h2><p>Enable the mic, then speak when you’re ready. Review your answer before sending.</p></div>
    <label className="field">Provider<select aria-label="Voice provider" value={provider} disabled={capturing || busy} onChange={event => setProvider(event.target.value as Provider)}><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Google Gemini</option></select></label>
    <div className="provider-status"><span className={`status-dot ${status?.providers[provider] ? 'ready' : ''}`} />{status?.providers[provider] ? 'API key configured' : 'API key missing'}<span className="model-name">{status?.models[provider]}</span></div>
    <div className={`mic-status ${recording.phase === 'recording' ? 'recording' : ''}`} role="status">
      <Mic size={14} /><span>{recording.phase === 'recording' ? 'Recording speech' : recording.phase === 'listening' ? 'Listening for speech' : recording.phase === 'loading' ? 'Loading speech detection' : recording.phase === 'requesting' ? 'Waiting for microphone access' : recording.phase === 'stopping' ? 'Finishing answer' : 'Mic off'}</span>
      <time>{formatTime(recording.seconds)} / {formatTime(MAX_VOICE_SECONDS)}</time>
    </div>
    {capturing ? <div className="voice-actions">
      {recording.phase === 'recording' ? <button className="button full-width" onClick={() => void microphone.stop()}><Square size={13} /> Finish answer</button> : <button className="button full-width" onClick={() => microphone.cancel()}><X size={15} /> Disable mic</button>}
      {recording.phase === 'recording' && <button className="icon-button" aria-label="Cancel recording" onClick={() => microphone.cancel()}><X size={15} /></button>}
    </div> : <button className="button full-width" disabled={busy} onClick={start}><Mic size={15} />{recording.audio ? 'Record again' : 'Enable mic'}</button>}
    <p className="hint voice-hint">Starts with speech and finishes after a pause. Up to {MAX_VOICE_SECONDS} seconds. Detection stays on this device; only Send uploads your answer.</p>
    {recording.audio && <div className="voice-review">
      <audio ref={preview} src={audioUrl || undefined} preload="metadata" onPlay={() => setPreviewing(true)} onPause={() => setPreviewing(false)} onEnded={() => setPreviewing(false)} hidden />
      <div className="voice-review-heading"><button className="text-button" disabled={busy} onClick={() => {
        if (!preview.current) return;
        if (previewing) preview.current.pause();
        else { controller.pause(); preview.current.currentTime = 0; void preview.current.play().catch(() => setError('Unable to play the recording. Please record again.')); }
      }}>{previewing ? <Square size={12} /> : <Play size={12} />}{previewing ? 'Stop preview' : 'Play recording'}</button><span>Video {formatTime(context?.videoTime || 0, true)}</span></div>
      <div className="voice-actions"><button className="button primary full-width" disabled={busy || !status?.providers[provider]} onClick={() => void send()}><Send size={14} /> Send to LLM</button><button className="icon-button" disabled={busy} aria-label="Discard recording" onClick={() => { microphone.cancel(); setResult(null); setError(''); }}><X size={15} /></button></div>
    </div>}
    {busy && <div className="task-status" role="status"><span className="spinner" /><span>Processing spoken answer…</span><button className="icon-button small" aria-label="Cancel voice request" onClick={() => { task.current?.abort(); task.current = null; setBusy(false); }}><X size={16} /></button></div>}
    {(error || recording.error) && <p className="inline-error" role="alert">{error || recording.error}</p>}
    {result && <article className="analysis-result" aria-label="Voice result"><h3>Your answer</h3><p>{result.transcript || 'No speech detected.'}</p><h3>Model response</h3><p>{result.response}</p><div className="result-meta">Video {formatTime(result.context.videoTime, true)}<br />{result.model}</div></article>}
  </div>;
}
