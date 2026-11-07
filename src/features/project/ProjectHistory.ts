import { assetPlacement } from './migrateClipMedia';
import { interstitialSettings, type Interstitial, type InterstitialSettings } from '../../../shared/interstitials';
import type { LibraryAsset, Project } from './types';

export type InterstitialEdit = Pick<Interstitial, 'id' | 'label' | 'time' | 'kind' | 'groupId'> & InterstitialSettings;
export type ProjectEdit = Pick<Project, 'callResponse' | 'callResponses' | 'storyFlow' | 'library' | 'libraryFolders' | 'deletedAssetIds' | 'subtitle' | 'crossfadeFrames' | 'loras'> & { interstitials: InterstitialEdit[]; clipGenerations?: Pick<import('../../../shared/asset-generation').AssetGeneration, 'id' | 'name' | 'kind' | 'folderId' | 'settings' | 'versions' | 'selectedAssetId'>[] };
type Entry = { before: ProjectEdit; after: ProjectEdit; label: string; key?: string; time: number };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function projectEdit(project: Project): ProjectEdit {
  return { interstitials: project.interstitials.map(({ id, label, time, kind, groupId, ...item }) => ({ id, label, time, kind, groupId, ...interstitialSettings(item), imageReferences: item.imageReferences ?? [] })),
    callResponse: project.callResponse, callResponses: project.callResponses, storyFlow: project.storyFlow, library: project.library, libraryFolders: project.libraryFolders, deletedAssetIds: project.deletedAssetIds,
    loras: project.loras, clipGenerations: project.clipGenerations?.map(({id,name,kind,folderId,settings,versions,selectedAssetId}) => ({id,name,kind,folderId,settings,versions,selectedAssetId})), subtitle: project.subtitle, crossfadeFrames: project.crossfadeFrames };
}
function describe(before: ProjectEdit, after: ProjectEdit): Pick<Entry, 'label' | 'key'> {
  if (!same(before.deletedAssetIds, after.deletedAssetIds)) return { label: 'Delete assets' };
  if (!same(before.loras, after.loras)) return { label: 'Edit project LoRAs' };
  if (!same(before.libraryFolders, after.libraryFolders)) return { label: 'Organize library folders' };
  if (!same(before.clipGenerations, after.clipGenerations)) return { label: 'Edit generation', key: 'asset-generation' };
  if (!same(before.storyFlow, after.storyFlow)) {
    const a=before.storyFlow,b=after.storyFlow;
    if(!a || !b) return {label:'Create story flow'};
    if(b.nodes.length>a.nodes.length)return {label:'Add clips'};
    if(b.nodes.length<a.nodes.length)return {label:'Remove clips'};
    if(a.entryId!==b.entryId)return {label:'Change start video'};
    if(!same(a.templates,b.templates))return {label:'Save group template'};
    if(!same(a.groups,b.groups))return {label:(b.groups?.length??0)>(a.groups?.length??0)?'Group clips':(b.groups?.length??0)<(a.groups?.length??0)?'Ungroup clips':'Edit group'};
    if(!same(a.edges,b.edges))return {label:'Edit connections'};
    const changed=b.nodes.filter(n=>!same(n,a.nodes.find(p=>p.id===n.id)));
    return {label:'Edit clip',key:changed.length===1?`node:${changed[0].id}`:undefined};
  }
  if (before.crossfadeFrames !== after.crossfadeFrames) return { label: 'Change crossfade length', key: 'crossfadeFrames' };
  if (!same(before.callResponse, after.callResponse)) {
    if (!after.callResponse) return { label: 'Remove call-response video' };
    if (!before.callResponse) return { label: 'Add call-response video' };
    if (before.callResponse.interstitial.label !== after.callResponse.interstitial.label) return { label: 'Rename video' };
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
  if (!same(before.library, after.library)) {
    return { label: 'Update library' };
  }
  if (!same(before.callResponses, after.callResponses)) return { label: 'Edit call-response video' };
  const previous = new Map(before.interstitials.map(item => [item.id, item]));
  if (after.interstitials.some(item => !previous.has(item.id))) return { label: 'Add video' };
  if (after.interstitials.length < before.interstitials.length) return { label: 'Remove video' };
  const changed = after.interstitials.flatMap(item => Object.keys(item).filter(key => !same(item[key as keyof InterstitialEdit], previous.get(item.id)?.[key as keyof InterstitialEdit])).map(key => ({ id: item.id, key })));
  if (changed.some(change => change.key === 'time')) return { label: 'Move video' };
  const field = changed[0]?.key;
  const labels: Record<string, string> = { label: 'Rename video', prompt: 'Edit prompt', duration: 'Change duration', audioMaskTransitionMs: 'Change audio mask transition', videoMaskTransitionMs: 'Change video mask transition', start_range: 'Change start range', end_range: 'Change end range', method: 'Change generation method', enable_prompt_expansion: 'Change prompt expansion', loopAudio: 'Toggle Idle audio' };
  return { label: labels[field] ?? 'Edit video',
    key: ['prompt', 'duration', 'audioMaskTransitionMs', 'videoMaskTransitionMs', 'start_range', 'end_range'].includes(field) && changed.every(change => change.key === field)
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
  /** Async renders are retained even when undo returns to an edit made before completion. */
  retainGeneratedMedia(added: LibraryAsset[]) {
    if(!added.length)return;
    for(const entry of [...this.past,...this.future])for(const snapshot of [entry.before,entry.after]){
      const ids=new Set(snapshot.library?.map(asset=>asset.assetId));
      snapshot.library=[...snapshot.library??[],...added.filter(asset=>!ids.has(asset.assetId))];
      if(snapshot.storyFlow)snapshot.storyFlow={...snapshot.storyFlow,nodes:snapshot.storyFlow.nodes.map(node=>{
        const asset=added.find(asset=>asset.generationId&&asset.generationId===node.generationId);
        return asset&&!node.source?{...node,source:assetPlacement(asset,node.duration)}:node;
      })};
    }
  }
  target(direction: 'undo' | 'redo') { return direction === 'undo' ? this.past.at(-1)?.before : this.future.at(-1)?.after; }
  commit(direction: 'undo' | 'redo') {
    const entry = (direction === 'undo' ? this.past : this.future).pop();
    if (entry) (direction === 'undo' ? this.future : this.past).push(entry);
    this.endGroup();
  }
}
