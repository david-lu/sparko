import { Sparkles, X } from 'lucide-react';

export default function EnhancePromptActions({ promptId, enhancing, enabled, connected, onEnhance, onCancel, description, unavailableReason }: {
  promptId: string; enhancing: boolean; enabled: boolean; connected: boolean; onEnhance: () => void; onCancel: () => void; description?: string; unavailableReason?: string;
}) {
  const reason = enhancing ? 'Enhancing this prompt…' : !connected ? 'OpenAI is not connected. Configure OPENAI_API_KEY on the server to enhance prompts.' : !enabled ? unavailableReason ?? 'Enter a draft prompt to enhance.' : undefined;
  return <div className="enhance-prompt-actions">
    <button type="button" className="text-button enhance-prompt" disabled={enhancing || !connected || !enabled} aria-busy={enhancing} aria-controls={promptId}
      aria-description={reason} title={reason ?? description ?? 'Enhance with OpenAI using reference frames to preserve the shot, composition and continuous positions'} onClick={onEnhance}>
      {enhancing ? <span className="spinner" /> : <Sparkles size={12} />}
      <span className="button-labels"><span aria-hidden={enhancing}>Enhance prompt</span><span aria-hidden={!enhancing}>Enhancing…</span></span>
    </button>
    <button type="button" className="icon-button small enhance-prompt-cancel" aria-label="Cancel prompt enhancement" aria-controls={promptId} aria-hidden={!enhancing} disabled={!enhancing}
      onClick={onCancel}><X size={13} /></button>
  </div>;
}
