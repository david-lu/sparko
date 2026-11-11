import { promptEnhancementPatch } from '../../../shared/prompt-versions';
import { useSyncExternalStore } from 'react';
import { generationLoraInstructions } from '../../../shared/loras';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import { promptCharacters, withCharacterReferences, type AssetGeneration } from '../../../shared/asset-generation';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { referenceImagePreviews } from '../interstitials/image-references';
import { request } from '../../shared/api';
import { showErrorToast } from '../../shared/toasts';
import { capturePromptFrame } from '../player/promptFrame';
import type { PromptEditResult } from '../interstitials/EnhancePromptActions';
import { useGenerationWorkspace } from '../interstitials/GenerationWorkspace';

type Result = { prompt: string; enhancedPrompt?: string; model: string };
/** Image prompts use reference previews and the player frame; audio prompts use the project's characters. */
export function useAssetPromptEnhancement(editor: StoryEditor, generation: AssetGeneration | undefined, connected: boolean) {
  const workspace = useGenerationWorkspace(), tasks = editor.clipJobs.promptEnhancements;
  const phase = useSyncExternalStore(tasks.subscribe, () => tasks.getPhase(generation?.id ?? ''));
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (!generation || generation.kind === 'video' || !generation.settings.prompt.trim() || !connected) return { applied: false };
    const audio = generation.kind === 'audio', snapshot = editor.projects.getSnapshot(), settings = structuredClone(generation.settings);
    const fingerprint = JSON.stringify(settings), projectInstructions = projectPromptInstructions(snapshot.project);
    const loraInstructions = audio ? undefined : generationLoraInstructions(settings, snapshot.project?.loras, settings.model);
    const cast = (project = snapshot.project) => promptCharacters(settings, project?.characters), characters = cast();
    // The request uses the references generation will submit, including selected characters' images.
    const requestSettings = withCharacterReferences(settings, snapshot.project?.characters);
    return tasks.run(generation.id, {
      isCurrent: () => {
        const state = editor.projects.getSnapshot(), project = state.project, current = project?.clipGenerations?.find(g => g.id === generation.id);
        return !!current && project?.id === snapshot.project?.id && state.activationRevision === snapshot.activationRevision
          && JSON.stringify(current.settings) === fingerprint
          && (audio || generationLoraInstructions(current.settings, project?.loras, current.settings.model) === loraInstructions)
          && projectPromptInstructions(project) === projectInstructions
          && JSON.stringify(cast(project)) === JSON.stringify(characters)
          && JSON.stringify(withCharacterReferences(current.settings, project?.characters).references) === JSON.stringify(requestSettings.references);
      },
      subscribe: editor.projects.subscribe,
      execute: async signal => {
        if (audio) return request<Result>('/api/audio-prompts/enhance', { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: requestSettings, editInstructions, characters, projectInstructions }) });
        const currentFrame = await capturePromptFrame(editor.player, signal, workspace?.getFrameCapture());
        const images = await referenceImagePreviews(requestSettings.references.filter(r => r.kind === 'image'), signal);
        signal.throwIfAborted();
        return request<Result>('/api/image-prompts/enhance', { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: requestSettings, editInstructions, images, currentFrame, loraInstructions, projectInstructions, characters }) });
      },
      apply: result => {
        if (result.model !== settings.model || typeof result.prompt !== 'string' || !result.prompt.trim()) throw new Error('Prompt enhancement returned an invalid result.');
        editor.clipJobs.edit(generation.id, { settings: { ...settings, ...promptEnhancementPatch(settings, result, !!editInstructions) } });
      },
      onError: message => { if (!editInstructions) showErrorToast(`${audio ? 'Audio' : 'Image'} prompt enhancement failed`, message, generation.name); },
    });
  };
  return { enhancing: phase !== 'idle', enhance, cancel: () => { if (generation) tasks.cancel(generation.id); } };
}
