import { FilePlus2, Film, FolderOpen, Play, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectController } from '../features/project/ProjectController';

type State = ReturnType<ProjectController['getSnapshot']>;
type Props = {
  projects: ProjectController;
  state: State;
  ready: boolean;
  error: string | null;
  hasSampleProject: boolean;
  onOpenVideo: () => void;
  onOpenProject: () => void;
  onOpenSampleProject: () => void;
  onDismissError: () => void;
};

export default function ProjectStart({ projects, state, ready, error, hasSampleProject, onOpenVideo, onOpenProject,
  onOpenSampleProject, onDismissError }: Props) {
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const projectCount = state.recentFiles.length + state.savedProjects.length;
  const disabled = !ready || state.busy;
  const loading = ready && state.busy && state.message !== 'Closing project';
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) { setShowLoading(false); return; }
    const timer = window.setTimeout(() => setShowLoading(true), 500);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return <main className="project-start">
    <div className="project-start-content">
      <header className="project-start-header">
        <div className="project-start-intro">
          <div className="project-start-brand"><span className="project-start-brand-mark"><Sparkles size={15} /></span>Sparko</div>
          <h1>Make videos pop.</h1>
          <p>Sparko is an interactive interstitial creator. Add little moments between scenes and spice up your videos.</p>
        </div>
      </header>
      <div className="project-start-status">
        {error ? <div className="project-start-feedback error" role="alert"><span title={error}>{error}</span><button className="icon-button small" aria-label="Dismiss error" onClick={onDismissError}><X size={16} /></button></div>
          : loading && showLoading && <div className="project-start-feedback" role="status"><span className="spinner" /><span title={state.message}>{state.message}{state.progress !== null ? ` · ${Math.round(state.progress * 100)}%` : ''}</span><button className="icon-button small" aria-label="Cancel project operation" onClick={() => projects.cancel()}><X size={14} /></button></div>}
      </div>
      <div className="project-start-actions">
        <button className="project-start-action primary" disabled={disabled} onClick={onOpenVideo}><span className="project-start-action-icon"><FilePlus2 size={24} /></span><span className="project-start-action-copy"><strong>Create project from video</strong><span>Got a clip? Let's make it shine.</span></span></button>
        <button className="project-start-action" disabled={disabled} onClick={onOpenProject}><span className="project-start-action-icon"><FolderOpen size={24} /></span><span className="project-start-action-copy"><strong>Open project file</strong><span>Pick up where you left off.</span></span></button>
      </div>
      <div className="project-start-sections">
        <section className="project-start-section" aria-labelledby="recent-projects-heading" aria-busy={!ready}>
          <div className="project-start-section-heading"><div><h2 id="recent-projects-heading">Recent projects</h2><p>Your ideas are right where you left them.</p></div><span aria-label={ready ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : 'Checking projects'}>{ready ? projectCount : '…'}</span></div>
          {!ready && <div className="project-start-empty project-start-pending" aria-hidden="true"><span className="project-start-pending-icon" /><span className="project-start-pending-line" /><span className="project-start-pending-line short" /></div>}
          {ready && projectCount === 0 && <div className="project-start-empty"><span className="project-start-empty-icon"><FolderOpen size={21} /></span><strong>Your first project starts here</strong><span>Bring a video and it will show up here next time.</span></div>}
          {state.recentFiles.length > 0 && <div className="project-start-list">{state.recentFiles.map(item => <div className="project-start-row" key={item.id}>
            <span className="project-start-file-icon"><FolderOpen size={17} /></span><div className="project-start-row-info"><strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></div>
            {deleteCandidate === `file:${item.id}` ? <div className="project-start-row-actions"><span>Delete from disk?</span><button className="button small danger" disabled={disabled} onClick={() => { void projects.removeRecentFile(item.id, true).then(deleted => { if (deleted) setDeleteCandidate(null); }); }}>Delete file</button><button className="button small" onClick={() => setDeleteCandidate(null)}>Cancel</button></div>
              : <div className="project-start-row-actions"><button className="button small" disabled={disabled} onClick={() => { void projects.openProjectFile(item.handle); }}><Play size={12} />Open</button><button className="icon-button small" aria-label={`Remove ${item.name} from Recent`} title="Remove from Recent" disabled={disabled} onClick={() => { void projects.removeRecentFile(item.id); }}><X size={14} /></button>{'remove' in item.handle && <button className="icon-button small" aria-label={`Delete file ${item.name}`} title="Delete file from disk" disabled={disabled} onClick={() => setDeleteCandidate(`file:${item.id}`)}><Trash2 size={14} /></button>}</div>}
          </div>)}</div>}
          {state.savedProjects.length > 0 && <><h3 className="project-start-subheading">Earlier browser projects</h3><div className="project-start-list">{state.savedProjects.map(item => <div className="project-start-row" key={item.id}>
            <span className="project-start-file-icon"><FolderOpen size={17} /></span><div className="project-start-row-info"><strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></div>
            {deleteCandidate === `browser:${item.id}` ? <div className="project-start-row-actions"><span>Delete browser copy?</span><button className="button small danger" disabled={disabled} onClick={() => { void projects.deleteSavedProject(item.id).then(deleted => { if (deleted) setDeleteCandidate(null); }); }}>Delete</button><button className="button small" onClick={() => setDeleteCandidate(null)}>Cancel</button></div>
              : <div className="project-start-row-actions"><button className="button small" disabled={disabled} onClick={() => { void projects.openSavedProject(item.id); }}><Play size={12} />Open</button><button className="icon-button small" aria-label={`Delete browser copy ${item.name}`} disabled={disabled} onClick={() => setDeleteCandidate(`browser:${item.id}`)}><Trash2 size={14} /></button></div>}
          </div>)}</div></>}
        </section>
        <section className="project-start-section" aria-labelledby="sample-projects-heading">
          <div className="project-start-section-heading"><div><h2 id="sample-projects-heading">Sample projects</h2><p>Take a ready-made project for a spin.</p></div></div>
          <div className="project-start-samples">{!ready
            ? <div className="project-start-sample-placeholder" aria-hidden="true" />
            : hasSampleProject
            ? <button className="project-start-sample" disabled={disabled} onClick={onOpenSampleProject}><span className="project-start-sample-icon"><Film size={20} /></span><span><strong>Sample project</strong><small>Explore an interactive edit</small></span><Play size={14} /></button>
            : <div className="project-start-sample-unavailable">No sample project is available on this server.</div>}</div>
        </section>
      </div>
    </div>
  </main>;
}
