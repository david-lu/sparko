import { describe, expect, it } from 'vitest';
import { ProjectHistory, projectEdit } from '../../src/features/project/ProjectHistory';
import { emptyAnalysis, type Project } from '../../src/features/project/types';
import { createTimelineExample, editAnswer } from '../../src/features/call-response/model';

const project = (): Project => ({ id: 'project', name: 'Video', source: { name: 'video.mp4', assetId: 'source' }, updatedAt: 0,
  subtitle: null, analysis: emptyAnalysis(), interstitials: [{ id: 'clip', label: 'Interstitial 1', time: 2,
    prompt: '', start_range: 2, end_range: 2, duration: 6, enable_prompt_expansion: false, phase: 'draft' }] });
function prompt(value: Project, text: string): Project { return { ...value, interstitials: value.interstitials.map(item => ({ ...item, prompt: text })) }; }

describe('project edit history', () => {
  it('records crossfade length as a project edit and merges slider changes', () => {
    const history = new ProjectHistory(), start = { ...project(), crossfadeFrames: 12 };
    const first = { ...start, crossfadeFrames: 14 }, next = { ...start, crossfadeFrames: 16 };
    history.record(start, first, 0); history.record(first, next, 100);
    expect(history.undoLabel).toBe('Change crossfade length');
    expect(history.target('undo')?.crossfadeFrames).toBe(12);
    history.commit('undo');
    expect(history.target('redo')?.crossfadeFrames).toBe(16);
  });
  it('groups consecutive typing, round-trips it, and starts a separate group after undo', () => {
    const history = new ProjectHistory(), start = project(), first = prompt(start, 'H'), next = prompt(first, 'Hello');
    history.record(start, first, 0); history.record(first, next, 100);
    expect(history.undoLabel).toBe('Edit prompt');
    expect(history.target('undo')).toEqual(projectEdit(start));
    history.commit('undo'); expect(history.undoLabel).toBeNull();
    expect(history.target('redo')).toEqual(projectEdit(next));
    history.commit('redo'); history.record(next, prompt(next, 'Hello world'), 200);
    expect(history.target('undo')).toEqual(projectEdit(next));
  });
  it('separates edits when focus changes or typing pauses', () => {
    const history = new ProjectHistory(), start = project(), first = prompt(start, 'A'), second = prompt(first, 'B'), third = prompt(second, 'C');
    history.record(start, first, 0); history.endGroup(); history.record(first, second, 100);
    expect(history.target('undo')).toEqual(projectEdit(first));
    history.record(second, third, 1200);
    expect(history.target('undo')).toEqual(projectEdit(second));
  });
  it('does not record generation updates or clear redo when a render completes', () => {
    const history = new ProjectHistory(), start = project(), edited = prompt(start, 'A scene');
    history.record(start, edited); history.commit('undo');
    const rendered: Project = { ...start, updatedAt: 99, interstitials: start.interstitials.map(item => ({ ...item, phase: 'ready',
      result: { url: 'asset:render', assetId: 'render', start: 0, duration: 6, totalDuration: 6 } })) };
    history.record(start, rendered);
    expect(history.undoLabel).toBeNull(); expect(history.redoLabel).toBe('Edit prompt');
    expect(history.target('redo')).toEqual(projectEdit(edited));
  });
  it('invalidates redo on a new edit and ignores identical edits', () => {
    const history = new ProjectHistory(), start = project(), edited = prompt(start, 'A');
    history.record(start, edited); history.commit('undo');
    history.record(start, structuredClone(start)); expect(history.redoLabel).not.toBeNull();
    history.record(start, prompt(start, 'Different'));
    expect(history.redoLabel).toBeNull(); expect(history.target('redo')).toBeUndefined();
  });
  it('restores an entire removed call-response group as one entry', () => {
    const history = new ProjectHistory(), example = createTimelineExample('source', 10);
    const start = { ...project(), callResponse: example.flow, interstitials: example.interstitials };
    const removed = { ...start, callResponse: undefined, interstitials: [] };
    history.record(start, removed);
    expect(history.undoLabel).toBe('Remove call-response interstitial');
    expect(history.target('undo')).toEqual(projectEdit(start));
    history.commit('undo'); expect(history.undoLabel).toBeNull();
    history.commit('redo'); expect(history.target('undo')).toEqual(projectEdit(start));
  });
  it('groups consecutive color slider changes for one button into one undo step', () => {
    const history = new ProjectHistory(), example = createTimelineExample('source', 10);
    const start = { ...project(), callResponse: example.flow, interstitials: example.interstitials };
    const first = { ...start, callResponse: editAnswer(example.flow, 'correct', { color: { hue: 120, saturation: 100 } }) };
    const next = { ...first, callResponse: editAnswer(first.callResponse, 'correct', { color: { hue: 130, saturation: 50 } }) };
    history.record(start, first, 0); history.record(first, next, 100);
    expect(history.undoLabel).toBe('Change button color');
    expect(history.target('undo')).toEqual(projectEdit(start));
  });
  it('records linked duration edits together, retains only its limit, and clears on project switch', () => {
    const history = new ProjectHistory(2);
    const start = project(); start.interstitials.push({ ...start.interstitials[0], id: 'other' });
    const duration = { ...start, interstitials: start.interstitials.map(item => ({ ...item, duration: 8 })) };
    history.record(start, duration); expect(history.undoLabel).toBe('Change duration');
    expect(history.target('undo')!.interstitials.map(item => item.duration)).toEqual([6, 6]);
    const edited = prompt(duration, 'A'); history.record(duration, edited); history.endGroup();
    history.record(edited, prompt(edited, 'B'));
    history.commit('undo'); history.commit('undo'); expect(history.undoLabel).toBeNull();
    history.clear(); expect(history.redoLabel).toBeNull(); expect(history.target('redo')).toBeUndefined();
  });
  it('records subtitle replacements', () => {
    const history = new ProjectHistory(), start = project();
    history.record(start, { ...start, subtitle: { name: 'captions.vtt', assetId: 'captions' } });
    expect(history.undoLabel).toBe('Change subtitles'); expect(history.target('undo')!.subtitle).toBeNull();
    history.commit('undo'); expect(history.target('redo')!.subtitle?.assetId).toBe('captions');
  });
});
