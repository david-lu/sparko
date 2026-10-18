import { useEffect, useId, useRef, useState } from 'react';
import { INTERSTITIAL } from '../../../shared/constants';
import type { InterstitialEditorProps } from '../interstitials/InterstitialEditor';
import EnhancePromptActions from '../interstitials/EnhancePromptActions';
import { enhancePrompt } from '../interstitials/enhance-prompt';
import type { FlowTimeline } from '../timeline/FlowTracks';

export default function ContinuityBriefEditor({ value, engine, info, status }: Pick<InterstitialEditorProps, 'engine' | 'info' | 'status'> & { value: FlowTimeline }) {
  const promptId = useId(), { id, time, brief = '' } = value.flow.interstitial;
  const [enhancing, setEnhancing] = useState(false), [error, setError] = useState('');
  const enhancement = useRef<AbortController | null>(null);
  const latest = useRef(value); latest.current = value;
  useEffect(() => {
    setEnhancing(false); setError('');
    return () => { enhancement.current?.abort(); enhancement.current = null; };
  }, [id, brief, time, engine]);
  const enhance = async () => {
    if (enhancement.current || !status?.providers.openai || !brief.trim() || !value.onChange) return;
    const operation = new AbortController(); enhancement.current = operation;
    setEnhancing(true); setError('');
    try {
      const result = await enhancePrompt({ prompt: brief, time, duration: INTERSTITIAL.defaultDuration }, 'call', undefined, engine, info, operation.signal, 'continuity');
      const current = latest.current;
      if (!operation.signal.aborted && enhancement.current === operation && current.flow.interstitial.id === id && (current.flow.interstitial.brief ?? '') === brief) {
        current.onChange?.({ ...current.flow, interstitial: { ...current.flow.interstitial, brief: result.prompt } });
      }
    } catch (error) {
      if (!operation.signal.aborted && enhancement.current === operation) setError(error instanceof Error ? error.message : 'Prompt enhancement failed. Try again.');
    } finally {
      if (enhancement.current === operation) { enhancement.current = null; setEnhancing(false); }
    }
  };
  return <div className="continuity-brief-editor" data-project-edit>
    <div className="field">
      <div className="prompt-field-heading">
        <label htmlFor={promptId}>Continuity brief</label>
        <EnhancePromptActions promptId={promptId} enhancing={enhancing} enabled={!!brief.trim() && !!value.onChange} connected={!!status?.providers.openai}
          onEnhance={() => void enhance()} onCancel={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); }} />
      </div>
      <textarea id={promptId} aria-label="Continuity brief" rows={3} maxLength={1500} value={brief} placeholder="Character, setting, camera, voice and shared direction"
        onChange={event => value.onChange?.({ ...value.flow, interstitial: { ...value.flow.interstitial, brief: event.target.value } })} />
      <p className="hint">Enhance each clip to apply changes to this brief. Generation uses the clip's visible prompt.</p>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
