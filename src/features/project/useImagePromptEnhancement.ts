import { promptEnhancementPatch } from '../../../shared/prompt-versions';
import { useEffect, useRef, useState } from 'react';
import { generationLoraInstructions } from '../../../shared/loras';
import type { AssetGeneration } from '../../../shared/asset-generation';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { referenceImagePreviews } from '../interstitials/image-references';
import { request } from '../../shared/api';
import { showErrorToast } from '../../shared/toasts';
import { capturePromptFrame } from '../player/promptFrame';
import type { PromptEditResult } from '../interstitials/EnhancePromptActions';
import { useGenerationWorkspace } from '../interstitials/GenerationWorkspace';

export function useImagePromptEnhancement(editor: StoryEditor, generation: AssetGeneration | undefined, connected: boolean) {
  const workspace = useGenerationWorkspace();
  const task = useRef<AbortController | null>(null), [enhancing, setEnhancing] = useState(false);
  const projectId = editor.projects.getSnapshot().project?.id, fingerprint = JSON.stringify(generation?.settings);
  const loraInstructions = generation && generationLoraInstructions(generation.settings, editor.projects.getSnapshot().project?.loras, generation.settings.model);
  useEffect(() => {
    setEnhancing(false);
    return () => { task.current?.abort(); task.current = null; };
  }, [projectId, generation?.id, fingerprint, loraInstructions]);
  const cancel = () => { task.current?.abort(); task.current = null; setEnhancing(false); };
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (!generation || generation.kind !== 'image' || !generation.settings.prompt.trim() || !connected || task.current) return { applied: false };
    const operation = new AbortController(), settings = structuredClone(generation.settings);
    task.current = operation; setEnhancing(true);
    try {
      const currentFrame = await capturePromptFrame(editor.player, operation.signal, workspace?.getFrameCapture());
      const images = await referenceImagePreviews(settings.references.filter(r => r.kind === 'image'), operation.signal);
      operation.signal.throwIfAborted();
      const result = await request<{ prompt: string; enhancedPrompt?: string; model: string }>('/api/image-prompts/enhance', { method: 'POST', signal: operation.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, editInstructions, images, currentFrame, loraInstructions }) });
      const project = editor.projects.getSnapshot().project, current = project?.clipGenerations?.find(g => g.id === generation.id);
      if (!operation.signal.aborted && task.current === operation && project?.id === projectId && JSON.stringify(current?.settings) === fingerprint
        && current && generationLoraInstructions(current.settings, project?.loras, current.settings.model) === loraInstructions) {
        if (result.model !== settings.model || typeof result.prompt !== 'string' || !result.prompt.trim() || result.prompt.length > 8000) throw new Error('Prompt enhancement returned an invalid result.');
        editor.clipJobs.edit(generation.id, { settings: { ...settings, ...promptEnhancementPatch(settings, result, !!editInstructions) } });
        return { applied: true };
      }
    } catch (e) { if (!operation.signal.aborted && task.current === operation) {
      const message = e instanceof Error ? e.message : 'Try again.';
      if (!editInstructions) showErrorToast('Image prompt enhancement failed', message, generation.name);
      return { applied: false, error: message };
    } }
    finally { if (task.current === operation) { task.current = null; setEnhancing(false); } }
    return { applied: false, error: 'The prompt or settings changed. Try the edit again.' };
  };
  return { enhancing, enhance, cancel };
}
