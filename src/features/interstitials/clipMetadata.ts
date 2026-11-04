import { TIMELINE_FPS } from '../../../shared/constants';
import { clipOriginSchema, type ClipMetadata, type ClipOrigin } from '../../../shared/clip-metadata';
import { interstitialSettings, playableResult, type GenerationReference, type Interstitial, type InterstitialResult } from '../../../shared/interstitials';
import { behaviors, conditionsFor } from '../story-flow/behaviors';
import { edge, freshId, runtimeFlow, withReferenceFade, type StoryGraph, type StoryNode } from '../story-flow/model';
import { sceneMediaRange } from '../story-flow/mediaRange';

export function captureClipOrigin(item: Interstitial, reference: GenerationReference | undefined, graph?: StoryGraph, items: Interstitial[] = []): ClipOrigin {
  const node = graph?.nodes.find(n => n.interstitialId === item.id);
  const describe = (ref: GenerationReference['before']) => {
    if (!ref) return;
    const source = graph?.nodes.find(n => n.id === ref.sceneId);
    const saved = items.find(i => i.id === source?.interstitialId);
    const renderId = saved && playableResult(saved)?.metadata?.id;
    return { ...ref, name: source?.name ?? saved?.label ?? 'Saved reference clip', ...(renderId ? { renderId } : {}) };
  };
  return clipOriginSchema.parse({ format: 'sparko-clip', version: 1, fps: TIMELINE_FPS, id: freshId(), createdAt: new Date().toISOString(),
    clip: { ...(node ? { nodeId: node.id } : {}), name: item.label, time: item.time,
      ...(node ? behaviors(node) : { loop: reference?.mode === 'loop', conditional: false }), loopCount: node?.loopCount ?? 0,
      ...(node && graph ? { conditions: conditionsFor(graph, node) } : {}), ...(node?.defaultConditionId ? { defaultConditionId: node.defaultConditionId } : {}) },
    settings: interstitialSettings(item), references: { mode: reference?.mode ?? 'custom',
      ...(reference?.before ? { before: describe(reference.before) } : {}), ...(reference?.after ? { after: describe(reference.after) } : {}) },
  });
}

export function restoreClip(metadata: ClipMetadata, assetId: string, duration: number): { node: StoryNode; item: Interstitial } | undefined {
  // Tags may survive an unrelated trim/re-encode. Only accept boundaries matching this file.
  if (Math.abs(metadata.media.totalDuration - duration) > 1 / TIMELINE_FPS + 0.001
    || metadata.media.start + metadata.media.duration > duration + 1 / TIMELINE_FPS) return;
  // A standalone MP4 carries provenance, but not its attached reference files.
  const id = freshId(), nodeId = freshId(), settings = interstitialSettings({ ...metadata.settings, imageReferences: undefined,
    startVideoAsset: undefined, endVideoAsset: undefined, useStartVideoAsset: false, useEndVideoAsset: false });
  const result: InterstitialResult = { url: `asset:${assetId}`, assetId, ...metadata.media, prompt: metadata.prompt, metadata,
    reference: { mode: metadata.references.mode ?? 'custom' } };
  return {
    node: { id: nodeId, name: metadata.clip.name, kind: 'simple', interstitialId: id, x: 0, y: 0,
      loop: metadata.clip.loop, conditional: metadata.clip.conditional, loopCount: metadata.clip.loopCount,
      conditions: metadata.clip.conditions, defaultConditionId: metadata.clip.defaultConditionId, trim: metadata.clip.trim },
    item: { ...settings, id, label: metadata.clip.name, time: metadata.clip.time, phase: 'ready', result,
      generationSettings: settings, requestPrompt: metadata.prompt, requestInsertion: metadata.media },
  };
}

/** Match identities AND ranges. Never guess by filename or replace an existing route. */
export function reconnectClipReferences(graph: StoryGraph, items: Interstitial[], imported: Interstitial[]): StoryGraph {
  const flow = runtimeFlow(graph, items, '', 0);
  let edges = [...graph.edges];
  for (const item of imported) {
    const metadata = item.result?.metadata, node = graph.nodes.find(n => n.interstitialId === item.id);
    if (!metadata || !node) continue;
    const reference: GenerationReference = { mode: metadata.references.mode ?? 'custom' };
    for (const side of ['before', 'after'] as const) {
      const saved = metadata.references[side]; if (!saved) continue;
      const candidates = flow.scenes.filter(scene => {
        if (scene.id === node.id || scene.draft) return false;
        const range = sceneMediaRange(scene, flow.fps);
        return (range.assetId === saved.assetId || !!saved.renderId && scene.generated?.metadata?.id === saved.renderId)
          && Math.round(range.start * flow.fps) === saved.inFrame && Math.round(range.end * flow.fps) === saved.outFrame;
      });
      const exact = candidates.find(scene => scene.id === saved.sceneId), match = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!match) continue;
      const range = sceneMediaRange(match, flow.fps);
      reference[side] = { sceneId: match.id, assetId: range.assetId, inFrame: saved.inFrame, outFrame: saved.outFrame };
      const from = side === 'before' ? match.id : node.id, to = side === 'before' ? node.id : match.id;
      const source = graph.nodes.find(n => n.id === from)!;
      if (!behaviors(source).conditional && !edges.some(e => e.from === from)) edges.push(withReferenceFade(edge(from, to), graph.nodes));
    }
    item.result = { ...item.result!, reference };
  }
  return { ...graph, edges };
}
