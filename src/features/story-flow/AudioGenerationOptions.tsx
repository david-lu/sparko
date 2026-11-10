import { Plus } from 'lucide-react';
import { useId } from 'react';
import { AUDIO_DURATION_LIMITS, DIALOGUE_LANGUAGES, DIALOGUE_STABILITY, type AssetModel, type AssetSettings } from '../../../shared/asset-generation';
import type { ProjectCharacter } from '../../../shared/characters';
import '../project/characters.css';

/** Character chips insert "Name: " into the script; dashed chips still need a voice. */
export function DialogueCast({ characters, disabled, onInsert, onAdd }: { characters: readonly ProjectCharacter[]; disabled: boolean; onInsert: (name: string) => void; onAdd: (element: HTMLElement) => void }) {
  return <div className="dialogue-cast" role="group" aria-label="Dialogue speakers">
    <div className="dialogue-cast-heading"><span>Speakers · one “Name: line” per turn</span>
      <button type="button" className="text-button" disabled={disabled} onClick={event => onAdd(event.currentTarget)}><Plus size={11}/>Add character</button></div>
    <ul>{characters.length ? characters.map(character => <li key={character.id}>
      <button type="button" disabled={disabled} data-voiceless={!character.voice} aria-label={`Insert ${character.name}`}
        title={character.voice ? `Insert a line for ${character.name} · Voice: ${character.voice.name}` : `${character.name} has no voice yet. Edit them under Characters in Project settings.`}
        onClick={() => onInsert(character.name)}><span>{character.name}</span></button>
    </li>) : <li className="dialogue-cast-empty">Add characters to give each speaker a voice.</li>}</ul>
  </div>;
}

function Duration({ model, settings, update }: { model: AssetModel; settings: AssetSettings; update: (patch: Partial<AssetSettings>) => void }) {
  const limits = AUDIO_DURATION_LIMITS[model.audioType!]!, auto = !!settings.autoDuration;
  return <div className="inspector-property"><span>Duration (s)</span><div className="audio-generation-duration">
    <input aria-label="Generation duration" type="number" min={limits.min} max={limits.max} step={limits.step} disabled={auto} value={settings.duration}
      onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) update({ duration: Math.min(limits.max, Math.max(limits.min, e.target.valueAsNumber)) }); }}/>
    <label title="Let ElevenLabs choose the length from the prompt"><input type="checkbox" aria-label="Automatic duration" checked={auto} onChange={e => update({ autoDuration: e.target.checked })}/>Auto</label>
  </div></div>;
}

/** ElevenLabs settings for the selected audio type. */
export default function AudioGenerationOptions({ model, settings, update }: { model: AssetModel; settings: AssetSettings; update: (patch: Partial<AssetSettings>) => void }) {
  const influenceId = useId();
  if (model.audioType === 'dialogue') {
    const stability = DIALOGUE_STABILITY.find(option => option.value === (settings.stability ?? .5))!;
    return <>
      <label className="inspector-property"><span>Delivery</span><select aria-label="Dialogue stability" value={stability.value}
        onChange={e => update({ stability: Number(e.target.value) as AssetSettings['stability'] })}>{DIALOGUE_STABILITY.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <p className="hint audio-generation-hint">{stability.description}</p>
      <label className="inspector-property"><span>Language</span><select aria-label="Dialogue language" value={settings.languageCode ?? ''}
        onChange={e => update({ languageCode: e.target.value || undefined })}><option value="">Detect from script</option>{DIALOGUE_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label className="inspector-property"><span>Seed</span><input aria-label="Generation seed" type="number" min={0} max={4294967295} step={1} placeholder="Random" value={settings.seed ?? ''}
        onChange={e => { const value = e.target.valueAsNumber; update({ seed: Number.isInteger(value) && value >= 0 && value <= 4294967295 ? value : undefined }); }}/></label>
    </>;
  }
  if (model.audioType === 'music') return <>
    <Duration model={model} settings={settings} update={update}/>
    <label className="inspector-property audio-generation-option"><span>Vocals</span><span><input type="checkbox" aria-label="Instrumental only" checked={!!settings.instrumental}
      onChange={e => update({ instrumental: e.target.checked })}/> Instrumental only</span></label>
  </>;
  const influence = settings.promptInfluence ?? .3;
  return <>
    <Duration model={model} settings={settings} update={update}/>
    <div className="inspector-property"><span>Prompt influence</span><div className="audio-generation-influence">
      <input id={influenceId} type="range" aria-label="Prompt influence" min={0} max={1} step={.05} value={influence} title="Low is more creative; high follows the prompt more literally."
        onChange={e => update({ promptInfluence: Math.round(e.target.valueAsNumber * 100) / 100 })}/><output htmlFor={influenceId}>{Math.round(influence * 100)}%</output></div></div>
    <label className="inspector-property audio-generation-option"><span>Loop</span><span><input type="checkbox" aria-label="Seamless loop" checked={!!settings.loop}
      onChange={e => update({ loop: e.target.checked })}/> Seamless loop</span></label>
  </>;
}
