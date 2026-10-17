import { Sparkles, X } from 'lucide-react';

export default function EnhancePromptActions({ promptId, enhancing, enabled, connected, onEnhance, onCancel }: {
  promptId: string; enhancing: boolean; enabled: boolean; connected: boolean; onEnhance: () => void; onCancel: () => void;
}) {
  return <div className="enhance-prompt-actions">
    <button type="button" className="text-button enhance-prompt" disabled={enhancing || !connected || !enabled} aria-busy={enhancing} aria-controls={promptId}
      title={connected ? 'Enhance with OpenAI using reference frames to preserve the shot, composition and continuous positions' : 'Connect OpenAI to enhance prompts'} onClick={onEnhance}>
      {enhancing ? <span className="spinner" /> : <Sparkles size={12} />}
      <span className="button-labels"><span aria-hidden={enhancing}>Enhance prompt</span><span aria-hidden={!enhancing}>Enhancing…</span></span>
    </button>
    <button type="button" className="icon-button small enhance-prompt-cancel" aria-label="Cancel prompt enhancement" aria-controls={promptId} aria-hidden={!enhancing} disabled={!enhancing}
      onClick={onCancel}><X size={13} /></button>
  </div>;
}
