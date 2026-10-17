import './styles.css';
import { useEffect, useRef, useState } from 'react';
import { Copy, Play, Sparkles } from 'lucide-react';
import type { AppStatus, CaptionResult, Provider, Slice } from '../../../shared/contracts';
import { formatTime, validateSlice } from '../../../shared/contracts';
import { MAX_ANALYSIS_SECONDS } from '../../../shared/constants';
import { analyzeVideo } from './api';
import type { MediaEngine } from '../../media/MediaEngine';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import type { AnalysisState } from '../project/types';
import TaskStatus from '../../shared/TaskStatus';

export default function AiPanel({ engine, controller, status, slice, onSlice, analysis, onAnalysis }: {
  engine: MediaEngine | null; controller: VideoPlayerController; status: AppStatus | null;
  slice: Slice; onSlice: (value: Slice) => void;
  analysis: AnalysisState; onAnalysis: (value: AnalysisState) => void;
}) {
  const { provider, instructions, result } = analysis;
  const setProvider = (provider: Provider) => onAnalysis({ ...analysis, provider });
  const setInstructions = (instructions: string) => onAnalysis({ ...analysis, instructions });
  const latest = useRef({ analysis, onAnalysis }); latest.current = { analysis, onAnalysis };
  const setResult = (result: CaptionResult | null) => latest.current.onAnalysis({ ...latest.current.analysis, result });
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const task = useRef<AbortController | null>(null);
  useEffect(() => {
    setError(''); setProgress('');
    return () => { task.current?.abort(); task.current = null; };
  }, [engine]);
  const busy = !!progress;
  const analyze = async () => {
    if (!engine) return;
    setError('');
    const operation = new AbortController(); task.current = operation;
    try {
      validateSlice(slice, controller.getSourceDuration(), MAX_ANALYSIS_SECONDS);
      const response = await analyzeVideo(engine, slice, provider, instructions, operation.signal,
        text => { if (task.current === operation) setProgress(text); });
      if (task.current === operation) setResult(response);
    } catch (err) {
      if (!operation.signal.aborted && task.current === operation) setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally { if (task.current === operation) { setProgress(''); task.current = null; } }
  };
  return <div className="panel-content">
    <div className="panel-intro"><h2>Describe a segment</h2><p>Choose a moment. Get a caption and a detailed description.</p></div>
    <form onSubmit={event => { event.preventDefault(); void analyze(); }}>
      <fieldset disabled={busy}>
        <label className="field">Provider<select value={provider} onChange={event => setProvider(event.target.value as Provider)} aria-label="AI provider"><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Google Gemini</option></select></label>
        <div className="provider-status"><span className={`status-dot ${status?.providers[provider] ? 'ready' : ''}`} />{status?.providers[provider] ? 'API key configured' : 'API key missing'}<span className="model-name">{status?.models[provider]}</span></div>
        <div className="range-fields">
          <label className="field">Start <span className="unit">seconds</span><input aria-label="Analysis start" type="number" min="0" step="0.001" required value={Number.isNaN(slice.start) ? '' : slice.start} onChange={event => onSlice({ ...slice, start: event.target.valueAsNumber })} /><button className="text-button" type="button" onClick={() => onSlice({ ...slice, start: Number(controller.getSourceTime().toFixed(3)) })}>Set at playhead</button></label>
          <label className="field">End <span className="unit">seconds</span><input aria-label="Analysis end" type="number" min="0" step="0.001" required value={Number.isNaN(slice.end) ? '' : slice.end} onChange={event => onSlice({ ...slice, end: event.target.valueAsNumber })} /><button className="text-button" type="button" onClick={() => onSlice({ ...slice, end: Number(controller.getSourceTime().toFixed(3)) })}>Set at playhead</button></label>
        </div>
        <div className="range-summary"><span>{Math.max(0, slice.end - slice.start).toFixed(2)}s selected · max {MAX_ANALYSIS_SECONDS}s</span><button className="text-button" type="button" onClick={() => {
          try { validateSlice(slice, controller.getSourceDuration(), MAX_ANALYSIS_SECONDS); controller.previewSource(slice.start, slice.end); setError(''); }
          catch (err) { setError((err as Error).message); }
        }}><Play size={12} /> Preview</button></div>
        <label className="field">Focus <span className="unit">optional</span><textarea rows={3} maxLength={2000} placeholder="e.g. Describe the action and camera movement" value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        <p className="hint">{provider === 'openai' ? 'Sends sampled frames and audio for transcription to OpenAI.' : 'Sends only this video segment, including audio, to Gemini.'}</p>
        <button className="button primary full-width" type="submit" disabled={!engine || !status?.providers[provider]}><Sparkles size={15} /> Generate description</button>
      </fieldset>
    </form>
    <TaskStatus active={busy} message={progress} cancelLabel="Cancel analysis" onCancel={() => { task.current?.abort(); task.current = null; setProgress(''); }} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    {result && <article className="analysis-result" aria-label="Analysis result">
      <div className="result-heading"><span className="eyebrow">RESULT</span><button className="text-button" onClick={() => { void navigator.clipboard.writeText(`${result.caption}\n\n${result.description}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setError('Clipboard access is unavailable. Select and copy the result text.')); }}><Copy size={13} />{copied ? 'Copied' : 'Copy'}</button></div>
      <h3>Caption</h3><p>{result.caption}</p><h3>Description</h3><p>{result.description}</p>
      <div className="result-meta">{formatTime(result.start, true)} – {formatTime(result.end, true)}<br />{result.model}<br />{result.basis}</div>
    </article>}
  </div>;
}
