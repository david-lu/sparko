import { useEffect, useRef, useState, type DragEvent } from 'react';
import { TIMELINE_FPS } from '../../../shared/constants';
import { MAX_VIDEO_KEYFRAMES, type VideoKeyframe } from '../../../shared/video-keyframes';
import type { InterstitialSettings } from '../../../shared/interstitials';
import type { ProjectController } from '../project/ProjectController';
import type { LibraryAsset } from '../project/types';
import { fileEntries } from '../project/libraryFiles';
import { assets as mediaAssets } from '../project/assets';
import { LIBRARY_MOVE_TYPE, STORY_DRAG_TYPE, readLibraryMove } from '../story-flow/libraryDrag';

type Placement = { asset: LibraryAsset; frame: number; frames: number; image: boolean };
type Props = {
  active: boolean; projects?: ProjectController; item: InterstitialSettings; prefix: number; middle: number; total: number;
  onChange: (patch: Partial<InterstitialSettings>) => void;
  onKeyframesChange: (update: (current: VideoKeyframe[]) => VideoKeyframe[]) => void;
  onFrame: (frame: number) => void; onSelect: (type: 'image' | 'video', id: string) => void;
};
/** Read Library payloads during dragstart; browsers protect them during dragover. */
export function useGenerationDrop(props: Props) {
  const current = useRef(props); current.current = props;
  const dragged = useRef<string[]>([]), mounted = useRef(true);
  const [preview, setPreview] = useState<{ frame: number; placements: Placement[]; error?: string }>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const resolveIds = (data: DataTransfer) => readLibraryMove(data).flatMap(selection => {
    const id = selection.type === 'asset' ? selection.id : current.current.projects?.getSnapshot().project?.clipGenerations?.find(g => g.id === selection.id)?.selectedAssetId;
    return id ? [id] : [];
  });
  useEffect(() => {
    mounted.current = true;
    const start = (event: globalThis.DragEvent) => { if (event.dataTransfer) dragged.current = resolveIds(event.dataTransfer); };
    const end = () => { dragged.current = []; setPreview(undefined); };
    window.addEventListener('dragstart', start); window.addEventListener('dragend', end); window.addEventListener('drop', end);
    return () => { mounted.current = false; window.removeEventListener('dragstart', start); window.removeEventListener('dragend', end); window.removeEventListener('drop', end); };
  }, []);
  const position = (event: DragEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(), { prefix, middle, total } = current.current;
    return Math.max(0, Math.min(middle - 1, Math.round((event.clientX - bounds.left) / bounds.width * total) - prefix));
  };
  const plan = (assets: LibraryAsset[], frame: number) => {
    const { item, middle } = current.current;
    const placements: Placement[] = []; let cursor = frame;
    const images = assets.filter(asset => asset.kind === 'image');
    if (images.length + (item.keyframes?.length ?? 0) > MAX_VIDEO_KEYFRAMES) throw new Error('Use up to 9 image keyframes.');
    if (assets.length - images.length + (item.timelineVideos?.length ?? 0) > 16) throw new Error('Use up to 16 timeline videos.');
    for (const asset of assets) {
      if (!['image', 'video', 'generated'].includes(asset.kind)) throw new Error('Drop an image or video from the Library.');
      const image = asset.kind === 'image', frames = image ? 1 : Math.min(middle - cursor, Math.max(1, Math.floor((asset.duration ?? 1) * TIMELINE_FPS)));
      if (cursor >= middle || frames < 1) throw new Error('Not enough room here. Move earlier or increase Duration.');
      if (image && (item.keyframes?.some(k => k.enabled && k.frame === cursor) || cursor === 0 && item.startImageIndex !== undefined || cursor === middle - 1 && item.endImageIndex !== undefined)) throw new Error('An image already guides this frame. Drop on another frame.');
      if (!image && item.timelineVideos?.some(v => v.enabled && v.video && cursor < v.frame + v.video.outFrame - v.video.inFrame && cursor + frames > v.frame)) throw new Error('This overlaps another video. Drop in an empty interval.');
      placements.push({ asset, image, frame: cursor, frames }); cursor += frames;
    }
    return placements;
  };
  const accepts = (event: DragEvent) => [LIBRARY_MOVE_TYPE, STORY_DRAG_TYPE, 'Files'].some(type => event.dataTransfer.types.includes(type));
  const handlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (!props.active || busy || !props.projects) { event.dataTransfer.dropEffect = 'none'; return; }
      const frame = position(event), library = props.projects.getSnapshot().project?.library ?? [];
      const ids = dragged.current.length ? dragged.current : resolveIds(event.dataTransfer);
      try {
        const placements = plan(ids.flatMap(id => library.filter(asset => asset.assetId === id)), frame);
        setPreview({ frame, placements }); event.dataTransfer.dropEffect = 'copy';
      } catch (error) { setPreview({ frame, placements: [], error: (error as Error).message }); event.dataTransfer.dropEffect = 'none'; }
      props.onFrame(props.prefix + frame);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(undefined); },
    onDrop: async (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (!props.active || busy || !props.projects) return;
      const frame = position(event), ids = resolveIds(event.dataTransfer), files = [...event.dataTransfer.files];
      setPreview(undefined); setMessage(''); setBusy(true);
      const projectId = props.projects.getSnapshot().project?.id;
      try {
        const library = props.projects.getSnapshot().project?.library ?? [];
        const assets = files.length ? await props.projects.importAssets(fileEntries(files)) : ids.flatMap(id => library.filter(asset => asset.assetId === id));
        if (!mounted.current || props.projects.getSnapshot().project?.id !== projectId) return;
        if (!assets.length) throw new Error('Choose a saved image or video from the Library.');
        for (const asset of assets) {
          const media = await mediaAssets.open(asset.assetId);
          if (asset.kind === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(media.asset.blob.type)) throw new Error('Use a PNG, JPEG or WebP image for a keyframe.');
        }
        if (!mounted.current || props.projects.getSnapshot().project?.id !== projectId) return;
        const placements = plan(assets, frame), next = placements.map(p => ({ ...p, id: crypto.randomUUID() }));
        const now = current.current;
        const images = next.filter(p => p.image), videos = next.filter(p => !p.image);
        if (images.length) now.onKeyframesChange(old => [...old, ...images.map(p => ({ id: p.id, frame: p.frame, enabled: true, method: 'guide' as const, image: { assetId: p.asset.assetId, name: p.asset.name } }))]);
        if (videos.length) now.onChange({ timelineVideos: [...now.item.timelineVideos ?? [], ...videos.map(p => ({ id: p.id, frame: p.frame, enabled: true, video: { assetId: p.asset.assetId, name: p.asset.name, inFrame: 0, outFrame: p.frames } }))] });
        now.onSelect(next[0].image ? 'image' : 'video', next[0].id); now.onFrame(now.prefix + next[0].frame);
      } catch (error) { if (mounted.current) setMessage((error as Error).message); }
      finally { if (mounted.current) setBusy(false); }
    },
  };
  return { preview, busy, message, handlers };
}
