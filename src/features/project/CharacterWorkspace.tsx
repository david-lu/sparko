import { Check, Mic, Plus, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CHARACTER_DESCRIPTION_MAX_LENGTH, CHARACTER_MAX_IMAGES, CHARACTER_NAME_MAX_LENGTH, characterKey, characterSchema, nextCharacterName, type ProjectCharacter } from '../../../shared/characters';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import type { AppStatus } from '../../../shared/contracts';
import ModalBackdrop from '../../shared/ModalBackdrop';
import AssetInput from './AssetInput';
import AssetThumbnail from './AssetThumbnail';
import VoicePicker from './VoicePicker';
import { enhanceVoiceDescription } from './elevenlabsVoices';
import type { ProjectController } from './ProjectController';
import './characters.css';

/** The workspace either adds a character (no id) or edits one. It replaces the player and timeline. */
export type CharacterView = { id?: string; key: number };
export type CharacterWorkspaceControls = { view: CharacterView | null; open: (characterId?: string) => void; close: () => void };
export const CharacterWorkspaceContext = createContext<CharacterWorkspaceControls | null>(null);
export const useCharacterWorkspace = () => useContext(CharacterWorkspaceContext);

const IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
type Draft = Omit<ProjectCharacter, 'id'>;
export const characterSummary = (character: Draft) => [character.voice ? `Voice: ${character.voice.name}` : 'No voice',
  character.images?.length ? `${character.images.length} image${character.images.length === 1 ? '' : 's'}` : 'No images'].join(' · ');
export function CharacterAvatar({ character, projects }: { character: Draft; projects: ProjectController }) {
  const first = character.images?.[0], asset = first && projects.getSnapshot().project?.library?.find(a => a.assetId === first.assetId);
  return asset ? <AssetThumbnail asset={asset} kind="image" name={character.name}/> : <span className="character-card-avatar" aria-hidden="true"><UserRound size={15}/></span>;
}
/** The stored form: empty text and lists are omitted, so an unchanged draft compares equal. */
const clean = (draft: Draft): Draft => Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))) as Draft;
const draftOf = ({ id: _id, ...character }: ProjectCharacter): Draft => clean(character);
const same = (a: Draft, b: Draft) => JSON.stringify(clean({ ...a, name: a.name.trim() })) === JSON.stringify(clean(b));

function CharacterEditor({ draft, onChange, projects, status, autoFocus }: { draft: Draft; onChange: (patch: Partial<Draft>) => void; projects: ProjectController; status: AppStatus | null; autoFocus: boolean }) {
  const id = useId(), nameInput = useRef<HTMLInputElement>(null), enhancing = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [enhanceError, setEnhanceError] = useState(''), latest = useRef(draft); latest.current = draft;
  useEffect(() => { if (autoFocus) { nameInput.current?.focus(); nameInput.current?.select(); } }, [autoFocus]);
  useEffect(() => () => enhancing.current?.abort(), []);
  const enhance = async () => {
    const text = draft.voiceDescription?.trim(); if (!text || busy) return;
    const operation = new AbortController(); enhancing.current = operation; setBusy(true); setEnhanceError('');
    try {
      const result = await enhanceVoiceDescription(draft.name.trim() || 'Character', text, projectPromptInstructions(projects.getSnapshot().project), operation.signal);
      // Typing during the request wins over the rewrite.
      if (!operation.signal.aborted && latest.current.voiceDescription?.trim() === text) onChange({ voiceDescription: result.voiceDescription });
    } catch (cause) { if (!operation.signal.aborted) setEnhanceError(cause instanceof Error ? cause.message : 'Unable to enhance the description.'); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  };
  const name = draft.name.trim() || 'this character', images = draft.images ?? [];
  return <div className="character-editor">
    <div className="character-editor-column">
      <h3>Identity and look</h3>
      <label className="character-field" htmlFor={`${id}-name`}>Name</label>
      <input ref={nameInput} id={`${id}-name`} maxLength={CHARACTER_NAME_MAX_LENGTH} value={draft.name} autoComplete="off" onChange={event => onChange({ name: event.target.value })}/>
      <p className="hint character-field-help">Prompts can mention {name} by name; Enhance describes them instead.</p>
      <label className="character-field" htmlFor={`${id}-visual`}>How they look</label>
      <textarea id={`${id}-visual`} rows={5} maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH} value={draft.visualDescription ?? ''}
        placeholder="Face, build, hair, clothing and distinguishing details" onChange={event => onChange({ visualDescription: event.target.value })}/>
      <p className="hint character-field-help">Image and video prompts use this when a clip features {name}.</p>
      <div className="character-images">
        <span className="character-field">Reference images</span>
        <AssetInput projects={projects} label="Character reference images" kinds={['image']} maxCount={CHARACTER_MAX_IMAGES} imageFormats={IMAGE_FORMATS}
          value={images.map(image => ({ ...image, kind: 'image' as const }))} onChange={refs => onChange({ images: refs.map(({ assetId, name }) => ({ assetId, name })) })}/>
        <p className="hint">Drag up to {CHARACTER_MAX_IMAGES} images from the Library, or drop files. Image clips that use {name} send them as references; video clips can add them as Pictures.</p>
      </div>
    </div>
    <div className="character-editor-column">
      <h3>Voice</h3>
      <div className="character-field-heading"><label className="character-field" htmlFor={`${id}-voice`}>How they sound</label>
        <button type="button" className="text-button" disabled={!status?.providers.openai || !draft.voiceDescription?.trim() || busy} aria-busy={busy} onClick={() => void enhance()}
          title={!status?.providers.openai ? 'OpenAI is not connected. Configure OPENAI_API_KEY on the server to enhance descriptions.' : 'Rewrite with OpenAI following ElevenLabs’ voice design guide'}>
          <span className="status-icon">{busy ? <span className="spinner"/> : <Sparkles size={12}/>}</span>{busy ? 'Enhancing…' : 'Enhance'}</button></div>
      <textarea id={`${id}-voice`} rows={4} maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH} value={draft.voiceDescription ?? ''} readOnly={busy}
        placeholder="Age, accent, pitch, pace, timbre and attitude" onChange={event => onChange({ voiceDescription: event.target.value })}/>
      <p className={`hint character-field-help${enhanceError ? ' has-error' : ''}`} role="status">{enhanceError || 'Audio prompts, H3 voices and voice design follow this.'}</p>
      <div className="character-voice-row" role="group" aria-label="Character voice">
        <Mic size={13} aria-hidden="true"/><span title={draft.voice?.name}>ElevenLabs voice: <strong>{draft.voice?.name ?? 'None'}</strong></span>
        {draft.voice && <button type="button" className="icon-button small" aria-label="Remove voice" title="Remove voice" onClick={() => onChange({ voice: undefined })}><X size={12}/></button>}
      </div>
      {status?.providers.elevenlabs ? <VoicePicker character={{ id: 'draft', ...draft, name: draft.name.trim() || 'Character' }} onUse={voice => onChange({ voice })}/>
        : <p className="hint character-voice-offline">Connect ElevenLabs with ELEVENLABS_API_KEY in .env to choose or design voices.</p>}
    </div>
  </div>;
}

/** Adds or edits one character. Changes apply with Add character or Save changes; leaving asks before discarding them. */
export default function CharacterWorkspace({ projects, status, view, onSelect, onClose }: {
  projects: ProjectController; status: AppStatus | null; view: CharacterView; onSelect: (characterId?: string) => void; onClose: () => void;
}) {
  const id = useId(), characters = useSyncExternalStore(projects.subscribe, () => projects.getSnapshot().project?.characters) ?? [];
  const blank = (): Draft => ({ name: nextCharacterName(characters) });
  const [active, setActive] = useState<CharacterView>(view);
  const stored = active.id ? characters.find(c => c.id === active.id) : undefined;
  const [baseline, setBaseline] = useState<Draft>(() => stored ? draftOf(stored) : blank());
  const [draft, setDraft] = useState<Draft>(baseline), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ view?: CharacterView; close?: boolean } | null>(null);
  const footer = useRef<HTMLElement>(null);
  const adding = !active.id, dirty = !same(draft, baseline);
  const load = (next: CharacterView) => {
    const character = next.id ? characters.find(c => c.id === next.id) : undefined, start = character ? draftOf(character) : blank();
    setActive(next); setBaseline(start); setDraft(start); setError(''); setNotice('');
  };
  // Another character chosen in the inspector, or Add: switch, unless that would discard changes.
  useEffect(() => {
    if (view.key === active.key) return;
    // The same character (or Add while adding) only syncs the selection; it never reloads the draft.
    if (view.id === active.id) { setActive(view); return; }
    if (dirty) setPending({ view }); else load(view);
  }, [view.key]);
  // Undo or another edit refreshes the saved version; a removed character closes the editor.
  useEffect(() => {
    if (!active.id) return;
    if (!stored) { onClose(); return; }
    const next = draftOf(stored);
    if (same(next, baseline)) return;
    if (!dirty) setDraft(next);
    setBaseline(next);
  }, [stored]);
  const change = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); setNotice(''); };
  const requestClose = () => { if (dirty) setPending({ close: true }); else onClose(); };
  const submit = () => {
    const others = characters.filter(c => c.id !== active.id), name = draft.name.trim();
    if (others.some(c => characterKey(c.name) === characterKey(name))) { setError(`Another character is already named ${name}.`); return; }
    const parsed = characterSchema.safeParse({ id: active.id ?? crypto.randomUUID(), ...clean({ ...draft, name }) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    projects.setCharacters(adding ? [...characters, parsed.data] : characters.map(c => c.id === parsed.data.id ? parsed.data : c));
    const saved = draftOf(parsed.data);
    setActive({ id: parsed.data.id, key: view.key }); setBaseline(saved); setDraft(saved); setError(''); setNotice(adding ? `${name} added.` : 'Changes saved.');
    onSelect(parsed.data.id);
  };
  const remove = () => { if (!active.id) return; projects.setCharacters(characters.filter(c => c.id !== active.id)); onClose(); };
  const discard = () => { const request = pending; setPending(null); if (request?.close) onClose(); else if (request?.view) load(request.view); };
  // Put the inspector's selection back on the character still being edited.
  const keepEditing = () => { setPending(null); onSelect(active.id); };
  return <section className="character-workspace" aria-labelledby={`${id}-title`}
    onKeyDown={event => { if (event.key === 'Escape' && !pending && !(event.target as HTMLElement).closest('input,textarea,select')) { event.stopPropagation(); requestClose(); } }}>
    <form className="character-workspace-form" noValidate onSubmit={event => { event.preventDefault(); if (dirty || adding) submit(); }}>
      <header className="character-workspace-header">
        <CharacterAvatar character={draft} projects={projects}/>
        <h2 id={`${id}-title`}>{adding ? 'Add character' : `Edit ${baseline.name}`}</h2>
        <span className="hint">{adding ? 'Fill in what you know; you can change it later.' : dirty ? 'Unsaved changes' : characterSummary(baseline)}</span>
        <button type="button" className="icon-button" aria-label="Close characters" title="Back to the player and timeline (Esc)" onClick={requestClose}><X size={15}/></button>
      </header>
      <CharacterEditor key={active.id ?? `new:${active.key}`} draft={draft} onChange={change} projects={projects} status={status} autoFocus={adding}/>
      <footer ref={footer} className="character-workspace-footer">
        {adding ? <button type="button" className="button large" onClick={onClose}>Cancel</button>
          : <button type="button" className="button large danger" onClick={remove}><Trash2 size={15}/>Remove character</button>}
        <p className={`character-workspace-status${error ? ' has-error' : ''}`} role="status">{error || notice}</p>
        <button type="submit" className="button primary large" disabled={!adding && !dirty}>{adding ? <><Plus size={15}/>Add character</> : <><Check size={15}/>Save changes</>}</button>
      </footer>
    </form>
    {pending && createPortal(<ModalBackdrop labelledBy={`${id}-discard`} onCancel={keepEditing} restoreFocus={() => footer.current?.querySelector<HTMLButtonElement>('button[type=submit]')?.focus()}>
      <div className="project-card character-discard">
        <h2 id={`${id}-discard`}>Discard unsaved changes?</h2>
        <p className="hint">{adding ? 'This character has not been added yet.' : `Your changes to ${baseline.name} have not been saved.`}</p>
        <div className="close-project-actions">
          <button autoFocus type="button" className="button" onClick={keepEditing}>Keep editing</button>
          <button type="button" className="button danger" onClick={discard}>Discard changes</button>
        </div>
      </div>
    </ModalBackdrop>, document.body)}
  </section>;
}
