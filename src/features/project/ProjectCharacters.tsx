import { Mic, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_PROJECT_CHARACTERS, type ProjectCharacter } from '../../../shared/characters';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import type { AppStatus } from '../../../shared/contracts';
import CharacterDialog from './CharacterDialog';
import type { ProjectController } from './ProjectController';
import './characters.css';

/** Saves a new or edited character into the project cast as one undoable edit. */
export const saveCharacter = (projects: ProjectController, character: ProjectCharacter) => {
  const characters = projects.getSnapshot().project?.characters ?? [];
  projects.setCharacters(characters.some(c => c.id === character.id) ? characters.map(c => c.id === character.id ? character : c) : [...characters, character]);
};
export function ProjectCharacterDialog({ projects, status, initial, onClose, restoreFocus }: {
  projects: ProjectController; status: AppStatus | null; initial?: ProjectCharacter; onClose: (saved?: ProjectCharacter) => void; restoreFocus: () => void;
}) {
  const project = projects.getSnapshot().project;
  return <CharacterDialog key={`${project?.id}:${initial?.id ?? 'new'}`} initial={initial} others={project?.characters ?? []}
    elevenlabs={!!status?.providers.elevenlabs} openai={!!status?.providers.openai} projectInstructions={projectPromptInstructions(project)}
    onCancel={() => onClose()} restoreFocus={restoreFocus} onSave={character => { saveCharacter(projects, character); onClose(character); }}/>;
}

export default function ProjectCharacters({ projects, status }: { projects: ProjectController; status: AppStatus | null }) {
  const characters = projects.getSnapshot().project?.characters ?? [];
  const [dialog, setDialog] = useState<ProjectCharacter | 'add' | null>(null);
  const trigger = useRef<HTMLElement | null>(null), addButton = useRef<HTMLButtonElement>(null);
  const open = (value: ProjectCharacter | 'add', element: HTMLElement) => { trigger.current = element; setDialog(value); };
  const full = characters.length >= MAX_PROJECT_CHARACTERS;
  return <section className="project-characters" aria-label="Project characters">
    <div className="project-characters-heading"><h3>Characters</h3><button ref={addButton} className="button" type="button" disabled={full}
      title={full ? `Projects can have up to ${MAX_PROJECT_CHARACTERS} characters.` : 'Add a character and their voice'} onClick={event => open('add', event.currentTarget)}><Plus size={12}/>Add character</button></div>
    <p className="hint">Dialogue uses each character’s ElevenLabs voice. Audio prompts follow how they sound.</p>
    {characters.length ? <ul>{characters.map(character => <li key={character.id}>
      <Mic size={14} aria-hidden="true"/>
      <div className="project-character-label"><strong title={character.name}>{character.name}</strong>
        <span className={character.voice ? undefined : 'is-missing'} title={character.voiceDescription}>{character.voice ? `Voice: ${character.voice.name}` : 'No voice yet'}{character.voiceDescription ? ` · ${character.voiceDescription}` : ''}</span></div>
      <div className="project-character-actions">
        <button className="icon-button small" type="button" aria-label={`Edit ${character.name}`} title="Edit character" onClick={event => open(character, event.currentTarget)}><Pencil size={12}/></button>
        <button className="icon-button small" type="button" aria-label={`Remove ${character.name}`} title="Remove character" onClick={() => { projects.setCharacters(characters.filter(c => c.id !== character.id)); addButton.current?.focus(); }}><Trash2 size={12}/></button>
      </div>
    </li>)}</ul> : <p className="project-characters-empty">No characters yet.</p>}
    {dialog && <ProjectCharacterDialog projects={projects} status={status} initial={dialog === 'add' ? undefined : dialog} onClose={() => setDialog(null)}
      restoreFocus={() => { if (trigger.current?.isConnected) trigger.current.focus(); else addButton.current?.focus(); }}/>}
  </section>;
}
