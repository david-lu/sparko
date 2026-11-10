import { useEffect, useId, useRef, useState } from 'react';
import { INTERSTITIAL } from '../../../shared/constants';
import type { InterstitialEditorProps } from '../interstitials/InterstitialEditor';
import EnhancePromptActions, { type PromptEditResult } from '../interstitials/EnhancePromptActions';
import { enhancePrompt } from '../interstitials/enhance-prompt';
import type { FlowTimeline } from '../timeline/FlowTracks';
import { showErrorToast } from '../../shared/toasts';
import { useGenerationWorkspace } from '../interstitials/GenerationWorkspace';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';

export default function ContinuityBriefEditor({ value, engine, info, status, player, projects }: Pick<InterstitialEditorProps, 'engine' | 'info' | 'status' | 'player' | 'projects'> & { value: FlowTimeline }) {
  const workspace = useGenerationWorkspace();
  const promptId = useId(), { id, time, brief = '' } = value.flow.interstitial;
  const [enhancing, setEnhancing] = useState(false);
  const enhancement = useRef<AbortController | null>(null);
  const latest = useRef(value); latest.current = value;
  useEffect(() => {
    setEnhancing(false);
    return () => { enhancement.current?.abort(); enhancement.current = null; };
  }, [id, brief, time, engine]);
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (enhancement.current || !status?.providers.openai || !brief.trim() || !value.onChange) return { applied: false };
    const operation = new AbortController(); enhancement.current = operation;
    setEnhancing(true);
    const projectInstructions = projectPromptInstructions(projects?.getSnapshot().project);
    try {
      const result = await enhancePrompt({ prompt: brief, time, duration: INTERSTITIAL.defaultDuration }, 'call', undefined, engine, info, operation.signal, { target: 'continuity', player, captureFrame: workspace?.getFrameCapture(), editInstructions, projectInstructions });
      const current = latest.current;
      if (!operation.signal.aborted && enhancement.current === operation && current.flow.interstitial.id === id && (current.flow.interstitial.brief ?? '') === brief
        && projectPromptInstructions(projects?.getSnapshot().project) === projectInstructions) {
        current.onChange?.({ ...current.flow, interstitial: { ...current.flow.interstitial, brief: result.prompt } });
        return { applied: true };
      }
    } catch (error) {
      if (!operation.signal.aborted && enhancement.current === operation) {
        const message = error instanceof Error ? error.message : 'Try again.';
        if (!editInstructions) showErrorToast('Continuity brief enhancement failed', message);
        return { applied: false, error: message };
      }
    } finally {
      if (enhancement.current === operation) { enhancement.current = null; setEnhancing(false); }
    }
    return { applied: false, error: 'The brief or project enhance instructions changed. Try the edit again.' };
  };
  return <div className="continuity-brief-editor" data-project-edit>
    <div className="field">
      <div className="prompt-field-heading">
        <label htmlFor={promptId}>Continuity brief</label>
        <EnhancePromptActions key={id} promptId={promptId} enhancing={enhancing} enabled={!!brief.trim() && !!value.onChange} connected={!!status?.providers.openai}
          onEnhance={() => void enhance()} onEdit={enhance} onCancel={() => { enhancement.current?.abort(); enhancement.current = null; setEnhancing(false); }} />
      </div>
      <textarea id={promptId} aria-label="Continuity brief" rows={3} maxLength={1500} value={brief} placeholder="Character, setting, camera, voice and shared direction"
        onChange={event => value.onChange?.({ ...value.flow, interstitial: { ...value.flow.interstitial, brief: event.target.value } })} />
      <p className="hint">Enhance each clip to apply changes to this brief. Generation uses the clip's visible prompt.</p>
    </div>
  </div>;
}
