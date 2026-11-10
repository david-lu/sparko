import { promptEnhancementPatch } from '../../../shared/prompt-versions';
import { useSyncExternalStore } from 'react';
import { generationLoraInstructions } from '../../../shared/loras';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import type { AssetGeneration } from '../../../shared/asset-generation';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { referenceImagePreviews } from '../interstitials/image-references';
import { request } from '../../shared/api';
import { showErrorToast } from '../../shared/toasts';
import { capturePromptFrame } from '../player/promptFrame';
import type { PromptEditResult } from '../interstitials/EnhancePromptActions';
import { useGenerationWorkspace } from '../interstitials/GenerationWorkspace';

export function useImagePromptEnhancement(editor: StoryEditor, generation: AssetGeneration | undefined, connected: boolean) {
  const workspace = useGenerationWorkspace(), tasks = editor.clipJobs.promptEnhancements;
  const phase = useSyncExternalStore(tasks.subscribe, () => tasks.getPhase(generation?.id ?? ''));
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (!generation || generation.kind !== 'image' || !generation.settings.prompt.trim() || !connected) return { applied: false };
    const snapshot = editor.projects.getSnapshot(), settings = structuredClone(generation.settings);
    const fingerprint = JSON.stringify(settings);
    const loraInstructions = generationLoraInstructions(settings, snapshot.project?.loras, settings.model), projectInstructions = projectPromptInstructions(snapshot.project);
    return tasks.run(generation.id, {
      isCurrent: () => {
        const state = editor.projects.getSnapshot(), project = state.project, current = project?.clipGenerations?.find(g => g.id === generation.id);
        return !!current && project?.id === snapshot.project?.id && state.activationRevision === snapshot.activationRevision
          && JSON.stringify(current.settings) === fingerprint
          && generationLoraInstructions(current.settings, project?.loras, current.settings.model) === loraInstructions
          && projectPromptInstructions(project) === projectInstructions;
      },
      subscribe: editor.projects.subscribe,
      execute: async signal => {
        const currentFrame = await capturePromptFrame(editor.player, signal, workspace?.getFrameCapture());
        const images = await referenceImagePreviews(settings.references.filter(r => r.kind === 'image'), signal);
        signal.throwIfAborted();
        return request<{ prompt: string; enhancedPrompt?: string; model: string }>('/api/image-prompts/enhance', { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, editInstructions, images, currentFrame, loraInstructions, projectInstructions }) });
      },
      apply: result => {
        if (result.model !== settings.model || typeof result.prompt !== 'string' || !result.prompt.trim()) throw new Error('Prompt enhancement returned an invalid result.');
        editor.clipJobs.edit(generation.id, { settings: { ...settings, ...promptEnhancementPatch(settings, result, !!editInstructions) } });
      },
      onError: message => { if (!editInstructions) showErrorToast('Image prompt enhancement failed', message, generation.name); },
    });
  };
  return { enhancing: phase !== 'idle', enhance, cancel: () => { if (generation) tasks.cancel(generation.id); } };
}
