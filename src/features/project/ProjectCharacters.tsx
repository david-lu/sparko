import { Plus, Trash2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { MAX_PROJECT_CHARACTERS } from '../../../shared/characters';
import { CharacterAvatar, characterSummary, useCharacterWorkspace } from './CharacterWorkspace';
import type { ProjectController } from './ProjectController';
import './characters.css';

/** The cast. Choosing a character edits it in the Characters workspace; removing one is undoable. */
export default function ProjectCharacters({ projects }: { projects: ProjectController }) {
  const characters = useSyncExternalStore(projects.subscribe, () => projects.getSnapshot().project?.characters) ?? [], workspace = useCharacterWorkspace();
  const editing = workspace?.view, full = characters.length >= MAX_PROJECT_CHARACTERS;
  return <section className="project-characters" aria-label="Project characters">
    <div className="project-characters-heading"><h3>Characters</h3>
      <button className="button" type="button" aria-pressed={!!editing && !editing.id} disabled={!workspace || full}
        title={full ? `Projects can have up to ${MAX_PROJECT_CHARACTERS} characters.` : 'Add a character'} onClick={() => workspace?.open()}><Plus size={12}/>Add character</button></div>
    <p className="hint">Each character’s voice speaks their dialogue. Their descriptions and reference images guide audio, image and video generation when a clip uses them.</p>
    {characters.length ? <ul>{characters.map(character => <li key={character.id} className="project-character-row">
      <button type="button" className="character-list-item" aria-label={`Edit ${character.name}`} aria-current={editing?.id === character.id ? 'true' : undefined} disabled={!workspace}
        onClick={() => workspace?.open(character.id)}>
        <CharacterAvatar character={character} projects={projects}/>
        <span className="project-character-label"><strong title={character.name}>{character.name}</strong><span className={character.voice ? undefined : 'is-missing'}>{characterSummary(character)}</span></span>
      </button>
      <button type="button" className="icon-button small project-character-remove" aria-label={`Remove ${character.name}`} title={`Remove ${character.name} (undoable)`}
        onClick={() => projects.setCharacters(characters.filter(c => c.id !== character.id))}><Trash2 size={13}/></button>
    </li>)}</ul> : <p className="project-characters-empty">No characters yet.</p>}
  </section>;
}
