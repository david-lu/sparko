import { Plus } from 'lucide-react';
import type { ProjectCharacter } from '../../../shared/characters';
import './characters.css';

/** Toggle chips that select project characters for a generation. */
export default function CharacterPicker({ characters, selected, onToggle, onManage, disabled = false, label = 'Characters', hint, unavailable }: {
  characters: readonly ProjectCharacter[]; selected: readonly string[]; onToggle: (id: string) => void; onManage?: () => void;
  disabled?: boolean; label?: string; hint?: string; unavailable?: (character: ProjectCharacter) => string | undefined;
}) {
  return <div className="dialogue-cast character-picker" role="group" aria-label={label}>
    <div className="dialogue-cast-heading"><span>{label}{hint ? ` · ${hint}` : ''}</span>
      {onManage && <button type="button" className="text-button" onClick={onManage}><Plus size={11}/>New character</button>}</div>
    <ul>{characters.length ? characters.map(character => {
      const pressed = selected.includes(character.id), reason = pressed ? undefined : unavailable?.(character);
      return <li key={character.id}><button type="button" aria-pressed={pressed} disabled={disabled || !!reason} title={reason ?? `${pressed ? 'Stop using' : 'Use'} ${character.name}`}
        aria-label={`Use ${character.name}`} onClick={() => onToggle(character.id)}><span>{character.name}</span></button></li>;
    }) : <li className="dialogue-cast-empty">No characters yet.</li>}</ul>
  </div>;
}
