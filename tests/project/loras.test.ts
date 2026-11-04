import { afterEach, describe, expect, it, vi } from 'vitest';
import { loraAddressSchema, projectLorasSchema, saveProjectLora } from '../../shared/loras';
import { newAssetGeneration, validateAssetSettings } from '../../shared/asset-generation';
import { hasUnsubmittedChanges, interstitialSettings } from '../../shared/interstitials';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { AssetGenerationController } from '../../src/features/project/AssetGenerationController';
import { createNode } from '../../src/features/story-flow/model';
import { makePreset, instantiateTemplate } from '../../src/features/story-flow/templates';
import { ProjectHistory } from '../../src/features/project/ProjectHistory';
import { packProject, unpackProject } from '../../src/features/project/archive';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import type { ProjectController } from '../../src/features/project/ProjectController';

const address = 'iris-animation__h3_character.safetensors';
const entry = { model: 'h3', address, name: address };
const empty = (): Project => ({ id: 'project', name: 'LoRAs', updatedAt: 0, source: { name: 'Empty' }, interstitials: [],
  subtitle: null, analysis: emptyAnalysis(), storyFlow: { version: 1, entryId: '', nodes: [], edges: [], templates: [] } });
afterEach(() => vi.unstubAllGlobals());

describe('project LoRAs', () => {
  it('enforces one assignment per model on add, edit and archive validation', () => {
    const first = saveProjectLora([], entry);
    expect(() => saveProjectLora(first, { ...entry, address: 'other.safetensors' })).toThrow('already has');
    expect(saveProjectLora(first, { ...entry, address: 'other.safetensors' }, 'h3')[0].address).toBe('other.safetensors');
    const another = { ...entry, model: 'another-model' };
    expect(() => saveProjectLora([...first, another], entry, another.model)).toThrow('already has');
    expect(projectLorasSchema.safeParse([...first, entry]).success).toBe(false);
  });

  it('accepts imported model names and Comfy asset links, rejecting arbitrary fetch targets and traversal', () => {
    for (const value of [address, 'folder/model.safetensors', 'https://cloud.comfy.org/api/assets/model-123/content']) expect(loraAddressSchema.safeParse(value).success).toBe(true);
    for (const value of ['', '../model.safetensors', '/model.safetensors', 'folder/../model.safetensors', 'https://cloud.comfy.org.evil.test/api/assets/model-123',
      'https://user:pass@cloud.comfy.org/api/assets/model-123', 'https://cloud.comfy.org/api/assets/model-123?token=secret', 'https://127.0.0.1/model.safetensors', 'file:///model.safetensors']) {
      expect(loraAddressSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('copies defaults for new clips and built-in templates while retaining overrides and submitted settings', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const jobs = new InterstitialController(); jobs.load('project', []); jobs.setDefaultLora(address);
    const first = jobs.add(1, 10)!;
    const { item } = createNode('simple'); jobs.ensureItem(item);
    const template = instantiateTemplate(empty().storyFlow!, makePreset('question'), []);
    template.items.forEach(clip => jobs.ensureItem(clip));
    expect(jobs.getSnapshot().items.every(clip => clip.lora === address)).toBe(true);
    jobs.setDefaultLora('changed.safetensors');
    expect(jobs.getSnapshot().items[0].lora).toBe(address);
    jobs.edit(first.id, { lora: null });
    expect(jobs.getSnapshot().items.find(clip => clip.id === first.id)?.lora).toBeNull();
    expect(jobs.add(3, 10)!.lora).toBe('changed.safetensors');
    const submitted = { ...item, lora: address, generationSettings: interstitialSettings({ ...item, lora: address }) };
    expect(hasUnsubmittedChanges(submitted)).toBe(false);
    submitted.lora = 'override.safetensors';
    expect(hasUnsubmittedChanges(submitted)).toBe(true);
    expect(submitted.generationSettings.lora).toBe(address);
    expect(hasUnsubmittedChanges({ ...item, lora: null, generationSettings: interstitialSettings({ ...item, lora: undefined }) })).toBe(false);
    jobs.load('other-project', []); expect(jobs.add(1, 10)!.lora).toBeNull();
    jobs.dispose();
  });

  it('resets a generation to the new model assignment when switching models, without altering submitted versions', () => {
    const generation = newAssetGeneration('image', undefined, [{ ...entry, model: 'nano-banana-2' }]);
    generation.submitted = structuredClone(generation.settings);
    let project = { ...empty(), loras: [entry, { ...entry, model: 'flux-2-pro', address: 'flux.safetensors' }], assetGenerations: [generation] };
    const projects = { getSnapshot: () => ({ project }), editAssets: (change: (p: Project) => Project) => { project = change(project) as typeof project; } };
    const jobs = new AssetGenerationController(projects as unknown as ProjectController);
    expect(generation.settings.lora).toBe(address);
    jobs.edit(generation.id, { settings: { ...generation.settings, model: 'flux-2-pro' } });
    expect(project.assetGenerations[0].settings.lora).toBe('flux.safetensors');
    expect(project.assetGenerations[0].submitted?.lora).toBe(address);
    jobs.edit(generation.id, { settings: { ...generation.settings, model: 'nano-banana-pro' } });
    expect(project.assetGenerations[0].settings.lora).toBeNull();
    expect(validateAssetSettings({ ...generation.settings, prompt: 'A scene' })).toContain('does not support LoRAs');
  });

  it('round-trips assignments, overrides, submitted inputs and templates and keeps project edits undoable', async () => {
    const project = empty(), { item, node } = createNode('simple');
    item.lora = 'override.safetensors'; item.generationSettings = interstitialSettings({ ...item, lora: address });
    project.loras = [entry]; project.interstitials = [item];
    project.storyFlow = { ...project.storyFlow!, entryId: node.id, nodes: [node], templates: [{ id: 'template', name: 'Saved', entryId: node.id,
      nodes: [node], edges: [], settings: { [node.id]: interstitialSettings(item) } }] };
    const signal = new AbortController().signal;
    const result = await unpackProject(await packProject(project, [], signal, () => {}), signal, () => {});
    expect(result.project.loras).toEqual([entry]);
    expect(result.project.interstitials[0].lora).toBe(item.lora);
    expect(result.project.interstitials[0].generationSettings?.lora).toBe(address);
    expect(Object.values(result.project.storyFlow!.templates[0].settings)[0].lora).toBe(item.lora);
    const history = new ProjectHistory(); history.record(project, { ...project, loras: [] });
    expect(history.undoLabel).toBe('Edit project LoRAs'); expect(history.target('undo')?.loras).toEqual([entry]);
    history.commit('undo'); expect(history.target('redo')?.loras).toEqual([]);
    await expect(packProject({ ...project, loras: [entry, entry] }, [], signal, () => {})).rejects.toThrow('one LoRA');
  });
});
