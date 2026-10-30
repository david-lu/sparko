import { interstitialSettings, type Interstitial, type InterstitialSettings } from '../../../shared/interstitials';
import type { Project } from './types';

export type InterstitialEdit = Pick<Interstitial, 'id' | 'label' | 'time' | 'kind' | 'groupId'> & InterstitialSettings;
export type ProjectEdit = Pick<Project, 'callResponse' | 'callResponses' | 'storyFlow' | 'library' | 'subtitle' | 'crossfadeFrames'> & { interstitials: InterstitialEdit[] };
type Entry = { before: ProjectEdit; after: ProjectEdit; label: string; key?: string; time: number };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function projectEdit(project: Project): ProjectEdit {
  return { interstitials: project.interstitials.map(({ id, label, time, kind, groupId, ...item }) => ({ id, label, time, kind, groupId, ...interstitialSettings(item) })),
    callResponse: project.callResponse, callResponses: project.callResponses, storyFlow: project.storyFlow, library: project.library, subtitle: project.subtitle, crossfadeFrames: project.crossfadeFrames };
}
function describe(before: ProjectEdit, after: ProjectEdit): Pick<Entry, 'label' | 'key'> {
  if (!same(before.storyFlow, after.storyFlow)) {
    const a=before.storyFlow,b=after.storyFlow;
    if(!a || !b) return {label:'Create story flow'};
    if(b.nodes.length>a.nodes.length)return {label:'Add clips'};
    if(b.nodes.length<a.nodes.length)return {label:'Remove clips'};
    if(!same(a.templates,b.templates))return {label:'Edit templates'};
    if(!same(a.edges,b.edges))return {label:'Edit connections'};
    const changed=b.nodes.filter(n=>!same(n,a.nodes.find(p=>p.id===n.id)));
    return {label:'Edit clip',key:changed.length===1?`node:${changed[0].id}`:undefined};
  }
  if (before.crossfadeFrames !== after.crossfadeFrames) return { label: 'Change crossfade length', key: 'crossfadeFrames' };
  if (!same(before.callResponse, after.callResponse)) {
    if (!after.callResponse) return { label: 'Remove call-response interstitial' };
    if (!before.callResponse) return { label: 'Add call-response interstitial' };
    if (before.callResponse.interstitial.label !== after.callResponse.interstitial.label) return { label: 'Rename interstitial' };
    const previousAnswers = before.callResponse.interaction.answers, answers = after.callResponse.interaction.answers;
    if (answers.length > previousAnswers.length) return { label: 'Add answer' };
    if (answers.length < previousAnswers.length) return { label: 'Remove answer' };
    const colorEdits = answers.filter((answer, index) => !same(answer.color, previousAnswers[index]?.color));
    if (colorEdits.length === 1 && same({ ...before.callResponse.interaction, answers: undefined }, { ...after.callResponse.interaction, answers: undefined })
      && answers.every((answer, index) => same({ ...answer, color: undefined }, { ...previousAnswers[index], color: undefined }))) {
      return { label: 'Change button color', key: `answer:${colorEdits[0].id}:color` };
    }
    if (!same(before.callResponse.interaction, after.callResponse.interaction)) return { label: 'Edit answer' };
    const changedType = after.callResponse.scenes.some(scene => before.callResponse!.scenes.find(previous => previous.id === scene.id)?.clip.kind !== scene.clip.kind);
    return { label: changedType ? 'Change clip type' : 'Edit call-response connections' };
  }
  if (!same(before.subtitle, after.subtitle)) return { label: 'Change subtitles' };
  if (!same(before.library, after.library)) return { label: 'Update library' };
  if (!same(before.callResponses, after.callResponses)) return { label: 'Edit call-response interstitial' };
  const previous = new Map(before.interstitials.map(item => [item.id, item]));
  if (after.interstitials.some(item => !previous.has(item.id))) return { label: 'Add interstitial' };
  if (after.interstitials.length < before.interstitials.length) return { label: 'Remove interstitial' };
  const changed = after.interstitials.flatMap(item => Object.keys(item).filter(key => !same(item[key as keyof InterstitialEdit], previous.get(item.id)?.[key as keyof InterstitialEdit])).map(key => ({ id: item.id, key })));
  if (changed.some(change => change.key === 'time')) return { label: 'Move interstitial' };
  const field = changed[0]?.key;
  const labels: Record<string, string> = { label: 'Rename interstitial', prompt: 'Edit prompt', duration: 'Change duration', start_range: 'Change start range', end_range: 'Change end range', method: 'Change generation method', enable_prompt_expansion: 'Change prompt expansion', loopAudio: 'Toggle Idle audio' };
  return { label: labels[field] ?? 'Edit interstitial',
    key: ['prompt', 'duration', 'start_range', 'end_range'].includes(field) && changed.every(change => change.key === field)
      ? changed.map(change => `${change.id}:${change.key}`).sort().join('|') : undefined };
}

/** Session edit history contains document metadata, never media blobs or generation progress. */
export class ProjectHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private merge = false;
  constructor(private limit = 100) {}
  get undoLabel() { return this.past.at(-1)?.label ?? null; }
  get redoLabel() { return this.future.at(-1)?.label ?? null; }
  clear() { this.past = []; this.future = []; this.merge = false; }
  endGroup() { this.merge = false; }
  record(previous: Project, next: Project, now = Date.now()) {
    const before = projectEdit(previous), after = projectEdit(next);
    if (same(before, after)) return;
    const description = describe(before, after), last = this.past.at(-1);
    if (this.merge && description.key && last?.key === description.key && now - last.time < 1000 && same(last.after, before)) {
      last.after = structuredClone(after); last.time = now;
      if (same(last.before, last.after)) this.past.pop();
    } else {
      this.past.push({ before: structuredClone(before), after: structuredClone(after), ...description, time: now });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = []; this.merge = true;
  }
  target(direction: 'undo' | 'redo') { return direction === 'undo' ? this.past.at(-1)?.before : this.future.at(-1)?.after; }
  commit(direction: 'undo' | 'redo') {
    const entry = (direction === 'undo' ? this.past : this.future).pop();
    if (entry) (direction === 'undo' ? this.future : this.past).push(entry);
    this.endGroup();
  }
}
