import { isGenerating, playableResult, type ClipReference, type GenerationReference, type Interstitial } from '../../../shared/interstitials';
import { sameReference, type ClipDependency } from '../call-response/dependencies';
import { runtimeFlow, type StoryGraph } from './model';
import { sceneMediaRange } from './mediaRange';
import { connectedReferences, storyGenerationItem } from './referenceInputs';
import type { ContentIssue } from '../../shared/ContentIssues';

/** Resolve current wires; each saved render retains its own immutable provenance. */
export function storyDependency(graph: StoryGraph, items: Interstitial[], assetId: string, duration: number, itemId: string, assetError: (id: string) => string | undefined = () => undefined): ClipDependency {
  const node = graph.nodes.find(n => n.interstitialId === itemId), saved = items.find(i => i.id === itemId);
  if (!node || !saved) return { label: 'Source', stale: false };
  const item = storyGenerationItem(saved, node), connected = connectedReferences(graph, node.id);
  const loop = item.method === 'comfy-loop';
  const flow = runtimeFlow(graph, items, assetId, duration), byId = new Map(flow.scenes.map(s => [s.id, s]));
  const ref = (id: string): ClipReference => {
    const scene = byId.get(id)!, range = sceneMediaRange(scene, flow.fps);
    return { sceneId: id, assetId: range.assetId, inFrame: Math.round(range.start * flow.fps), outFrame: Math.round(range.end * flow.fps) };
  };
  const matches = (input: ClipReference, current: ClipReference) => {
    const scene = byId.get(current.sceneId)!;
    return input.assetId === current.assetId && input.inFrame === current.inFrame && input.outFrame === current.outFrame
      || !!scene && input.assetId === scene.clip.assetId && input.inFrame === scene.clip.inFrame && input.outFrame === scene.clip.outFrame;
  };
  const input: GenerationReference = { mode: loop ? 'loop' : 'custom' };
  const issues: ContentIssue[] = [];
  const add = (side: 'start' | 'end', reason: string, message: string) => issues.push({ key: `${side}:${reason}`, side, title: `${loop ? 'Loop' : side === 'start' ? 'Start' : 'End'} reference`, message });
  const imageEndpoints = new Set<number>();
  for (const [side, enabled, index] of [['start', item.useInputReference, item.startImageIndex], ['end', item.useOutputReference, item.endImageIndex]] as const) {
    if (loop && side === 'end') continue;
    if (!enabled && index !== undefined) {
      imageEndpoints.add(index);
      const image = item.imageReferences?.[index];
      if (!image) add(side, 'image', `Add an image for the ${loop ? 'loop' : side} reference, or choose a different reference type.`);
      else if (assetError(image.assetId)) add(side, 'media', `${image.name}: ${assetError(image.assetId)}`);
    }
  }
  for (const [index, image] of (item.imageReferences ?? []).entries()) {
    if (!imageEndpoints.has(index) && assetError(image.assetId)) issues.push({ key: `image:${index}`, title: `Picture ${index + 1}`, message: `${image.name}: ${assetError(image.assetId)}` });
  }
  for (const side of ['input', 'output'] as const) {
    if (loop && side === 'output') continue;
    if (!(side === 'input' ? item.useInputReference : item.useOutputReference)) continue;
    const endpoint = side === 'input' ? 'start' : 'end';
    const missingMedia = (id: string, name: string) => { const error = assetError(id); if (error) add(endpoint, 'media', `${name}: ${error}`); };
    const arbitrary = side === 'input' ? item.useStartVideoAsset : item.useEndVideoAsset;
    if (arbitrary) {
      const asset = side === 'input' ? item.startVideoAsset : item.endVideoAsset;
      if (!asset) { add(endpoint, 'video', `Choose a video for the ${loop ? 'loop' : endpoint} reference.`); continue; }
      input[side === 'input' ? 'before' : 'after'] = { sceneId: `asset:${asset.assetId}`, assetId: asset.assetId, inFrame: asset.inFrame, outFrame: asset.outFrame };
      missingMedia(asset.assetId, asset.name);
      if (!Number.isFinite(asset.inFrame) || !Number.isFinite(asset.outFrame) || asset.inFrame < 0 || asset.outFrame <= asset.inFrame) add(endpoint, 'range', `The selected range in ${asset.name} is empty or invalid. Set Out after In, or choose another video.`);
      continue;
    }
    const ids = connected[side];
    if (ids.length !== 1) {
      add(endpoint, 'connection', ids.length
        ? `${loop ? 'Loop' : side === 'input' ? 'Start (input)' : 'End (output)'} reference needs one connected clip; ${ids.length} are connected. Keep one connection, enable Choose another video and drag in a Library video, or select None.`
        : `Connect ${side === 'input' ? 'an incoming' : 'a following'} clip for the ${loop ? 'loop' : endpoint} reference, enable Choose another video and drag in a Library video, or select None.`);
      continue;
    }
    if (!byId.has(ids[0])) { add(endpoint, 'clip', 'The connected clip no longer exists. Reconnect an available clip, choose a Library video, or select None.'); continue; }
    input[side === 'input' ? 'before' : 'after'] = ref(ids[0]);
    const scene = byId.get(ids[0])!, job = items.find(i => i.id === scene.interstitialId);
    if (job && isGenerating(job)) add(endpoint, 'pending', `Wait for ${scene.label} to finish generating, or choose another reference.`);
    else if (scene.draft) add(endpoint, 'draft', `Generate ${scene.label} first: it has no video output yet. You can also choose a Library video, use an image, or select None.`);
    if (!scene.draft) missingMedia(ref(ids[0]).assetId, scene.label);
    // Check saved footage, without recursively following future settings through playback cycles.
    for (const previous of [job && playableResult(job)?.reference?.before, job && playableResult(job)?.reference?.after]) {
      if (previous && byId.has(previous.sceneId) && !matches(previous, ref(previous.sceneId))) {
        add(endpoint, 'stale', `Regenerate ${scene.label} to match its updated reference first.`); break;
      }
    }
  }
  if (loop && input.before) input.after = { ...input.before };
  const submitted = playableResult(saved)?.reference, normalized = submitted ? { ...submitted } : undefined;
  if (normalized) {
    if (normalized.mode !== 'loop') normalized.mode = 'custom';
    for (const side of ['before', 'after'] as const) {
      if (normalized[side] && input[side] && matches(normalized[side]!, input[side]!)) normalized[side] = input[side];
    }
  }
  return { label: byId.get(input.before?.sceneId ?? input.after?.sceneId ?? '')?.label ?? (input.before && item.useStartVideoAsset ? item.startVideoAsset?.name : input.after && item.useEndVideoAsset ? item.endVideoAsset?.name : undefined) ?? 'No reference footage', reference: input, issues, blocked: issues[0]?.message, stale: !!normalized && !sameReference(normalized, input) };
}
