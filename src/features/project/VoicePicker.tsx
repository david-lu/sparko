import { Check, Pause, Play, Search, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CharacterVoice, ProjectCharacter } from '../../../shared/characters';
import { designVoices, saveDesignedVoice, searchVoices, voiceLabels, type VoiceOption, type VoicePreview } from './elevenlabsVoices';
import './characters.css';

export const MIN_DESIGN_DESCRIPTION = 20;
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

/** One preview plays at a time; it stops when the picker unmounts. */
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

/** Choose a voice from the ElevenLabs account, or design one from how the character sounds. */
export default function VoicePicker({ character, onUse }: { character: ProjectCharacter; onUse: (voice: CharacterVoice) => void }) {
  const operations = useRef(new Set<AbortController>()), player = usePreviewPlayer(), searchRun = useRef<AbortController | null>(null);
  const description = character.voiceDescription?.trim() ?? '';
  const [mode, setMode] = useState<'choose' | 'design'>('choose'), [search, setSearch] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>([]), [nextPage, setNextPage] = useState<string>(), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  const [previews, setPreviews] = useState<VoicePreview[]>([]), [designing, setDesigning] = useState(false), [saving, setSaving] = useState<string>(), [error, setError] = useState('');
  useEffect(() => () => { for (const operation of operations.current) operation.abort(); }, []);
  /** Track every request so leaving cancels it and late results are ignored. */
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
    if (mode !== 'choose') return;
    const timer = window.setTimeout(() => void load(search), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [search, mode]);
  const design = async () => {
    if (description.length < MIN_DESIGN_DESCRIPTION || designing) return;
    const operation = start(); setDesigning(true); setError(''); player.stop();
    try { const result = await designVoices(description, operation.signal); if (!operation.signal.aborted) setPreviews(result.previews); }
    catch (cause) { if (!operation.signal.aborted) setError(message(cause, 'Unable to design voices.')); }
    finally { if (finish(operation)) setDesigning(false); }
  };
  const useDesigned = async (preview: VoicePreview) => {
    if (saving) return;
    const operation = start(); setSaving(preview.generatedVoiceId); setError(''); player.stop();
    try { const voice = await saveDesignedVoice(character.name, description, preview.generatedVoiceId, operation.signal); if (!operation.signal.aborted) { onUse(voice); setPreviews([]); } }
    catch (cause) { if (!operation.signal.aborted) setError(message(cause, 'Unable to save the designed voice.')); }
    finally { if (finish(operation)) setSaving(undefined); }
  };
  return <div className="character-voice" role="group" aria-label={`${character.name} voice options`}>
    <div className="character-voice-modes" role="group" aria-label="Voice source">
      <button type="button" aria-pressed={mode === 'choose'} onClick={() => setMode('choose')}><Search size={12}/>Choose voice</button>
      <button type="button" aria-pressed={mode === 'design'} onClick={() => { setMode('design'); player.stop(); }}><Wand2 size={12}/>Design voice</button>
    </div>
    {mode === 'choose' ? <div className="character-voice-panel">
      <input type="search" aria-label="Search ElevenLabs voices" placeholder="Search your ElevenLabs voices" value={search} onChange={event => setSearch(event.target.value)}/>
      <ul className="character-voice-list" aria-label="ElevenLabs voices" aria-busy={searching}>
        {voices.map(option => <li key={option.id}>
          <button type="button" className="character-voice-option" aria-pressed={character.voice?.id === option.id} onClick={() => onUse({ id: option.id, name: option.name })}>
            {character.voice?.id === option.id ? <Check size={12} aria-hidden="true"/> : <span className="character-voice-check" aria-hidden="true"/>}
            <span><strong>{option.name}</strong><small>{voiceLabels(option)}</small></span>
          </button>
          {option.previewUrl && <PlayButton label={`${option.name} preview`} active={player.playing === option.id} onClick={() => player.toggle(option.id, option.previewUrl!)}/>}
        </li>)}
        {!voices.length && <li className="character-voice-empty" role="status">{searching ? 'Loading voices…' : searchError || (search ? 'No voices match this search.' : 'No voices found.')}</li>}
      </ul>
      <div className="character-voice-more">{nextPage && <button type="button" className="text-button" disabled={searching} onClick={() => void load(search, nextPage)}>{searching ? 'Loading…' : 'Load more voices'}</button>}
        {voices.length > 0 && searchError && <span className="hint">{searchError}</span>}</div>
    </div> : <div className="character-voice-panel">
      <button type="button" className="button character-design" disabled={description.length < MIN_DESIGN_DESCRIPTION || designing || !!saving} aria-busy={designing} onClick={() => void design()}>
        <span className="status-icon">{designing ? <span className="spinner"/> : <Wand2 size={13}/>}</span>{designing ? 'Designing voices…' : previews.length ? 'Design new voices' : 'Design voices from “How they sound”'}</button>
      <ul className="character-voice-list" aria-label="Designed voices" aria-busy={designing}>
        {previews.map((preview, index) => <li key={preview.generatedVoiceId}>
          <PlayButton label={`designed voice ${index + 1}`} active={player.playing === preview.generatedVoiceId} onClick={() => player.toggle(preview.generatedVoiceId, preview.audio)}/>
          <span className="character-voice-option is-static"><span><strong>Designed voice {index + 1}</strong><small>{preview.duration ? `${preview.duration.toFixed(1)} s sample` : 'Sample'}</small></span></span>
          <button type="button" className="button character-voice-use" disabled={!!saving} aria-busy={saving === preview.generatedVoiceId} onClick={() => void useDesigned(preview)}>
            <span className="status-icon">{saving === preview.generatedVoiceId && <span className="spinner"/>}</span>{saving === preview.generatedVoiceId ? 'Saving…' : `Use voice ${index + 1}`}</button>
        </li>)}
        {!previews.length && <li className="character-voice-empty" role="status">{designing ? 'Designing three voices from the description…'
          : description.length < MIN_DESIGN_DESCRIPTION ? `Describe how ${character.name} sounds in at least ${MIN_DESIGN_DESCRIPTION} characters to design a voice.` : 'ElevenLabs creates three voices to compare. The one you use is saved to your ElevenLabs account.'}</li>}
      </ul>
    </div>}
    <p className="hint character-field-help has-error" role="status">{error}</p>
  </div>;
}
