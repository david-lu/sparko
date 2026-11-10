import { useId, useSyncExternalStore } from 'react';
import { PROMPT_INSTRUCTIONS_MAX_LENGTH } from '../../../shared/prompt-instructions';
import type { ProjectController } from './ProjectController';

export default function ProjectPromptInstructions({ projects }: { projects: ProjectController }) {
  const id = useId(), value = useSyncExternalStore(projects.subscribe, projects.getSnapshot).project?.promptInstructions ?? '';
  return <section className="project-prompt-instructions" aria-label="Project enhance instructions">
    <h3><label htmlFor={id}>Enhance instructions</label></h3>
    <p className="hint" id={`${id}-hint`}>Enhance prompt and Edit with AI follow these for every prompt in this project. A prompt’s own text takes precedence.</p>
    <textarea id={id} aria-describedby={`${id}-hint`} rows={4} maxLength={PROMPT_INSTRUCTIONS_MAX_LENGTH} value={value} spellCheck
      placeholder="Style, setting, language or wording to apply to every prompt" onChange={event => projects.setPromptInstructions(event.target.value)}/>
  </section>;
}
