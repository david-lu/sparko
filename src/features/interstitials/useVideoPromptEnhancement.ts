import { useSyncExternalStore } from 'react';
import { interstitialSettings, type Interstitial } from '../../../shared/interstitials';
import { H3_MODEL_ID, generationLoraInstructions } from '../../../shared/loras';
import { projectPromptInstructions } from '../../../shared/prompt-instructions';
import { promptEnhancementPatch } from '../../../shared/prompt-versions';
import { showErrorToast } from '../../shared/toasts';
import { enhancePrompt } from './enhance-prompt';
import { useGenerationWorkspace } from './GenerationWorkspace';
import type { InterstitialEditorProps } from './InterstitialEditor';
import type { PromptEditResult } from './PromptEnhancementTasks';

export function useVideoPromptEnhancement({ selected, controller, engine, info, status, projects, player }:
  Pick<InterstitialEditorProps, 'selected' | 'controller' | 'engine' | 'info' | 'status' | 'projects' | 'player'>) {
  const workspace = useGenerationWorkspace(), tasks = controller.promptEnhancements;
  const phase = useSyncExternalStore(tasks.subscribe, () => tasks.getPhase(selected.id));
  const enhance = async (editInstructions?: string): Promise<PromptEditResult> => {
    if (!status?.providers.openai || !selected.prompt.trim()) return { applied: false };
    const project = projects?.getSnapshot(), source = controller.generationItem(selected);
    const loraInstructions = generationLoraInstructions(source, project?.project?.loras, H3_MODEL_ID), projectInstructions = projectPromptInstructions(project?.project);
    const fingerprint = (item: Interstitial) => JSON.stringify({
      settings: interstitialSettings(item), time: item.time, kind: controller.clipKind(item.id),
      reference: controller.dependency(item.id)?.reference,
      loraInstructions: generationLoraInstructions(item, projects?.getSnapshot().project?.loras, H3_MODEL_ID),
      projectInstructions: projectPromptInstructions(projects?.getSnapshot().project),
      characters: projects?.getSnapshot().project?.characters,
    });
    const submitted = fingerprint(source);
    return tasks.run(selected.id, {
      isCurrent: () => {
        const current = controller.getSnapshot().items.find(item => item.id === selected.id), state = projects?.getSnapshot();
        return !!current && state?.project?.id === project?.project?.id && state?.activationRevision === project?.activationRevision
          && fingerprint(controller.generationItem(current)) === submitted;
      },
      subscribe: check => {
        const stopController = controller.subscribe(check), stopProject = projects?.subscribe(check);
        return () => { stopController(); stopProject?.(); };
      },
      execute: (signal, onAnalyzing) => enhancePrompt({ ...source, loraInstructions }, controller.clipKind(selected.id),
        controller.dependency(selected.id)?.reference, engine, info, signal,
        { player, captureFrame: workspace?.getFrameCapture(), editInstructions, projectInstructions, characters: project?.project?.characters, onAnalyzing }),
      apply: result => controller.edit(selected.id, promptEnhancementPatch(selected, result, !!editInstructions)),
      onError: message => { if (!editInstructions) showErrorToast('Video prompt enhancement failed', message, selected.label); },
    });
  };
  return { enhancing: phase !== 'idle', analyzing: phase === 'analyzing', enhance, cancel: () => tasks.cancel(selected.id) };
}
