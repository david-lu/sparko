import { Mic, Plus, Sparkles, Trash2, UserRound, Users, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { CHARACTER_DESCRIPTION_MAX_LENGTH, CHARACTER_MAX_IMAGES, CHARACTER_NAME_MAX_LENGTH, MAX_PROJECT_CHARACTERS, characterKey, characterNameSchema, nextCharacterName, type ProjectCharacter } from '../../../shared/characters';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import type { AppStatus } from '../../../shared/contracts';
import AssetInput from './AssetInput';
import AssetThumbnail from './AssetThumbnail';
import VoicePicker from './VoicePicker';
import { enhanceVoiceDescription } from './elevenlabsVoices';
import type { ProjectController } from './ProjectController';
import './characters.css';

/** Opens the Characters workspace in place of the player and timeline. */
export type CharacterWorkspaceControls = { open: (characterId?: string, create?: boolean) => void; close: () => void };
export const CharacterWorkspaceContext = createContext<CharacterWorkspaceControls | null>(null);
export const useCharacterWorkspace = () => useContext(CharacterWorkspaceContext);

const IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
export const characterSummary = (character: ProjectCharacter) => [character.voice ? `Voice: ${character.voice.name}` : 'No voice',
  character.images?.length ? `${character.images.length} image${character.images.length === 1 ? '' : 's'}` : 'No images'].join(' · ');
export function CharacterAvatar({ character, projects }: { character: ProjectCharacter; projects: ProjectController }) {
  const first = character.images?.[0], asset = first && projects.getSnapshot().project?.library?.find(a => a.assetId === first.assetId);
  return asset ? <AssetThumbnail asset={asset} kind="image" name={character.name}/> : <span className="character-card-avatar" aria-hidden="true"><UserRound size={15}/></span>;
}

function CharacterEditor({ character, others, projects, status, focusName }: { character: ProjectCharacter; others: readonly ProjectCharacter[]; projects: ProjectController; status: AppStatus | null; focusName: boolean }) {
  const id = useId(), nameInput = useRef<HTMLInputElement>(null), enhancing = useRef<AbortController | null>(null);
  const [name, setName] = useState(character.name), [nameError, setNameError] = useState(''), [busy, setBusy] = useState(false), [enhanceError, setEnhanceError] = useState('');
  const update = (patch: Partial<Omit<ProjectCharacter, 'id'>>) => projects.updateCharacter(character.id, patch);
  useEffect(() => { setName(character.name); setNameError(''); }, [character.name]);
  useEffect(() => { if (focusName) { nameInput.current?.focus(); nameInput.current?.select(); } }, [focusName]);
  useEffect(() => () => enhancing.current?.abort(), []);
  // Names commit when editing ends, so a draft can pass through invalid states; scripts use them as speakers.
  const commitName = () => {
    const parsed = characterNameSchema.safeParse(name);
    const problem = !parsed.success ? parsed.error.issues[0].message : others.some(c => characterKey(c.name) === characterKey(parsed.data)) ? `Another character is already named ${parsed.data}.` : '';
    if (problem || !parsed.success) { setNameError(`${problem} Kept “${character.name}”.`); setName(character.name); return; }
    const next = parsed.data; setNameError(''); if (next !== character.name) update({ name: next }); setName(next);
  };
  const enhance = async () => {
    const draft = character.voiceDescription?.trim(); if (!draft || busy) return;
    const operation = new AbortController(); enhancing.current = operation; setBusy(true); setEnhanceError('');
    try {
      const result = await enhanceVoiceDescription(character.name, draft, projectPromptInstructions(projects.getSnapshot().project), operation.signal);
      // Typing during the request wins over the rewrite.
      if (!operation.signal.aborted && projects.getSnapshot().project?.characters?.find(c => c.id === character.id)?.voiceDescription?.trim() === draft) update({ voiceDescription: result.voiceDescription });
    } catch (cause) { if (!operation.signal.aborted) setEnhanceError(cause instanceof Error ? cause.message : 'Unable to enhance the description.'); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  };
  const images = character.images ?? [];
  return <div className="character-editor" role="region" aria-label={`${character.name} details`}>
    <div className="character-editor-column">
      <h3>Identity and look</h3>
      <label className="character-field" htmlFor={`${id}-name`}>Name</label>
      <input ref={nameInput} id={`${id}-name`} maxLength={CHARACTER_NAME_MAX_LENGTH} value={name} autoComplete="off" aria-invalid={!!nameError} aria-describedby={`${id}-name-help`}
        onChange={event => { setName(event.target.value); setNameError(''); }} onBlur={commitName}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setName(character.name); setNameError(''); } }}/>
      <p id={`${id}-name-help`} className={`hint character-field-help${nameError ? ' has-error' : ''}`} role="status">{nameError || `Prompts can mention ${character.name} by name; Enhance describes them instead.`}</p>
      <label className="character-field" htmlFor={`${id}-visual`}>How they look</label>
      <textarea id={`${id}-visual`} rows={5} maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH} value={character.visualDescription ?? ''}
        placeholder="Face, build, hair, clothing and distinguishing details" onChange={event => update({ visualDescription: event.target.value })}/>
      <p className="hint character-field-help">Image and video prompts use this when a clip features {character.name}.</p>
      <div className="character-images">
        <span className="character-field">Reference images</span>
        <AssetInput projects={projects} label={`${character.name} reference images`} kinds={['image']} maxCount={CHARACTER_MAX_IMAGES} imageFormats={IMAGE_FORMATS}
          value={images.map(image => ({ ...image, kind: 'image' as const }))} onChange={refs => update({ images: refs.map(({ assetId, name }) => ({ assetId, name })) })}/>
        <p className="hint">Drag up to {CHARACTER_MAX_IMAGES} images from the Library, or drop files. Image clips that use {character.name} send them as references; video clips can add them as Pictures.</p>
      </div>
    </div>
    <div className="character-editor-column">
      <h3>Voice</h3>
      <div className="character-field-heading"><label className="character-field" htmlFor={`${id}-voice`}>How they sound</label>
        <button type="button" className="text-button" disabled={!status?.providers.openai || !character.voiceDescription?.trim() || busy} aria-busy={busy} onClick={() => void enhance()}
          title={!status?.providers.openai ? 'OpenAI is not connected. Configure OPENAI_API_KEY on the server to enhance descriptions.' : 'Rewrite with OpenAI following ElevenLabs’ voice design guide'}>
          <span className="status-icon">{busy ? <span className="spinner"/> : <Sparkles size={12}/>}</span>{busy ? 'Enhancing…' : 'Enhance'}</button></div>
      <textarea id={`${id}-voice`} rows={4} maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH} value={character.voiceDescription ?? ''} readOnly={busy}
        placeholder="Age, accent, pitch, pace, timbre and attitude" onChange={event => update({ voiceDescription: event.target.value })}/>
      <p className={`hint character-field-help${enhanceError ? ' has-error' : ''}`} role="status">{enhanceError || 'Audio prompts, H3 voices and voice design follow this.'}</p>
      <div className="character-voice-row" role="group" aria-label={`${character.name} voice`}>
        <Mic size={13} aria-hidden="true"/><span title={character.voice?.name}>ElevenLabs voice: <strong>{character.voice?.name ?? 'None'}</strong></span>
        {character.voice && <button type="button" className="icon-button small" aria-label={`Remove ${character.name}’s voice`} title="Remove voice" onClick={() => update({ voice: undefined })}><X size={12}/></button>}
      </div>
      {status?.providers.elevenlabs ? <VoicePicker key={character.id} character={character} onUse={voice => update({ voice })}/>
        : <p className="hint character-voice-offline">Connect ElevenLabs with ELEVENLABS_API_KEY in .env to choose or design voices.</p>}
    </div>
    <button type="button" className="text-button character-remove" onClick={() => projects.setCharacters((projects.getSnapshot().project?.characters ?? []).filter(c => c.id !== character.id))}>
      <Trash2 size={12}/>Remove {character.name}</button>
  </div>;
}

/** The project's cast, edited in the main workspace so Library images can be dragged onto characters. */
export default function CharacterWorkspace({ projects, status, initialId, create = false, onClose }: { projects: ProjectController; status: AppStatus | null; initialId?: string; create?: boolean; onClose: () => void }) {
  const characters = useSyncExternalStore(projects.subscribe, () => projects.getSnapshot().project?.characters) ?? [];
  const [selectedId, setSelectedId] = useState(initialId), [created, setCreated] = useState<string>(), closeButton = useRef<HTMLButtonElement>(null);
  const selected = characters.find(c => c.id === selectedId) ?? characters[0], full = characters.length >= MAX_PROJECT_CHARACTERS;
  const add = () => {
    if (full) return;
    const character = { id: crypto.randomUUID(), name: nextCharacterName(characters) };
    projects.setCharacters([...characters, character]); setSelectedId(character.id); setCreated(character.id);
  };
  const opened = useRef(false);
  useEffect(() => { if (opened.current) return; opened.current = true; if (create) add(); else closeButton.current?.focus({ preventScroll: true }); }, []);
  return <section className="character-workspace" aria-label="Characters" onKeyDown={event => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('input,textarea,select')) { event.stopPropagation(); onClose(); } }}>
    <header className="character-workspace-header">
      <h2><Users size={15} aria-hidden="true"/>Characters</h2>
      <span className="hint">{characters.length} of {MAX_PROJECT_CHARACTERS}</span>
      <button type="button" className="button" disabled={full} title={full ? `Projects can have up to ${MAX_PROJECT_CHARACTERS} characters.` : 'Add a character'} onClick={add}><Plus size={12}/>Add character</button>
      <button ref={closeButton} type="button" className="icon-button" aria-label="Close characters" title="Back to the player and timeline (Esc)" onClick={onClose}><X size={15}/></button>
    </header>
    {characters.length ? <div className="character-workspace-body">
      <ul className="character-workspace-list" aria-label="Characters list">{characters.map(character => <li key={character.id}>
        <button type="button" className="character-list-item" aria-pressed={character.id === selected?.id} onClick={() => setSelectedId(character.id)}>
          <CharacterAvatar character={character} projects={projects}/>
          <span className="project-character-label"><strong title={character.name}>{character.name}</strong><span className={character.voice ? undefined : 'is-missing'}>{characterSummary(character)}</span></span>
        </button>
      </li>)}</ul>
      {selected && <CharacterEditor key={selected.id} character={selected} others={characters.filter(c => c.id !== selected.id)} projects={projects} status={status} focusName={created === selected.id}/>}
    </div> : <div className="character-workspace-empty">
      <UserRound size={28} aria-hidden="true"/>
      <p><strong>No characters yet</strong><span>Give each character a name, a voice, how they look and reference images. Dialogue, audio, image and video generation can then use them.</span></p>
      <button type="button" className="button primary" onClick={add}><Plus size={13}/>Add character</button>
    </div>}
  </section>;
}
