import { useId } from 'react';
import type { PromptVersions } from '../../../shared/prompt-versions';
import './prompt-versions.css';

export default function EnhancedPromptField({ value, onChange, rows = 4, maxLength = 8000 }: {
  value: PromptVersions; onChange: (patch: Partial<PromptVersions>) => void; rows?: number; maxLength?: number;
}) {
  const id = useId(), hasEnhanced = !!value.enhancedPrompt?.trim();
  const status = !hasEnhanced ? 'Enhance creates a separate version. Edit with AI updates both when available.'
    : value.enhancedPromptStale ? 'Original or settings changed. Enhance again, edit both with AI, or review and edit the enhanced prompt.'
    : 'Edit with AI updates both prompts together. Enhance rebuilds this version from the original.';
  return <div className="enhanced-prompt-field">
    <label htmlFor={id}>Enhanced prompt</label>
    <textarea id={id} aria-label="Enhanced prompt" aria-describedby={`${id}-status`} rows={rows} maxLength={maxLength}
      placeholder="Your enhanced prompt will appear here." value={value.enhancedPrompt ?? ''}
      onChange={event => onChange({ enhancedPrompt: event.target.value, enhancedPromptStale: false })}/>
    <p id={`${id}-status`} className="hint prompt-version-status" role="status">{status}</p>
    <label className="prompt-version-choice"><span>Generate with</span><select aria-label="Prompt used for generation" value={value.useEnhancedPrompt ? 'enhanced' : 'original'}
      onChange={event => onChange({ useEnhancedPrompt: event.target.value === 'enhanced' })}>
      <option value="original">Original prompt</option><option value="enhanced" disabled={!hasEnhanced}>Enhanced prompt</option>
    </select></label>
  </div>;
}
