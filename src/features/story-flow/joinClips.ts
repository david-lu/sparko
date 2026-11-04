import { TIMELINE_FPS } from '../../../shared/constants';
import { isGenerating, playableResult, type Interstitial } from '../../../shared/interstitials';
import { behaviors, conditionsFor } from './behaviors';
import { generatedBounds, type StoryGraph, type StoryNode } from './model';

type JoinResult = { ok: false; reasons: string[] } | { ok: true; graph: StoryGraph; nodeId: string; count: number };

/** Resolve every range into the original file's timeline, including retained full renders. */
function mediaRange(node: StoryNode, items: Interstitial[]) {
  if (node.source) return { ...node.source, identity: node.source.originalAssetId ?? node.source.assetId, bodyStart: 0, bodyFrames: 0 };
  const item = items.find(item => item.id === node.interstitialId), result = item && playableResult(item);
  if (!result?.assetId) return;
  const full = result.fullAssetId && (result.fullRange ?? (result === item?.result ? item.requestInsertion : undefined));
  const assetId = full ? result.fullAssetId! : result.assetId;
  const bodyStart = Math.round((full ? full.start : result.start) * TIMELINE_FPS);
  const bounds = generatedBounds(node, result.duration);
  return { assetId, identity: assetId, duration: full ? full.totalDuration : result.totalDuration,
    inFrame: bodyStart + bounds.inFrame, outFrame: bodyStart + bounds.outFrame,
    bodyStart, bodyFrames: Math.round(result.duration * TIMELINE_FPS) };
}

/** Collect independent failures even when the selection has no valid graph order yet. */
function inspectJoin(graph: StoryGraph, items: Interstitial[], ids: string[]) {
  const selected = new Set(ids), reasons: string[] = [];
  const chosen = graph.nodes.filter(node => selected.has(node.id)), byId = new Map(chosen.map(node => [node.id, node]));
  if (selected.size < 2) reasons.push('Select at least two clips to join. Shift-click clips or drag a selection around them.');
  if (chosen.length !== selected.size) reasons.push('One of the selected clips is no longer available. Select the clips again.');
  const internal = graph.edges.filter(edge => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to);
  const incoming = new Map(chosen.map(node => [node.id, [] as string[]])), outgoing = new Map(chosen.map(node => [node.id, [] as string[]]));
  for (const edge of internal) { incoming.get(edge.to)!.push(edge.from); outgoing.get(edge.from)!.push(edge.to); }
  const branched = chosen.some(node => incoming.get(node.id)!.length > 1 || outgoing.get(node.id)!.length > 1);
  if (branched) reasons.push('The selected clips form a branch. Select one continuous chain of clips to join.');
  const roots = chosen.filter(node => !incoming.get(node.id)!.length);
  const queue = roots.map(node => node.id), degrees = new Map(chosen.map(node => [node.id, incoming.get(node.id)!.length]));
  for (let i = 0; i < queue.length; i++) for (const next of outgoing.get(queue[i])!) {
    degrees.set(next, degrees.get(next)! - 1); if (!degrees.get(next)) queue.push(next);
  }
  const cyclic = queue.length < chosen.length;
  if (cyclic) reasons.push('The selected clips form a cycle. Select a chain with a clear first and last clip.');
  const reached = new Set<string>(), pending = chosen.length ? [chosen[0].id] : [];
  while (pending.length) { const id = pending.pop()!; if (reached.has(id)) continue; reached.add(id); pending.push(...incoming.get(id)!, ...outgoing.get(id)!); }
  const disconnected = reached.size !== chosen.length;
  if (disconnected) reasons.push('The selected clips are not connected in one chain. Connect them in the graph, and include every clip between them.');
  const ordered = !branched && !cyclic && !disconnected ? queue.map(id => byId.get(id)!) : [];
  const first = ordered[0], last = ordered.at(-1);
  for (const edge of graph.edges) {
    if (!selected.has(edge.from) && byId.has(edge.to) && incoming.get(edge.to)!.length)
      reasons.push(`“${byId.get(edge.to)!.name}” has an incoming connection in the middle of the selection. Move that connection to ${first ? `“${first.name}”` : 'the first clip'} before joining.`);
    if (byId.has(edge.from) && !selected.has(edge.to) && outgoing.get(edge.from)!.length)
      reasons.push(`“${byId.get(edge.from)!.name}” branches outside the selection. Move that connection to ${last ? `“${last.name}”` : 'the last clip'} before joining.`);
    if (edge.from === edge.to && byId.has(edge.from) && outgoing.get(edge.from)!.length)
      reasons.push(`“${byId.get(edge.from)!.name}” loops back to itself before the last clip. Remove that connection before joining.`);
  }
  for (const edge of internal) if (edge.event !== 'next')
    reasons.push(`The connection from “${byId.get(edge.from)!.name}” to “${byId.get(edge.to)!.name}” is conditional. Use an ordinary Next connection before joining.`);
  const ranges = new Map(chosen.map(node => [node.id, mediaRange(node, items)]));
  for (const node of chosen) {
    const value = behaviors(node), item = items.find(item => item.id === node.interstitialId);
    if (outgoing.get(node.id)!.length && (value.loop || value.conditional))
      reasons.push(`“${node.name}” has Loop or Conditional enabled before the last clip. Turn those behaviors off before joining.`);
    if (item && isGenerating(item)) reasons.push(`“${node.name}” is still generating. Wait for it to finish before joining.`);
    if (!ranges.get(node.id)) reasons.push(`“${node.name}” has no rendered video yet. Generate or import its video before joining.`);
  }
  const base = (ordered.length ? ordered : chosen).find(node => ranges.get(node.id));
  if (base) for (const node of chosen) {
    const range = ranges.get(node.id);
    if (range && range.identity !== ranges.get(base.id)!.identity)
      reasons.push(`“${node.name}” uses different source material from “${base.name}”. All joined clips must use the same source video.`);
  }
  for (const edge of internal) {
    const before = ranges.get(edge.from), after = ranges.get(edge.to);
    if (before && after && before.inFrame >= after.outFrame)
      reasons.push(`“${byId.get(edge.from)!.name}” starts at or after “${byId.get(edge.to)!.name}” ends in the source video. Each clip's start must be earlier than the next clip's end.`);
  }
  if (ordered.length > 2 && first && last) {
    const start = ranges.get(first.id), end = ranges.get(last.id);
    if (start && end && start.inFrame >= end.outFrame)
      reasons.push(`“${first.name}” starts at or after “${last.name}” ends in the source video. The joined range must end after it starts.`);
  }
  return { reasons: [...new Set(reasons)], ordered, ranges, selected };
}

export function joinProblems(graph: StoryGraph, items: Interstitial[], ids: string[]) {
  return inspectJoin(graph, items, ids).reasons;
}

/** Collapse a directed chain atomically; a failed join never changes clips or connections. */
export function joinClips(graph: StoryGraph, items: Interstitial[], ids: string[]): JoinResult {
  const { reasons, ordered, ranges, selected } = inspectJoin(graph, items, ids);
  if (reasons.length) return { ok: false, reasons };
  const first = ordered[0], last = ordered.at(-1)!, start = ranges.get(first.id)!, end = ranges.get(last.id)!;

  // Keep generation settings when the joined range still fits the first render's body.
  // A wider range becomes a source clip referencing the same saved video, without re-encoding.
  const keepGenerated = !first.source && end.outFrame <= start.bodyStart + start.bodyFrames;
  const trim = { inFrame: start.inFrame - start.bodyStart, outFrame: end.outFrame - start.bodyStart };
  const merged: StoryNode = { ...first, ...behaviors(last), loopCount: last.loopCount,
    conditions: conditionsFor(graph, last), defaultConditionId: last.defaultConditionId,
    crossfadeEnd: last.crossfadeEnd,
    referenceId: selected.has(first.referenceId ?? '') ? undefined : first.referenceId,
    ...(keepGenerated ? { trim: trim.inFrame === 0 && trim.outFrame === start.bodyFrames ? undefined : trim }
      : { kind: 'source', interstitialId: undefined, trim: undefined, source: { ...first.source,
        assetId: start.assetId, duration: start.duration, inFrame: start.inFrame, outFrame: end.outFrame } }) };
  const owner = graph.groups?.find(group => group.nodeIds.includes(first.id))
    ?? ordered.flatMap(node => graph.groups?.filter(group => group.nodeIds.includes(node.id)) ?? [])[0];
  const remap = (id: string) => selected.has(id) ? first.id : id;
  return { ok: true, nodeId: first.id, count: selected.size, graph: { ...graph,
    entryId: remap(graph.entryId),
    nodes: graph.nodes.flatMap(node => node.id === first.id ? [merged] : selected.has(node.id) ? []
      : [{ ...node, referenceId: node.referenceId ? remap(node.referenceId) : undefined }]),
    edges: graph.edges.filter(edge => !selected.has(edge.from) || !selected.has(edge.to) || edge.from === last.id && edge.to === last.id)
      .map(edge => ({ ...edge, from: remap(edge.from), to: remap(edge.to) })),
    groups: graph.groups?.map(group => ({ ...group, nodeIds: group.id === owner?.id
      ? [...new Set(group.nodeIds.map(remap))] : group.nodeIds.filter(id => !selected.has(id)) })).filter(group => group.nodeIds.length || group.bounds),
  } };
}
