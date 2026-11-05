import { afterEach, expect, it, vi } from 'vitest';
import { InterstitialController } from '../../src/features/interstitials/InterstitialController';
import { createNode, type StoryGraph } from '../../src/features/story-flow/model';
import { instantiateTemplate, makePreset } from '../../src/features/story-flow/templates';
import { createCallResponseDraft } from '../../src/features/call-response/draft';
import { savedDefaultTurbo } from '../../src/shared/preferences';

afterEach(() => vi.unstubAllGlobals());

it.each([null, 'false', 'invalid', '1', 'true'])('loads the Turbo default safely from %s', value => {
  vi.stubGlobal('localStorage', { getItem: () => value });
  expect(savedDefaultTurbo()).toBe(value === 'true');
});

it('defaults Turbo off when preferences storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(savedDefaultTurbo()).toBe(false);
});

it('applies Turbo to new clips and built-ins while preserving explicit and saved settings', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const jobs = new InterstitialController(); jobs.load('project', []);
  const graph: StoryGraph = { version: 1, entryId: '', nodes: [], edges: [], templates: [] };
  try {
    const first = jobs.add(2, 20); expect(first.turbo).toBe(false);
    jobs.setDefaultTurbo(true);
    expect(jobs.getSnapshot().items[0].turbo).toBe(false);
    expect(jobs.add(3, 20).turbo).toBe(true);
    const item = createNode('looped').item; jobs.ensureItem(item);
    expect(jobs.getSnapshot().items.find(i => i.id === item.id)?.turbo).toBe(true);
    const preset = makePreset('question');
    const builtIn = instantiateTemplate(graph, preset, []);
    builtIn.items.forEach(item => jobs.ensureItem(item));
    expect(jobs.getSnapshot().items.filter(i => builtIn.items.some(item => item.id === i.id)).every(i => i.turbo)).toBe(true);
    const saved = instantiateTemplate(graph, { ...preset, id: 'saved-template' }, []);
    saved.items.forEach(item => jobs.ensureItem(item));
    expect(jobs.getSnapshot().items.filter(i => saved.items.some(item => item.id === i.id)).every(i => i.turbo === false)).toBe(true);
    jobs.edit(item.id, { turbo: false }); jobs.setDefaultTurbo(false);
    expect(jobs.getSnapshot().items.find(i => i.id === item.id)?.turbo).toBe(false);
    expect(jobs.add(5, 20).turbo).toBe(false);
    jobs.setDefaultTurbo(true);
    const draft = createCallResponseDraft(first, crypto.randomUUID(), 20);
    jobs.setCallResponse(draft.flow);
    expect(jobs.getSnapshot().items.filter(i => i.groupId === draft.flow.interstitial.id).every(i => i.turbo)).toBe(true);
    const submitted = createNode('simple').item;
    jobs.ensureItem({ ...submitted, generationSettings: { ...submitted } });
    expect(jobs.getSnapshot().items.find(i => i.id === submitted.id)?.turbo).toBe(false);
    const legacy = createNode('simple').item;
    jobs.load('another-project', [legacy]);
    expect(jobs.getSnapshot().items[0].turbo).toBe(false);
    expect(jobs.add(7, 20).turbo).toBe(true);
  } finally { jobs.dispose(); }
});
