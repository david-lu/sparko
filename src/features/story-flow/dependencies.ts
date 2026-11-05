import { referenceClips, setReferenceClips } from '../../../shared/reference-clips';
import { videoAssets } from '../../../shared/video-references';
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
    return { ...(scene.storyNode?.source?.kind === 'image' ? { kind: 'image' as const } : {}), sceneId: id, assetId: range.assetId, inFrame: Math.round(range.start * flow.fps), outFrame: Math.round(range.end * flow.fps) };
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
      const clips = videoAssets(item, endpoint);
      if (!clips.length) { add(endpoint, 'video', `Choose videos or images for the ${loop ? 'loop' : endpoint} reference.`); continue; }
      setReferenceClips(input, side === 'input' ? 'before' : 'after', clips.map(asset => ({
        sceneId: `asset:${asset.assetId}`, assetId: asset.assetId, inFrame: asset.inFrame, outFrame: asset.outFrame, kind: asset.kind,
      })));
      for (const asset of clips) {
        missingMedia(asset.assetId, asset.name);
        if (!Number.isFinite(asset.inFrame) || !Number.isFinite(asset.outFrame) || asset.inFrame < 0 || asset.outFrame <= asset.inFrame) add(endpoint, 'range', `The selected range in ${asset.name} is empty or invalid. Set Out after In, or choose another clip.`);
      }
      continue;
    }
    const ids = connected[side];
    if (ids.length !== 1) {
      add(endpoint, 'connection', ids.length
        ? `${loop ? 'Loop' : side === 'input' ? 'Start (input)' : 'End (output)'} reference needs one connected clip; ${ids.length} are connected. Keep one connection, enable Choose other videos / images and drag in Library footage, or select None.`
        : `Connect ${side === 'input' ? 'an incoming' : 'a following'} clip for the ${loop ? 'loop' : endpoint} reference, enable Choose other videos / images and drag in Library footage, or select None.`);
      continue;
    }
    if (!byId.has(ids[0])) { add(endpoint, 'clip', 'The connected clip no longer exists. Reconnect an available clip, choose a Library video, or select None.'); continue; }
    const clips: ClipReference[] = [], visited = new Set([node.id]);
    let remaining = Math.ceil((side === 'input' ? item.start_range : item.end_range) * flow.fps), current: string | undefined = ids[0];
    while (current && !visited.has(current)) {
      visited.add(current);
      const scene = byId.get(current);
      if (!scene) { add(endpoint, 'clip', 'The connected clip no longer exists. Reconnect an available clip.'); break; }
      const clip = ref(current), job = items.find(i => i.id === scene.interstitialId);
      clips.push(clip);
      if (job && isGenerating(job)) add(endpoint, 'pending', `Wait for ${scene.label} to finish generating, or choose another reference.`);
      else if (scene.draft) add(endpoint, 'draft', `Generate ${scene.label} first: it has no video output yet. You can also choose Library footage, use an image, or select None.`);
      if (!scene.draft) missingMedia(clip.assetId, scene.label);
      const savedReference = job && playableResult(job)?.reference;
      for (const previous of [...referenceClips(savedReference, 'before'), ...referenceClips(savedReference, 'after')]) {
        if (byId.has(previous.sceneId) && !matches(previous, ref(previous.sceneId))) {
          add(endpoint, 'stale', `Regenerate ${scene.label} to match its updated reference first.`); break;
        }
      }
      remaining -= clip.outFrame - clip.inFrame;
      if (remaining <= 0 || scene.draft) break;
      const neighbors: string[] = connectedReferences(graph, current)[side].filter(id => !visited.has(id));
      if (neighbors.length > 1) {
        add(endpoint, 'connection', `${scene.label} has ${neighbors.length} possible ${side === 'input' ? 'previous' : 'following'} clips. Choose reference footage in Library to fill this window without an ambiguous path.`);
        break;
      }
      current = neighbors[0];
    }
    setReferenceClips(input, side === 'input' ? 'before' : 'after', side === 'input' ? clips.reverse() : clips);
  }
  if (loop && input.before) input.after = { ...input.before };

  const submitted = playableResult(saved)?.reference, normalized = submitted ? { ...submitted } : undefined;
  if (normalized) {
    if (normalized.mode !== 'loop') normalized.mode = 'custom';
    for (const side of ['before', 'after'] as const) {
      const submittedClips = referenceClips(normalized, side), currentClips = referenceClips(input, side);
      if (submittedClips.length === currentClips.length && submittedClips.every((clip, index) => matches(clip, currentClips[index]))) setReferenceClips(normalized, side, currentClips);
    }
  }
  return { label: byId.get(input.before?.sceneId ?? input.after?.sceneId ?? '')?.label ?? (input.before && item.useStartVideoAsset ? videoAssets(item, 'start').map(a => a.name).join(' → ') : input.after && item.useEndVideoAsset ? videoAssets(item, 'end').map(a => a.name).join(' → ') : undefined) ?? 'No reference footage', reference: input, issues, blocked: issues[0]?.message, stale: !!normalized && !sameReference(normalized, input) };
}
