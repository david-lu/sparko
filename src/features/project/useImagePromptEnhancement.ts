import { useEffect, useRef, useState } from 'react';
import type { AssetGeneration } from '../../../shared/asset-generation';
import type { StoryEditor } from '../story-flow/useStoryEditor';
import { referenceImagePreviews } from '../interstitials/image-references';
import { request } from '../../shared/api';

export function useImagePromptEnhancement(editor: StoryEditor, generation: AssetGeneration | undefined, connected: boolean) {
  const task = useRef<AbortController | null>(null), [enhancing, setEnhancing] = useState(false), [error, setError] = useState('');
  const projectId = editor.projects.getSnapshot().project?.id, fingerprint = JSON.stringify(generation?.settings);
  useEffect(() => {
    setEnhancing(false); setError('');
    return () => { task.current?.abort(); task.current = null; };
  }, [projectId, generation?.id, fingerprint]);
  const cancel = () => { task.current?.abort(); task.current = null; setEnhancing(false); };
  const enhance = async () => {
    if (!generation || generation.kind !== 'image' || !generation.settings.prompt.trim() || !connected || task.current) return;
    const operation = new AbortController(), settings = structuredClone(generation.settings);
    task.current = operation; setEnhancing(true); setError('');
    try {
      const images = await referenceImagePreviews(settings.references.filter(r => r.kind === 'image'), operation.signal);
      const result = await request<{ prompt: string; model: string }>('/api/image-prompts/enhance', { method: 'POST', signal: operation.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, images }) });
      const project = editor.projects.getSnapshot().project, current = project?.assetGenerations?.find(g => g.id === generation.id);
      if (!operation.signal.aborted && task.current === operation && project?.id === projectId && JSON.stringify(current?.settings) === fingerprint) {
        if (result.model !== settings.model || typeof result.prompt !== 'string' || !result.prompt.trim() || result.prompt.length > 8000) throw new Error('Prompt enhancement returned an invalid result.');
        editor.assetJobs.edit(generation.id, { settings: { ...settings, prompt: result.prompt } });
      }
    } catch (e) { if (!operation.signal.aborted && task.current === operation) setError(e instanceof Error ? e.message : 'Unable to enhance prompt.'); }
    finally { if (task.current === operation) { task.current = null; setEnhancing(false); } }
  };
  return { enhancing, error, enhance, cancel };
}
