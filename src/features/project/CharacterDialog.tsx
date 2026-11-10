import { Check, Mic, Pause, Play, Search, Sparkles, Wand2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHARACTER_NAME_MAX_LENGTH, CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH, characterKey, characterSchema, type CharacterVoice, type ProjectCharacter } from '../../../shared/characters';
import ModalBackdrop from '../../shared/ModalBackdrop';
import { designVoices, enhanceVoiceDescription, saveDesignedVoice, searchVoices, voiceLabels, type VoiceOption, type VoicePreview } from './elevenlabsVoices';
import './characters.css';

const MIN_DESIGN_DESCRIPTION = 20;
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

/** One preview plays at a time; it stops when the dialog closes. */
function usePreviewPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null), [playing, setPlaying] = useState<string>();
  useEffect(() => () => { audio.current?.pause(); }, []);
  const stop = () => { audio.current?.pause(); setPlaying(undefined); };
  const toggle = (key: string, url: string) => {
    if (playing === key) { stop(); return; }
    audio.current?.pause();
    const element = new Audio(url); audio.current = element; setPlaying(key);
    element.onended = element.onerror = () => { if (audio.current === element) setPlaying(undefined); };
    void element.play().catch(() => { if (audio.current === element) setPlaying(undefined); });
  };
  return { playing, toggle, stop };
}
function PlayButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="icon-button small character-voice-play" aria-label={`${active ? 'Stop' : 'Play'} ${label}`} title={`${active ? 'Stop' : 'Play'} preview`} aria-pressed={active} onClick={onClick}>
    {active ? <Pause size={12}/> : <Play size={12}/>}
  </button>;
}

export default function CharacterDialog({ initial, others, elevenlabs, openai, projectInstructions, onSave, onCancel, restoreFocus }: {
  initial?: ProjectCharacter; others: readonly ProjectCharacter[]; elevenlabs: boolean; openai: boolean; projectInstructions?: string;
  onSave: (character: ProjectCharacter) => void; onCancel: () => void; restoreFocus: () => void;
}) {
  const id = useId(), operations = useRef(new Set<AbortController>()), player = usePreviewPlayer();
  const [name, setName] = useState(initial?.name ?? ''), [description, setDescription] = useState(initial?.voiceDescription ?? '');
  const [voice, setVoice] = useState<CharacterVoice | undefined>(initial?.voice), [designed, setDesigned] = useState<{ preview: VoicePreview; index: number }>();
  const [mode, setMode] = useState<'choose' | 'design'>('choose'), [search, setSearch] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>([]), [nextPage, setNextPage] = useState<string>(), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  const [previews, setPreviews] = useState<VoicePreview[]>([]), [designing, setDesigning] = useState(false), [enhancing, setEnhancing] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const searchRun = useRef<AbortController | null>(null);
  useEffect(() => () => { for (const operation of operations.current) operation.abort(); }, []);
  /** Track every request so closing the dialog cancels it and late results are ignored. */
  const start = () => { const operation = new AbortController(); operations.current.add(operation); return operation; };
  const finish = (operation: AbortController) => { operations.current.delete(operation); return !operation.signal.aborted; };
  const load = async (query: string, page?: string) => {
    searchRun.current?.abort(); const operation = start(); searchRun.current = operation;
    setSearching(true); setSearchError('');
    try {
      const result = await searchVoices(query, page, operation.signal);
      if (!operation.signal.aborted) { setVoices(current => page ? [...current, ...result.voices] : result.voices); setNextPage(result.nextPageToken); }
    } catch (cause) { if (!operation.signal.aborted) setSearchError(message(cause, 'Unable to load ElevenLabs voices.')); }
    finally { if (finish(operation)) setSearching(false); }
  };
  useEffect(() => {
    if (!elevenlabs || mode !== 'choose') return;
    const timer = window.setTimeout(() => void load(search), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [search, mode, elevenlabs]);
  const trimmedName = name.trim(), trimmedDescription = description.trim();
  const duplicate = others.some(other => other.id !== initial?.id && characterKey(other.name) === characterKey(trimmedName));
  const design = async () => {
    if (trimmedDescription.length < MIN_DESIGN_DESCRIPTION || designing) return;
    const operation = start(); setDesigning(true); setError(''); player.stop();
    try {
      const result = await designVoices(trimmedDescription, operation.signal);
      if (!operation.signal.aborted) { setPreviews(result.previews); setDesigned(undefined); }
    } catch (cause) { if (!operation.signal.aborted) setError(message(cause, 'Unable to design voices.')); }
    finally { if (finish(operation)) setDesigning(false); }
  };
  const enhance = async () => {
    if (!trimmedDescription || enhancing) return;
    const operation = start(); setEnhancing(true); setError('');
    try {
      const result = await enhanceVoiceDescription(trimmedName || 'Character', trimmedDescription, projectInstructions, operation.signal);
      if (!operation.signal.aborted) setDescription(result.voiceDescription);
    } catch (cause) { if (!operation.signal.aborted) setError(message(cause, 'Unable to enhance the description.')); }
    finally { if (finish(operation)) setEnhancing(false); }
  };
  const submit = async () => {
    if (saving) return;
    if (duplicate) { setError(`Another character is already named ${trimmedName}.`); return; }
    const draft = { id: initial?.id ?? crypto.randomUUID(), name: trimmedName, ...(trimmedDescription ? { voiceDescription: trimmedDescription } : {}), ...(voice ? { voice } : {}) };
    const parsed = characterSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!designed) { onSave(parsed.data); return; }
    const operation = start(); setSaving(true); setError(''); player.stop();
    try {
      const saved = await saveDesignedVoice(parsed.data.name, trimmedDescription, designed.preview.generatedVoiceId, operation.signal);
      if (!operation.signal.aborted) onSave({ ...parsed.data, voice: saved });
    } catch (cause) { if (!operation.signal.aborted) setError(message(cause, 'Unable to save the designed voice.')); }
    finally { if (finish(operation)) setSaving(false); }
  };
  const cancel = () => { for (const operation of operations.current) operation.abort(); onCancel(); };
  const current = designed ? `Designed voice ${designed.index + 1}` : voice?.name;
  // Generation controls live in a form; keep this dialog's form outside it.
  return createPortal(<ModalBackdrop labelledBy={`${id}-title`} onCancel={cancel} restoreFocus={restoreFocus}>
    <form className="project-card character-dialog" aria-busy={saving} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void submit(); }}>
      <h2 id={`${id}-title`}>{initial ? 'Edit character' : 'Add character'}</h2>
      <fieldset disabled={saving}>
        <label className="field" htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} autoFocus required maxLength={CHARACTER_NAME_MAX_LENGTH} value={name} autoComplete="off" aria-invalid={duplicate}
          aria-describedby={`${id}-name-help`} placeholder="Mara" onChange={event => { setName(event.target.value); setError(''); }}/>
        <p id={`${id}-name-help`} className="hint">Dialogue scripts use this name, for example “{trimmedName || 'Mara'}: Hello.”</p>
        <div className="character-field-heading"><label className="field" htmlFor={`${id}-description`}>How they sound</label>
          <button type="button" className="text-button" disabled={!openai || !trimmedDescription || enhancing} aria-busy={enhancing} onClick={() => void enhance()}
            title={!openai ? 'OpenAI is not connected. Configure OPENAI_API_KEY on the server to enhance descriptions.' : !trimmedDescription ? 'Describe the voice first.' : 'Rewrite with OpenAI following ElevenLabs’ voice design guide'}>
            <span className="status-icon">{enhancing ? <span className="spinner"/> : <Sparkles size={12}/>}</span>{enhancing ? 'Enhancing…' : 'Enhance'}</button></div>
        <textarea id={`${id}-description`} rows={4} maxLength={CHARACTER_VOICE_DESCRIPTION_MAX_LENGTH} value={description} readOnly={enhancing} aria-describedby={`${id}-description-help`}
          placeholder="Native English, London. Female, early 30s. Warm, low and slightly husky; speaks quickly with dry humour." onChange={event => setDescription(event.target.value)}/>
        <p id={`${id}-description-help`} className="hint">Age, accent, pitch, pace, timbre and attitude. Audio prompts and voice design follow this.</p>
        <div className="character-voice" role="group" aria-labelledby={`${id}-voice`}>
          <div className="character-voice-current"><Mic size={14} aria-hidden="true"/><span id={`${id}-voice`}>Voice</span>
            <strong title={current}>{current ?? 'None selected'}</strong>
            {(voice || designed) && <button type="button" className="icon-button small" aria-label="Clear voice" title="Clear voice" onClick={() => { setVoice(undefined); setDesigned(undefined); }}><X size={12}/></button>}
          </div>
          {!elevenlabs ? <p className="character-voice-panel hint">Connect ElevenLabs with ELEVENLABS_API_KEY in .env to choose or design voices.</p> : <>
            <div className="character-voice-modes" role="group" aria-label="Voice source">
              <button type="button" aria-pressed={mode === 'choose'} onClick={() => setMode('choose')}><Search size={12}/>Choose voice</button>
              <button type="button" aria-pressed={mode === 'design'} onClick={() => { setMode('design'); player.stop(); }}><Wand2 size={12}/>Design voice</button>
            </div>
            {mode === 'choose' ? <div className="character-voice-panel">
              <input type="search" aria-label="Search ElevenLabs voices" placeholder="Search your ElevenLabs voices" value={search} onChange={event => setSearch(event.target.value)}/>
              <ul className="character-voice-list" aria-label="ElevenLabs voices" aria-busy={searching}>
                {voices.map(option => <li key={option.id}>
                  <button type="button" className="character-voice-option" aria-pressed={!designed && voice?.id === option.id} onClick={() => { setVoice({ id: option.id, name: option.name }); setDesigned(undefined); }}>
                    {!designed && voice?.id === option.id ? <Check size={12} aria-hidden="true"/> : <span className="character-voice-check" aria-hidden="true"/>}
                    <span><strong>{option.name}</strong><small>{voiceLabels(option)}</small></span>
                  </button>
                  {option.previewUrl && <PlayButton label={`${option.name} preview`} active={player.playing === option.id} onClick={() => player.toggle(option.id, option.previewUrl!)}/>}
                </li>)}
                {!voices.length && <li className="character-voice-empty" role="status">{searching ? 'Loading voices…' : searchError || (search ? 'No voices match this search.' : 'No voices found.')}</li>}
              </ul>
              <div className="character-voice-more">{nextPage && <button type="button" className="text-button" disabled={searching} onClick={() => void load(search, nextPage)}>{searching ? 'Loading…' : 'Load more voices'}</button>}
                {voices.length > 0 && searchError && <span className="hint">{searchError}</span>}</div>
            </div> : <div className="character-voice-panel">
              <button type="button" className="button character-design" disabled={trimmedDescription.length < MIN_DESIGN_DESCRIPTION || designing} aria-busy={designing} onClick={() => void design()}>
                <span className="status-icon">{designing ? <span className="spinner"/> : <Wand2 size={13}/>}</span>{designing ? 'Designing voices…' : previews.length ? 'Design new voices' : 'Design voices from description'}</button>
              <ul className="character-voice-list" aria-label="Designed voices" aria-busy={designing}>
                {previews.map((preview, index) => <li key={preview.generatedVoiceId}>
                  <button type="button" className="character-voice-option" aria-pressed={designed?.preview.generatedVoiceId === preview.generatedVoiceId} onClick={() => { setDesigned({ preview, index }); }}>
                    {designed?.preview.generatedVoiceId === preview.generatedVoiceId ? <Check size={12} aria-hidden="true"/> : <span className="character-voice-check" aria-hidden="true"/>}
                    <span><strong>Designed voice {index + 1}</strong><small>{preview.duration ? `${preview.duration.toFixed(1)} s sample` : 'Sample'}</small></span>
                  </button>
                  <PlayButton label={`designed voice ${index + 1}`} active={player.playing === preview.generatedVoiceId} onClick={() => player.toggle(preview.generatedVoiceId, preview.audio)}/>
                </li>)}
                {!previews.length && <li className="character-voice-empty" role="status">{designing ? 'Designing three voices from the description…'
                  : trimmedDescription.length < MIN_DESIGN_DESCRIPTION ? `Describe how ${trimmedName || 'they'} sound${trimmedName ? 's' : ''} in at least ${MIN_DESIGN_DESCRIPTION} characters to design a voice.` : 'ElevenLabs creates three voices to compare.'}</li>}
              </ul>
              <p className="hint character-voice-more">The chosen voice is saved to your ElevenLabs account when you save the character.</p>
            </div>}
          </>}
        </div>
      </fieldset>
      <div className="lora-dialog-feedback character-dialog-feedback" role="status">{error}</div>
      <div className="close-project-actions">
        <button className="button" type="button" onClick={cancel}>Cancel</button>
        <button className="button primary character-save" type="submit" disabled={saving || !trimmedName || duplicate}>
          <span className="status-icon">{saving && <span className="spinner"/>}</span>{saving ? 'Saving voice…' : initial ? 'Save character' : 'Add character'}
        </button>
      </div>
    </form>
  </ModalBackdrop>, document.body);
}
