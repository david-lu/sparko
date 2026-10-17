import { FilePlus2, Film, FolderOpen, Play, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ProjectController } from '../features/project/ProjectController';

type State = ReturnType<ProjectController['getSnapshot']>;
type Props = {
  projects: ProjectController;
  state: State;
  ready: boolean;
  error: string | null;
  hasExample: boolean;
  onOpenVideo: () => void;
  onOpenProject: () => void;
  onOpenSample: () => void;
  onOpenExample: () => void;
  onDismissError: () => void;
};

export default function ProjectStart({ projects, state, ready, error, hasExample, onOpenVideo, onOpenProject,
  onOpenSample, onOpenExample, onDismissError }: Props) {
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const disabled = !ready || state.busy;
  return <main className="project-start">
    <div className="project-start-content">
      <header className="project-start-header">
        <div><div className="project-start-brand">SPARKO</div><h1>Choose a project</h1><p>Pick up where you left off, explore a sample, or start with your own video.</p></div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button small" aria-label="Dismiss error" onClick={onDismissError}><X size={16} /></button></div>}
      {(!ready || state.busy) && <div className="project-start-status" role="status"><span className="spinner" /><span>{state.busy ? state.message : 'Loading projects'}{state.progress !== null ? ` · ${Math.round(state.progress * 100)}%` : ''}</span>{state.busy && <button className="icon-button small" aria-label="Cancel project operation" onClick={() => projects.cancel()}><X size={14} /></button>}</div>}
      <div className="project-start-actions">
        <button className="project-start-action primary" disabled={disabled} onClick={onOpenVideo}><span className="project-start-action-icon"><FilePlus2 size={24} /></span><strong>Create project from video</strong><span>Choose a video file to begin editing</span></button>
        <button className="project-start-action" disabled={disabled} onClick={onOpenProject}><span className="project-start-action-icon"><FolderOpen size={24} /></span><strong>Open project file</strong><span>Open a saved .sparko file</span></button>
      </div>
      <div className="project-start-sections">
        <section className="project-start-section" aria-labelledby="recent-projects-heading">
          <div className="project-start-section-heading"><h2 id="recent-projects-heading">Recent projects</h2><span>{state.recentFiles.length + state.savedProjects.length}</span></div>
          {ready && state.recentFiles.length === 0 && state.savedProjects.length === 0 && <div className="project-start-empty">Projects you open or save will appear here.</div>}
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
          <div className="project-start-section-heading"><h2 id="sample-projects-heading">Sample projects</h2></div>
          <div className="project-start-samples"><button className="project-start-sample" disabled={disabled} onClick={onOpenSample}><span className="project-start-sample-icon"><Film size={20} /></span><span><strong>Sample video</strong><small>A clean project to explore the editor</small></span><Play size={14} /></button>
            {hasExample && <button className="project-start-sample" disabled={disabled} onClick={onOpenExample}><span className="project-start-sample-icon"><Film size={20} /></span><span><strong>Example project</strong><small>A project with a ready made timeline</small></span><Play size={14} /></button>}</div>
        </section>
      </div>
    </div>
  </main>;
}
