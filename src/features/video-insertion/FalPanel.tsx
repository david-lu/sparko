import './styles.css';
import { useEffect, useState } from 'react';
import { ExternalLink, Upload } from 'lucide-react';
import type { AppStatus, FalJob } from '../../../shared/contracts';
import type { MediaSource } from '../../media/media';
import type { VideoPlayerController } from '../player/VideoPlayerController';
import { request } from '../../shared/api';
import { submitFal } from './api';
import { AI_MODELS } from '../../../shared/constants';

function savedJob(): FalJob | null {
  try {
    const value = JSON.parse(localStorage.getItem('sparko:fal-job') || 'null');
    return value && /^[A-Za-z0-9_-]{8,128}$/.test(value.requestId) && ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(value.status) ? value : null;
  } catch { return null; }
}
export default function FalPanel({ source, controller, status }: { source: MediaSource; controller: VideoPlayerController; status: AppStatus | null }) {
  const [start, setStart] = useState(0);
  const [resume, setResume] = useState(0);
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('768p');
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<FalJob | null>(savedJob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollFailed, setPollFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setStart(0); setResume(0); setError(''); }, [source.id]);
  useEffect(() => { try { if (job) localStorage.setItem('sparko:fal-job', JSON.stringify(job)); } catch { /* Job remains available in this session. */ } }, [job]);
  useEffect(() => {
    if (!job || !['IN_QUEUE', 'IN_PROGRESS'].includes(job.status)) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setPollFailed(false);
    const poll = async () => {
      try {
        const update = await request<FalJob>(`/api/fal/jobs/${job.requestId}`, { signal: abort.signal });
        if (!abort.signal.aborted) {
          setJob(update);
          if (update.status === 'IN_QUEUE' || update.status === 'IN_PROGRESS') timer = setTimeout(() => void poll(), 3500);
        }
      } catch (err) { if (!abort.signal.aborted) { setError((err as Error).message); setPollFailed(true); } }
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [job?.requestId, job?.status, retry]);
  const active = !!job && ['IN_QUEUE', 'IN_PROGRESS'].includes(job.status);
  const submit = async () => {
    setError('');
    const total = controller.getSnapshot().duration;
    if (!Number.isFinite(start) || !Number.isFinite(resume) || start < 0 || resume < start || start >= total || resume > total) { setError('Choose insertion and resume times within the video. Resume must be at or after insertion.'); return; }
    setBusy(true);
    try { setJob(await submitFal(source, { start, resume, duration, resolution, prompt })); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="panel-content">
    <div className="panel-intro"><h2>Insert a scene</h2><p>Upload the current video to MiniMax H3 Max through fal.ai.</p></div>
    <div className="provider-status"><span className={`status-dot ${status?.providers.fal ? 'ready' : ''}`} />{status?.providers.fal ? 'API key configured' : 'FAL_KEY missing'}</div>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy || active}>
      <div className="source-box"><span className="eyebrow">SOURCE VIDEO</span><strong>{source.name}</strong></div>
      <div className="range-fields">
        <label className="field">Insert at <span className="unit">sec</span><input type="number" aria-label="Insert at" required min="0" step="0.001" value={Number.isNaN(start) ? '' : start} onChange={event => setStart(event.target.valueAsNumber)} /><button type="button" className="text-button" onClick={() => setStart(Number(controller.getSnapshot().time.toFixed(3)))}>Set at playhead</button></label>
        <label className="field">Resume at <span className="unit">sec</span><input type="number" aria-label="Resume at" required min="0" step="0.001" value={Number.isNaN(resume) ? '' : resume} onChange={event => setResume(event.target.valueAsNumber)} /><button type="button" className="text-button" onClick={() => setResume(Number(controller.getSnapshot().time.toFixed(3)))}>Set at playhead</button></label>
      </div>
      <p className="hint">The generated scene starts at the insertion time, then returns to the original video at the resume time.</p>
      <label className="field">Scene prompt<textarea rows={4} maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the scene to insert…" /></label>
      <div className="range-fields"><label className="field">New scene length<input aria-label="New scene length" type="number" min="1" max="30" step="0.5" required value={Number.isNaN(duration) ? '' : duration} onChange={event => setDuration(event.target.valueAsNumber)} /></label><label className="field">Resolution<select aria-label="Generation resolution" value={resolution} onChange={event => setResolution(event.target.value)}><option>768p</option><option>480p</option></select></label></div>
      <p className="hint">Uploads this video and starts a paid generation on your fal account.</p>
      <button className="button primary full-width" disabled={!status?.providers.fal || !controller.getSnapshot().duration} type="submit"><Upload size={15} /> Upload & generate</button>
    </fieldset></form>
    {busy && <div className="task-status" role="status"><span className="spinner" />Uploading and submitting to fal…</div>}
    {job && <div className="job-card"><div className="result-heading"><span className="eyebrow">{job.status.replaceAll('_', ' ')}</span>{active && !pollFailed && <span className="spinner" />}</div><p className="job-id">{job.requestId}</p>{job.queuePosition !== undefined && active && <p className="hint">Queue position: {job.queuePosition}</p>}
      {job.videoUrl?.startsWith('https://') && <a className="button full-width" href={job.videoUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open generated video</a>}
      {active && <button className="text-button danger" disabled={busy} onClick={() => { setBusy(true); void request<FalJob>(`/api/fal/jobs/${job.requestId}`, { method: 'DELETE' }).then(setJob).catch(err => setError(err.message)).finally(() => setBusy(false)); }}>Cancel generation</button>}
      {pollFailed && active && <button className="text-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry status check</button>}
    </div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <a className="endpoint-link" href="https://fal.ai/models/minimax/h3-max/insert-video" target="_blank" rel="noreferrer">{AI_MODELS.fal}<ExternalLink size={12} /></a>
  </div>;
}
