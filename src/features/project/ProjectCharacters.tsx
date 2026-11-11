import { Plus, Users } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { MAX_PROJECT_CHARACTERS } from '../../../shared/characters';
import { CharacterAvatar, characterSummary, useCharacterWorkspace } from './CharacterWorkspace';
import type { ProjectController } from './ProjectController';
import './characters.css';

/** A summary of the cast; characters are edited in the Characters workspace. */
export default function ProjectCharacters({ projects }: { projects: ProjectController }) {
  const characters = useSyncExternalStore(projects.subscribe, () => projects.getSnapshot().project?.characters) ?? [], workspace = useCharacterWorkspace();
  return <section className="project-characters" aria-label="Project characters">
    <div className="project-characters-heading"><h3>Characters</h3>
      <div className="project-characters-actions">
        <button className="button" type="button" disabled={!workspace || characters.length >= MAX_PROJECT_CHARACTERS} onClick={() => workspace?.open(undefined, true)}><Plus size={12}/>Add</button>
        <button className="button" type="button" disabled={!workspace} onClick={() => workspace?.open()}><Users size={12}/>Open characters</button>
      </div></div>
    <p className="hint">Each character’s voice speaks their dialogue. Their descriptions and reference images guide audio, image and video generation when a clip uses them.</p>
    {characters.length ? <ul>{characters.map(character => <li key={character.id}>
      <button type="button" className="character-list-item" aria-label={`Edit ${character.name}`} disabled={!workspace} onClick={() => workspace?.open(character.id)}>
        <CharacterAvatar character={character} projects={projects}/>
        <span className="project-character-label"><strong title={character.name}>{character.name}</strong><span className={character.voice ? undefined : 'is-missing'}>{characterSummary(character)}</span></span>
      </button>
    </li>)}</ul> : <p className="project-characters-empty">No characters yet.</p>}
  </section>;
}
