import { playableResult, type Interstitial } from '../../../shared/interstitials';
import { branchScenes, getScene, resolveFlow, sceneFrames, type CallResponseFlow, type TimelineScene } from './model';

/** Runtime timelines contain only finished clips; draft settings stay in the editor. */
function playableFlow(flow: CallResponseFlow, items: Interstitial[]): CallResponseFlow {
  const resolved = resolveFlow(flow, items);
  if (!resolved.scenes.some(scene => scene.draft)) return resolved;
  const scenes = resolved.scenes.filter(scene => !scene.draft), ids = new Set(scenes.map(scene => scene.id));
  const answers = resolved.interaction.answers.filter(answer => ids.has(answer.sceneId));
  const edges = resolved.edges.flatMap(edge => {
    if (!ids.has(edge.from)) return [];
    if (ids.has(edge.to)) return [edge];
    if (edge.when !== 'ended') return [];
    const next = resolved.scenes.slice(resolved.scenes.findIndex(scene => scene.id === edge.to)).find(scene => ids.has(scene.id));
    return next ? [{ ...edge, to: next.id, transitionFrames: 0 }] : [];
  });
  return { ...resolved, scenes, edges, layout: undefined, seekPath: undefined, interaction: { ...resolved.interaction, answers,
    fallbackAnswerId: answers.some(answer => answer.id === resolved.interaction.fallbackAnswerId) ? resolved.interaction.fallbackAnswerId : null } };
}

/** Compose pins in source order while retaining each group's independent answer routing. */
export function composeFlows(flows: CallResponseFlow[], items: Interstitial[], assetId: string, duration: number): CallResponseFlow | undefined {
  if (!flows.length) return;
  const regular = items.filter(item => !item.groupId && item.kind !== 'call-response' && !flows.some(flow => flow.interstitial.id === item.id || flow.scenes.some(scene => scene.interstitialId === item.id)));
  // Keep legacy scene IDs stable for existing saved timelines and connections.
  if (flows.length === 1 && !regular.length && !items.some(item => item.id === flows[0].interstitial.id)) return playableFlow(flows[0], items);
  const events = [...flows.map(flow => ({ time: flow.interstitial.time, flow, item: undefined as Interstitial | undefined })),
    ...regular.map(item => ({ time: item.time, item, flow: undefined as CallResponseFlow | undefined }))].sort((a, b) => a.time - b.time);
  const scenes: TimelineScene[] = [], edges: CallResponseFlow['edges'] = [], groups: CallResponseFlow[] = [], starts: Record<string, number> = {}, seekPath: string[] = [];
  let cursor = 0;
  const fps = 24, total = Math.floor(duration * fps);
  const add = (scene: TimelineScene) => { starts[scene.id] = cursor; scenes.push(scene); seekPath.push(scene.id); cursor += sceneFrames(scene); };
  for (let index = 0; index <= events.length; index++) {
    const from = index ? Math.round(events[index - 1].time * fps) : 0;
    const to = index < events.length ? Math.round(events[index].time * fps) : total;
    const sourceId = `source:${index}`;
    // Empty intervals are represented by one held boundary frame, never a negative media range.
    add({ id: sourceId, label: 'Parent video', role: 'source', dialogue: '', sourceTime: from / fps,
      clip: { id: sourceId, kind: 'video', assetId, inFrame: Math.min(total - 1, from), outFrame: Math.max(Math.min(total, from + 1), to) } });
    const event = events[index]; if (!event) break;
    if (event.flow) {
      const local = playableFlow(event.flow, items), prefix = `${local.interstitial.id}/`;
      const sceneId = (id: string) => id === 'intro' ? sourceId : id === 'continue' ? `source:${index + 1}` : prefix + id;
      const answerId = (id: string) => prefix + id;
      const group: CallResponseFlow = { ...local, entrySceneId: sourceId,
        scenes: local.scenes.map(scene => ({ ...scene, id: sceneId(scene.id), localId: scene.id, groupId: local.interstitial.id,
          sourceTime: local.interstitial.time, clip: scene.clip.kind === 'response' ? { ...scene.clip, outcome: answerId(scene.clip.outcome) } : scene.clip })),
        edges: local.edges.map(edge => ({ ...edge, id: prefix + edge.id, from: sceneId(edge.from), to: sceneId(edge.to), when: ['ended', 'pending'].includes(edge.when) ? edge.when : answerId(edge.when) })),
        interaction: { ...local.interaction, waitSceneId: sceneId(local.interaction.waitSceneId),
          fallbackAnswerId: local.interaction.fallbackAnswerId ? answerId(local.interaction.fallbackAnswerId) : null,
          answers: local.interaction.answers.map(answer => ({ ...answer, id: answerId(answer.id), sceneId: sceneId(answer.sceneId) })) } };
      groups.push(group); edges.push(...group.edges);
      for (const id of ['call', 'wait']) { const scene = getScene(group, sceneId(id)); if (scene) add(scene); }
      const branches = branchScenes(group);
      for (const branch of branches) { starts[branch.id] = cursor; scenes.push(branch); }
      if (branches.length) seekPath.push(branches[0].id);
      cursor += Math.max(0, ...branches.map(sceneFrames));
    } else {
      const item = event.item!, result = playableResult(item), id = `regular:${item.id}`;
      add({ id, interstitialId: item.id, label: item.label, role: 'source', dialogue: '', draft: !result,
        sourceTime: item.time, plannedFrames: Math.round(item.duration * fps), clip: { id, kind: 'video', assetId: result?.assetId ?? assetId,
          inFrame: result ? Math.round(result.start * fps) : Math.max(0, Math.round(item.time * fps) - 1),
          outFrame: result ? Math.round((result.start + result.duration) * fps) : Math.max(1, Math.round(item.time * fps)) } });
      edges.push({ id: `${id}:in`, from: sourceId, to: id, when: 'ended', label: 'Next', transitionFrames: 0 },
        { id: `${id}:out`, from: id, to: `source:${index + 1}`, when: 'ended', label: 'Next', transitionFrames: 0 });
    }
  }
  return { ...groups[0], entrySceneId: 'source:0', scenes, edges, groups, layout: { starts, totalFrames: cursor }, seekPath,
    interaction: { ...groups[0].interaction, answers: groups.flatMap(group => group.interaction.answers) } };
}
